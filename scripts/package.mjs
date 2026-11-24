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

  const rootDirs = ['assets', 'sidecars', 'claude'];
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
          '/reference:System.dll,System.Drawing.dll,System.Windows.Forms.dll,System.IO.Compression.dll,System.IO.Compression.FileSystem.dll',
          installerSrc
        ]);
        console.log(`   ✔ 已生成 Windows 雙擊安裝檔: ${path.basename(exeOut)}`);

        // 解除安裝執行檔
        await execFileAsync(cscPath, [
          '/target:winexe',
          '/optimize+',
          `/out:${uninstExeOut}`,
          '/reference:System.dll,System.Drawing.dll,System.Windows.Forms.dll,System.IO.Compression.dll,System.IO.Compression.FileSystem.dll',
          installerSrc
        ]);
        console.log(`   ✔ 已生成 Windows 雙擊解除安裝檔: ${path.basename(uninstExeOut)}`);
      } catch (err) {
        console.warn('   ❌ 編譯 Windows 執行檔失敗:', err.message);
      }
    }

    // 獨立的 SSH 通道安裝檔：給「在這台 Windows 用 Claude 透過 SSH 連到遠端機器開發」的使用者，只安裝通道
    const tunnelSrc = path.join(__dirname, 'tunnel-installer.cs');
    const tunnelDir = path.join(ROOT_DIR, 'client', 'ssh-tunnel');
    if (cscPath && fs.existsSync(tunnelSrc) && fs.existsSync(tunnelDir)) {
      const tunnelRefs = '/reference:System.dll,System.Drawing.dll,System.Windows.Forms.dll';
      const tunnelResources = [
        `/resource:${path.join(tunnelDir, 'git-graph-tunnel.ps1')},git-graph-tunnel.ps1`,
        `/resource:${path.join(tunnelDir, 'run-hidden.vbs')},run-hidden.vbs`
      ];
      for (const kind of ['setup', 'uninstall']) {
        const out = path.join(DIST_DIR, `${pluginName}-v${version}-ssh-tunnel-${kind}.exe`);
        try {
          await execFileAsync(cscPath, ['/target:winexe', '/optimize+', `/out:${out}`, ...tunnelResources, tunnelRefs, tunnelSrc]);
          console.log(`   ✔ 已生成 Windows SSH 通道${kind === 'setup' ? '安裝' : '解除安裝'}檔: ${path.basename(out)}`);
        } catch (err) {
          console.warn('   ❌ 編譯 SSH 通道安裝檔失敗:', err.message);
        }
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
  CLAUDE_DIR="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  if [ -f "$CLAUDE_DIR/skills/git-graph/SKILL.md" ] && grep -q "managed-by: agy-git-graph" "$CLAUDE_DIR/skills/git-graph/SKILL.md"; then
    rm -rf "$CLAUDE_DIR/skills/git-graph"
    echo "已移除 Claude 的 /git-graph 技能。"
  fi
  exit 0
fi

echo "========================================================"
echo "  AGY Git Graph - Linux / macOS 自動安裝程式 (v${version})"
echo "========================================================"
echo ""

# 安裝選項：AGY 固定安裝；Claude 桌面版 /git-graph 技能為選用（--claude / --no-claude，未指定時詢問，預設不安裝）
INSTALL_CLAUDE=""
for arg in "$@"; do
  case "$arg" in
    --claude) INSTALL_CLAUDE=1 ;;
    --no-claude) INSTALL_CLAUDE=0 ;;
  esac
done

CLAUDE_DIR="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SKILL_DEST="$CLAUDE_DIR/skills/git-graph/SKILL.md"
CLAUDE_INSTALLED=0
if [ -f "$SKILL_DEST" ] && grep -q "managed-by: agy-git-graph" "$SKILL_DEST"; then
  CLAUDE_INSTALLED=1
fi

echo "安裝項目："
echo "  [x] AGY Git Graph（必要，固定安裝）"
if [ ! -d "$CLAUDE_DIR" ]; then
  INSTALL_CLAUDE=0
  echo "  [ ] Claude 桌面版 /git-graph 技能（未偵測到 Claude: $CLAUDE_DIR，略過）"
