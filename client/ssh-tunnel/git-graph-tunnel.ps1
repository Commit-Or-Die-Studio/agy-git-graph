# AGY Git Graph - SSH 通道（Windows 用戶端）
#
# 讓 Claude 桌面版透過 SSH 連到遠端機器開發時，右側瀏覽器窗格能連到遠端的 Git Graph 伺服器：
#   ssh -N -L 127.0.0.1:<本機埠>:127.0.0.1:52899 <使用者@主機>
# 機器清單：%APPDATA%\agy-git-graph\ssh-tunnels.json（可多台，每台一條通道、各用不同本機埠）
#
# 用法：
#   git-graph-tunnel.ps1 -Add <使用者@主機> [-Port 22] [-LocalPort 52898]   新增 / 更新一台機器
#   git-graph-tunnel.ps1 -Remove <使用者@主機>                              移除
#   git-graph-tunnel.ps1 -Test <使用者@主機> [-Port 22]                     測試能否以金鑰登入
#   git-graph-tunnel.ps1 -Start | -Stop | -Status                         啟動 / 停止 / 查看狀態
#   git-graph-tunnel.ps1 -StatusJson                                       狀態（JSON，供安裝程式判斷）
#   git-graph-tunnel.ps1 -EnableAutostart | -DisableAutostart              登入 Windows 時自動啟動
#   git-graph-tunnel.ps1 -InstallShortcut | -RemoveShortcut                開始功能表捷徑
#   git-graph-tunnel.ps1 -Uninstall                                        停止並移除所有設定
#   git-graph-tunnel.ps1 -Run                                              （內部）背景維持通道，斷線自動重連
#
# 只使用 SSH 金鑰登入（BatchMode），不會詢問或儲存密碼。

param(
  [string]$Add,
  [string]$Remove,
  [string]$Test,
  [int]$Port = 22,
  [int]$LocalPort = 52898,
  [switch]$Start,
  [switch]$Stop,
  [switch]$Status,
  [switch]$StatusJson,
  [switch]$EnableAutostart,
  [switch]$DisableAutostart,
  [switch]$InstallShortcut,
  [switch]$RemoveShortcut,
  [switch]$Uninstall,
  [switch]$Run
)

$ErrorActionPreference = 'Stop'

$RemotePort = 52899
$ScriptPath = $MyInvocation.MyCommand.Path
$ScriptDir = Split-Path -Parent $ScriptPath
$Launcher = Join-Path $ScriptDir 'run-hidden.vbs'
$DataDir = Join-Path $env:APPDATA 'agy-git-graph'
$ConfigFile = Join-Path $DataDir 'ssh-tunnels.json'
$LogFile = Join-Path $DataDir 'tunnel.log'
$TaskName = 'AGY Git Graph SSH Tunnel'
$MutexName = 'Local\AgyGitGraphSshTunnel'
$ShortcutPath = Join-Path ([Environment]::GetFolderPath('Programs')) 'Git Graph SSH 通道.lnk'

function Get-SshExe {
  $builtin = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
  if (Test-Path $builtin) { return $builtin }
  $cmd = Get-Command ssh.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw '找不到 ssh.exe，請先安裝 Windows 的 OpenSSH 用戶端'
}

function Write-Log([string]$msg) {
  if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir -Force | Out-Null }
  if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 1MB)) { Clear-Content $LogFile }
  $line = '[{0}] {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Read-Hosts {
  if (-not (Test-Path $ConfigFile)) { return @() }
  try {
    $data = Get-Content -Path $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -eq $data -or $null -eq $data.hosts) { return @() }
    return @($data.hosts | Where-Object { $_.target })
  } catch {
    return @()
  }
}

function Save-Hosts($hostList) {
  if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir -Force | Out-Null }
  $items = @($hostList | ForEach-Object {
    [ordered]@{ target = [string]$_.target; port = [int]$_.port; localPort = [int]$_.localPort }
  })
  $json = ConvertTo-Json -InputObject ([ordered]@{ hosts = $items }) -Depth 4
  [IO.File]::WriteAllText($ConfigFile, $json, (New-Object Text.UTF8Encoding $false))
}

function Test-Running {
  $m = New-Object Threading.Mutex($false, $MutexName)
  try {
    $acquired = $false
    try { $acquired = $m.WaitOne(0) } catch [Threading.AbandonedMutexException] { $acquired = $true }
    if ($acquired) { $m.ReleaseMutex(); return $false }
    return $true
  } finally {
    $m.Dispose()
  }
}

function Test-Autostart {
  return [bool](Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)
}

