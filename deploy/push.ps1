# FGC 2026 Scouting — 部署 / 更新（適用任何 Ubuntu 主機：Vultr、Lightsail、Oracle…）
#
#   第一次（含安裝環境）：
#     .\deploy\push.ps1 -Server root@fgc-scout.duckdns.org -Setup -Domain fgc-scout.duckdns.org -WithData -Key $HOME\.ssh\id_ed25519_fgc
#   之後每次改東西：
#     .\deploy\push.ps1 -Server root@fgc-scout.duckdns.org -Key $HOME\.ssh\id_ed25519_fgc
#
# Windows 11 內建 ssh / scp / tar，不用另外裝東西。
param(
  [Parameter(Mandatory = $true)][string]$Server,   # root@IP 或 root@網域
  [string]$Domain = "",                            # 有網域才會申請 HTTPS 憑證
  [switch]$Setup,                                  # 第一次跑，順便安裝 Python/Caddy/systemd
  [switch]$WithData,                               # 連同本機 data\ 一起搬（第一次或搬家才用）
  [string]$Key = ""                                # 私鑰路徑
)

# 原生指令（ssh/scp）把提示寫到 stderr，不該中斷腳本；一律用 $LASTEXITCODE 判斷成敗
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$sshArgs = @("-o", "StrictHostKeyChecking=accept-new", "-o", "LogLevel=ERROR")
if ($Key) { $sshArgs += @("-i", $Key) }

function Remote([string]$cmd) {
  # 去掉 Windows 換行的 CR，否則遠端 bash 每行結尾都會多一個控制字元
  $cmd = $cmd -replace "[`r]", ""
  & ssh @sshArgs $Server $cmd
  if ($LASTEXITCODE -ne 0) { throw "遠端指令失敗（exit $LASTEXITCODE）" }
}

function Send([string]$local, [string]$remote) {
  & scp @sshArgs $local "${Server}:$remote"
  if ($LASTEXITCODE -ne 0) { throw "上傳失敗: $local" }
}

Write-Host "`n=== 1/5 重新產生離線單檔 ===" -ForegroundColor Cyan
python "$root\build_single.py" | Out-Host

Write-Host "`n=== 2/5 打包 ===" -ForegroundColor Cyan
$stage = Join-Path $env:TEMP "fgc-stage"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item "$root\server.py" $stage
Copy-Item "$root\web" $stage -Recurse
Copy-Item "$root\FGC2026_Scouting.html" $stage -ErrorAction SilentlyContinue
if ($WithData -and (Test-Path "$root\data")) {
  Copy-Item "$root\data" $stage -Recurse
  $n = (Get-ChildItem "$root\data\teams" -ErrorAction SilentlyContinue).Count
  Write-Host "  含 data\（$n 隊的資料與帳號）" -ForegroundColor Yellow
}
$tar = Join-Path $env:TEMP "fgc-deploy.tar.gz"
if (Test-Path $tar) { Remove-Item $tar -Force }
& tar -czf $tar -C $stage .
Write-Host ("  封存 {0:N0} KB" -f ((Get-Item $tar).Length / 1KB))

Write-Host "`n=== 3/5 上傳 ===" -ForegroundColor Cyan
Send $tar "/tmp/fgc-deploy.tar.gz"
if ($Setup) { Send "$root\deploy\setup.sh" "/tmp/setup.sh" }

if ($Setup) {
  Write-Host "`n=== 4/5 安裝環境（Python / Caddy / systemd / 防火牆）===" -ForegroundColor Cyan
  Remote "sudo bash /tmp/setup.sh $Domain"
} else {
  Write-Host "`n=== 4/5 略過安裝（沒有 -Setup）===" -ForegroundColor DarkGray
}

Write-Host "`n=== 5/5 解開並重啟 ===" -ForegroundColor Cyan
$deploy = @'
set -e
sudo mkdir -p /opt/fgc
sudo tar -xzf /tmp/fgc-deploy.tar.gz -C /opt/fgc
sudo chown -R fgc:fgc /opt/fgc
sudo systemctl restart fgc-scouting
sleep 1
echo -n "  服務狀態: "; systemctl is-active fgc-scouting
echo -n "  健康檢查: "; curl -s --max-time 5 localhost:8080/health; echo
rm -f /tmp/fgc-deploy.tar.gz /tmp/setup.sh
'@
Remote $deploy

$hostName = if ($Domain) { $Domain } else { $Server -replace '^.*@', '' }
$scheme = if ($Domain) { "https" } else { "http" }
Write-Host "`n完成 ✓" -ForegroundColor Green
Write-Host "  網站    ${scheme}://${hostName}/"
Write-Host "  安裝頁  ${scheme}://${hostName}/install"
Write-Host "  健康    ${scheme}://${hostName}/health`n"