elif [ -z "$INSTALL_CLAUDE" ]; then
  if [ -t 0 ]; then
    if [ "$CLAUDE_INSTALLED" = "1" ]; then
      read -r -p "  是否保留 / 更新 Claude 桌面版 /git-graph 技能？(Y/n): " ans
      case "$ans" in [Nn]*) INSTALL_CLAUDE=0 ;; *) INSTALL_CLAUDE=1 ;; esac
    else
      read -r -p "  是否同時安裝 Claude 桌面版 /git-graph 技能？(y/N): " ans
      case "$ans" in [Yy]*) INSTALL_CLAUDE=1 ;; *) INSTALL_CLAUDE=0 ;; esac
    fi
  else
    # 非互動執行：維持目前狀態（已安裝則更新，未安裝則不裝）
    INSTALL_CLAUDE="$CLAUDE_INSTALLED"
  fi
fi
echo ""

# Claude 用的獨立伺服器（非 AGY 管理）若正在執行，安裝完成後以新版重新啟動，避免 Claude 窗格中斷
RESTART_CLAUDE_SERVER=0
if command -v node >/dev/null 2>&1; then
  if node -e 'fetch("http://127.0.0.1:52899/api/health",{signal:AbortSignal.timeout(1500)}).then(r=>r.json()).then(j=>process.exit(j&&j.name==="agy-git-graph"&&j.agyManaged===false?0:1)).catch(()=>process.exit(1))' 2>/dev/null; then
    RESTART_CLAUDE_SERVER=1
  fi
fi

echo "[1/3] 正在終止可能執行的舊背景進程..."
pkill -9 -f "server\.mjs" 2>/dev/null || true

echo "[2/3] 正在檢查與建立目標目錄: $TARGET_DIR..."
mkdir -p "$HOME/.gemini/config/plugins"

echo "[3/3] 正在從安裝檔自我解壓安裝核心檔案..."
base64 -d <<'EOF_PAYLOAD' | tar -xz -C "$HOME/.gemini/config/plugins/"
${base64Tar}
EOF_PAYLOAD

# 依選擇安裝 / 移除 Claude 的 /git-graph 技能（不覆寫使用者自己建立的同名技能）
SKILL_SRC="$TARGET_DIR/claude/skills/git-graph/SKILL.md"
if [ "$INSTALL_CLAUDE" = "1" ] && [ -f "$SKILL_SRC" ]; then
  if [ ! -f "$SKILL_DEST" ] || grep -q "managed-by: agy-git-graph" "$SKILL_DEST"; then
    mkdir -p "$CLAUDE_DIR/skills/git-graph"
    cp "$SKILL_SRC" "$SKILL_DEST"
    echo "  Claude 桌面版: 已安裝 /git-graph 技能 ($SKILL_DEST)"
    echo ""
    echo "  若您是從其他電腦用 Claude 桌面版透過 SSH 連到這台機器開發："
    echo "  請在「那台電腦」安裝 SSH 通道安裝檔（${pluginName}-v${version}-ssh-tunnel-setup.exe），"
    echo "  讓 Claude 右側的 Git Graph 能連到這台機器上的伺服器："
    echo "  https://github.com/Commit-Or-Die-Studio/agy-git-graph/releases/latest"
  else
    echo "  Claude 桌面版: 已有使用者自訂的 git-graph 技能，未覆寫"
  fi
elif [ "$CLAUDE_INSTALLED" = "1" ]; then
  rm -rf "$CLAUDE_DIR/skills/git-graph"
  echo "  Claude 桌面版: 已移除 /git-graph 技能"
fi

# 安裝前正在執行的 Claude 獨立伺服器：以新版重新啟動（脫離此終端機，關閉終端機也不會停止）
if [ "$RESTART_CLAUDE_SERVER" = "1" ]; then
  SERVER_DIR="$TARGET_DIR/sidecars/git_graph_server"
  if command -v setsid >/dev/null 2>&1; then
    (cd "$SERVER_DIR" && env -u ANTIGRAVITY_SIDECAR_WEB_PORT -u PORT setsid nohup node server.mjs --port 52899 >/dev/null 2>&1 &)
  else
    (cd "$SERVER_DIR" && env -u ANTIGRAVITY_SIDECAR_WEB_PORT -u PORT nohup node server.mjs --port 52899 >/dev/null 2>&1 &)
  fi
  echo "  Claude 桌面版: Git Graph 伺服器已以新版重新啟動"
fi

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