function Test-KeyLogin([string]$target, [int]$port) {
  $ssh = Get-SshExe
  $sshArgs = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new')
  if ($port -and $port -ne 22) { $sshArgs += @('-p', "$port") }
  $sshArgs += @($target, 'exit')
  $p = Start-Process -FilePath $ssh -ArgumentList $sshArgs -WindowStyle Hidden -PassThru -Wait
  return ($p.ExitCode -eq 0)
}

# 本機埠是否被「本通道以外」的程式監聽（本通道自己的 ssh 正在使用不算）
function Test-PortUsedByOthers([int]$port) {
  $conns = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  if ($conns.Count -eq 0) { return $false }
  $supervisors = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'git-graph-tunnel\.ps1' -and $_.CommandLine -match '-Run' } |
    ForEach-Object { $_.ProcessId })
  foreach ($c in $conns) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)" -ErrorAction SilentlyContinue
    $ours = $owner -and $owner.Name -eq 'ssh.exe' -and ($supervisors -contains $owner.ParentProcessId)
    if (-not $ours) { return $true }
  }
  return $false
}

function Stop-Tunnel {
  $procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'git-graph-tunnel\.ps1' -and $_.CommandLine -match '-Run' }
  foreach ($p in $procs) {
    Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p.ProcessId)" |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
  return @($procs).Count
}

function Start-Tunnel {
  if (Test-Running) { return $false }
  Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$Launcher`"" -WindowStyle Hidden
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 300
    if (Test-Running) { break }
  }
  return $true
}

function Show-Status {
  $hosts = Read-Hosts
  Write-Host ('通道程式：' + $(if (Test-Running) { '執行中' } else { '未執行' }))
  Write-Host ('登入時自動啟動：' + $(if (Test-Autostart) { '是' } else { '否' }))
  if ($hosts.Count -eq 0) {
    Write-Host '尚未設定任何遠端機器（用 -Add <使用者@主機> 新增）'
  }
  foreach ($h in $hosts) {
    $listening = Get-NetTCPConnection -LocalPort $h.localPort -State Listen -ErrorAction SilentlyContinue |
      Where-Object { $_.LocalAddress -eq '127.0.0.1' }
    $state = if ($listening) { '已連線' } else { '未連線' }
    Write-Host ('  {0} (SSH 埠 {1}) -> http://localhost:{2}  [{3}]' -f $h.target, $h.port, $h.localPort, $state)
  }
  if (Test-Path $LogFile) {
    Write-Host '最近紀錄：'
    Get-Content $LogFile -Tail 5 | ForEach-Object { Write-Host "  $_" }
  }
}

# 背景維持所有通道；斷線後依 5 → 10 → 20 → 40 → 60 秒間隔重試，連線維持 60 秒以上後重設為 5 秒
function Invoke-Run {
  $mutex = New-Object Threading.Mutex($false, $MutexName)
  $acquired = $false
  try { $acquired = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $acquired = $true }
  if (-not $acquired) { return } # 已有一份在執行

  $ssh = Get-SshExe
  $state = @{}
  Write-Log '通道程式啟動'
  try {
    while ($true) {
      $hosts = Read-Hosts
      $wanted = @{}
      foreach ($h in $hosts) { $wanted["$($h.target)|$($h.port)|$($h.localPort)"] = $h }

      foreach ($key in @($state.Keys)) {
        if (-not $wanted.ContainsKey($key)) {
          $s = $state[$key]
          if ($s.Proc -and -not $s.Proc.HasExited) { Stop-Process -Id $s.Proc.Id -Force -ErrorAction SilentlyContinue }
          $state.Remove($key)
          Write-Log "已移除通道 $key"
        }
      }

      $now = Get-Date
      foreach ($key in $wanted.Keys) {
        $h = $wanted[$key]
        if (-not $state.ContainsKey($key)) {
          $state[$key] = @{ Proc = $null; Delay = 5; NextStart = $now; Started = $now }
        }
        $s = $state[$key]

        if ($s.Proc) {
          if (-not $s.Proc.HasExited) { continue }
          $ran = [int]($now - $s.Started).TotalSeconds
          if ($ran -ge 60) { $s.Delay = 5 }
          Write-Log ('{0} 通道中斷（結束代碼 {1}，維持 {2} 秒），{3} 秒後重連' -f $h.target, $s.Proc.ExitCode, $ran, $s.Delay)
          $s.NextStart = $now.AddSeconds($s.Delay)
          $s.Delay = [Math]::Min(60, $s.Delay * 2)
          $s.Proc = $null
        }

        if ($now -ge $s.NextStart) {
          $sshArgs = @('-N', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ExitOnForwardFailure=yes',
            '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
            '-L', "127.0.0.1:$($h.localPort):127.0.0.1:$RemotePort")
          if ($h.port -and [int]$h.port -ne 22) { $sshArgs += @('-p', "$($h.port)") }
          $sshArgs += @("$($h.target)")
          $s.Proc = Start-Process -FilePath $ssh -ArgumentList $sshArgs -WindowStyle Hidden -PassThru
          $null = $s.Proc.Handle # 保留 handle 才能在結束後讀到 ExitCode
          $s.Started = Get-Date
          Write-Log ('連線 {0}（本機埠 {1}）' -f $h.target, $h.localPort)
        }
      }

      Start-Sleep -Seconds 2
    }
  } finally {
    foreach ($s in $state.Values) {
      if ($s.Proc -and -not $s.Proc.HasExited) { Stop-Process -Id $s.Proc.Id -Force -ErrorAction SilentlyContinue }
    }
    $mutex.ReleaseMutex()
    $mutex.Dispose()
  }
}

# ---------------------------------------------------------------------------

if ($Run) { Invoke-Run; exit 0 }

if ($Test) {
  if (Test-KeyLogin $Test $Port) { Write-Host "OK: 可用金鑰登入 $Test"; exit 0 }
  Write-Host "FAILED: 無法用金鑰登入 $Test（請先設定 SSH 金鑰登入）"
  exit 1
}

if ($Add) {
  $hosts = @(Read-Hosts | Where-Object { $_.target -ne $Add })
  $clash = $hosts | Where-Object { [int]$_.localPort -eq $LocalPort }
  if ($clash) {
    Write-Host "FAILED: 本機埠 $LocalPort 已被 $($clash[0].target) 使用，請改用其他本機埠"
    exit 1
  }
  if (Test-PortUsedByOthers $LocalPort) {
    Write-Host "FAILED: 本機埠 $LocalPort 已被其他程式使用（例如您自己建立的 SSH 通道或其他服務）。若該程式已提供連到遠端 Git Graph 的通道，就不必再設定；否則請用 -LocalPort 改用其他埠"
    exit 1
  }
  $hosts += [pscustomobject]@{ target = $Add; port = $Port; localPort = $LocalPort }
  Save-Hosts $hosts
  Write-Host "已設定：$Add（SSH 埠 $Port）-> http://localhost:$LocalPort"
}

if ($Remove) {
  $hosts = @(Read-Hosts | Where-Object { $_.target -ne $Remove })
  Save-Hosts $hosts
  Write-Host "已移除：$Remove"
}

if ($EnableAutostart) {
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$Launcher`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $trigger.Delay = 'PT30S'
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TaskName -Description 'AGY Git Graph：登入 Windows 後建立到遠端開發機的 SSH 通道（Claude 桌面版 SSH 工作階段使用）' `
    -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Write-Host '已設定登入 Windows 時自動啟動'
}

if ($DisableAutostart) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host '已取消登入時自動啟動'
}

if ($InstallShortcut) {
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut($ShortcutPath)
  $lnk.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $lnk.Arguments = "`"$Launcher`""
  $lnk.WorkingDirectory = $ScriptDir
  $lnk.Description = '啟動 AGY Git Graph 的 SSH 通道（Claude 桌面版 SSH 工作階段使用）'
  $lnk.Save()
  Write-Host "已建立開始功能表捷徑：$ShortcutPath"
}

