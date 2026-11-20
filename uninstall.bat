@echo off
chcp 65001 >nul
set TARGET_DIR=%USERPROFILE%\.gemini\config\plugins\agy-git-graph

echo ========================================================
echo   AGY Git Graph 外掛解除安裝程式
echo ========================================================
echo.

if not exist "%TARGET_DIR%" goto NOT_FOUND

echo [1/2] 正在終止可能執行的背景伺服器...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Where-Object { $_.CommandLine -like '*git_graph_server*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1

echo [2/2] 正在從 AGY 全域外掛目錄移除檔案...
rmdir /s /q "%TARGET_DIR%"

if exist "%TARGET_DIR%" goto FAILED

echo.
echo ========================================================
echo   解除安裝完成！已成功從系統中清除。
echo   重新啟動 AGY App 後生效。
echo ========================================================
goto FINISH

:NOT_FOUND
echo [提示] 尚未在全域目錄偵測到已安裝的 AGY Git Graph 外掛。
goto FINISH

:FAILED
echo [錯誤] 檔案移除不完整，請關閉 AGY App 後重試。
goto FINISH

:FINISH
echo.
pause
