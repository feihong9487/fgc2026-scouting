# FGC 2026 Scouting — 把雲端上的資料抓回本機備份
#   .\deploy\pull-data.ps1 -Server root@fgc-scout.duckdns.org
# 比賽期間建議每天跑一次；砍掉機器之前一定要跑！
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [string]$Key = "",
  [string]$Out = ""
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
if (-not $Out) { $Out = Join-Path $root ("cloud-backup\" + (Get-Date -Format "yyyyMMdd-HHmm")) }
$sshArgs = @("-o", "StrictHostKeyChecking=accept-new", "-o", "LogLevel=ERROR")
if ($Key) { $sshArgs += @("-i", $Key) }

New-Item -ItemType Directory -Path $Out -Force | Out-Null
Write-Host "備份到 $Out" -ForegroundColor Cyan

& ssh @sshArgs $Server "sudo tar -czf /tmp/fgc-data.tar.gz -C /opt/fgc data backups 2>/dev/null; sudo chmod 644 /tmp/fgc-data.tar.gz"
if ($LASTEXITCODE -ne 0) { throw "遠端打包失敗" }
& scp @sshArgs "${Server}:/tmp/fgc-data.tar.gz" "$Out\fgc-data.tar.gz"
if ($LASTEXITCODE -ne 0) { throw "下載失敗" }
& ssh @sshArgs $Server "rm -f /tmp/fgc-data.tar.gz"

& tar -xzf "$Out\fgc-data.tar.gz" -C $Out
$teams = (Get-ChildItem "$Out\data\teams" -ErrorAction SilentlyContinue).Count
if (Test-Path "$Out\data\accounts.json") { $acc = @((Get-Content "$Out\data\accounts.json" -Raw | ConvertFrom-Json).PSObject.Properties).Count }
Write-Host "完成 ✓  $teams 隊有資料、$acc 個帳號" -ForegroundColor Green
Write-Host "  $Out"
