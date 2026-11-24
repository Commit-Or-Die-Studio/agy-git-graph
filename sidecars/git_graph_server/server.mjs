import http from 'node:http';
import crypto from 'node:crypto';
import { execFile, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const GITHUB_RELEASE_API = 'https://api.github.com/repos/Commit-Or-Die-Studio/agy-git-graph/releases/latest';

// 是否由 AGY Sidecar 管理：AGY 以 sidecar_sdk loader 啟動並負責重新拉起（restart_policy: always）。
// 否則為獨立模式（例如 Claude 桌面版的 git-graph skill 啟動），需自行重啟。
const IS_AGY_MANAGED = Boolean(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT) ||
  process.execArgv.some(arg => arg.includes('sidecar_sdk'));

// Claude Code 設定目錄（尊重 CLAUDE_CONFIG_DIR），用於同步 git-graph skill
function getClaudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// 本程序啟動時載入的程式版本（安裝檔案更新後，仍在執行的舊程序會回報舊版號，供啟動腳本判斷是否需重啟）
const RUNNING_VERSION = getLocalVersion();

const CLAUDE_SKILL_NAME = 'git-graph';
const CLAUDE_SKILL_MARKER = 'managed-by: agy-git-graph';
const CLAUDE_SKILL_SRC = path.join(PLUGIN_ROOT, 'claude', 'skills', CLAUDE_SKILL_NAME, 'SKILL.md');

// 啟動時同步 Claude skill：讓舊版透過一鍵更新升級後，也能自動補裝 / 更新 Claude 端的 /git-graph。
// 僅在已安裝 Claude（設定目錄存在）時寫入，且只覆寫帶有本外掛標記的檔案，不動使用者自己的同名 skill。
function syncClaudeSkill() {
  try {
    if (fs.existsSync(path.join(PLUGIN_ROOT, '.git'))) return; // 開發用 Git 倉庫不自動寫入
    const claudeDir = getClaudeConfigDir();
    if (!fs.existsSync(claudeDir) || !fs.existsSync(CLAUDE_SKILL_SRC)) return;

    const src = fs.readFileSync(CLAUDE_SKILL_SRC, 'utf8');
    const destDir = path.join(claudeDir, 'skills', CLAUDE_SKILL_NAME);
    const dest = path.join(destDir, 'SKILL.md');
    if (fs.existsSync(dest)) {
      const current = fs.readFileSync(dest, 'utf8');
      if (current === src) return;
      if (!current.includes(CLAUDE_SKILL_MARKER)) return;
    }
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(dest, src, 'utf8');
    console.log(`[Git Graph Sidecar] Claude skill synced: ${dest}`);
  } catch (err) {
    console.warn('[Git Graph Sidecar] Claude skill sync skipped:', err.message);
  }
}

// 讀取本地外掛版本號
function getLocalVersion() {
  for (const name of ['plugin.json', 'package.json']) {
    try {
      const p = path.join(PLUGIN_ROOT, name);
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (data && data.version) return String(data.version).trim();
      }
    } catch {}
  }
  return '1.0.0';
}

