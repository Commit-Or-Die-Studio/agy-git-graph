@echo off
chcp 65001 >nul
set TARGET_DIR=%USERPROFILE%\.gemini\config\plugins\agy-git-graph
set SOURCE_DIR=%~dp0

echo ========================================================
echo   AGY Git Graph 外掛安裝程式
echo ========================================================
echo.

echo [1/3] 檢查目標全域外掛目錄...
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

echo [2/3] 正在安裝核心檔案與 Sidecar 伺服器...
xcopy /E /I /Y "%SOURCE_DIR%plugin.json" "%TARGET_DIR%\" >nul
xcopy /E /I /Y "%SOURCE_DIR%assets" "%TARGET_DIR%\assets\" >nul
xcopy /E /I /Y "%SOURCE_DIR%sidecars" "%TARGET_DIR%\sidecars\" >nul

echo [3/3] 安裝完成！
echo.
echo ========================================================
echo   安裝成功！
echo   請重啟 AGY App，於右側輔助面板點擊 Extensions 即可使用。
echo ========================================================
echo.
pause
