' AGY Git Graph - hidden launcher for the SSH tunnel
' Starts git-graph-tunnel.ps1 -Run with no window at all (no console flash).
' Used by the logon scheduled task and the Start menu shortcut.
Set shell = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\git-graph-tunnel.ps1"" -Run", 0, False
