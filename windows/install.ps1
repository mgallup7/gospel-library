# Gospel Library, personal edition: setup on Windows (PowerShell).
# Right-click > Run with PowerShell, or:  powershell -ExecutionPolicy Bypass -File windows\install.ps1
# Needs Python 3.9+ from python.org (tick "Add python.exe to PATH" when installing).

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$Repo = (Get-Location).Path
$Port = if ($env:GOSPEL_LIBRARY_PORT) { $env:GOSPEL_LIBRARY_PORT } else { "8777" }

Write-Host "`n1. Python" -ForegroundColor Cyan
if (-not (Test-Path ".venv\Scripts\python.exe")) { python -m venv .venv }
.\.venv\Scripts\python.exe -m pip install --quiet --upgrade pip
.\.venv\Scripts\python.exe -m pip install --quiet -r requirements.txt
New-Item -ItemType Directory -Force -Path "data\logs" | Out-Null

Write-Host "`n2. Scripture text" -ForegroundColor Cyan
try { .\.venv\Scripts\python.exe -m gospel_library seed | Out-Null } catch { Write-Host "   (skipped; the sync will fetch everything)" }

Write-Host "`n3. Scheduled tasks" -ForegroundColor Cyan
$py = "$Repo\.venv\Scripts\pythonw.exe"
$pyc = "$Repo\.venv\Scripts\python.exe"
schtasks /Create /F /TN "Gospel Library server" /SC ONLOGON /TR "`"$py`" -m gospel_library serve" /RL LIMITED | Out-Null
schtasks /Create /F /TN "Gospel Library nightly sync" /SC DAILY /ST 03:30 /TR "cmd /c cd /d `"$Repo`" && git pull --ff-only --quiet & `"$pyc`" -m gospel_library sync >> data\logs\nightly.out 2>&1" /RL LIMITED | Out-Null
schtasks /Run /TN "Gospel Library server" | Out-Null
Write-Host "   web app starts at every logon; nightly sync at 3:30 am"

Write-Host "`n4. First full pull" -ForegroundColor Cyan
Start-Process -FilePath $pyc -ArgumentList "-m gospel_library sync" -WorkingDirectory $Repo -WindowStyle Minimized
Write-Host "   running in a minimized window; roughly an hour for scriptures and all conference talks"

$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.*" } | Select-Object -First 1).IPAddress
Write-Host "`nOpen on your iPad (same Wi-Fi): http://$ip`:$Port" -ForegroundColor Green
Write-Host "If Windows Firewall asks, allow python on private networks.`n"
