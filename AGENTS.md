# AGY Git Graph - Agent Guidelines & Repository Rules

本專案為 **AGY Git Graph**，專為 Google Antigravity (AGY) 輔助面板量身打造的視覺化 Git 分支圖與 Commit Diff 檢視外掛。
所有參與本專案的 AI 代理人必須嚴格遵守以下架構、文件同步與發布守則。

---

## 1. 核心開發與架構守則

- **純本機原生、零外部依賴 (Zero Dependencies)**：
  後端一律採用 Node.js 原生模組（`node:http`、`node:child_process`、`node:fs`、`node:path`、`node:os`、`node:sqlite`）。嚴禁引入外部 npm 套件，維持最極致的啟動速度與輕量特性。
- **跨平台相容性**：
  所有路徑處理與指令執行必須同時在 Windows 與 Linux / macOS (SSH 遠端虛擬機) 運作良好。

---

## 2. Commit 前文件同步與日常打包守則 (Pre-Commit & Local Packaging Rules)

1. **每次 Commit 前強制更新 `README.md`**：
   任何功能新增、問題修復、架構變動或腳本調整，在執行 `git commit` 前**必須先檢查並同步更新 `README.md`**（包括功能介紹、目錄結構、安裝使用說明或 `## 📋 版本更新紀錄 / Changelog` 區塊），確保文件與程式碼永遠一致。
2. **日常試用打包一律走下一版本 (`local-package` skill)**：
   平時開發測試需要打包（不 commit、不推版）時，必須走 `local-package` skill 執行 `node scripts/package.mjs --next`，直接產出下一版號的測試安裝包，嚴禁覆蓋已發布的舊版號產物。

---

## 3. 發布流程隔離原則 (Release Gate)

> **發布原則**：
> **只有在使用者明確指示發布至 Git（例如：「發布新版本」、「Release 到 GitHub」）時，才啟動發布流程（走 `release` skill）！**

### 發布與打 Tag 前的版本、文件與 Release 資訊同步規範：
1. **禁止平時提前壓版本**：日常開發中根目錄 `package.json` 與 `plugin.json` 維持既有版號，不得隨意更動。
2. **Release / 打 Tag 前必須完整更新版本與 Release 資訊**：在確認發布或建立 `v<VERSION>` Tag 前，必須由 `release` 流程同時且一致地更新：
   - `package.json` (`"version"`)
   - `plugin.json` (`"version"`)
   - `README.md`：更新頂部版本徽章 (`Version-v<VERSION>`)，並在 `## 📋 版本更新紀錄 / Changelog` 新增 `### v<VERSION>` 的詳細更新項目（打包腳本會自動擷取此區塊產生 `dist/RELEASE_NOTES.md` 供 GitHub Release 頁面使用）。
3. **產出物檔名必須攜帶版本號且生成 Release 說明檔**：
   打包腳本輸出之 Release 檔案必須一律帶有版本號並附帶完整說明：
   - `agy-git-graph-v<VERSION>-setup.exe` / `agy-git-graph-v<VERSION>-uninstall.exe`
   - `agy-git-graph-v<VERSION>-setup.sh` / `agy-git-graph-v<VERSION>-uninstall.sh`
   - `agy-git-graph-v<VERSION>.zip` / `agy-git-graph-v<VERSION>.tar.gz`
   - `SHA256SUMS.txt`
   - `RELEASE_NOTES.md`（由 `package.mjs` 依 `README.md` 之對應版本更新紀錄自動生成）
4. **Git Tag 與 GitHub Release 聯動**：
   壓版並確認 `README.md` 與 `dist/RELEASE_NOTES.md` 更新無誤後，才建立對應的 `v<VERSION>` 標籤並推送至遠端，由 GitHub Actions 自動完成帶有完整更新說明的 GitHub Release 發布。