// 語意化版本比對 (a > b 回傳 1, a < b 回傳 -1, 相等回傳 0)
function compareSemver(a, b) {
  const pa = String(a || '').replace(/^v/i, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '').replace(/^v/i, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// 遞迴複製目錄
function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

const UPDATE_CHECK_COOLDOWN_MS = 60 * 1000; // 後端記憶體快取冷卻 60 秒，防止短時間重複開關面板或連點頻繁打 GitHub API
let releaseCheckCache = null; // { timestamp, data }
let releaseCheckInFlight = null;

async function fetchLatestReleaseInfo({ bypassCooldown = false } = {}) {
  const now = Date.now();
  if (!bypassCooldown && releaseCheckCache && now - releaseCheckCache.timestamp < UPDATE_CHECK_COOLDOWN_MS) {
    return { data: releaseCheckCache.data, cached: true };
  }

  if (releaseCheckInFlight) {
    const data = await releaseCheckInFlight;
    return { data, cached: false };
  }

  releaseCheckInFlight = (async () => {
    const res = await fetch(GITHUB_RELEASE_API, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'agy-git-graph-updater'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      throw new Error(`GitHub API HTTP ${res.status}`);
    }
    const data = await res.json();
    releaseCheckCache = { timestamp: Date.now(), data };
    return data;
  })();

  try {
    const data = await releaseCheckInFlight;
    return { data, cached: false };
  } finally {
    releaseCheckInFlight = null;
  }
}

let DatabaseSyncClass = null;
try {
  const sqlite = await import('node:sqlite');
  DatabaseSyncClass = sqlite.DatabaseSync;
} catch {}

// 輔助函式：路徑正規化比對 (跨平台相容)
function isSamePath(a, b) {
  if (!a || !b) return false;
  const normA = path.normalize(a).replace(/\\/g, '/').replace(/\/+$/, '');
  const normB = path.normalize(b).replace(/\\/g, '/').replace(/\/+$/, '');
  if (normA === normB) return true;
  return normA.toLowerCase() === normB.toLowerCase();
}

// 輔助函式：將各種 URI (包含 file://, vscode-remote://, ssh-remote://) 解析為本機或 Linux 實體路徑
function parseUriToPath(uri) {
  if (!uri) return '';
  try {
    if (uri.startsWith('file://')) {
      let p = uri.replace(/^file:\/\//, '');
      p = decodeURIComponent(p);
      if (/^\/[a-zA-Z]:/.test(p)) {
        p = p.slice(1);
      }
      return path.normalize(p);
    }
    if (uri.includes('://')) {
      const parsed = new URL(uri);
      let p = decodeURIComponent(parsed.pathname);
      if (/^\/[a-zA-Z]:/.test(p)) {
        p = p.slice(1);
      }
      return path.normalize(p);
    }
  } catch {}
  let p = decodeURIComponent(uri.replace(/^file:\/\//, ''));
  if (/^\/[a-zA-Z]:/.test(p)) {
    p = p.slice(1);
  }
  return path.normalize(p);
}

// 解析 .gitmodules 內容取得子模組資訊
function parseGitModules(content) {
  const submodules = [];
  let current = null;
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    const sectionMatch = trimmed.match(/^\[submodule\s+"?([^"\]]+)"?\]/i);
    if (sectionMatch) {
      if (current && current.relPath) submodules.push(current);
      current = { name: sectionMatch[1].trim(), relPath: '' };
      continue;
    }
    if (current) {
      const kvMatch = trimmed.match(/^path\s*=\s*(.+)$/i);
      if (kvMatch) {
        current.relPath = kvMatch[1].trim().replace(/^["']|["']$/g, '');
      }
    }
  }
  if (current && current.relPath) submodules.push(current);
  return submodules;
}

// 多管道深度偵測 Git Submodules 與巢狀 Git 倉庫
function getSubmodules(repoPath, depth = 0) {
  if (depth > 2) return [];
  const submodules = [];
  if (!repoPath || !fs.existsSync(repoPath)) return submodules;

  const foundRelPaths = new Set();

  // 管道 1：透過 Git 指令 git submodule status 取得正式註冊之子模組
  try {
    const gitSubStatus = execFileSync('git', ['submodule', 'status'], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 3000,
      windowsHide: true
    });
    if (gitSubStatus) {
      const lines = gitSubStatus.split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/^[\s\+\-U]?([0-9a-f]{40})\s+([^\s]+)/i);
        if (m) {
          const relPath = m[2].trim().replace(/\\/g, '/');
          if (relPath && !foundRelPaths.has(relPath)) {
            foundRelPaths.add(relPath);
            const fullPath = path.normalize(path.join(repoPath, relPath));
            const isGit = fs.existsSync(path.join(fullPath, '.git'));
            submodules.push({
              name: path.basename(relPath),
              relPath,
              path: fullPath,
              isGit
            });
          }
        }
      }
    }
  } catch {}

  // 管道 2：解析 .gitmodules 檔案 (支援未初始化或特殊註冊)
  const gitmodulesPath = path.join(repoPath, '.gitmodules');
  if (fs.existsSync(gitmodulesPath)) {
    try {
      const content = fs.readFileSync(gitmodulesPath, 'utf8');
      const parsed = parseGitModules(content);
      for (const item of parsed) {
        const relPath = item.relPath.replace(/\\/g, '/');
        if (relPath && !foundRelPaths.has(relPath)) {
          foundRelPaths.add(relPath);
          const fullPath = path.normalize(path.join(repoPath, relPath));
          const isGit = fs.existsSync(path.join(fullPath, '.git'));
          submodules.push({
            name: item.name || path.basename(relPath),
            relPath,
            path: fullPath,
            isGit
          });
        }
      }
    } catch {}
  }

  // 管道 3：透過 git ls-files 檢查 Git 索引中的 160000 gitlink 記錄
  try {
    const lsFilesOut = execFileSync('git', ['ls-files', '--stage'], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 3000,
      windowsHide: true
    });
    if (lsFilesOut) {
      const lines = lsFilesOut.split(/\r?\n/);
      for (const line of lines) {
        if (line.startsWith('160000 ')) {
          const parts = line.split('\t');
          if (parts.length > 1) {
            const relPath = parts[1].trim().replace(/\\/g, '/');
            if (relPath && !foundRelPaths.has(relPath)) {
              foundRelPaths.add(relPath);
              const fullPath = path.normalize(path.join(repoPath, relPath));
              const isGit = fs.existsSync(path.join(fullPath, '.git'));
              submodules.push({
                name: path.basename(relPath),
                relPath,
                path: fullPath,
                isGit
              });
            }
          }
        }
      }
    }
  } catch {}

  // 管道 4：自動掃描 1~2 層子目錄中內含 .git 的巢狀倉庫 (特別針對 Odoo 與多 Repo 工作區)
  try {
    const entries = fs.readdirSync(repoPath, { withFileTypes: true });
    const ignoreNames = new Set(['.git', 'node_modules', '.gemini', '.vscode', '.idea', 'venv', '.venv', '__pycache__', 'dist', 'build', '.cache']);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (ignoreNames.has(name) || name.startsWith('.')) continue;

      const subPath = path.join(repoPath, name);
      const gitPath = path.join(subPath, '.git');
      const rel1 = name.replace(/\\/g, '/');

      if (fs.existsSync(gitPath)) {
        if (!foundRelPaths.has(rel1)) {
          foundRelPaths.add(rel1);
          submodules.push({
            name,
            relPath: rel1,
            path: path.normalize(subPath),
            isGit: true
          });
        }
      } else {
        // 檢查下一層 (例如 addons/custom/.git 或 src/odoo/.git)
        try {
          const subEntries = fs.readdirSync(subPath, { withFileTypes: true });
          for (const subEntry of subEntries) {
            if (!subEntry.isDirectory()) continue;
            const subName = subEntry.name;
            if (ignoreNames.has(subName) || subName.startsWith('.')) continue;

            const subSubPath = path.join(subPath, subName);
            if (fs.existsSync(path.join(subSubPath, '.git'))) {
              const rel2 = `${name}/${subName}`.replace(/\\/g, '/');
              if (!foundRelPaths.has(rel2)) {
                foundRelPaths.add(rel2);
                submodules.push({
                  name: `${name}/${subName}`,
                  relPath: rel2,
                  path: path.normalize(subSubPath),
                  isGit: true
                });
              }
            }
          }
        } catch {}
      }
    }
  } catch {}

  return submodules;
}

// 記憶體快取：避免切換 Session 時每次都深度掃描專案目錄與數十個子模組
let cachedProjects = null;
let lastProjectsFetchTime = 0;
const sessionConvCache = new Map();

