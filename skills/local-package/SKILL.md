---
name: local-package
description: Packages agy-git-graph into dist/ using the next patch version (e.g. 1.0.4 -> 1.0.5) for local testing WITHOUT modifying workspace version files or running git commit/tag/push. Use whenever the user asks to package, build installers, or test locally without releasing.
---

# AGY Git Graph - Local Next-Version Package Skill 📦

本技能專用於**本機開發測試打包**（不 commit、不壓版、不推 GitHub）。

> ⚠️ **與 `release` Skill 的分工**：
> - **日常試用打包**（例如：「幫我打包」、「先打包試用」、「不要 commit 不要推版」）→ 走本技能 (`local-package`)，直接產出**下一版本**的安裝檔。
> - **正式發布**（例如：「發布新版本」、「commit push release」）→ 走 `release` skill。

---

## 核心規則

1. **一律打包成「下一版本」**：
   禁止覆蓋已發布的同版號產物（避免 `dist/` 裡的新舊安裝檔混在一起）。
   直接執行：
   ```bash
   node scripts/package.mjs --next
   ```
   此參數會自動讀取目前 `package.json` 的版號（例如 `1.0.4`），計算出下一版（`1.0.5`），並只寫入 `dist/staging/` 內部與輸出檔名（`agy-git-graph-v1.0.5-setup.exe` 等）。

2. **保持工作區版號乾淨**：
   不提前修改專案根目錄的 `package.json` 與 `plugin.json`（遵守 `AGENTS.md` 規範，正式壓版留給 `release` 流程）。

3. **嚴禁 Git 發布動作**：
   本技能執行過程中**絕對不可**執行 `git commit`、`git tag` 或 `git push`。

4. **回報產物連結**：
   打包完成後，附上 `dist/` 底下新版號安裝檔的可點擊 `file:///` 連結給使用者執行測試。
