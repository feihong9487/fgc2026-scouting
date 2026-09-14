# 把 FGC 2026 Scouting 架到 Vultr（首爾）

**目標**：現在就上雲、一路用到 10/10 賽後關機。首爾機房離仁川會場約 5 ms。
**費用**：按小時計費，一週大約 US$1.2（$5/月 方案）。Vultr 新帳號通常有 $300 贈金，等於免費。

> 為什麼要搬：不是你電腦不夠力（Ryzen 9 跑這個只用 29 MB 記憶體），
> 而是比賽期間你人在仁川、機器在台灣——停電、Windows 更新、ISP 斷線你都救不了。
> 而且雲端有固定網域，iOS 描述檔裝一次就永久有效。

---

## 0. 事前準備（現在就可以做，5 分鐘）

**SSH 金鑰**：已經產生好了 —— `%USERPROFILE%\.ssh\id_ed25519_fgc`（fgc 專用、無密碼，給自動部署用）。
要再看一次公鑰（貼到 Vultr 用）：

```powershell
Get-Content $HOME\.ssh\id_ed25519_fgc.pub
```

之後所有部署指令都要加 `-Key $HOME\.ssh\id_ed25519_fgc`。

**申請免費固定網域**：到 [duckdns.org](https://www.duckdns.org) 用 Google 登入 → 建一個名字（例 `fgc-scout`）→ 先不用填 IP。
你會得到 `<your-domain>`，永久免費。

---

## 1. 開機器（Vultr）

1. 帳號已註冊完成，$300 贈金已入帳（Billing → 確認 Total Available Credit 有 $300）
2. Products → Deploy New Server
   - **Type**：Cloud Compute — Shared CPU
   - **Location**：**Seoul 首爾**
   - **Image**：Ubuntu 24.04 LTS x64
   - **Plan**：選首爾最便宜的（大約 $5–6/月、1 GB RAM / 25 GB SSD）
   - **SSH Keys**：Add New → 把 `id_ed25519_fgc.pub` 那一整行貼上去（**一定要加，不然只能用密碼登入**）
   - **Additional Features**：IPv4 保持開啟；Auto Backups 不用開（省錢，我們自己備份）
   - Hostname：`fgc-scout`
3. 開好之後複製它的 **IP 位址**
4. 回到 DuckDNS，把那個 IP 填進 current ip → Update

> DNS 生效大概 1 分鐘。可以用 `ping <your-domain>` 確認指到對的 IP 再往下走。

---

## 2. 一鍵部署

在專案資料夾（`D:\FGC2026`）開 PowerShell：

```powershell
.\deploy\push.ps1 -Server root@<your-domain> -Setup -Domain <your-domain> -WithData -Key $HOME\.ssh\id_ed25519_fgc
```

這一行會做完：

1. 重新 build 離線單檔
2. 打包 `server.py` + `web\` + `data\`（現有 11 隊的帳號與資料）
3. 上傳、安裝 Python / Caddy / systemd / ufw 防火牆
4. Caddy 自動申請 Let's Encrypt 憑證（第一次要等 10–30 秒）
5. 啟動服務並檢查 `/health`

完成後：

| 用途 | 網址 |
|---|---|
| 網站 | `https://<your-domain>/` |
| iOS 安裝頁 | `https://<your-domain>/install` |
| 健康檢查 | `https://<your-domain>/health` |

之後每次改程式，只要：

```powershell
.\deploy\push.ps1 -Server root@<your-domain> -Key $HOME\.ssh\id_ed25519_fgc
```

---

## 3. 從別的地方搬過來

搬家會換網址，現有使用者要通知。建議挑半夜：

1. `.\deploy\push.ps1 ... -WithData` 把資料一起搬上去
2. 開新網址確認能登入、資料都在
3. 把家裡的 `server.py` 和 `cloudflared` 關掉（避免有人還在寫舊的那份，之後資料對不起來）
4. 通知那 11 隊新網址，請他們：
   - 重新開 `https://<your-domain>/`
   - **重裝 iOS 描述檔**（舊的指向已失效的隧道網址）
   - 密碼和資料都不用重設，照舊

---

## 4. 比賽期間的維運

```powershell
# 每天備份一次（賽後砍機器前一定要做！）
.\deploy\pull-data.ps1 -Server root@<your-domain> -Key $HOME\.ssh\id_ed25519_fgc

# 看服務狀態與日誌
ssh root@<your-domain> "systemctl status fgc-scouting --no-pager; tail -30 /var/log/fgc-scouting.log"

# 幫忘記密碼的隊伍重設（會登出他們所有裝置，密碼回到 password）
ssh root@<your-domain> "cd /opt/fgc && sudo -u fgc python3 server.py --reset-password nepal"

# 看目前有幾隊在用
curl https://<your-domain>/health
```

服務是 systemd 管的：掛掉 3 秒自動重開、主機重開機也會自動啟動。

---

## 5. 賽後收尾

> ⚠️ 如果你是用註冊贈金開的機器，贈金到期後機器還開著就會開始真的扣款。
> 比賽結束、資料拉回來之後就去 Destroy。

```powershell
.\deploy\pull-data.ps1 -Server root@<your-domain> -Key $HOME\.ssh\id_ed25519_fgc    # 先把資料抓回來！
```

確認 `cloud-backup\` 裡有東西之後，再去 Vultr 後台 **Destroy** 那台機器，計費立刻停止。
（只是 Stop 沒有用，Vultr 關機仍然計費，一定要 Destroy。）

想繼續留著給明年用的話，也可以先 **Snapshot**（快照每月約 $0.05/GB），之後再從快照開回來。

---

## 附錄：換成別家

`setup.sh` 和 `push.ps1` 不綁任何雲端商，只要是 Ubuntu 22.04/24.04、有 root SSH 就能用：

- **AWS Lightsail 首爾**：$5/月（1 GB / 40 GB / 2 TB 流量），要綁信用卡
- **Oracle 首爾 ap-seoul-1**：Always Free 永久免費（ARM 4 核 24 GB），但要卡驗證、常常搶不到容量
- **自己的 NAS / 舊筆電**：一樣跑 `setup.sh`，只是要自己處理對外 IP 和 port forwarding

指令都一樣：

```powershell
.\deploy\push.ps1 -Server root@<IP或網域> -Setup -Domain <網域>
```