// 初始預設倉庫路徑（自動尋找當前工作區或 AGY 已註冊的 Git 專案，支援本機與 SSH 遠端）
function getAgyProjects(force = false) {
  const now = Date.now();
  if (!force && cachedProjects && (now - lastProjectsFetchTime < 30000)) {
    return cachedProjects;
  }

  const projects = [];
  const homedir = os.homedir();
  const candidateDirs = [
    path.join(homedir, '.gemini', 'config', 'projects'),
    path.join(homedir, '.gemini', 'antigravity', 'projects'),
    path.join(homedir, '.config', 'antigravity', 'projects'),
    path.join(homedir, '.gemini', 'projects')
  ];

  for (const configProjectsDir of candidateDirs) {
    if (!fs.existsSync(configProjectsDir)) continue;
    try {
      const files = fs.readdirSync(configProjectsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = fs.readFileSync(path.join(configProjectsDir, file), 'utf8').replace(/^\uFEFF/, '');
          const data = JSON.parse(raw);
          if (data.projectResources) {
            const resList = Array.isArray(data.projectResources.resources)
              ? data.projectResources.resources
              : [data.projectResources];
            for (const res of resList) {
              const uri = (res.gitFolder && res.gitFolder.folderUri) || res.folderUri || res.workspaceUri || res.fileUri || res.uri;
              if (uri) {
                const p = parseUriToPath(uri);
                if (p) {
                  const isGit = fs.existsSync(path.join(p, '.git'));
                  const submodules = isGit ? getSubmodules(p) : [];
                  projects.push({
                    id: data.id,
                    name: data.name || path.basename(p),
                    path: p,
                    isGit,
                    submodules
                  });
                }
              }
            }
          }
        } catch {}
      }
    } catch {}
  }

  cachedProjects = projects;
  lastProjectsFetchTime = Date.now();
  return projects;
}

// 依據 AGY 對話 (Session) ID 解析對應的 Git 專案路徑 (含記憶體快取)
function resolveSessionRepo(convId) {
  if (convId && sessionConvCache.has(convId)) {
    return sessionConvCache.get(convId);
  }

  const projects = getAgyProjects();
  if (projects.length === 0) return null;

  const homedir = os.homedir();
  const appDataDir = process.env.ANTIGRAVITY_APP_DATA_DIR || path.join(homedir, '.gemini', 'antigravity');

  // 1. 若有指定 convId，優先比對該對話的 convDbPath
  if (convId && /^[0-9a-f-]{8,}$/i.test(convId)) {
    const convDbPath = path.join(appDataDir, 'conversations', `${convId}.db`);
    if (fs.existsSync(convDbPath)) {
      try {
        const fd = fs.openSync(convDbPath, 'r');
        const headerBuf = Buffer.alloc(36);
        const readBytes = fs.readSync(fd, headerBuf, 0, 36, 327644);
        if (readBytes === 36) {
          const candidateId = headerBuf.toString('latin1');
          const exactHit = projects.find(p => p.id === candidateId);
          if (exactHit) {
            fs.closeSync(fd);
            sessionConvCache.set(convId, exactHit);
            return exactHit;
          }
        }

        const scanBuf = Buffer.alloc(512 * 1024);
        const scanBytes = fs.readSync(fd, scanBuf, 0, scanBuf.length, 0);
        fs.closeSync(fd);
        const scanStr = scanBuf.toString('latin1', 0, scanBytes);
        for (const p of projects) {
          if (p.id && scanStr.includes(p.id)) {
            sessionConvCache.set(convId, p);
            return p;
          }
        }
      } catch {}
    }
  }

  // 2. 次選方案：從 conversation_summaries.db 查詢該對話或最近活躍對話之專案綁定
  if (DatabaseSyncClass) {
    try {
      const summariesDbPath = path.join(appDataDir, 'conversation_summaries.db');
      if (fs.existsSync(summariesDbPath)) {
        const db = new DatabaseSyncClass(summariesDbPath, { readOnly: true });
        let row = null;
        if (convId) {
          row = db.prepare('SELECT project_id, workspace_uris FROM conversation_summaries WHERE conversation_id = ?').get(convId);
        } else {
          row = db.prepare("SELECT conversation_id, project_id, workspace_uris FROM conversation_summaries WHERE project_id != 'outside-of-project' AND project_id IS NOT NULL ORDER BY last_modified_time DESC LIMIT 1").get();
        }
        db.close();

        if (row) {
          if (row.project_id) {
            const hit = projects.find(p => p.id === row.project_id);
            if (hit) {
              if (convId) sessionConvCache.set(convId, hit);
              return hit;
            }
          }
          if (row.workspace_uris) {
            try {
              const uris = JSON.parse(row.workspace_uris);
              if (Array.isArray(uris) && uris.length > 0) {
                const parsed = parseUriToPath(uris[0]);
                const hit = projects.find(p => isSamePath(p.path, parsed));
                if (hit) {
                  if (convId) sessionConvCache.set(convId, hit);
                  return hit;
                }
              }
            } catch {}
          }
        }
      }
    } catch {}
  }

  return null;
}

function resolveInitialRepo() {
  if (process.env.WORKSPACE_ROOT && fs.existsSync(path.join(process.env.WORKSPACE_ROOT, '.git'))) {
    return process.env.WORKSPACE_ROOT;
  }
  return '';
}

let currentRepoPath = resolveInitialRepo();

// 解析 CLI 參數與環境變數取得 Port
function getPort() {
  const envPort = process.env.ANTIGRAVITY_SIDECAR_WEB_PORT || process.env.PORT;
  if (envPort) return parseInt(envPort, 10);
  const argIdx = process.argv.indexOf('--port');
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    return parseInt(process.argv[argIdx + 1], 10);
  }
  return 52888;
}

