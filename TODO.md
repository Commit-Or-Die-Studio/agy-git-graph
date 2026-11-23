# AGY Git Graph — 待辦事項與版本規劃 (TODO & Roadmap)

## 1. 外掛版本更新檢查策略優化 (v1.0.9+)
- [ ] **24 小時定時檢查 + 開啟時檢查**：
  - 若面板長期未關閉，自動檢查 GitHub Release 的間隔由 30 分鐘拉長為 **24 小時**（`24 * 60 * 60 * 1000`）。
  - 若面板有關閉再重新開啟，則於開啟時檢查。
- [ ] **防頻繁查詢節流保護 (Rate-Limit / Cooldown Guard)**：
  - **重新整理按鈕 (`🔄`) 脫鉤**：使用者按 `🔄` 大多只是為了重新確認本地 Git 狀態，**不應每次按 `🔄` 都強制打 GitHub API**。
  - **關閉/開啟或連續刷新冷卻時間**：透過 `localStorage` 與後端快取雙重記錄上次檢查時間戳（`lastUpdateCheckAt`），若距離上次檢查未滿冷卻門檻（例如數小時內重複開關面板或連續重整），直接沿用快取結果擋下來，避免頻繁消耗 GitHub API 額度；僅在冷卻期過後或使用者明確點擊版本標籤要求檢查（且同樣受最短防連點節流保護）時才發送請求。

---

## 2. 跨平台多宿主支援與品牌重命名 (v2.0.0 Roadmap)
- [ ] **支援 Claude Mods / Claude 環境可用**：
  - 抽象化宿主整合層（Session 解析、Workspace 偵測、UI 掛載入口與安裝器），讓外掛除了 Google Antigravity (AGY) 之外，也能在 **Claude Mods** 等多平台環境中運作。
- [ ] **專案更名為 `corvus-git-graph`（使用者備註拼寫：`corvus-git-grpah`）**：
  - 當成功達成多平台同步可用（v2.0.0）時，將專案名稱由 `agy-git-graph` 正式更名為 **`corvus-git-graph`**（同步更新 `package.json`、`plugin.json`、安裝器路徑、GitHub Repository 與文件）。
