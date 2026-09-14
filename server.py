#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FGC 2026 Scouting — 伺服器（靜態網站 + 每隊獨立帳號/資料 + 多裝置同步）

用法：
    python server.py                       # port 8080
    python server.py --port 8080 --host 0.0.0.0
    python server.py --reset-password nepal   # 把某隊密碼重設回預設 "password"

帳號：
    每一個參賽國家（web/nations.js 裡的 slug）就是一個帳號，預設密碼 "password"。
    第一次登入必須改密碼；之後只有知道該隊密碼的人能看到／寫入該隊的 scouting 資料。

路由：
    GET  /                      → web/index.html
    GET  /<static>              → web/ 內的 css / js
    GET  /health                → 健康檢查
    POST /api/login             {team, password}      → {token, team, mustChange}
    GET  /api/me                X-Token               → {team, mustChange}
    POST /api/password          X-Token {current,new} → {ok}
    POST /api/logout            X-Token
    GET  /api/state             X-Token               → 該隊整份資料
    POST /api/sync              X-Token {cfg,pit,match} → 合併後的該隊資料

資料：
    data/accounts.json          帳號（PBKDF2 雜湊）
    data/sessions.json          登入 token
    data/teams/<slug>.json      每隊的 scouting 資料
    backups/<slug>_YYYYMMDD.json 每日備份