// 執行 Git 命令
async function runGit(args, cwd = currentRepoPath) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
      encoding: 'utf8',
      // 唯讀查詢不取得 .git/index.lock，避免與 AGY / 使用者的 git 操作互搶鎖、也避免改寫 index 觸發假變更
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
    });
    return {
      ok: true,
      stdout: stdout ? stdout.replace(/[\r\n]+$/, '') : '',
      stderr: stderr ? stderr.replace(/[\r\n]+$/, '') : ''
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      stderr: err.stderr ? err.stderr.replace(/[\r\n]+$/, '') : '',
      stdout: err.stdout ? err.stdout.replace(/[\r\n]+$/, '') : ''
    };
  }
}

// 解析 Refs (裝飾標籤：HEAD、分支、遠端分支、Tag)
function parseRefs(refStr) {
  if (!refStr) return [];
  const clean = refStr.replace(/^\s*\(/, '').replace(/\)\s*$/, '').trim();
  if (!clean) return [];

  const parts = clean.split(',').map(s => s.trim());
  const badges = [];

  for (const part of parts) {
    if (!part || part === 'refs/stash') continue;
    if (part.startsWith('HEAD -> ')) {
      const branchName = part.replace('HEAD -> ', '').trim().replace(/^refs\/heads\//, '');
      badges.push({ type: 'head', name: branchName, isHead: true });
    } else if (part === 'HEAD') {
      badges.push({ type: 'head', name: 'HEAD', isHead: true });
    } else if (part.startsWith('tag: ') || part.startsWith('refs/tags/')) {
      const tagName = part.replace(/^tag:\s*/, '').replace(/^refs\/tags\//, '').trim();
      badges.push({ type: 'tag', name: tagName });
    } else if (part.startsWith('refs/heads/')) {
      badges.push({ type: 'branch', name: part.replace(/^refs\/heads\//, '').trim() });
    } else if (part.startsWith('refs/remotes/')) {
      const remoteRef = part.replace(/^refs\/remotes\//, '').trim();
      if (!remoteRef.endsWith('/HEAD')) {
        badges.push({ type: 'remote', name: remoteRef });
      }
    } else if (part.startsWith('origin/')) {
      if (!part.endsWith('/HEAD')) {
        badges.push({ type: 'remote', name: part });
      }
    } else {
      badges.push({ type: 'branch', name: part });
    }
  }
  return badges;
}

// 分支圖軌道 (Lanes) 與連線 (Links) 計算演算法
function calculateGraphLayout(commits) {
  const lanes = [];
  const commitMap = new Map();

  // 第一階段：決定每個 commit 所在的 column (x)
  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row];
    commitMap.set(commit.hash, commit);

    let laneIndex = lanes.indexOf(commit.hash);
    if (laneIndex === -1) {
      laneIndex = lanes.findIndex(x => x === null);
      if (laneIndex === -1) {
        laneIndex = lanes.length;
        lanes.push(commit.hash);
      } else {
        lanes[laneIndex] = commit.hash;
      }
    }

    commit.x = laneIndex;
    commit.y = row;

    if (commit.parents && commit.parents.length > 0) {
      lanes[laneIndex] = commit.parents[0];
      for (let i = 1; i < commit.parents.length; i++) {
        const pHash = commit.parents[i];
        let pLane = lanes.indexOf(pHash);
        if (pLane === -1) {
          pLane = lanes.findIndex(x => x === null);
          if (pLane === -1) {
            pLane = lanes.length;
            lanes.push(pHash);
          } else {
            lanes[pLane] = pHash;
          }
        }
      }
    } else {
      lanes[laneIndex] = null;
    }
  }

  // 第二階段：連線生成 (從子 commit 連到父 commit)
  const links = [];
  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row];
    if (!commit.parents) continue;

    for (let pIdx = 0; pIdx < commit.parents.length; pIdx++) {
      const pHash = commit.parents[pIdx];
      const parent = commitMap.get(pHash);
      if (parent) {
        links.push({
          fromX: commit.x,
          fromY: commit.y,
          toX: parent.x,
          toY: parent.y,
          isMerge: pIdx > 0,
          colorIndex: pIdx === 0 ? commit.x : parent.x
        });
      }
    }
  }

  const maxLanes = Math.max(1, ...commits.map(c => c.x + 1));
  return { commits, links, maxLanes };
}

// 靜態檔案類型對應
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// 輔助函式：發送 JSON
function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=UTF-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

// 輔助函式：發送靜態檔案
function serveStatic(req, res, filePath) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// 建立 HTTP 伺服器
const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  // CORS 預檢請求
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // 取得 query 參數中指定的 repo，若無則使用 currentRepoPath
  const queryRepo = reqUrl.searchParams.get('repo') || currentRepoPath;

  // API: 取得 AGY 註冊專案清單與 Submodules (依當前工作區與 Session 分組)
  if (pathname === '/api/projects' && req.method === 'GET') {
    const allProjects = getAgyProjects();

    // 依據 path 進行去重
    const uniqueProjects = [];
    const seenPaths = new Set();
    for (const p of allProjects) {
      const norm = p.path.toLowerCase().replace(/\\/g, '/');
      if (!seenPaths.has(norm)) {
        seenPaths.add(norm);
        uniqueProjects.push(p);
      }
    }

    // 尋找當前工作區對應之專案 (優先比對主目錄與子模組目錄)
    let currentProject = null;
    let currentTarget = queryRepo || currentRepoPath;

    if (currentTarget) {
      for (const p of uniqueProjects) {
        if (isSamePath(p.path, currentTarget)) {
          currentProject = p;
          break;
        }
        if (p.submodules) {
          for (const sub of p.submodules) {
            if (isSamePath(sub.path, currentTarget)) {
              currentProject = p;
              break;
            }
          }
        }
        if (currentProject) break;
      }
    }

    // 若 currentTarget 不在已知專案中，但本機路徑存在，動態構建當前專案
    if (!currentProject && currentTarget && fs.existsSync(currentTarget)) {
      const isGit = fs.existsSync(path.join(currentTarget, '.git'));
      const submodules = isGit ? getSubmodules(currentTarget) : [];
      currentProject = {
        id: 'current-workspace',
        name: path.basename(currentTarget),
        path: currentTarget,
        isGit,
        submodules
      };
    }

    // 若仍無 currentProject，優先以最近活躍的對話專案作為預設工作區
    if (!currentProject) {
      const activeProj = resolveSessionRepo('');
      if (activeProj && activeProj.isGit) {
        currentProject = activeProj;
      }
    }

    // 若仍無 currentProject 且有專案清單，優先挑選具有 Git 的專案
    if (!currentProject && uniqueProjects.length > 0) {
      currentProject = uniqueProjects.find(p => p.isGit) || uniqueProjects[0];
    }

    // 其餘 Session 專案 (排除 currentProject，防止重複)
    const sessionProjects = uniqueProjects.filter(p => {
      if (!currentProject) return true;
      return !isSamePath(p.path, currentProject.path);
    });

    return sendJson(res, {
      ok: true,
      currentRepo: currentTarget || (currentProject ? currentProject.path : ''),
      currentProject,
      sessionProjects,
      projects: currentProject ? [currentProject, ...sessionProjects] : sessionProjects
    });
  }

  // API: 依 Session ID 自動解析對應的 Git 專案
  if (pathname === '/api/resolve-session' && req.method === 'GET') {
    const convId = reqUrl.searchParams.get('conv') || '';
    const project = resolveSessionRepo(convId);
    if (project) {
      return sendJson(res, {
        ok: true,
        found: true,
        projectId: project.id,
        projectName: project.name,
        repoPath: project.path,
        isGit: project.isGit
      });
    }
    return sendJson(res, { ok: true, found: false });
  }

  // API: 倉庫狀態檢查
  if (pathname === '/api/status' && req.method === 'GET') {
    if (!queryRepo) {
      return sendJson(res, {
        ok: true,
        isGit: false,
        repoPath: '',
        error: '當前對話工作區無 Git 倉庫'
      });
    }
    const isGit = await runGit(['rev-parse', '--is-inside-work-tree'], queryRepo);
    if (!isGit.ok) {
      return sendJson(res, {
        ok: true,
        isGit: false,
        repoPath: queryRepo,
        error: '當前對話工作區無 Git 倉庫'
      });
    }

    const [branchRes, topLevelRes, statusRes, remoteRes] = await Promise.all([
      runGit(['rev-parse', '--abbrev-ref', 'HEAD'], queryRepo),
      runGit(['rev-parse', '--show-toplevel'], queryRepo),
      runGit(['status', '--porcelain', '--ignore-submodules=dirty'], queryRepo),
      runGit(['config', '--get', 'remote.origin.url'], queryRepo)
    ]);

    const statusLines = (statusRes.stdout || '').split('\n').filter(Boolean);
    const stagedCount = statusLines.filter(l => /^[MADRC]/.test(l)).length;
    const unstagedCount = statusLines.filter(l => /^.[MADRCU]/.test(l)).length;
    const untrackedCount = statusLines.filter(l => /^\?\?/.test(l)).length;

    const targetRepo = topLevelRes.stdout || queryRepo;
    const submodules = getSubmodules(targetRepo);

    return sendJson(res, {
      ok: true,
      isGit: true,
      repoPath: targetRepo,
      currentBranch: branchRes.stdout || 'HEAD',
      isClean: statusLines.length === 0,
      stagedCount,
      unstagedCount,
      untrackedCount,
      remoteUrl: remoteRes.stdout || '',
      submodules
    });
  }

  // API: 輕量檢測本地 Git 狀態變更 (Watch State，含遠端分支指標與子模組快速過濾)
  if (pathname === '/api/watch-state' && req.method === 'GET') {
    if (!queryRepo) return sendJson(res, { ok: true, stateHash: '' });

    const [headRes, branchRes, remotesRes, statusRes] = await Promise.all([
      runGit(['rev-parse', 'HEAD'], queryRepo),
      runGit(['rev-parse', '--abbrev-ref', 'HEAD'], queryRepo),
      runGit(['for-each-ref', '--format=%(refname):%(objectname)', 'refs/remotes/'], queryRepo),
      runGit(['status', '--porcelain', '--ignore-submodules=dirty'], queryRepo)
    ]);

    // 任一指令暫時失敗 (例如其他程序正在操作倉庫) 時不回傳 stateHash，避免空字串造成「假變更 → 重刷 → 恢復 → 再重刷」
    const headUnborn = !headRes.ok && /unknown revision|ambiguous argument 'HEAD'|bad revision/i.test(headRes.stderr || '');
    if ((!headRes.ok && !headUnborn) || !branchRes.ok || !remotesRes.ok || !statusRes.ok) {
      return sendJson(res, { ok: false, transient: true });
    }

    const head = headRes.stdout || '';
    const branch = branchRes.stdout || '';
    const remotes = remotesRes.stdout || '';
    const statusText = statusRes.stdout || '';
    const statusCount = statusText ? statusText.split('\n').filter(Boolean).length : 0;
    const graphHash = `${head}:${branch}:${remotes}`;
    const stateHash = `${graphHash}:${statusText}`;

    return sendJson(res, {
      ok: true,
      graphHash,
      stateHash,
      isClean: statusCount === 0
    });
  }

  // API: 取得工作區未提交變更清單
  if (pathname === '/api/working-tree' && req.method === 'GET') {
    if (!queryRepo) return sendJson(res, { ok: false, error: 'No repo' }, 400);

    const statusRes = await runGit(['-c', 'core.quotepath=false', 'status', '--porcelain', '-uall'], queryRepo);
    if (!statusRes.ok) return sendJson(res, { ok: false, error: statusRes.error }, 500);

    const lines = (statusRes.stdout || '').split('\n').filter(Boolean);
    const files = [];

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '');
      if (!line) continue;

      // 支援標準 2 字元狀態碼 (例: " M README.md", "?? new.txt", "A  file.js")
      // 或開頭空格被 trim 掉的情況 (例: "M README.md")
      const match = line.match(/^([ MADRCU?]{1,2})\s+(.+)$/);
      if (!match) continue;

      const code = match[1];
      let filePath = match[2].trim();
      if (filePath.startsWith('"') && filePath.endsWith('"')) {
        filePath = filePath.slice(1, -1);
      }

      let status = 'M';
      let label = '修改';

      if (code.includes('?')) {
        status = '?';
        label = '未追蹤';
      } else if (code.includes('A')) {
        status = 'A';
        label = '新增';
      } else if (code.includes('D')) {
        status = 'D';
        label = '刪除';
      } else if (code.includes('R')) {
        status = 'R';
        label = '重命名';
      } else if (code.includes('M')) {
        status = 'M';
        label = '修改';
      }

      files.push({
        raw: code,
        status,
        label,
        path: filePath,
        staged: code.length === 2 ? (code.charAt(0) !== ' ' && code.charAt(0) !== '?') : false
      });
    }

    return sendJson(res, {
      ok: true,
      isClean: files.length === 0,
      files
    });
  }

  // API: 取得工作區未提交檔案的 Diff
  if (pathname === '/api/working-diff' && req.method === 'GET') {
    let filePath = reqUrl.searchParams.get('file');
    if (!filePath) return sendJson(res, { ok: false, error: 'file is required' }, 400);
    if (filePath.startsWith('"') && filePath.endsWith('"')) {
      filePath = filePath.slice(1, -1);
    }

    // 先嘗試取得 HEAD 與當前檔案的 diff（包含 staged 與 unstaged）
    let diffRes = await runGit(['-c', 'core.quotepath=false', 'diff', 'HEAD', '--', filePath], queryRepo);

    // 若 HEAD 比對為空（可能為剛新增的未追蹤檔案或空 commit）
    if (!diffRes.stdout) {
      diffRes = await runGit(['-c', 'core.quotepath=false', 'diff', '--', filePath], queryRepo);
    }

    let diffText = diffRes.stdout || '';

    // 如果仍無 diff，檢查是否為未追蹤新檔案 (??)，若是則生成整份新增內容 diff
    if (!diffText) {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(queryRepo, filePath);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const lines = content.split('\n');
          diffText = `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n` + lines.map(l => `+${l}`).join('\n');
        } catch {}
      }
    }

    return sendJson(res, {
      ok: true,
      file: filePath,
      diff: diffText
    });
  }

  // API: 取得分支清單
  if (pathname === '/api/branches' && req.method === 'GET') {
    const branchesRes = await runGit(['branch', '-a', '--format=%(refname:short)|%(HEAD)'], queryRepo);
    if (!branchesRes.ok) {
      return sendJson(res, { ok: false, error: branchesRes.error }, 500);
    }
    const lines = (branchesRes.stdout || '').split('\n').filter(Boolean);
    const branches = lines.map(line => {
      const [name, isHead] = line.split('|');
      return {
        name,
        isHead: isHead === '*',
        isRemote: name.startsWith('origin/') || name.includes('/')
      };
    });
    return sendJson(res, { ok: true, branches });
  }

