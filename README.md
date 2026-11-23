# AGY Git Graph 🌿

> **Visual Git branch graph and commit diff viewer for AGY Auxiliary Pane.**  
> **專為 Antigravity (AGY) 輔助面板打造的 Git 視覺化分支圖與 Commit Diff 檢視器。**

[![Version](https://img.shields.io/badge/Version-v1.0.8-orange.svg)](https://github.com/Commit-Or-Die-Studio/agy-git-graph/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Antigravity](https://img.shields.io/badge/Platform-Antigravity%20(AGY)-673ab7.svg)](#)
[![Zero Dependency](https://img.shields.io/badge/Dependencies-Zero%20(Native%20Node.js)-success.svg)](#)

---

## 📖 簡介 / Overview

**AGY Git Graph** 是專為 **Antigravity (AGY) 桌面版** 量身打造的原生 UI 外掛（UI Plugin / Sidecar）。  
常駐於 AGY 右側輔助面板（Auxiliary Pane，約 350px~500px 寬度），以流暢彩色的多軌平滑曲線直觀呈現專案的分支走向、Merge 線條、Commit 歷史與變更檔案 Diff，支援公司 Organization 私有儲存庫、Submodule 子模組切換與純本地離線運作。

**AGY Git Graph** is a native UI Plugin & Sidecar tailored for the **Antigravity (AGY) Desktop App**.  
It embeds seamlessly into the AGY Auxiliary Pane (~350px-500px), rendering smooth multi-lane Bezier curves for branch trajectories, merge topologies, commit histories, and inline file diffs—fully offline and private-repo friendly with zero external dependencies.

---

## ✨ 核心特點 / Key Features

* 🚀 **純本地零依賴 (Zero External Dependencies)**  
  後端採用原生 Node.js（`node:http`、`node:child_process`、`node:fs`、`node:sqlite`），無需執行 `npm install` 下載龐大套件，啟動最輕量迅速。  
  *Powered entirely by native Node.js standard libraries—no external npm modules needed.*

* 🎨 **彩色多軌平滑分支圖與合體分支標籤 (Multi-Lane Smooth Curves & Synced Badges)**  
  內建分支軌道演算法繪製平滑貝茲曲線（Bezier Curves）；當本地分支與遠端分支同步於同一 Commit 時，自動合併為單一漸層標籤（如 `[ ⎇ main ☁ ]`），精簡側邊欄空間。  
  *Dynamic multi-lane layout with unified local/remote synced branch badges.*

* 📱 **完美適配 AGY 側邊欄 (Tailored for Auxiliary Pane)**  
  針對 350px~500px 寬度設計響應式暗色系介面，支援 Commit 關鍵字搜尋、分支下拉即時篩選與絕對時間戳記（`YYYY-MM-DD HH:mm`）。  
  *Responsive dark-themed UI specifically tuned for 350px–500px panes with instant commit search and branch filters.*

* 🔍 **即時 Commit 詳情、Working Tree 與 Diff 獨立視窗 (Details, Working Tree & Popout Diff)**  
  點擊任一 Commit 或頂部工作區狀態列即可展開修改檔案清單（`[A]`、`[M]`、`[D]`、`[U]`），支援樹狀/列表檢視與一鍵彈出獨立大視窗檢視語法高亮 Diff。  
  *Click any commit or the working-tree status bar to inspect modified files and view syntax-highlighted diffs inline or in a popout window.*

* 🏢 **支援多專案、Submodule 子模組與私有倉庫切換 (Multi-Repo & Submodule Switch)**  
  完全在本地執行 `git` 指令，安全無資安疑慮；內建 AGY 專案與 Git Submodule 階層選單，亦支援手動輸入任意本機倉庫路徑。  
  *Local execution ensures 100% security for corporate private repos with built-in AGY project and submodule selector.*

* 🔔 **GitHub 新版偵測與一鍵熱更新 (Release Update Notification & One-Click Hot Update)**  
  自動比對 GitHub 最新 Release 版本，當有新版本發布時於面板右上角顯示 `⬆ vX.Y.Z` 提示按鈕；點擊即可自動下載更新包、校驗 `SHA256SUMS.txt`、覆蓋安裝並自動熱重啟面板，無須重開 AGY。  
  *Automatically detects new GitHub Releases and displays an update pill in the toolbar for one-click SHA-256 verified hot updating.*

---

## 📁 專案架構 / Directory Structure

```text
agy-git-graph/
├── plugin.json                 # AGY Plugin Manifest 清單設定檔
├── package.json                # 專案資訊與打包腳本配置
├── AGENTS.md                   # AI 代理人開發、文件同步與發布規範
├── LICENSE                     # MIT License
├── assets/
│   └── logo.svg                # 外掛專屬圖示
├── sidecars/
│   └── git_graph_server/       # Sidecar 核心伺服器與前端 UI
│       ├── sidecar.json        # AGY Sidecar 描述設定檔 (AUX_PANE 進入點)
│       ├── server.mjs          # Node.js 輕量 HTTP 伺服器與 Git 解析器
│       └── public/             # 前端介面 (HTML5 / CSS / SVG)
│           ├── index.html      # 主頁面
│           ├── style.css       # 暗色系響應式樣式
│           └── app.js          # SVG 繪圖、狀態管理與互動邏輯
├── scripts/
│   ├── package.mjs             # 跨平台發行打包腳本 (支援 --next 預覽打包與自動生成 Release Notes)
│   └── installer.cs            # Windows 原生自解壓安裝/解除安裝器 C# 原始碼
├── skills/
│   ├── local-package/SKILL.md  # 本機下一版本測試打包技能
│   └── release/SKILL.md        # 正式壓版與 GitHub Release 自動發布技能
└── README.md                   # 說明文件與版本更新紀錄
```

---

## 📦 安裝與解除安裝 / Install & Uninstall

請至 [GitHub Releases](https://github.com/Commit-Or-Die-Studio/agy-git-graph/releases) 下載最新版本的安裝檔：

| 平台 | 檔案名稱 | 用途說明 |
| :--- | :--- | :--- |
| **Windows** | `agy-git-graph-v<VERSION>-setup.exe` | **Windows 一鍵安裝檔**：雙擊即可自動部署至 `~/.gemini/config/plugins/agy-git-graph/` |
| **Windows** | `agy-git-graph-v<VERSION>-uninstall.exe` | **Windows 解除安裝檔**：雙擊自動關閉背景程序並完整移除外掛 |
| **Linux / macOS** | `agy-git-graph-v<VERSION>-setup.sh` | **Linux / macOS 自解壓安裝腳本**：執行 `bash agy-git-graph-v<VERSION>-setup.sh` 自動完成安裝 |
| **Linux / macOS** | `agy-git-graph-v<VERSION>-uninstall.sh` | **Linux / macOS 解除安裝腳本**：執行 `bash agy-git-graph-v<VERSION>-uninstall.sh` 乾淨移除 |
| **跨平台手動包** | `agy-git-graph-v<VERSION>.zip` / `.tar.gz` | 手動解壓縮至 `~/.gemini/config/plugins/agy-git-graph/` |

安裝完成後，重啟或重新整理 Antigravity (AGY)，於右側輔助面板開啟 **Git Graph** 即可使用。

---

## 🛠️ 本地開發與打包 / Local Development & Packaging

### 1. 啟動本機測試伺服器
```bash
node sidecars/git_graph_server/server.mjs
```
伺服器預設將在 `http://127.0.0.1:52888` 啟動。

### 2. 本機預覽打包（不更動工作區版號）
```bash
node scripts/package.mjs --next
```
會在 `dist/` 目錄下直接產出**下一版本號**的安裝檔與壓縮包，方便本地安裝實測且不與已發布的舊版號混淆。

---

## 📋 版本更新紀錄 / Changelog

### v1.0.8 (2026-11-24)
* 🏷️ **頂部工具列常駐顯示目前版本號與手動檢查更新**：
  * 於第一排工具列右上角（重新整理按鈕旁）常駐顯示目前安裝版本標籤（如 `v1.0.8`），隨時可確認當前外掛版本。
  * 平常點擊該版本標籤可主動連線 GitHub 檢查是否有新版本並顯示 Toast 狀態提示；當偵測到新版本時，標籤將直接亮起轉換為 `⬆ vX.Y.Z` 一鍵熱更新按鈕。

### v1.0.7 (2026-11-24)
* 🔔 **新增 GitHub Release 新版本偵測與頂部提示按鈕**：
  * 面板啟動時、定時每 30 分鐘、以及點擊「重新整理 🔄」時自動檢查 GitHub 最新 Release（離線環境下靜默略過不影響本地運作）。
  * 當線上最新 Release 版本大於本地安裝版本時，於工具列右上角顯示醒目的綠色漸層按鈕 `⬆ vX.Y.Z`。
* ⚡ **一鍵自動下載、SHA-256 校驗與免重開機熱更新**：
  * 點擊 `⬆ vX.Y.Z` 按鈕即可於背景自動下載最新發行包與 `SHA256SUMS.txt` 進行完整性驗證。
  * 校驗通過後自動解壓縮覆蓋外掛檔案並觸發 Sidecar 伺服器熱重啟（`restart_policy: always`），前端自動重載切換至新版介面，全程無須手動下載或重開 AGY。

### v1.0.6 (2026-11-24)
* 🌿 **修復帶斜線 `/` 的本地分支誤判為遠端分支**：
  * `git log` 改用 `--decorate=full` 搭配完整 `refs/heads/`（本地分支）與 `refs/remotes/`（遠端分支）解析。
  * 解決 `feat/xxx`、`fix/xxx` 等含 `/` 命名的本地分支被誤判為遠端分支而重複顯示兩個藍色雲朵標籤的問題，並能正常與同名遠端分支合體為單一漸層標籤 `[ ⎇ feat/xxx ☁ ]`。
* 📝 **自動化 Release 說明與開發規範升級**：
  * 打包腳本自動擷取 `README.md` 對應版本更新紀錄產生 `dist/RELEASE_NOTES.md`，讓 GitHub Release 自動附帶完整更新摘要、安裝檔指引與 SHA-256 校驗碼。

### v1.0.5 (2026-11-23)
* 🛡️ **根治無變動時面板頻繁重刷與跨專案搶畫面問題**：
  * **對話專案綁定優化**：僅在 AGY 明確提供 `conversationId` 變更時自動切換專案；無 ID 時僅於初次啟動未選定專案時偵測一次，徹底解決多視窗 / 多專案並行時互相搶奪畫面重刷的問題。
  * **分離分支圖與工作區狀態輪詢**：將 `/api/watch-state` 拆分為 `graphHash`（HEAD / 分支 / 遠端）與 `stateHash`（含工作區狀態）。工作區未提交檔案微調時僅更新頂部狀態列，不再重繪整張 Commit 分支圖與彈出載入遮罩。
  * **無鎖唯讀查詢與容錯**：所有 Git 唯讀查詢加入 `GIT_OPTIONAL_LOCKS=0`，且在任一查詢暫時失敗時跳過該輪比對，避免 `.git/index.lock` 互搶與假變更重刷。
* 📦 **新增 `--next` 預覽打包與 `local-package` Skill**：
  * `node scripts/package.mjs --next` 支援在不動到工作區 `package.json` / `plugin.json` 的前提下，直接打包出下一版號安裝檔供本地試用。

### v1.0.4 (2026-11-21)
* 🎨 **本地與遠端同步分支標籤合體 (Synced Branch Badges)**：
  * 當本地分支與遠端分支（如 `main` 與 `origin/main`）停留在同一個 Commit 時，自動合併為單一漸層標籤 `[ ⎇ main ☁ ]`，大幅節省側邊欄水平空間；分歧時則自動拆開顯示。
* 🧹 **移除冗餘 HEAD 標籤字串**：
  * 左側節點已有同心圓（Bullseye）代表當前 Checkout (`HEAD`) 位置，移除標籤內重複的 `HEAD ->` 字串與冗餘的 `origin/HEAD` 標籤。
* 🕒 **絕對時間戳記顯示**：
  * Commit 時間由相對時間（「幾分鐘前」）改為直接顯示完整絕對時間 `YYYY-MM-DD HH:mm` 並防止換行擠壓。

### v1.0.3 (2026-11-20)
* ⚙️ **升級 GitHub Actions 自動發布管線**：
  * 將 Release CI 建置環境切換至 `windows-latest`，於雲端自動編譯並掛載 Windows 原生雙擊安裝檔（`-setup.exe` / `-uninstall.exe`）、Linux/macOS 自解壓安裝腳本（`-setup.sh` / `-uninstall.sh`）、`.zip`、`.tar.gz` 與 `SHA256SUMS.txt`。

### v1.0.2 (2026-11-20)
* 🔍 **修復 `gitFolder` 專案資源偵測與自動對話同步**：
  * 修正 AGY 以 `res.gitFolder.folderUri` 格式儲存 Git 專案資源時的解析邏輯，確保所有納管 Git 專案皆能正確列舉。
  * 支援透過 `conversation_summaries.db`（`node:sqlite` 唯讀查詢）解析對話所屬之 `project_id` 與 `workspace_uris`。

### v1.0.1 (2026-11-20)
* ⚡ **超大型專案效能飛躍與體驗升級**：
  * 狀態檢查加入 `--ignore-submodules=dirty`，Commit Log 加入 `--topo-order` 拓撲排序與後端記憶體快取，大型多子模組專案二次載入秒回。
  * **遠端指標變更即時感知 (Live Remote Tracking)**：本地 `git push` 後自動感應遠端指針推進並刷新；點擊右上角重整按鈕時同步於背景執行 `git fetch --prune`。
  * **Commit 點擊切換 (Toggle Interaction)**：點擊同一筆 Commit 或未提交變更狀態列可再次點擊立即收合明細抽屜。

### v1.0.0 (2026-11-19)
* 🎉 **AGY Git Graph 首個正式版發布**：
  * 專為 Google Antigravity (AGY) 輔助面板打造的純本地零依賴視覺化 Git 分支圖與 Commit Diff 檢視外掛。
  * 支援 8 色高對比多軌平滑貝茲曲線（Bezier Curves）、雙環同心圓 HEAD 高亮、4 通道 Git Submodules 樹狀選單、多對話專案切換、Flex Split-Pane 明細抽屜與 Windows / Linux 一鍵安裝包。

---

## 📄 授權條款 / License

本專案採用 [MIT License](LICENSE) 授權。  
Created by **Commit-Or-Die-Studio**.