CLAUDE_DIR="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
if [ -f "$CLAUDE_DIR/skills/git-graph/SKILL.md" ] && grep -q "managed-by: agy-git-graph" "$CLAUDE_DIR/skills/git-graph/SKILL.md"; then
  rm -rf "$CLAUDE_DIR/skills/git-graph"
  echo "已移除 Claude 的 /git-graph 技能。"
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

  // 6. 由 README.md 擷取該版本 Changelog 並生成 dist/RELEASE_NOTES.md (供 GitHub Release 自動掛載說明)
  let changelogSection = '';
  const readmePath = path.join(ROOT_DIR, 'README.md');
  if (fs.existsSync(readmePath)) {
    const readmeText = fs.readFileSync(readmePath, 'utf8');
    const escapedVer = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const headingRegex = new RegExp(`^###\\s+v${escapedVer}\\b[^\\r\\n]*\\r?\\n([\\s\\S]*?)(?=^###\\s+v|^##\\s+|(?![\\s\\S]))`, 'm');
    const match = readmeText.match(headingRegex);
    if (match && match[1]) {
      // 取到下一個 ### 或 --- 分隔線前
      changelogSection = match[1].split(/\r?\n---\r?\n/)[0].trim();
    }
  }
  if (!changelogSection) {
    changelogSection = `* Release v${version}`;
  }

  const releaseNotesMd = [
    `## 🚀 AGY Git Graph v${version} 更新內容 / What's Changed`,
    '',
    changelogSection,
    '',
    '---',
    '',
    '## 📦 安裝檔下載與使用說明 / Installation Guide',
    '',
    '| 平台 / Platform | 檔案名稱 / Asset | 說明 / Description |',
    '| :--- | :--- | :--- |',
    `| **Windows (推薦)** | \`${pluginName}-v${version}-setup.exe\` | **Windows 一鍵安裝檔**：下載後雙擊即可自動安裝至 AGY 全域外掛目錄 |`,
    `| **Windows** | \`${pluginName}-v${version}-uninstall.exe\` | **Windows 解除安裝檔**：雙擊自動關閉背景程序並完整移除外掛 |`,
    `| **Windows（SSH 遠端開發用）** | \`${pluginName}-v${version}-ssh-tunnel-setup.exe\` | **SSH 通道安裝檔**：在自己的 Windows 用 Claude 桌面版透過 SSH 連到遠端機器開發時使用；只安裝背景 SSH 通道，讓 Claude 右側的 Git Graph 連到遠端（遠端機器需安裝本外掛並啟用 Claude /git-graph） |`,
    `| **Windows（SSH 遠端開發用）** | \`${pluginName}-v${version}-ssh-tunnel-uninstall.exe\` | **SSH 通道解除安裝檔**：停止通道並移除開機啟動、捷徑與設定 |`,
    `| **Linux / macOS (推薦)** | \`${pluginName}-v${version}-setup.sh\` | **自解壓安裝腳本**：執行 \`bash ${pluginName}-v${version}-setup.sh\` 一鍵完成安裝 |`,
    `| **Linux / macOS** | \`${pluginName}-v${version}-uninstall.sh\` | **解除安裝腳本**：執行 \`bash ${pluginName}-v${version}-uninstall.sh\` 乾淨移除 |`,
    `| **手動壓縮包 (ZIP)** | \`${pluginName}-v${version}.zip\` | 手動解壓縮至 \`~/.gemini/config/plugins/${pluginName}/\` |`,
    `| **手動壓縮包 (TAR.GZ)** | \`${pluginName}-v${version}.tar.gz\` | 手動解壓縮至 \`~/.gemini/config/plugins/${pluginName}/\` |`,
    '',
    '---',
    '',
    '## 🔒 SHA-256 校驗碼 / Checksums (`SHA256SUMS.txt`)',
    '',
    '```text',
    checksumContent.trim(),
    '```',
    ''
  ].join('\n');

  fs.writeFileSync(path.join(DIST_DIR, 'RELEASE_NOTES.md'), releaseNotesMd, 'utf8');

  console.log('\n========================================================');
  console.log('  🎉 打包完成！輸出檔案位於 dist/ 目錄：');
  console.log('========================================================');
  for (const c of checksums) {
    console.log(`  📦 ${c.file.padEnd(35)} [${c.size}]`);
    console.log(`     SHA-256: ${c.hash}`);
  }
  console.log(`  📄 SHA256SUMS.txt (校驗清單)`);
  console.log(`  📝 RELEASE_NOTES.md (GitHub Release 完整說明檔)`);
  console.log('========================================================\n');
}

packagePlugin().catch(err => {
  console.error('❌ Package failed:', err);
  process.exit(1);
});