if ($RemoveShortcut) {
  if (Test-Path $ShortcutPath) { Remove-Item $ShortcutPath -Force }
}

if ($Stop) {
  $n = Stop-Tunnel
  Write-Host $(if ($n -gt 0) { '已停止通道' } else { '通道原本就沒有在執行' })
}

if ($Start) {
  if ((Read-Hosts).Count -eq 0) {
    Write-Host '尚未設定任何遠端機器（用 -Add <使用者@主機> 新增）'
    exit 1
  }
  if (Start-Tunnel) { Write-Host '已啟動通道' } else { Write-Host '通道已在執行中' }
}

if ($Uninstall) {
  Stop-Tunnel | Out-Null
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  if (Test-Path $ShortcutPath) { Remove-Item $ShortcutPath -Force }
  if (Test-Path $DataDir) { Remove-Item $DataDir -Recurse -Force }
  Write-Host '已移除 SSH 通道、開機啟動、捷徑與設定'
}

if ($StatusJson) {
  $hosts = @(Read-Hosts | ForEach-Object { [ordered]@{ target = $_.target; port = [int]$_.port; localPort = [int]$_.localPort } })
  $obj = [ordered]@{ configured = ($hosts.Count -gt 0); running = (Test-Running); autostart = (Test-Autostart); hosts = $hosts }
  ConvertTo-Json -InputObject $obj -Depth 4 -Compress
}

if ($Status) { Show-Status }