// Commit Log 記憶體快取 (避免龐大倉庫重複計算拓撲佈局)
const commitLogCache = new Map(); // key -> { timestamp, data }

// 取得 Commit 分支走向資料
  if (pathname === '/api/commits' && req.method === 'GET') {
    const limit = parseInt(reqUrl.searchParams.get('limit') || '150', 10);
    const branch = reqUrl.searchParams.get('branch') || 'all';

    // 先取得目前 HEAD hash 作為快取版本校驗
    const headRes = await runGit(['rev-parse', 'HEAD'], queryRepo);
    const headHash = headRes.stdout ? headRes.stdout.trim() : '';
    const cacheKey = `${queryRepo}:${branch}:${limit}:${headHash}`;

    if (headHash && commitLogCache.has(cacheKey)) {
      const cached = commitLogCache.get(cacheKey);
      if (Date.now() - cached.timestamp < 60000) {
        return sendJson(res, cached.data);
      }
    }

    const args = ['log', '--decorate=full', '--topo-order', '--no-color', '--date=iso-strict', '--pretty=format:%H|%h|%P|%an|%ae|%aI|%s|%d', `-n${limit}`];
    if (branch === 'all') {
      args.splice(1, 0, '--all');
    } else {
      args.splice(1, 0, branch);
    }

    const logRes = await runGit(args, queryRepo);
    if (!logRes.ok) {
      return sendJson(res, { ok: false, error: logRes.error }, 500);
    }

    const lines = (logRes.stdout || '').split('\n').filter(Boolean);
    const rawCommits = lines.map(line => {
      const parts = line.split('|');
      const hash = parts[0] || '';
      const shortHash = parts[1] || '';
      const parents = parts[2] ? parts[2].split(' ').filter(Boolean) : [];
      const author = parts[3] || '';
      const email = parts[4] || '';
      const date = parts[5] || '';
      const subject = parts[6] || '';
      const refStr = parts.slice(7).join('|') || '';
      const refs = parseRefs(refStr);

      return {
        hash,
        shortHash,
        parents,
        author,
        email,
        date,
        subject,
        refs
      };
    });

    const layout = calculateGraphLayout(rawCommits);
    const responseData = {
      ok: true,
      repoPath: queryRepo,
      commits: layout.commits,
      links: layout.links,
      maxLanes: layout.maxLanes,
      total: layout.commits.length
    };

    if (cacheKey && headHash) {
      // 限制快取大小，避免記憶體無限膨脹
      if (commitLogCache.size > 20) {
        const oldestKey = commitLogCache.keys().next().value;
        commitLogCache.delete(oldestKey);
      }
      commitLogCache.set(cacheKey, { timestamp: Date.now(), data: responseData });
    }

    return sendJson(res, responseData);
  }

  // API: 取得單一 Commit 詳情與變更檔案清單
  if (pathname.startsWith('/api/commit/') && req.method === 'GET') {
    const hash = pathname.replace('/api/commit/', '').trim();
    if (!hash) return sendJson(res, { ok: false, error: 'Commit hash is required' }, 400);

    const [detailsRes, filesRes] = await Promise.all([
      runGit(['show', '-s', '--format=%H|%h|%an|%ae|%aI|%s%n%b', hash], queryRepo),
      runGit(['diff-tree', '--no-commit-id', '--name-status', '-r', hash], queryRepo)
    ]);

    if (!detailsRes.ok) {
      return sendJson(res, { ok: false, error: detailsRes.error }, 500);
    }

    const firstLineEnd = detailsRes.stdout.indexOf('\n');
    let header = detailsRes.stdout;
    let body = '';
    if (firstLineEnd !== -1) {
      header = detailsRes.stdout.slice(0, firstLineEnd);
      body = detailsRes.stdout.slice(firstLineEnd + 1).trim();
    }
    const [fullHash, shortHash, author, email, date, subject] = header.split('|');

    const fileLines = (filesRes.stdout || '').split('\n').filter(Boolean);
    const files = fileLines.map(line => {
      const parts = line.split('\t');
      return {
        status: parts[0] || 'M',
        path: parts[1] || parts[0]
      };
    });

    return sendJson(res, {
      ok: true,
      hash: fullHash || hash,
      shortHash: shortHash || hash.substring(0, 7),
      author,
      email,
      date,
      subject,
      body,
      files
    });
  }

  // API: 取得單一檔案的 Diff
  if (pathname === '/api/diff' && req.method === 'GET') {
    const hash = reqUrl.searchParams.get('hash');
    const filePath = reqUrl.searchParams.get('file');
    if (!hash || !filePath) {
      return sendJson(res, { ok: false, error: 'hash and file are required' }, 400);
    }

    const diffRes = await runGit(['show', '--pretty=format:', hash, '--', filePath], queryRepo);
    return sendJson(res, {
      ok: true,
      hash,
      file: filePath,
      diff: diffRes.stdout || ''
    });
  }

  // API: 切換目標 Repository
  if (pathname === '/api/set-repo' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const target = data.repoPath;
        if (!target) return sendJson(res, { ok: false, error: 'repoPath is required' }, 400);

        const testRes = await runGit(['rev-parse', '--show-toplevel'], target);
        if (!testRes.ok) {
          return sendJson(res, { ok: false, error: `Invalid git repository: ${testRes.error}` }, 400);
        }

        currentRepoPath = testRes.stdout;
        return sendJson(res, { ok: true, repoPath: currentRepoPath });
      } catch (err) {
        return sendJson(res, { ok: false, error: err.message }, 500);
      }
    });
    return;
  }

  // API: 手動拉取遠端最新分支與 Commit (Git Fetch)
  if (pathname === '/api/fetch' && req.method === 'POST') {
    if (!queryRepo) return sendJson(res, { ok: false, error: 'No repo' }, 400);
    const fetchRes = await runGit(['fetch', '--prune', '--quiet'], queryRepo);
    return sendJson(res, { ok: fetchRes.ok, error: fetchRes.error });
  }

  // API: 健康檢查（供 Claude 啟動腳本判斷伺服器是否已在執行、版本是否一致）
  if (pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, {
      ok: true,
      name: 'agy-git-graph',
      version: RUNNING_VERSION,
      installedVersion: getLocalVersion(),
      pid: process.pid,
      agyManaged: IS_AGY_MANAGED,
      pluginRoot: PLUGIN_ROOT
    });
  }

  // API: 檢查 GitHub 是否有新版本 Release
  if (pathname === '/api/update-check' && req.method === 'GET') {
    const currentVersion = getLocalVersion();
    try {
      const { data: release, cached } = await fetchLatestReleaseInfo();
      const latestVersion = String(release.tag_name || '').replace(/^v/i, '').trim() || currentVersion;
      const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;
      return sendJson(res, {
        ok: true,
        currentVersion,
        latestVersion,
        hasUpdate,
        cached,
        releaseName: release.name || `v${latestVersion}`,
        htmlUrl: release.html_url || '',
        body: release.body || ''
      });
    } catch (err) {
      return sendJson(res, {
        ok: true,
        currentVersion,
        latestVersion: currentVersion,
        hasUpdate: false,
        offline: true,
        error: err.message
      });
    }
  }

  // API: 一鍵下載並套用 GitHub 最新版本 Release (含 SHA-256 校驗與自動熱重啟)
  if (pathname === '/api/update-apply' && req.method === 'POST') {
    const currentVersion = getLocalVersion();
    let tmpDir = '';
    try {
      const { data: release } = await fetchLatestReleaseInfo({ bypassCooldown: true });
      const latestVersion = String(release.tag_name || '').replace(/^v/i, '').trim();
      if (!latestVersion || compareSemver(latestVersion, currentVersion) <= 0) {
        return sendJson(res, { ok: false, error: `目前已是最新版本 (v${currentVersion})` }, 400);
      }

      const assets = Array.isArray(release.assets) ? release.assets : [];
      const tarAsset = assets.find(a => a.name && a.name.endsWith('.tar.gz'));
      if (!tarAsset || !tarAsset.browser_download_url) {
        throw new Error('找不到新版本的 .tar.gz 更新套件');
      }

      // 1. 下載 .tar.gz 檔案
      const tarResp = await fetch(tarAsset.browser_download_url, {
        headers: { 'User-Agent': 'agy-git-graph-updater' },
        signal: AbortSignal.timeout(30000)
      });
      if (!tarResp.ok) {
        throw new Error(`下載更新包失敗 (HTTP ${tarResp.status})`);
      }
      const tarBuf = Buffer.from(await tarResp.arrayBuffer());

      // 2. 若有 SHA256SUMS.txt 則進行完整性校驗
      const sumAsset = assets.find(a => a.name === 'SHA256SUMS.txt');
      if (sumAsset && sumAsset.browser_download_url) {
        const sumResp = await fetch(sumAsset.browser_download_url, {
          headers: { 'User-Agent': 'agy-git-graph-updater' },
          signal: AbortSignal.timeout(10000)
        });
        if (sumResp.ok) {
          const sumText = await sumResp.text();
          const line = sumText.split(/\r?\n/).find(l => l.includes(tarAsset.name));
          if (line) {
            const expectedHash = line.trim().split(/\s+/)[0].toLowerCase();
            const actualHash = crypto.createHash('sha256').update(tarBuf).digest('hex').toLowerCase();
            if (expectedHash && expectedHash !== actualHash) {
              throw new Error('更新包 SHA-256 校驗碼不符，已中止安裝');
            }
          }
        }
      }

      // 3. 解壓縮至系統暫存目錄
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-git-graph-upd-'));
      const tarPath = path.join(tmpDir, tarAsset.name);
      fs.writeFileSync(tarPath, tarBuf);
      // Windows 一律使用系統內建 bsdtar（System32\tar.exe）：避免 PATH 中 Git Bash 的 GNU tar 無法解析 C:\ 路徑
      const systemTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
      const tarBin = process.platform === 'win32' ? (fs.existsSync(systemTar) ? systemTar : 'tar.exe') : 'tar';
      await execFileAsync(tarBin, ['-xzf', tarPath, '-C', tmpDir], { windowsHide: true });

      const extractedDir = path.join(tmpDir, 'agy-git-graph');
      const sourceDir = fs.existsSync(extractedDir) ? extractedDir : tmpDir;

      // 4. 覆蓋安裝至外掛目錄 (若當前為開發用 Git 倉庫，僅更新全域安裝目錄，保護開發區程式碼)
      const isDevRepo = fs.existsSync(path.join(PLUGIN_ROOT, '.git'));
      const globalPluginDir = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'agy-git-graph');

      if (!isDevRepo) {
        copyDirRecursive(sourceDir, PLUGIN_ROOT);
      }
      if (fs.existsSync(globalPluginDir) && !isSamePath(globalPluginDir, PLUGIN_ROOT)) {
        copyDirRecursive(sourceDir, globalPluginDir);
      }

      releaseCheckCache = null;

      sendJson(res, {
        ok: true,
        previousVersion: currentVersion,
        updatedTo: latestVersion,
        restarting: !isDevRepo
      });

      // 非開發模式下，延遲 400ms 後重啟為新版：AGY 模式交給 AGY 重新拉起，獨立模式自行重啟
      if (!isDevRepo) {
        setTimeout(restartSelf, 400);
      }
      return;
    } catch (err) {
      return sendJson(res, { ok: false, error: err.message }, 500);
    } finally {
      if (tmpDir) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }
    }
  }

  // API: 在系統預設瀏覽器以獨立全螢幕視窗開啟 Diff
  if (pathname === '/api/open-external') {
    const hash = reqUrl.searchParams.get('hash');
    const file = reqUrl.searchParams.get('file');
    let targetUrl = reqUrl.searchParams.get('url');

    if (hash && file) {
      targetUrl = `http://127.0.0.1:${PORT}/diff.html?hash=${encodeURIComponent(hash)}&file=${encodeURIComponent(file)}${queryRepo ? '&repo=' + encodeURIComponent(queryRepo) : ''}`;
    }

    if (!targetUrl) {
      return sendJson(res, { ok: false, error: 'hash & file or url is required' }, 400);
    }

    try {
      if (process.platform === 'win32') {
        // 使用 rundll32.exe 呼叫 ShellExecute 啟動預設瀏覽器，不經 cmd.exe，不受 & 符號干擾
        execFile('rundll32.exe', ['url.dll,FileProtocolHandler', targetUrl], (err) => {
          if (err) {
            execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${targetUrl.replace(/'/g, "''")}'`]);
          }
        });
      } else if (process.platform === 'darwin') {
        execFile('open', [targetUrl]);
      } else {
        execFile('xdg-open', [targetUrl], (err) => {
          if (err) {
            execFile('wslview', [targetUrl], () => {});
          }
        });
      }
      return sendJson(res, { ok: true, url: targetUrl });
    } catch (err) {
      return sendJson(res, { ok: false, error: err.message }, 500);
    }
  }

  // 靜態檔案路由
  let targetFile = pathname === '/' ? 'index.html' : pathname;
  targetFile = path.normalize(targetFile).replace(/^(\.\.[/\\])+/, '');
  const absPath = path.join(PUBLIC_DIR, targetFile);

  serveStatic(req, res, absPath);
});

const PORT = getPort();

// 重啟為新版伺服器
function restartSelf() {
  if (IS_AGY_MANAGED) {
    process.exit(0); // AGY (restart_policy: always) 會自動拉起新版
    return;
  }
  // 獨立模式：先停止監聽、釋放埠號，再以相同參數啟動一個脫離目前程序的新伺服器，最後結束自己
  let respawned = false;
  const respawn = () => {
    if (respawned) return;
    respawned = true;
    try {
      const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
        cwd: process.cwd(),
        env: process.env,
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.unref();
    } catch (err) {
      console.error('[Git Graph Sidecar] Failed to respawn:', err.message);
    }
    setTimeout(() => process.exit(0), 100);
  };
  server.close(respawn);
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  setTimeout(respawn, 1500); // 保險：連線未能及時關閉時仍繼續重啟
}

// 監聽埠號：若舊程序尚未釋放（自我重啟時），每 300ms 重試，最多約 10 秒
function startListening(attempt = 0) {
  server.once('error', (err) => {
    if (err && err.code === 'EADDRINUSE' && attempt < 33) {
      setTimeout(() => startListening(attempt + 1), 300);
      return;
    }
    console.error('[Git Graph Sidecar] Failed to listen:', err && err.message);
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[Git Graph Sidecar] Server running on http://127.0.0.1:${PORT} (${IS_AGY_MANAGED ? 'AGY' : 'standalone'})`);
    console.log(`[Git Graph Sidecar] Target repository: ${currentRepoPath}`);
  });
}

syncClaudeSkill();
startListening();
