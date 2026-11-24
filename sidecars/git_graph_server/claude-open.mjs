#!/usr/bin/env node
// AGY Git Graph - Claude 桌面版啟動腳本（由 Claude 的 git-graph skill 呼叫）
//
// 用法：node claude-open.mjs --repo <目前 Session 的專案資料夾> [--port 52899]
//
// 1. 檢查指定埠號上是否已有本外掛的伺服器在執行（GET /api/health）
// 2. 沒有 → 以「脫離任何 Session 的獨立程序」啟動 server.mjs；
//    版本與已安裝的外掛不同 → 先結束舊的再啟動新版
// 3. 輸出一行 JSON：{ ok, url, version, reused }，url 帶 ?repo= 供瀏覽器窗格開啟
//
// 伺服器與 AGY 自己的 Sidecar 各自獨立（不同埠號、不同程序），互不影響。

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, 'server.mjs');
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_PORT = 52899;

function parseArgs(argv) {
  const args = { repo: process.cwd(), port: DEFAULT_PORT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo' && argv[i + 1]) args.repo = argv[++i];
    else if (argv[i] === '--port' && argv[i + 1]) args.port = parseInt(argv[++i], 10) || DEFAULT_PORT;
  }
  return args;
}

function readInstalledVersion() {
  for (const name of ['plugin.json', 'package.json']) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, name), 'utf8'));
      if (data && data.version) return String(data.version).trim();
    } catch {}
  }
  return '';
}

async function getHealth(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.ok && data.name === 'agy-git-graph' ? data : null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitFor(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(300);
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

async function main() {
  const { repo, port } = parseArgs(process.argv.slice(2));
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
      console.log(JSON.stringify({
        ok: false,
        error: `Git Graph 伺服器無法在 ${port} 埠啟動（可能被其他程式佔用，或未安裝 Node.js）`
      }));
      process.exit(1);
    }
  }

  const repoRoot = resolveRepoRoot(repo);
  const url = `http://localhost:${port}/?repo=${encodeURIComponent(repoRoot)}`;
  console.log(JSON.stringify({ ok: true, url, version: health.version, reused, repo: repoRoot }));
}

main().catch(err => {
  console.log(JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }));
  process.exit(1);
});
