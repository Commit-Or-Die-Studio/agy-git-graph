# AGY Git Graph — 待辦事項與版本規劃 (TODO & Roadmap)

## 1. 外掛版本更新檢查策略優化 (v1.0.9+)
- [x] **6 小時定時檢查 + 開啟時檢查**：
  - 若面板長期未關閉，自動檢查 GitHub Release 的間隔由 30 分鐘拉長為 **6 小時**（`6 * 60 * 60 * 1000`）。
  - 若面板有關閉再重新開啟，則於開啟時檢查。
- [x] **防頻繁查詢節流保護 (Rate-Limit / Cooldown Guard)**：
  - **重新整理按鈕 (`🔄`) 脫鉤**：使用者按 `🔄` 僅重整本地 Git 狀態與 `git fetch`，不再每次強制打 GitHub API。
  - **後端記憶體快取冷卻時間（不使用 `localStorage`）**：由 Sidecar 後端記憶體快取統一控管 **60 秒**冷卻期（並合併併發請求），避免重複開關面板或連續點擊頻繁消耗 GitHub API 額度。

---

## 2. 跨平台多宿主支援與品牌重命名 (v2.0.0 Roadmap)
- [ ] **支援 Claude Mods / Claude 環境可用**：
  - 抽象化宿主整合層（Session 解析、Workspace 偵測、UI 掛載入口與安裝器），讓外掛除了 Google Antigravity (AGY) 之外，也能在 **Claude Mods** 等多平台環境中運作。
- [ ] **專案更名為 `corvus-git-graph`（使用者備註拼寫：`corvus-git-grpah`）**：
  - 當成功達成多平台同步可用（v2.0.0）時，將專案名稱由 `agy-git-graph` 正式更名為 **`corvus-git-graph`**（同步更新 `package.json`、`plugin.json`、安裝器路徑、GitHub Repository 與文件）。
