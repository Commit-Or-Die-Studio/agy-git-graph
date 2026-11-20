@echo off
chcp 65001 >nul
echo [Git Graph] 正在啟動 Git Graph 本地 Sidecar 伺服器...
cd /d "%~dp0\..\sidecars\git_graph_server"
node server.mjs
pause
