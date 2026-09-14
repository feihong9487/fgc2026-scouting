<#
    取得某一隊的認領連結，直接複製到剪貼簿，貼給他們就好。

        .\deploy\claim.ps1 -Team italy
        .\deploy\claim.ps1 -Team italy -Reissue     # 已經認領過、要重發時用

    連結等同密碼：一對一私訊，不要貼群組。
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Team,
    [string]$Server = 'root@fgc-scout.duckdns.org',
    [string]$Key = "$HOME\.ssh\id_ed25519_fgc",
    [switch]$Reissue
)

$ErrorActionPreference = 'Continue'
$slug = $Team.Trim().ToLower()

if ($Reissue) {
    Write-Host "先作廢 $slug 的舊帳號並重發..." -ForegroundColor Yellow
    $null = ssh -i $Key -o LogLevel=ERROR $Server "cd /opt/fgc && sudo -u fgc python3 server.py --reset-password $slug && systemctl restart fgc-scouting"
    if ($LASTEXITCODE -ne 0) { Write-Host "重發失敗" -ForegroundColor Red; exit 1 }
}

$out = ssh -i $Key -o LogLevel=ERROR $Server "cd /opt/fgc && sudo -u fgc python3 server.py --claim-link $slug"
if ($LASTEXITCODE -ne 0) { Write-Host "連不上伺服器" -ForegroundColor Red; exit 1 }

$text = ($out -join "`n")
Write-Host $text

$link = [regex]::Match($text, 'https?://\S+claim=\S+').Value
if (-not $link) {
    if ($text -match '已經認領過') {
        Write-Host ""
        Write-Host "$slug 已經有人認領了。如果是真的隊伍被鎖在外面，加 -Reissue 重發：" -ForegroundColor Yellow
        Write-Host "  .\deploy\claim.ps1 -Team $slug -Reissue"
    }
    exit 0
}

$msg = @"
Here is your team's sign-in link for the FGC 2026 scouting app:
$link

Open it on your phone and choose a password for your whole team. Everyone on
your team uses that same password, so agree on it together and write it down.
The link works once and is only for your team - please don't share it.
"@

try {
    Set-Clipboard -Value $msg
    Write-Host ""
    Write-Host "已經複製到剪貼簿，直接私訊給 $slug 就好。" -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host "剪貼簿用不了，手動複製上面那段。" -ForegroundColor Yellow
}
Write-Host "提醒：這是一對一私訊用的，貼到群組等於把 $slug 的帳號送給所有人。" -ForegroundColor DarkYellow
