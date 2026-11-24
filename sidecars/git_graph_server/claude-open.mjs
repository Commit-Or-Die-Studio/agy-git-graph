#!/usr/bin/env node
// AGY Git Graph - Claude 桌面版啟動腳本（由 Claude 的 git-graph skill 呼叫）
//
// 用法：
//   node claude-open.mjs --repo <Session 專案資料夾> [--port 52899]
//       檢查 / 啟動伺服器並輸出開啟網址（一行 JSON）
//   node claude-open.mjs --repo <資料夾> --save-ssh <使用者@主機> [--ssh-port 22] [--local-port 52898]
//       （SSH 模式）儲存這台機器的通道設定後，照常輸出
//   node claude-open.mjs --repo <資料夾> --wait-connected <秒數> --since <毫秒時間戳>
//       等待瀏覽器頁面連上伺服器（頁面開啟時會呼叫 /api/client-hello），輸出是否連上
//
// 一般模式：
//   1. 檢查指定埠號上是否已有本外掛的伺服器在執行（GET /api/health）
//   2. 沒有 → 以「脫離任何 Session 的獨立程序」啟動 server.mjs；版本較舊 → 結束後改啟動新版
//   3. 輸出 { ok, mode: "local", url, version, reused, repo, since }
//
// SSH 模式（偵測到 SSH_CONNECTION，例如 Claude 桌面版透過 SSH 連到遠端機器）：
//   瀏覽器窗格在使用者本機，連不到遠端的 localhost，需要使用者在本機開 SSH 通道。
//   通道設定依「這台機器」（伺服器 IP + SSH 埠）記錄於 ~/.config/agy-git-graph/ssh-tunnels.json，
//   同一台機器上的所有專案與 Session 共用；輸出另含 configured、target、localPort、sshCommand。
//
// 伺服器與 AGY 自己的 Sidecar 各自獨立（不同埠號、不同程序），互不影響。

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, 'server.mjs');
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_PORT = 52899;
const DEFAULT_LOCAL_PORT = 52898; // SSH 模式下使用者本機的通道埠號（避開本機自己的 Git Graph 52899）

function parseArgs(argv) {
  const args = { repo: process.cwd(), port: DEFAULT_PORT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--repo' && next) { args.repo = next; i++; }
    else if (a === '--port' && next) { args.port = parseInt(next, 10) || DEFAULT_PORT; i++; }
    else if (a === '--save-ssh' && next) { args.saveSsh = next; i++; }
    else if (a === '--ssh-port' && next) { args.sshPort = parseInt(next, 10) || undefined; i++; }
    else if (a === '--local-port' && next) { args.localPort = parseInt(next, 10) || undefined; i++; }
    else if (a === '--wait-connected' && next) { args.waitConnected = Math.max(1, parseInt(next, 10) || 60); i++; }
    else if (a === '--since' && next) { args.since = Number(next) || 0; i++; }
  }
  return args;
}

const output = (data) => console.log(JSON.stringify(data));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function readInstalledVersion() {
  for (const name of ['plugin.json', 'package.json']) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, name), 'utf8'));
      if (data && data.version) return String(data.version).trim();
    } catch {}
  }
  return '';
}

async function getJson(port, endpoint) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function getHealth(port) {
  const data = await getJson(port, '/api/health');
  return data && data.ok && data.name === 'agy-git-graph' ? data : null;
}

async function waitFor(check, timeoutMs, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(intervalMs);
  }
  return null;
}

function startDetachedServer(port) {
  const env = { ...process.env };
  // 確保以獨立模式啟動（不被誤判為 AGY 管理）
  delete env.ANTIGRAVITY_SIDECAR_WEB_PORT;
  delete env.PORT;
  const child = spawn(process.execPath, [SERVER_PATH, '--port', String(port)], {
    cwd: __dirname,
    env,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
}

// 取 Git 倉庫根目錄（在子資料夾開啟 Session 時也能顯示整個倉庫）；非 Git 資料夾則原樣傳入
function resolveRepoRoot(dir) {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    }).trim();
    return out ? path.normalize(out) : path.resolve(dir);
  } catch {
    return path.resolve(dir);
  }
}

// ---------------------------------------------------------------------------
// SSH 模式：偵測與依機器記錄通道設定
// ---------------------------------------------------------------------------

// SSH_CONNECTION = "<用戶端 IP> <用戶端埠> <伺服器 IP> <伺服器 SSH 埠>"
function detectSsh() {
  const parts = String(process.env.SSH_CONNECTION || '').trim().split(/\s+/);
  if (parts.length < 4) return null;
  const [, , serverIp, serverPort] = parts;
  let user = process.env.USER || process.env.LOGNAME || '';
  try { user = os.userInfo().username || user; } catch {}
  return {
    hostKey: `${serverIp}:${serverPort}`,
    suggestedTarget: user ? `${user}@${serverIp}` : serverIp,
    suggestedSshPort: parseInt(serverPort, 10) || 22
  };
}

function tunnelsFile() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'agy-git-graph', 'ssh-tunnels.json');
}

function loadTunnels() {
  try {
    const data = JSON.parse(fs.readFileSync(tunnelsFile(), 'utf8'));
    return data && typeof data === 'object' && data.hosts ? data : { hosts: {} };
  } catch {
    return { hosts: {} };
  }
}

