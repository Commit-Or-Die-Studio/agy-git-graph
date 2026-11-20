# AGY Git Graph 🌿

> **Visual Git branch graph and commit diff viewer for AGY Auxiliary Pane.**  
> **專為 Antigravity (AGY) 輔助面板打造的 Git 視覺化分支圖與 Commit Diff 檢視器。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Antigravity](https://img.shields.io/badge/Platform-Antigravity%20(AGY)-673ab7.svg)](#)
[![Zero Dependency](https://img.shields.io/badge/Dependencies-Zero%20(Native%20Node.js)-success.svg)](#)

---

## 📖 簡介 / Overview

**AGY Git Graph** 是專為 **Antigravity (AGY) 桌面版** 量身打造的原生 UI 外掛（UI Plugin / Sidecar）。  
常駐於 AGY 右側輔助面板（Auxiliary Pane，約 350px~500px 寬度），以流暢彩色的多軌平滑曲線直觀呈現專案的分支走向、Merge 線條、Commit 歷史與變更檔案 Diff，支援公司 Organization 私有儲存庫與純本地離線運作。

**AGY Git Graph** is a native UI Plugin & Sidecar tailored for the **Antigravity (AGY) Desktop App**.  
It embeds seamlessly into the AGY Auxiliary Pane (~350px-500px), rendering smooth multi-lane Bezier curves for branch trajectories, merge topologies, commit histories, and inline file diffs—fully offline and private-repo friendly with zero external dependencies.

---

## ✨ 核心特點 / Key Features

* 🚀 **純本地零依賴 (Zero External Dependencies)**  
  後端採用原生 Node.js（`node:http`、`node:child_process`），無需執行 `npm install` 下載龐大套件，啟動最輕量迅速。  
  *Powered entirely by native Node.js standard libraries—no external npm modules needed.*

* 🎨 **彩色多軌平滑分支圖 (Multi-Lane Smooth Curves)**  
  內建分支軌道演算法，利用高解析度平滑貝茲曲線（Bezier Curves）繪製分支交會與 Merge 拓撲走向。  
  *Dynamic multi-lane layout algorithm drawing high-DPI smooth Bezier curves for branch merges and forks.*

* 📱 **完美適配 AGY 側邊欄 (Tailored for Auxiliary Pane)**  
  針對 350px~500px 寬度設計響應式暗色系介面，Commit 訊息支援省略與 Tooltip，支援關鍵字與分支下拉即時篩選。  
  *Responsive dark-themed UI specifically tuned for 350px–500px panes with instant commit search and branch filters.*

* 🔍 **即時 Commit 詳情與 Diff (Instant Details & Diff View)**  
  點擊任一 Commit 即展開修改檔案清單（`[A]` 新增、`[M]` 修改、`[D]` 刪除），點擊檔案可直接檢視語法色彩高亮 Diff。  
  *Click any commit to inspect modified file lists and view syntax-highlighted inline diffs.*

* 🏢 **支援 Organization 私有倉庫與多目錄切換 (Private Org & Multi-Repo Switch)**  
  完全在本地執行 `git` 指令，安全無資安疑慮；介面頂部可隨意切換至電腦中的任何 Git 倉庫路徑。  
  *Local execution ensures 100% security for corporate private repos with dynamic repository path switching.*

---

## 📁 專案架構 / Directory Structure

```text
agy-git-graph/
├── plugin.json                 # AGY Plugin Manifest 清單設定檔
├── package.json                # 專案腳本配置
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
│   ├── start.bat               # 本機開發一鍵啟動腳本
│   └── deploy-global.bat       # 一鍵發布 (Release) 至 AGY 全域外掛目錄
└── README.md                   # 說明文件
```

---

## 🛠️ 本地開發與測試 / Local Development & Preview

### 1. 啟動本機測試伺服器
可以直接在專案目錄下執行：
```bash
npm start
# 或直接使用 Node.js:
node sidecars/git_graph_server/server.mjs
# 或在 Windows 雙擊:
scripts\start.bat
```
伺服器將在 `http://127.0.0.1:52888` 啟動。

### 2. 瀏覽器獨立除錯
啟動後，直接於瀏覽器開啟 `http://127.0.0.1:52888/` 即可進行介面預覽與除錯。

---

## 📦 發布至 AGY 全域擴充 / Release to AGY

當測試完成並準備讓 AGY 所有專案在側邊欄直接使用時：

1. **執行發布腳本**：  
   雙擊執行 `scripts\deploy-global.bat`（腳本會自動將外掛發布至 `~/.gemini/config/plugins/agy-git-graph/`）。
2. **在 AGY 中開啟**：  
   發布完成後，在 AGY 任何對話或筆記中點擊下方連結，即可在右側輔助面板開啟 Git Graph：
   ```markdown
   [Git Graph](sidecar://agy-git-graph/git_graph_server/)
   ```

---

## 📄 授權條款 / License

本專案採用 [MIT License](LICENSE) 授權。  
Created by **Commit-Or-Die-Studio**.
