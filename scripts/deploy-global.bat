@echo off
chcp 65001 >nul
echo ========================================================
echo  AGY Git Graph Plugin - 發布至 AGY 全域外掛目錄
echo ========================================================

set TARGET_DIR=%USERPROFILE%\.gemini\config\plugins\agy-git-graph
set SOURCE_DIR=%~dp0..

echo 來源目錄: %SOURCE_DIR%
echo 目標目錄: %TARGET_DIR%
echo.

if not exist "%TARGET_DIR%" (
    echo 建立目標目錄...
    mkdir "%TARGET_DIR%"
)

echo 正在複製檔案...
xcopy /E /I /Y "%SOURCE_DIR%\plugin.json" "%TARGET_DIR%\"
xcopy /E /I /Y "%SOURCE_DIR%\assets" "%TARGET_DIR%\assets\"
xcopy /E /I /Y "%SOURCE_DIR%\sidecars" "%TARGET_DIR%\sidecars\"

echo.
echo ========================================================
echo  發布完成！
echo  現在您可以在 AGY 輔助面板中使用以下連結開啟：
echo  sidecar://agy-git-graph/git_graph_server/
echo ========================================================
pause