function saveTunnels(data) {
  const file = tunnelsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// SSH 通道安裝檔（Windows 用戶端）的下載位置
const TUNNEL_INSTALLER_URL = 'https://github.com/Commit-Or-Die-Studio/agy-git-graph/releases/latest';

// 使用者電腦（Windows）已安裝 SSH 通道時：把這台機器加入背景通道並立即啟動（只需執行一次）
function buildWindowsTunnelCommand({ target, sshPort, localPort }) {
  const script = '$env:LOCALAPPDATA\\agy-git-graph\\ssh-tunnel\\git-graph-tunnel.ps1';
  return `powershell -NoProfile -ExecutionPolicy Bypass -File "${script}" -Add "${target}" -Port ${sshPort || 22} -LocalPort ${localPort} -Start`;
}

function buildSshCommand({ target, sshPort, localPort }, remotePort) {
  const portFlag = sshPort && sshPort !== 22 ? ` -p ${sshPort}` : '';
  return `ssh -N -L ${localPort}:127.0.0.1:${remotePort}${portFlag} ${target}`;
}

// ---------------------------------------------------------------------------

async function waitConnected({ port, repoRoot, seconds, since, ssh }) {
  if (!(await getHealth(port))) {
    output({ ok: false, connected: false, error: `Git Graph 伺服器未在 ${port} 埠執行，請重新執行 /git-graph` });
    return;
  }
  const query = `/api/client-seen?repo=${encodeURIComponent(repoRoot)}&since=${since || 0}`;
  const seen = await waitFor(async () => {
    const data = await getJson(port, query);
    return data && data.seen ? data : null;
  }, seconds * 1000, 1000);

  if (seen && ssh) {
    const tunnels = loadTunnels();
    const entry = tunnels.hosts[ssh.hostKey];
    if (entry) {
      entry.verifiedAt = new Date().toISOString();
      saveTunnels(tunnels);
    }
  }
  output({ ok: true, connected: Boolean(seen), at: seen ? seen.at : 0, waitedSeconds: seconds });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { port } = args;
  const repoRoot = resolveRepoRoot(args.repo);
  const ssh = detectSsh();

  if (args.waitConnected) {
    await waitConnected({ port, repoRoot, seconds: args.waitConnected, since: args.since, ssh });
    return;
  }

  // SSH 模式：儲存這台機器的通道設定（同機器所有專案共用）
  if (args.saveSsh) {
    if (!ssh) {
      output({ ok: false, error: '目前不是 SSH 工作階段，無需設定 SSH 通道' });
      process.exit(1);
    }
    const tunnels = loadTunnels();
    const prev = tunnels.hosts[ssh.hostKey] || {};
    tunnels.hosts[ssh.hostKey] = {
      target: args.saveSsh,
      sshPort: args.sshPort || prev.sshPort || ssh.suggestedSshPort,
      localPort: args.localPort || prev.localPort || DEFAULT_LOCAL_PORT,
      savedAt: new Date().toISOString(),
      verifiedAt: null
    };
    saveTunnels(tunnels);
  }

  const installedVersion = readInstalledVersion();
  let reused = false;

  let health = await getHealth(port);
  if (health && !health.agyManaged && installedVersion && health.version !== installedVersion) {
    // 執行中的是舊版：結束後改啟動新版
    try { process.kill(health.pid); } catch {}
    await waitFor(async () => !(await getHealth(port)), 5000);
    health = null;
  }

  if (health) {
    reused = true;
  } else {
    startDetachedServer(port);
    health = await waitFor(() => getHealth(port), 12000);
    if (!health) {
      output({
        ok: false,
        error: `Git Graph 伺服器無法在 ${port} 埠啟動（可能被其他程式佔用，或未安裝 Node.js）`
      });
      process.exit(1);
    }
  }

  const repoQuery = `?repo=${encodeURIComponent(repoRoot)}`;
  const since = Date.now();
  const base = { ok: true, version: health.version, reused, repo: repoRoot, since };

  if (!ssh) {
    output({ ...base, mode: 'local', url: `http://localhost:${port}/${repoQuery}` });
    return;
  }

  const saved = loadTunnels().hosts[ssh.hostKey];
  const tunnel = saved
    ? { target: saved.target, sshPort: saved.sshPort || 22, localPort: saved.localPort || DEFAULT_LOCAL_PORT }
    : { target: ssh.suggestedTarget, sshPort: ssh.suggestedSshPort, localPort: DEFAULT_LOCAL_PORT };

  output({
    ...base,
    mode: 'ssh',
    configured: Boolean(saved),
    verifiedAt: saved ? saved.verifiedAt || null : null,
    hostKey: ssh.hostKey,
    target: tunnel.target,
    sshPort: tunnel.sshPort,
    localPort: tunnel.localPort,
    sshCommand: buildSshCommand(tunnel, port),
    windowsTunnelCommand: buildWindowsTunnelCommand(tunnel),
    tunnelInstallerUrl: TUNNEL_INSTALLER_URL,
    url: `http://localhost:${tunnel.localPort}/${repoQuery}`
  });
}

main().catch(err => {
  output({ ok: false, error: err && err.message ? err.message : String(err) });
  process.exit(1);
});
