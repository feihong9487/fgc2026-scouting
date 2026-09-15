#!/usr/bin/env bash
# FGC 2026 Scouting — 一次性主機設定（Ubuntu 22.04 / 24.04）
# 用法：sudo bash setup.sh <你的網域>        例：sudo bash setup.sh fgc-scout.duckdns.org
# 沒有網域就先跑：sudo bash setup.sh           （只開 http，之後再補網域）
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR=/opt/fgc
SVC_USER=fgc

echo "== 1/7 套件 =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 rsync curl gnupg ca-certificates debian-keyring debian-archive-keyring apt-transport-https

echo "== 2/7 Caddy（自動 HTTPS 憑證）=="
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -qq && apt-get install -y -qq caddy
fi

echo "== 3/7 使用者與目錄 =="
id -u "$SVC_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$SVC_USER"
mkdir -p "$APP_DIR"/{web,data,backups}
chown -R "$SVC_USER:$SVC_USER" "$APP_DIR"

echo "== 4/7 systemd 服務 =="
cat >/etc/systemd/system/fgc-scouting.service <<UNIT
[Unit]
Description=FGC 2026 Scouting server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SVC_USER
WorkingDirectory=$APP_DIR
# 只聽本機，對外由 Caddy 轉發（HTTPS 在 Caddy 那層）
ExecStart=/usr/bin/python3 $APP_DIR/server.py --host 127.0.0.1 --port 8080
Restart=always
RestartSec=3
# 基本隔離：只有 data/ 和 backups/ 可寫
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR/data $APP_DIR/backups
StandardOutput=append:/var/log/fgc-scouting.log
StandardError=append:/var/log/fgc-scouting.log

[Install]
WantedBy=multi-user.target
UNIT
touch /var/log/fgc-scouting.log && chown "$SVC_USER" /var/log/fgc-scouting.log
systemctl daemon-reload
systemctl enable fgc-scouting

echo "== 5/7 Caddy 設定 =="
if [ -n "$DOMAIN" ]; then
  cat >/etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode zstd gzip
	# 靜態檔與 API 全部交給後端；Caddy 只負責 TLS、壓縮與基本保護
	reverse_proxy 127.0.0.1:8080 {
		header_up X-Forwarded-Host {host}
		header_up X-Forwarded-Proto {scheme}
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
		-Server
	}
	request_body {
		max_size 8MB
	}
	log {
		output file /var/log/caddy/fgc.log
		format console
	}
}
CADDY
else
  cat >/etc/caddy/Caddyfile <<CADDY
:80 {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8080 {
		header_up X-Forwarded-Host {host}
		header_up X-Forwarded-Proto {scheme}
	}
	request_body {
		max_size 8MB
	}
}
CADDY
fi
mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy
systemctl enable caddy

echo "== 6/7 防火牆（只開 SSH / HTTP / HTTPS）=="
if command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null
  ufw allow 80/tcp  >/dev/null
  ufw allow 443/tcp >/dev/null
  yes | ufw enable >/dev/null 2>&1 || true
  ufw status | sed 's/^/  /'
else
  echo "  （沒有 ufw，略過）"
fi

echo "== 7/7 啟動 =="
systemctl restart caddy || true
if [ -f "$APP_DIR/server.py" ]; then
  systemctl restart fgc-scouting
  sleep 1
  echo -n "  服務狀態: "; systemctl is-active fgc-scouting || true
else
  echo "  還沒上傳程式（$APP_DIR/server.py 不存在），推上去之後會自動啟動"
fi
echo
echo "完成。程式放在 $APP_DIR（server.py 與 web/）。"
if [ -n "$DOMAIN" ]; then
  echo "  → https://$DOMAIN/          （Caddy 會自動申請憑證，第一次可能要等 10-30 秒）"
  echo "  → https://$DOMAIN/install   （iOS 描述檔安裝頁）"
else
  echo "  → http://<這台機器的外部IP>/    （之後補網域再跑一次這個腳本就會開 HTTPS）"
fi
