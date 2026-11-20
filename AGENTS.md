# AGY Git Graph - Agent Guidelines & Repository Rules

本專案為 **AGY Git Graph**，專為 Google Antigravity (AGY) 輔助面板量身打造的視覺化 Git 分支圖與 Commit Diff 檢視外掛。
所有參與本專案的 AI 代理人必須嚴格遵守以下架構與發布守則。

---

## 1. 核心開發與架構守則

- **純本機原生、零外部依賴 (Zero Dependencies)**：
  後端一律採用 Node.js 原生模組（`node:http`、`node:child_process`、`node:fs`、`node:path`、`node:os`）。嚴禁引入外部 npm 套件，維持最極致的啟動速度與輕量特性。
- **跨平台相容性**：
  所有路徑處理與指令執行必須同時在 Windows 與 Linux / macOS (SSH 遠端虛擬機) 運作良好。

---

## 2. 發布流程隔離原則 (Release Gate)

> **發布原則**：
> **只有在使用者明確指示發布至 Git（例如：「發布新版本」、「Release 到 GitHub」）時，才啟動發布流程（走 `release` skill）！**

### 發布時的版本與程式同步規範：
1. **禁止平時提前壓版本**：日常開發中 `package.json` 與 `plugin.json` 維持既有版號，不得隨意更動。
2. **發布時同步壓版**：在確認發布時，必須由 release 流程同時且一致地更新：
   - `package.json` (`"version"`)
   - `plugin.json` (`"version"`)
   - `README.md` (相關版本號)
3. **產出物檔名必須攜帶版本號**：
   打包腳本輸出之 Release 壓縮檔必須一律帶有版本號：
   - `agy-git-graph-v<VERSION>.zip`
   - `agy-git-graph-v<VERSION>.tar.gz`
   - `SHA256SUMS.txt`
4. **Git Tag 與 GitHub Release 聯動**：
   壓版確認後，建立對應的 `v<VERSION>` 標籤並推送至遠端，由 GitHub Actions 自動完成 GitHub Release 發布。
