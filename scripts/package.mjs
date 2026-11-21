import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const STAGING_DIR = path.join(DIST_DIR, 'staging');

// 遞迴複製檔案 (排除版本控制與暫存檔)
function copyDirFiltered(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.git') || entry.name === '.DS_Store' || entry.name === 'Thumbs.db') continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirFiltered(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 計算 SHA-256
function getFileSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function bumpPatchVersion(ver) {
  const m = String(ver || '1.0.0').trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return `${ver}-next`;
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

async function packagePlugin() {
  console.log('========================================================');
  console.log('  AGY Git Graph - Release 打包建置程式');
  console.log('========================================================\n');

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  const baseVersion = pkg.version || '1.0.0';
  const useNext = process.argv.includes('--next');
  const verFlagIdx = process.argv.indexOf('--version');
  const explicitVer = verFlagIdx !== -1 ? process.argv[verFlagIdx + 1] : '';
  const version = explicitVer || (useNext ? bumpPatchVersion(baseVersion) : baseVersion);
  const pluginName = pkg.name || 'agy-git-graph';
  if (version !== baseVersion) {
    console.log(`📌 使用預覽/下一版本號打包: v${version} (工作區設定維持 v${baseVersion})\n`);
  }

  // 1. 準備暫存與輸出目錄
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const targetStaging = path.join(STAGING_DIR, pluginName);
  fs.mkdirSync(targetStaging, { recursive: true });

  // 2. 複製純淨外掛執行所需之核心檔案
  console.log('[1/4] 正在收集核心檔案至暫存區...');
  const rootFiles = ['plugin.json', 'package.json', 'README.md', 'LICENSE'];
  for (const file of rootFiles) {
    const src = path.join(ROOT_DIR, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(targetStaging, file));
    }
  }

  // 若為預覽/下一版本打包，僅更新暫存區內部的 manifest 版號，不更動工作區原始檔
  if (version !== baseVersion) {
    for (const jsonName of ['package.json', 'plugin.json']) {
      const stagedJsonPath = path.join(targetStaging, jsonName);
      if (fs.existsSync(stagedJsonPath)) {
        const data = JSON.parse(fs.readFileSync(stagedJsonPath, 'utf8'));
        data.version = version;
        fs.writeFileSync(stagedJsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
      }
    }
  }

  const rootDirs = ['assets', 'sidecars'];
  for (const dir of rootDirs) {
    const src = path.join(ROOT_DIR, dir);
    if (fs.existsSync(src)) {
      copyDirFiltered(src, path.join(targetStaging, dir));
    }
  }

  // 3. 生成發行壓縮包 (.zip 與 .tar.gz)
  console.log('[2/4] 正在打包生成核心發行檔案...');
  const zipName = `${pluginName}-v${version}.zip`;
  const tarName = `${pluginName}-v${version}.tar.gz`;
  const zipPath = path.join(DIST_DIR, zipName);
  const tarPath = path.join(DIST_DIR, tarName);

  const isWindows = process.platform === 'win32';

  // 生成 .zip
  if (isWindows) {
    try {
      await execFileAsync('tar.exe', ['-a', '-cf', zipPath, pluginName], { cwd: STAGING_DIR });
    } catch {
      const psCmd = `Compress-Archive -Path '${targetStaging}' -DestinationPath '${zipPath}' -Force`;
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd]);
    }
  } else {
    try {
      await execFileAsync('zip', ['-r', zipPath, pluginName], { cwd: STAGING_DIR });
    } catch {
      await execFileAsync('tar', ['-a', '-cf', zipPath, pluginName], { cwd: STAGING_DIR });
    }
  }

  // 生成 .tar.gz
  const tarBin = isWindows ? 'tar.exe' : 'tar';
  await execFileAsync(tarBin, ['-czf', tarPath, pluginName], { cwd: STAGING_DIR });

  // 清除暫存目錄
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });

  // 4. 生成雙平台「自解壓自動安裝執行檔」
  console.log('[3/4] 正在建置 Windows 與 Linux 自動安裝執行檔...');

  // 4a. Windows: 原生雙擊安裝與解除安裝執行檔 (.exe)
  if (isWindows && fs.existsSync(zipPath)) {
    const cscCandidates = [
      'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
      'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
    ];
    const cscPath = cscCandidates.find(p => fs.existsSync(p));
    const installerSrc = path.join(__dirname, 'installer.cs');

    if (cscPath && fs.existsSync(installerSrc)) {
      const exeOut = path.join(DIST_DIR, `${pluginName}-v${version}-setup.exe`);
      const uninstExeOut = path.join(DIST_DIR, `${pluginName}-v${version}-uninstall.exe`);
      try {
        // 安裝執行檔 (內嵌 zip payload)
        await execFileAsync(cscPath, [
          '/target:winexe',
          '/optimize+',
          `/out:${exeOut}`,
          `/resource:${zipPath},payload.zip`,
          '/reference:System.dll,System.Windows.Forms.dll,System.IO.Compression.dll,System.IO.Compression.FileSystem.dll',
          installerSrc
        ]);
        console.log(`   ✔ 已生成 Windows 雙擊安裝檔: ${path.basename(exeOut)}`);

        // 解除安裝執行檔
        await execFileAsync(cscPath, [
          '/target:winexe',
          '/optimize+',
          `/out:${uninstExeOut}`,
          '/reference:System.dll,System.Windows.Forms.dll,System.IO.Compression.dll,System.IO.Compression.FileSystem.dll',
          installerSrc
        ]);
        console.log(`   ✔ 已生成 Windows 雙擊解除安裝檔: ${path.basename(uninstExeOut)}`);
      } catch (err) {
        console.warn('   ❌ 編譯 Windows 執行檔失敗:', err.message);
      }
    }
  }

  // 4b. Linux / macOS: 單檔自解壓自動安裝與解除安裝執行腳本 (.sh)
  if (fs.existsSync(tarPath)) {
    const tarBuf = fs.readFileSync(tarPath);
    const base64Tar = tarBuf.toString('base64');
    const linuxSetupName = `${pluginName}-v${version}-setup.sh`;
    const linuxSetupPath = path.join(DIST_DIR, linuxSetupName);
    const linuxUninstName = `${pluginName}-v${version}-uninstall.sh`;
    const linuxUninstPath = path.join(DIST_DIR, linuxUninstName);

    const linuxScript = `#!/usr/bin/env bash
set -e

# AGY Git Graph - Linux / macOS Self-Extracting Installer (v${version})
TARGET_DIR="$HOME/.gemini/config/plugins/agy-git-graph"

if [ "$1" = "--uninstall" ] || [ "$1" = "-u" ]; then
  echo "正在終止可能執行的背景進程..."
  pkill -9 -f "server\.mjs" 2>/dev/null || true
  if [ -d "$TARGET_DIR" ]; then
    rm -rf "$TARGET_DIR"
    echo "🎉 AGY Git Graph 已成功解除安裝！"
  else
    echo "未發現已安裝的外掛目錄。"
  fi
  exit 0
fi

echo "========================================================"
echo "  AGY Git Graph - Linux / macOS 自動安裝程式 (v${version})"
echo "========================================================"
echo ""

echo "[1/3] 正在終止可能執行的舊背景進程..."
pkill -9 -f "server\.mjs" 2>/dev/null || true

echo "[2/3] 正在檢查與建立目標目錄: $TARGET_DIR..."
mkdir -p "$HOME/.gemini/config/plugins"

echo "[3/3] 正在從安裝檔自我解壓安裝核心檔案..."
base64 -d <<'EOF_PAYLOAD' | tar -xz -C "$HOME/.gemini/config/plugins/"
${base64Tar}
EOF_PAYLOAD

echo ""
echo "========================================================"
echo "  🎉 安裝成功！"
echo "  安裝目錄: $TARGET_DIR"
echo "  請重新開啟 Antigravity 應用程式即可於右側輔助面板開啟使用。"
echo "========================================================"
`;
    fs.writeFileSync(linuxSetupPath, linuxScript, 'utf8');
    console.log(`   ✔ 已生成 Linux 自解壓自動安裝檔: ${linuxSetupName}`);

    const linuxUninstScript = `#!/usr/bin/env bash
set -e

# AGY Git Graph - Linux / macOS Uninstaller (v${version})
TARGET_DIR="$HOME/.gemini/config/plugins/agy-git-graph"

echo "========================================================"
echo "  AGY Git Graph - Linux / macOS 解除安裝程式 (v${version})"
echo "========================================================"
echo ""

if [ "$1" != "-y" ] && [ "$1" != "--quiet" ]; then
  read -p "確定要解除安裝 AGY Git Graph 嗎？(y/N): " confirm
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "已取消解除安裝。"
    exit 0
  fi
fi

echo "正在終止背景進程..."
pkill -9 -f "server\.mjs" 2>/dev/null || true

if [ -d "$TARGET_DIR" ]; then
  rm -rf "$TARGET_DIR"
  echo "🎉 AGY Git Graph 已成功解除安裝！"
else
  echo "未發現已安裝的外掛目錄 ($TARGET_DIR)。"
fi
`;
    fs.writeFileSync(linuxUninstPath, linuxUninstScript, 'utf8');
    console.log(`   ✔ 已生成 Linux 自動解除安裝檔: ${linuxUninstName}`);
  }

  // 5. 計算 SHA-256 Checksums
  console.log('[4/4] 正在計算 SHA-256 校驗碼 (Checksums)...');
  const checksums = [];
  const distEntries = fs.readdirSync(DIST_DIR);

  for (const file of distEntries) {
    const filePath = path.join(DIST_DIR, file);
    if (fs.statSync(filePath).isFile() && (file.endsWith('.zip') || file.endsWith('.tar.gz') || file.endsWith('.exe') || file.endsWith('.sh'))) {
      const hash = getFileSha256(filePath);
      const size = formatBytes(fs.statSync(filePath).size);
      checksums.push({ file, hash, size });
    }
  }

  const checksumContent = checksums.map(c => `${c.hash}  ${c.file}`).join('\n') + '\n';
  fs.writeFileSync(path.join(DIST_DIR, 'SHA256SUMS.txt'), checksumContent, 'utf8');

  console.log('\n========================================================');
  console.log('  🎉 打包完成！輸出檔案位於 dist/ 目錄：');
  console.log('========================================================');
  for (const c of checksums) {
    console.log(`  📦 ${c.file.padEnd(35)} [${c.size}]`);
    console.log(`     SHA-256: ${c.hash}`);
  }
  console.log(`  📄 SHA256SUMS.txt (校驗清單)`);
  console.log('========================================================\n');
}

packagePlugin().catch(err => {
  console.error('❌ Package failed:', err);
  process.exit(1);
});