"""
import argparse, base64, hashlib, hmac, json, mimetypes, os, plistlib, re, secrets, shutil, sys, threading, time, uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "web")
DATA_DIR = os.path.join(HERE, "data")
TEAM_DIR = os.path.join(DATA_DIR, "teams")
BACKUP_DIR = os.path.join(HERE, "backups")
ACCOUNTS = os.path.join(DATA_DIR, "accounts.json")
SESSIONS = os.path.join(DATA_DIR, "sessions.json")
PROFILES = os.path.join(DATA_DIR, "profiles.json")   # 各隊自己填的機器介紹（published 的公開給所有隊）
PROF = {}
PROFILE_KEYS = {"cap", "type", "empty", "sup", "port", "climb", "climbSec", "carry", "carried", "pos",
                "roles", "hp", "drive", "lang", "desc", "published"}
PHOTO_DIR = os.path.join(DATA_DIR, "photos")     # data/photos/<slug>/<hex>.jpg，由 /photos/... 公開提供
PHOTO_MAX = 4
PHOTO_RE = re.compile(r"^/photos/([a-z0-9-]{2,64})/([a-f0-9]{16}\.(?:jpg|png|webp))$")

DEFAULT_PASSWORD = "password"
SESSION_DAYS = 45
PBKDF2_ITER = 120_000

LOCK = threading.Lock()
TEAMS = {}          # slug -> state dict（lazy load）
ACC = {}            # slug -> {salt, hash, changed, ts}
SESS = {}           # token -> {team, created, last}
NATION_SLUGS = set()
FAILS = {}          # ip -> [timestamps]

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("application/x-apple-aspen-config", ".mobileconfig")


def web_clip_profile(base_url):
    """iOS 設定描述檔（Web Clip）：在主畫面加一個圖示，指向 base_url。未簽章，所以 iOS 會顯示『未驗證』。"""
    icon = b""
    for name in ("fgc2026-180.png", "fgc2026-192.png"):
        p = os.path.join(WEB, name)
        if os.path.isfile(p):
            icon = open(p, "rb").read()
            break
    ns = uuid.NAMESPACE_URL
    payload = {
        "PayloadType": "com.apple.webClip.managed",
        "PayloadVersion": 1,
        "PayloadIdentifier": "global.first.fgc2026.scouting.webclip",
        "PayloadUUID": str(uuid.uuid5(ns, base_url + "#webclip")),
        "PayloadDisplayName": "FGC 2026 Scouting",
        "PayloadDescription": "Adds the FGC 2026 Scouting app to the Home Screen.",
        "URL": base_url,
        "Label": "FGC Scout",
        "Icon": icon,
        "IsRemovable": True,
        "Precomposed": True,
        "FullScreen": True,
        "IgnoreManifestScope": True,
    }
    profile = {
        "PayloadType": "Configuration",
        "PayloadVersion": 1,
        "PayloadIdentifier": "global.first.fgc2026.scouting",
        "PayloadUUID": str(uuid.uuid5(ns, base_url)),
        "PayloadDisplayName": "FGC 2026 Scouting",
        "PayloadDescription": "Home Screen icon for the FGC 2026 Scouting app. Nothing else is changed.",
        "PayloadOrganization": "FIRST Global Challenge 2026 · Scouting",
        "PayloadRemovalDisallowed": False,
        "PayloadContent": [payload],
    }
    return plistlib.dumps(profile, fmt=plistlib.FMT_XML)


# ───────────────────────── 檔案工具 ─────────────────────────
def _read_json(path, default):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[data] 讀取 {os.path.basename(path)} 失敗（{e}），保留為 .corrupt")
            try:
                shutil.copy2(path, path + ".corrupt")
            except Exception:
                pass
    return default


def _write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def load_nations():
    """從 web/nations.js 取出合法的隊伍 slug（只有這些能登入）。"""
    global NATION_SLUGS
    try:
        txt = open(os.path.join(WEB, "nations.js"), encoding="utf-8").read()
        m = re.search(r"window\.NATIONS\s*=\s*(\[.*\]);", txt, re.S)
        NATION_SLUGS = {n["slug"] for n in json.loads(m.group(1))}
    except Exception as e:
        print(f"[warn] 讀不到 web/nations.js（{e}），任何 slug 都可登入")
        NATION_SLUGS = set()


def blank():
    return {"cfg": {}, "pit": {}, "match": [], "rev": 0}


def team_state(slug):
    """呼叫前必須持有 LOCK。"""
    st = TEAMS.get(slug)
    if st is None:
        d = _read_json(os.path.join(TEAM_DIR, slug + ".json"), None) or {}
        st = {"cfg": d.get("cfg") or {}, "pit": d.get("pit") or {},
              "match": d.get("match") or [], "rev": int(d.get("rev") or 0)}
        TEAMS[slug] = st
    return st


def persist_team(slug):
    """原子寫入 + 每日備份。呼叫前必須持有 LOCK。"""
    path = os.path.join(TEAM_DIR, slug + ".json")
    _write_json(path, TEAMS[slug])
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        bak = os.path.join(BACKUP_DIR, f"{slug}_{datetime.now().strftime('%Y%m%d')}.json")
        if not os.path.exists(bak) or time.time() - os.path.getmtime(bak) > 1800:
            shutil.copy2(path, bak)
    except Exception:
        pass


def merge(state, incoming):
    """把 incoming 合併進 state，以 ts 決定勝負。呼叫前必須持有 LOCK。"""
    changed = False
    inc_cfg = incoming.get("cfg") or {}
    if isinstance(inc_cfg, dict) and inc_cfg.get("ts", "") > (state["cfg"].get("ts", "") or ""):
        state["cfg"] = inc_cfg
        changed = True
    for team, rec in (incoming.get("pit") or {}).items():
        if not isinstance(rec, dict):
            continue
        cur = state["pit"].get(team)
        if cur is None or rec.get("ts", "") > (cur.get("ts", "") or ""):
            state["pit"][team] = rec
            changed = True
    idx = {m.get("id"): i for i, m in enumerate(state["match"]) if isinstance(m, dict) and m.get("id")}
    for m in (incoming.get("match") or []):
        if not isinstance(m, dict) or not m.get("id"):
            continue
        mid = m["id"]
        if mid in idx:
            if m.get("ts", "") > (state["match"][idx[mid]].get("ts", "") or ""):
                state["match"][idx[mid]] = m
                changed = True
        else:
            idx[mid] = len(state["match"])
            state["match"].append(m)
            changed = True
    if changed:
        state["rev"] = int(state.get("rev", 0)) + 1
    return changed


# ───────────────────────── 帳號 ─────────────────────────
def _hash(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITER).hex()


def check_password(slug, pw):
    """回傳 (ok, must_change)。呼叫前必須持有 LOCK。"""
    a = ACC.get(slug)
    if a is None:
        return hmac.compare_digest(pw, DEFAULT_PASSWORD), True
    ok = hmac.compare_digest(_hash(pw, a["salt"]), a["hash"])
    return ok, not a.get("changed", False)


def set_password(slug, pw):
    """呼叫前必須持有 LOCK。"""
    salt = secrets.token_hex(16)
    ACC[slug] = {"salt": salt, "hash": _hash(pw, salt), "changed": True,
                 "ts": datetime.now().isoformat(timespec="seconds")}
    _write_json(ACCOUNTS, ACC)


def new_session(slug):
    """呼叫前必須持有 LOCK。"""
    tok = secrets.token_urlsafe(32)
    now = time.time()
    # 清掉過期 session
    for t in [t for t, s in SESS.items() if now - s.get("last", s.get("created", 0)) > SESSION_DAYS * 86400]:
        SESS.pop(t, None)
    SESS[tok] = {"team": slug, "created": now, "last": now}
    _write_json(SESSIONS, SESS)
    return tok


def session_team(tok):
    """呼叫前必須持有 LOCK。"""
    s = SESS.get(tok or "")
    if not s:
        return None
    if time.time() - s.get("last", s.get("created", 0)) > SESSION_DAYS * 86400:
        SESS.pop(tok, None)
        return None
    s["last"] = time.time()
    return s["team"]


def too_many_fails(ip):
    now = time.time()
    lst = [t for t in FAILS.get(ip, []) if now - t < 300]
    FAILS[ip] = lst
    return len(lst) >= 8


# ───────────────────────── HTTP ─────────────────────────
class H(BaseHTTPRequestHandler):
    server_version = "FGCScout/3.0"
    protocol_version = "HTTP/1.1"
    timeout = 20  # 卡住的客戶端不會占住執行緒

    def log_message(self, fmt, *args):
        try:
            line = fmt % args
        except Exception:
            line = " ".join(str(a) for a in args) or str(fmt)
        if "/api/sync" in line or "/health" in line or "/api/me" in line:
            return
        try:
            sys.stdout.write("[%s] %s\n" % (self.log_date_time_string(), line))
            sys.stdout.flush()
        except Exception:
            pass

    # -- helpers --
    def _send(self, code, body=b"", ctype="text/plain; charset=utf-8", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD" and body:
            self.wfile.write(body)

    def _json(self, code, obj=None, raw=None):
        body = raw if raw is not None else json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self._send(code, body, "application/json; charset=utf-8", {"Cache-Control": "no-store"})

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n <= 0 or n > 8 * 1024 * 1024:
            self._json(400, {"error": "payload 大小不合法"})
            return None
        try:
            d = json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception as e:
            self._json(400, {"error": f"JSON 解析失敗: {e}"})
            return None
        if not isinstance(d, dict):
            self._json(400, {"error": "格式不正確"})
            return None
        return d

    def _team(self):
        """從 X-Token 取得隊伍；失敗時已回 401。"""
        tok = self.headers.get("X-Token", "")
        with LOCK:
            slug = session_team(tok)
        if not slug:
            self._json(401, {"error": "請先登入"})
        return slug

    def _ip(self):
        return self.headers.get("CF-Connecting-IP") or self.headers.get("X-Forwarded-For", "").split(",")[0].strip() or self.client_address[0]

    def _base_url(self):
        """外部看到的網址：走 cloudflared 時要用轉發來的 host / proto。"""
        host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or ""
        host = host.split(",")[0].strip()
        proto = (self.headers.get("X-Forwarded-Proto") or "").split(",")[0].strip()
        if not proto:
            proto = "https" if host.endswith("trycloudflare.com") else "http"
        if not host:
            host = "localhost"
        return f"{proto}://{host}/"

    def _static(self, path):
        rel = unquote(path).lstrip("/") or "index.html"
        root = os.path.normpath(WEB)
        full = os.path.normpath(os.path.join(root, rel))
        if full != root and not full.startswith(root + os.sep):
            return self._send(404, b"not found")
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if not os.path.isfile(full):
            return self._send(404, b"not found")
        ctype, _ = mimetypes.guess_type(full)
        ctype = ctype or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json", "application/manifest+json"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as f:
            body = f.read()
        base = os.path.basename(full)
        extra = {"Cache-Control": "public, max-age=300"}
        if base in ("index.html", "install.html", "sw.js", "manifest.webmanifest"):
            extra["Cache-Control"] = "no-cache"
        if base == "sw.js":
            extra["Service-Worker-Allowed"] = "/"
        return self._send(200, body, ctype, extra)

    # -- routes --
    def do_GET(self):
        u = urlparse(self.path)
        p = u.path
        if p == "/health":
            with LOCK:
                info = {"ok": True, "teams": len(os.listdir(TEAM_DIR)) if os.path.isdir(TEAM_DIR) else 0,
                        "accounts": len(ACC), "sessions": len(SESS)}
            return self._json(200, info)
        if p == "/api/me":
            slug = self._team()
            if not slug:
                return
            with LOCK:
                must = not ACC.get(slug, {}).get("changed", False)
            return self._json(200, {"team": slug, "mustChange": must})
        if p == "/api/state":
            slug = self._team()
            if not slug:
                return
            with LOCK:
                raw = json.dumps(team_state(slug), ensure_ascii=False).encode("utf-8")
            return self._json(200, raw=raw)
        if p == "/api/profiles":
            # 所有隊伍公開的機器介紹（要登入才看得到，但任何隊都看得到）
            slug = self._team()
            if not slug:
                return
            with LOCK:
                pub = {k: v for k, v in PROF.items() if v.get("published") or k == slug}
            return self._json(200, pub)
        if p in ("/install.mobileconfig", "/FGC2026-Scouting.mobileconfig"):
            body = web_clip_profile(self._base_url())
            return self._send(200, body, "application/x-apple-aspen-config; charset=utf-8",
                              {"Cache-Control": "no-store",
                               "Content-Disposition": 'attachment; filename="FGC2026-Scouting.mobileconfig"'})

        if p in ("/install", "/install/"):
            return self._static("/install.html")

        if p == "/favicon.ico":
            return self._static("/fgc2026-64.png")
        m = PHOTO_RE.match(p)
        if m:
            full = os.path.join(PHOTO_DIR, m.group(1), m.group(2))
            if not os.path.isfile(full):
                return self._send(404, b"not found")
            with open(full, "rb") as f:
                body = f.read()
            ctype = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}[m.group(2).rsplit(".", 1)[1]]
            return self._send(200, body, ctype, {"Cache-Control": "public, max-age=86400"})
        if p.startswith("/api/") or p.startswith("/photos/"):
            return self._send(404, b"not found")
        return self._static(p)

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        u = urlparse(self.path)
        p = u.path

        if p == "/api/login":
            ip = self._ip()
            if too_many_fails(ip):
                return self._json(429, {"error": "嘗試太多次，5 分鐘後再試 / Too many attempts"})
            d = self._body()
            if d is None:
                return
            slug = str(d.get("team") or "").strip().lower()
            pw = str(d.get("password") or "")
            if not re.fullmatch(r"[a-z0-9-]{2,64}", slug) or (NATION_SLUGS and slug not in NATION_SLUGS):
                return self._json(400, {"error": "不是有效的隊伍 / Unknown team"})
            with LOCK:
                ok, must = check_password(slug, pw)
                if not ok:
                    FAILS.setdefault(ip, []).append(time.time())
                    return self._json(403, {"error": "密碼錯誤 / Wrong password"})
                tok = new_session(slug)
            return self._json(200, {"token": tok, "team": slug, "mustChange": must})

        if p == "/api/logout":
            tok = self.headers.get("X-Token", "")
            with LOCK:
                if SESS.pop(tok, None) is not None:
                    _write_json(SESSIONS, SESS)
            return self._json(200, {"ok": True})

        if p == "/api/password":
            slug = self._team()
            if not slug:
                return
            d = self._body()
            if d is None:
                return
            cur = str(d.get("current") or "")
            new = str(d.get("new") or "")
            if len(new) < 4 or len(new) > 128:
                return self._json(400, {"error": "新密碼至少 4 個字 / New password too short"})
            if new == DEFAULT_PASSWORD:
                return self._json(400, {"error": "不能用預設密碼 / Cannot keep the default password"})
            with LOCK:
                ok, _ = check_password(slug, cur)
                if not ok:
                    return self._json(403, {"error": "目前密碼錯誤 / Current password is wrong"})
                set_password(slug, new)
            return self._json(200, {"ok": True})

        if p == "/api/sync":
            # 客戶端沒有新資料時只送 {"rev": n} 當作輪詢；伺服器也沒變就回 nochange（省頻寬）
            slug = self._team()
            if not slug:
                return
            d = self._body()
            if d is None:
                return
            has_payload = any(k in d for k in ("cfg", "pit", "match"))
            try:
                client_rev = int(d.get("rev", -1))
            except (TypeError, ValueError):
                client_rev = -1
            with LOCK:
                st = team_state(slug)
                changed = merge(st, d) if has_payload else False
                if changed:
                    persist_team(slug)
                rev = int(st.get("rev", 0))
                if not changed and client_rev == rev:
                    return self._json(200, {"nochange": True, "rev": rev})
                raw = json.dumps(st, ensure_ascii=False).encode("utf-8")
            return self._json(200, raw=raw)

        if p == "/api/profile":
            # 自己隊的機器介紹（只能改自己的）
            slug = self._team()
            if not slug:
                return
            d = self._body()
            if d is None:
                return
            prof = {k: v for k, v in d.items() if k in PROFILE_KEYS}
            if len(json.dumps(prof, ensure_ascii=False)) > 20000:
                return self._json(400, {"error": "太長了 / Profile too long"})
            prof["team"] = slug
            prof["ts"] = datetime.now().isoformat(timespec="seconds")
            with LOCK:
                prof["photos"] = list(PROF.get(slug, {}).get("photos") or [])   # 照片由 /api/photo 管理
                PROF[slug] = prof
                _write_json(PROFILES, PROF)
            return self._json(200, prof)

        if p == "/api/photo":
            # 上傳自己隊的機器照片（前端已縮到 ≤1280px 的 JPEG，base64 data URL）
            slug = self._team()
            if not slug:
                return
            d = self._body()
            if d is None:
                return
            m = re.match(r"^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$", str(d.get("data") or ""))
            if not m:
                return self._json(400, {"error": "不是圖片 / Not an image"})
            try:
                raw = base64.b64decode(m.group(2), validate=False)
            except Exception:
                return self._json(400, {"error": "圖片資料壞掉 / Bad image data"})
            if len(raw) > 2_000_000:
                return self._json(413, {"error": "照片太大 / Photo too large (max 2 MB)"})
            ext = {"jpeg": "jpg", "png": "png", "webp": "webp"}[m.group(1)]
            with LOCK:
                prof = PROF.setdefault(slug, {"team": slug, "published": False})
                photos = prof.setdefault("photos", [])
                if len(photos) >= PHOTO_MAX:
                    return self._json(400, {"error": f"最多 {PHOTO_MAX} 張 / Max {PHOTO_MAX} photos"})
                name = secrets.token_hex(8) + "." + ext
                os.makedirs(os.path.join(PHOTO_DIR, slug), exist_ok=True)
                with open(os.path.join(PHOTO_DIR, slug, name), "wb") as f:
                    f.write(raw)
                url = f"/photos/{slug}/{name}"
                photos.append(url)
                prof["ts"] = datetime.now().isoformat(timespec="seconds")
                _write_json(PROFILES, PROF)
            return self._json(200, {"url": url, "photos": photos})

        if p == "/api/photo/delete":
            slug = self._team()
            if not slug:
                return
            d = self._body()
            if d is None:
                return
            url = str(d.get("url") or "")
            m = PHOTO_RE.match(url)
            if not m or m.group(1) != slug:
                return self._json(400, {"error": "不是你的照片 / Not your photo"})
            with LOCK:
                prof = PROF.get(slug)
                if prof and url in (prof.get("photos") or []):
                    prof["photos"].remove(url)
                    prof["ts"] = datetime.now().isoformat(timespec="seconds")
                    _write_json(PROFILES, PROF)
                try:
                    os.remove(os.path.join(PHOTO_DIR, m.group(1), m.group(2)))
                except OSError:
                    pass
                photos = list((prof or {}).get("photos") or [])
            return self._json(200, {"photos": photos})

        return self._send(404, b"not found")


def main():
    global ACC, SESS, PROF
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--host", default="0.0.0.0", help="0.0.0.0 允許區網連入；127.0.0.1 只允許本機/隧道")
    ap.add_argument("--reset-password", metavar="SLUG", help="把該隊密碼重設回預設並結束")
    a = ap.parse_args()

    os.makedirs(TEAM_DIR, exist_ok=True)
    load_nations()
    ACC = _read_json(ACCOUNTS, {}) or {}
    SESS = _read_json(SESSIONS, {}) or {}
    PROF = _read_json(PROFILES, {}) or {}

    if a.reset_password:
        slug = a.reset_password.strip().lower()
        ACC.pop(slug, None)
        _write_json(ACCOUNTS, ACC)
        for t in [t for t, s in SESS.items() if s.get("team") == slug]:
            SESS.pop(t)
        _write_json(SESSIONS, SESS)
        print(f"[ok] {slug} 的密碼已重設為 \"{DEFAULT_PASSWORD}\"，並登出該隊所有裝置")
        return

    if not os.path.isfile(os.path.join(WEB, "index.html")):
        print(f"[warn] 找不到 {os.path.join(WEB, 'index.html')}")

    srv = ThreadingHTTPServer((a.host, a.port), H)
    srv.daemon_threads = True

    print("=" * 60)
    print("  FGC 2026 Scouting Server  (per-team login)")
    print("=" * 60)
    print(f"  本機      http://localhost:{a.port}/")
    if a.host == "0.0.0.0":
        import socket
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80)); ip = s.getsockname()[0]; s.close()
            print(f"  區網      http://{ip}:{a.port}/   ← 同一個 Wi-Fi 的 iPad 用這個")
        except Exception:
            pass
    print(f"  隊伍數    {len(NATION_SLUGS) or '（不限）'}   預設密碼 \"{DEFAULT_PASSWORD}\"（第一次登入必須改）")
    print(f"  資料目錄  {DATA_DIR}")
    print(f"  每日備份  {BACKUP_DIR}")
    print(f"  重設密碼  python server.py --reset-password <slug>")
    print("=" * 60)
    print("  Ctrl+C 停止")
    print()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[stop] 關閉中…")
        with LOCK:
            for slug in list(TEAMS):
                persist_team(slug)
        srv.shutdown()


if __name__ == "__main__":
    main()
