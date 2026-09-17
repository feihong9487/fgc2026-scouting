#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FGC 2026 Scouting — 伺服器（靜態網站 + 每隊獨立帳號/資料 + 多裝置同步 + 官方比分）

用法：
    python server.py                          # port 8080
    python server.py --port 8080 --host 0.0.0.0
    python server.py --gen-claims             # 替所有還沒認領的國家發認領碼
    python server.py --claim-link nepal       # 印出可以私訊給該隊的一鍵認領連結
    python server.py --reset-password nepal   # 作廢該隊帳號、登出所有裝置、發一張新的認領碼
    python server.py --audit 40               # 最近 40 筆登入/認領/改密碼紀錄

帳號：
    每一個參賽國家（web/nations.js 裡的 slug）就是一個帳號，全隊共用。
    沒被認領的國家不能登入：第一次要用主辦方私下發的一次性認領碼，並在同一步自己設密碼，
    所以不存在共用的預設密碼。之後只有知道該隊密碼的人能看到／寫入該隊的 scouting 資料。
    上面的 CLI 指令是另一個程序直接改 data/ 裡的檔案，伺服器每次碰帳號前都會檢查檔案有沒有變，
    所以發碼、作廢都不需要重啟服務。

路由：
    GET  /                      → web/index.html
    GET  /<static>              → web/ 內的 css / js / 國旗
    GET  /health                → 健康檢查（不用登入）
    GET  /install               → 手機安裝頁；/install.mobileconfig 動態產生 iOS Web Clip 描述檔
    POST /api/login             {team, password}         → {token, team, mustChange}；未認領回 409 needClaim
    POST /api/claim             {team, code, password}   → {token, team}
    GET  /api/me                X-Token                  → {team, mustChange, lastLogin, prevLogin}
    POST /api/password          X-Token {current,new}    → {ok}
    POST /api/logout            X-Token
    GET  /api/state             X-Token                  → 該隊整份資料
    POST /api/sync              X-Token {rev,cfg,pit,match} → 合併後的該隊資料，或 {nochange}
    GET  /api/official          X-Token                  → results.first.global 的排名／賽程／比分 + 名次走勢
    POST /api/profile           X-Token {…}              → 自己隊的機器介紹（published 才公開）
    GET  /api/profiles          X-Token                  → 所有已發布的機器介紹
    POST /api/photo             X-Token {data}           → 上傳機器照片；/api/photo/delete 刪除
    GET  /photos/<slug>/<hex>.jpg                        → 照片（公開）

資料：
    data/accounts.json          帳號（PBKDF2 雜湊）
    data/claims.json            認領碼（等同密碼，不進 git）
    data/sessions.json          登入 token
    data/teams/<slug>.json      每隊的 scouting 資料
    data/profiles.json          各隊的機器介紹；data/photos/ 照片
    data/official.json          官方比分快取；data/audit.log 稽核
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

# ── 官方即時比分（results.first.global 是 Next.js，資料直接嵌在頁面的 __NEXT_DATA__）──
OFFICIAL_FILE = os.path.join(DATA_DIR, "official.json")
OFFICIAL_SITE = "https://results.first.global/"
OFFICIAL = {"fetched": "", "error": "", "build": "", "data": {}, "history": []}
OFFICIAL_POLL = 120          # 秒；--official-poll 可調，0 = 關閉
HISTORY_MAX = 240            # 名次快照上限（120 秒一筆 ≈ 8 小時）

CLAIMS = os.path.join(DATA_DIR, "claims.json")   # 每個國家的認領碼，只有主辦方能發
CLAIM = {}
AUDIT_LOG = os.path.join(DATA_DIR, "audit.log")  # 所有登入/改密碼事件，出事時可以追
CLAIM_ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # 拿掉容易看錯的 I O 0 1

DEFAULT_PASSWORD = "password"   # 只有舊帳號還吃這個；新帳號一律走認領碼

# 訪客模式：給評審和當天才想用的隊伍。不用認領碼就能登入，只能看官方排名／賽程／各隊公開的機器介紹、
# 在自己手機上做 scouting、用計分機；不能發布機器介紹、不能上傳照片、不能把任何東西存到伺服器。
# token 是固定的（從 data/guest.secret 推導），所以不佔 sessions.json，重開伺服器也不會失效。
GUEST_SLUG = "guest"
GUEST_SECRET_FILE = os.path.join(DATA_DIR, "guest.secret")
GUEST_TOKEN = ""
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
        "PayloadOrganization": "Team Chinese Taipei · FGC 2026 Scouting (unofficial)",
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


def _now():
    """帶時區的 ISO 時間。前端會轉成裝置本地時間顯示；沒有時區的字串在仁川會被當成當地時間，差 9 小時。"""
    return datetime.now().astimezone().isoformat(timespec="seconds")


# ── 帳號／認領碼／session 三個檔案是伺服器和 CLI 共用的 ──
# --gen-claims、--claim-link、--reset-password 是另一個程序，直接改檔案。伺服器如果只認記憶體裡那份，
# 新發的認領碼對不上（「認領碼不正確」），作廢的帳號又會在下一次登入時被寫回去。
# 所以：自己寫檔時記下 mtime，每次碰這三份資料前先看檔案有沒有被別人動過，有就重讀。
_MT = {}


def _save(path, obj):
    """寫入並記住 mtime，讓 _reload_auth 知道這是自己寫的。"""
    _write_json(path, obj)
    try:
        _MT[path] = os.path.getmtime(path)
    except OSError:
        pass


def _reload_auth():
    """檔案被別的程序改過就重讀。呼叫前必須持有 LOCK。"""
    for path, d in ((ACCOUNTS, ACC), (CLAIMS, CLAIM), (SESSIONS, SESS)):
        try:
            mt = os.path.getmtime(path)
        except OSError:
            mt = None
        if mt == _MT.get(path):
            continue
        _MT[path] = mt
        if mt is None:
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                fresh = json.load(f)
        except Exception:
            continue          # 讀壞了就先用記憶體那份，不要把好的清掉
        if isinstance(fresh, dict):
            d.clear()
            d.update(fresh)


NATION_NAMES = {}


def load_nations():
    """從 web/nations.js 取出合法的隊伍 slug（只有這些能登入）。"""
    global NATION_SLUGS
    try:
        txt = open(os.path.join(WEB, "nations.js"), encoding="utf-8").read()
        m = re.search(r"window\.NATIONS\s*=\s*(\[.*\]);", txt, re.S)
        nations = json.loads(m.group(1))
        NATION_SLUGS = {n["slug"] for n in nations}
        NATION_NAMES.update({n["slug"]: n.get("name", n["slug"]) for n in nations})
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


def audit(event, slug, ip, ua="", note=""):
    """每一次登入、認領、改密碼都寫一行，出事時才查得到是誰。"""
    try:
        rec = {"t": _now(), "event": event,
               "team": slug or "", "ip": ip or "", "ua": (ua or "")[:120], "note": note}
        with open(AUDIT_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception:
        pass        # 稽核失敗不能害到正常請求


def new_claim_code():
    return "-".join("".join(secrets.choice(CLAIM_ALPHA) for _ in range(4)) for _ in range(2))


def issue_claim(slug):
    """發一張新的認領碼給某國並回傳。呼叫前必須持有 LOCK。"""
    code = new_claim_code()
    CLAIM[slug] = {"code": code, "used": False, "issued": _now(),
                   "usedAt": "", "ip": ""}
    _save(CLAIMS, CLAIM)
    return code


def check_claim(slug, code):
    """認領碼對不對。呼叫前必須持有 LOCK。"""
    c = CLAIM.get(slug)
    if not c or c.get("used"):
        return False
    given = re.sub(r"[^A-Za-z0-9]", "", str(code or "")).upper()
    want = re.sub(r"[^A-Za-z0-9]", "", c.get("code", "")).upper()
    return bool(want) and hmac.compare_digest(given, want)


def burn_claim(slug, ip):
    c = CLAIM.get(slug)
    if c:
        c["used"] = True
        c["usedAt"] = _now()
        c["ip"] = ip or ""
        _save(CLAIMS, CLAIM)


def check_password(slug, pw):
    """回傳 (ok, must_change)。呼叫前必須持有 LOCK。"""
    a = ACC.get(slug)
    if a is None:
        # 還沒被認領的國家不能用密碼登入。以前這裡放行預設密碼，等於門是開的：
        # 任何人都能挑一個國家進去再把密碼改掉，把真正的隊伍鎖在外面。
        return False, True
    ok = hmac.compare_digest(_hash(pw, a["salt"]), a["hash"])
    return ok, not a.get("changed", False)


def set_password(slug, pw):
    """呼叫前必須持有 LOCK。"""
    salt = secrets.token_hex(16)
    ACC[slug] = {"salt": salt, "hash": _hash(pw, salt), "changed": True,
                 "ts": _now()}
    _save(ACCOUNTS, ACC)


def note_login(slug, ip):
    """呼叫前必須持有 LOCK。"""
    a = ACC.get(slug)
    if not a:
        return
    a["prevLogin"] = a.get("lastLogin", {})
    a["lastLogin"] = {"t": _now(), "ip": ip or ""}
    _save(ACCOUNTS, ACC)


def new_session(slug):
    """呼叫前必須持有 LOCK。"""
    tok = secrets.token_urlsafe(32)
    now = time.time()
    # 清掉過期 session
    for t in [t for t, s in SESS.items() if now - s.get("last", s.get("created", 0)) > SESSION_DAYS * 86400]:
        SESS.pop(t, None)
    SESS[tok] = {"team": slug, "created": now, "last": now}
    _save(SESSIONS, SESS)
    return tok


def guest_token():
    """固定的訪客 token；第一次呼叫時產生 data/guest.secret。"""
    global GUEST_TOKEN
    if GUEST_TOKEN:
        return GUEST_TOKEN
    os.makedirs(DATA_DIR, exist_ok=True)
    try:
        with open(GUEST_SECRET_FILE, "r", encoding="utf-8") as f:
            sec = f.read().strip()
    except OSError:
        sec = ""
    if not sec:
        sec = secrets.token_hex(32)
        with open(GUEST_SECRET_FILE, "w", encoding="utf-8") as f:
            f.write(sec)
    GUEST_TOKEN = "guest." + hmac.new(sec.encode(), b"fgc2026-guest", hashlib.sha256).hexdigest()[:40]
    return GUEST_TOKEN


def session_team(tok):
    """呼叫前必須持有 LOCK。"""
    if tok and tok == guest_token():
        return GUEST_SLUG
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



# ───────────────────────── 官方比分 ─────────────────────────
def _official_parse(html):
    """從 results.first.global 的 HTML 取出 __NEXT_DATA__ 裡的資料。"""
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    if not m:
        raise ValueError("找不到 __NEXT_DATA__")
    doc = json.loads(m.group(1))
    return doc.get("buildId", ""), (doc.get("props", {}).get("pageProps", {}) or {}).get("data", {}) or {}


def official_fetch():
    """先試 Next.js 的 JSON 端點（快），失敗就回頭解析整頁 HTML（穩）。"""
    import urllib.request
    hdr = {"User-Agent": "fgc2026-scouting/1.0 (+https://github.com/feihong9487/fgc2026-scouting)"}
    build = OFFICIAL.get("build") or ""
    if build:
        try:
            url = OFFICIAL_SITE + "_next/data/%s/index.json" % build
            with urllib.request.urlopen(urllib.request.Request(url, headers=hdr), timeout=20) as r:
                doc = json.loads(r.read().decode("utf-8"))
            data = (doc.get("pageProps", {}) or {}).get("data")
            if isinstance(data, dict):
                return build, data
        except Exception:
            pass          # buildId 過期是正常的，改走 HTML
    with urllib.request.urlopen(urllib.request.Request(OFFICIAL_SITE, headers=hdr), timeout=25) as r:
        html = r.read().decode("utf-8", "replace")
    return _official_parse(html)


def official_store(build, data):
    """存檔並記一筆名次快照，之後用來算升降箭頭與走勢。呼叫前必須持有 LOCK。"""
    OFFICIAL["build"] = build or OFFICIAL.get("build", "")
    OFFICIAL["data"] = data
    OFFICIAL["fetched"] = _now()
    OFFICIAL["error"] = ""
    ranks = {}
    for row in (data.get("rankings") or []):
        key = row.get("teamKey") or (row.get("team") or {}).get("countryCode")
        if key and isinstance(row.get("rank"), int):
            ranks[key] = row["rank"]
    if ranks:
        hist = OFFICIAL.setdefault("history", [])
        if not hist or hist[-1].get("ranks") != ranks:
            hist.append({"t": OFFICIAL["fetched"], "ranks": ranks})
            del hist[:-HISTORY_MAX]
    _write_json(OFFICIAL_FILE, OFFICIAL)


def official_view():
    """給前端的整理結果：名次升降 + 近期走勢。呼叫前必須持有 LOCK。"""
    data = OFFICIAL.get("data") or {}
    hist = OFFICIAL.get("history") or []
    cur = hist[-1]["ranks"] if hist else {}
    prev = hist[-2]["ranks"] if len(hist) > 1 else {}
    movement = {k: prev[k] - v for k, v in cur.items() if k in prev and prev[k] != v}
    spark = {}
    for snap in hist[-20:]:
        for k, v in snap["ranks"].items():
            spark.setdefault(k, []).append(v)
    return {
        "fetched": OFFICIAL.get("fetched", ""),
        "error": OFFICIAL.get("error", ""),
        "source": OFFICIAL_SITE,
        "data": data,
        "movement": movement,
        "spark": spark,
    }


def official_loop():
    while True:
        try:
            build, data = official_fetch()
            with LOCK:
                official_store(build, data)
            n = len((data.get("rankings") or []))
            m = len((data.get("matches") or []))
            print("[official] %s  rankings=%d matches=%d" % (OFFICIAL["fetched"], n, m))
        except Exception as e:
            with LOCK:
                OFFICIAL["error"] = "%s: %s" % (type(e).__name__, e)
            print("[official] 取得失敗：%s" % OFFICIAL["error"])
        time.sleep(max(30, OFFICIAL_POLL))


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
        line = re.sub(r"([?&]code=)[^&\s]+", r"\1***", line)   # 認領連結裡的碼不進日誌
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

    def _team_rw(self):
        """要寫伺服器的路由用這個：訪客一律 403。"""
        slug = self._team()
        if slug == GUEST_SLUG:
            self._json(403, {"error": "訪客模式只能看，不能存到伺服器 / Guest mode is read-only — "
                                      "sign in with your team's claim code to save or publish", "guest": True})
            return None
        return slug

    def _team(self):
        """從 X-Token 取得隊伍；失敗時已回 401。"""
        tok = self.headers.get("X-Token", "")
        with LOCK:
            _reload_auth()
            slug = session_team(tok)
        if not slug:
            self._json(401, {"error": "請先登入"})
        return slug

    def _ip(self):
        # 只信 Caddy 補上的 X-Forwarded-For（它會覆蓋客戶端自己帶的）。以前也讀 CF-Connecting-IP，
        # 但現在前面沒有 Cloudflare，那個標頭誰都能自己填，登入失敗次數限制會被繞過。
        return self.headers.get("X-Forwarded-For", "").split(",")[0].strip() or self.client_address[0]

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
        if p == "/api/guest":
            # 訪客登入：不用密碼、不用認領碼。只記一筆 audit 方便看有多少人用過。
            audit("login-guest", GUEST_SLUG, self._ip(), self.headers.get("User-Agent", ""))
            return self._json(200, {"token": guest_token(), "team": GUEST_SLUG, "guest": True, "mustChange": False})
        if p == "/api/me":
            slug = self._team()
            if not slug:
                return
            if slug == GUEST_SLUG:
                return self._json(200, {"team": GUEST_SLUG, "guest": True, "mustChange": False, "lastLogin": {}, "prevLogin": {}})
            with LOCK:
                _reload_auth()
                a = ACC.get(slug, {})
                must = not a.get("changed", False)
                last = dict(a.get("lastLogin") or {})
                prev = dict(a.get("prevLogin") or {})
            return self._json(200, {"team": slug, "mustChange": must, "lastLogin": last, "prevLogin": prev})
        if p == "/api/state":
            slug = self._team()
            if not slug:
                return
            if slug == GUEST_SLUG:
                return self._json(200, blank())
            with LOCK:
                raw = json.dumps(team_state(slug), ensure_ascii=False).encode("utf-8")
            return self._json(200, raw=raw)
        if p == "/api/official":
            slug = self._team()
            if not slug:
                return
            with LOCK:
                raw = json.dumps(official_view(), ensure_ascii=False).encode("utf-8")
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
        if p in ("/guest", "/guest/"):
            # 海報 QR 用這個網址；轉到首頁帶 ?guest=1，讓 app 自動以訪客登入
            return self._send(302, b"", extra={"Location": "/?guest=1", "Cache-Control": "no-store"})

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
            ua = self.headers.get("User-Agent", "")
            with LOCK:
                _reload_auth()
                claimed = slug in ACC
                if not claimed:
                    audit("login-unclaimed", slug, ip, ua)
                    return self._json(409, {"error": "這個國家還沒有人認領，需要認領碼 / "
                                                     "This nation has not been claimed yet — a claim code is required",
                                            "needClaim": True})
                ok, must = check_password(slug, pw)
                if not ok:
                    FAILS.setdefault(ip, []).append(time.time())
                    audit("login-fail", slug, ip, ua)
                    return self._json(403, {"error": "密碼錯誤 / Wrong password"})
                prev = dict(ACC.get(slug, {}).get("lastLogin") or {})
                note_login(slug, ip)
                tok = new_session(slug)
                audit("login-ok", slug, ip, ua)
            return self._json(200, {"token": tok, "team": slug, "mustChange": must, "prevLogin": prev})

        if p == "/api/claim":
            ip = self._ip()
            if too_many_fails(ip):
                return self._json(429, {"error": "嘗試太多次，5 分鐘後再試 / Too many attempts"})
            d = self._body()
            if d is None:
                return
            slug = str(d.get("team") or "").strip().lower()
            code = str(d.get("code") or "")
            pw = str(d.get("password") or "")
            ua = self.headers.get("User-Agent", "")
            if not re.fullmatch(r"[a-z0-9-]{2,64}", slug) or (NATION_SLUGS and slug not in NATION_SLUGS):
                return self._json(400, {"error": "不是有效的隊伍 / Unknown team"})
            if len(pw) < 4:
                return self._json(400, {"error": "密碼至少 4 個字 / Password must be at least 4 characters"})
            with LOCK:
                _reload_auth()
                if slug in ACC:
                    audit("claim-taken", slug, ip, ua)
                    return self._json(409, {"error": "這個國家已經被認領了，請直接登入 / "
                                                     "Already claimed — sign in with your team password"})
                if not check_claim(slug, code):
                    FAILS.setdefault(ip, []).append(time.time())
                    audit("claim-fail", slug, ip, ua)
                    return self._json(403, {"error": "認領碼不正確 / Wrong claim code"})
                set_password(slug, pw)
                burn_claim(slug, ip)
                note_login(slug, ip)
                tok = new_session(slug)
                audit("claim-ok", slug, ip, ua)
            return self._json(200, {"token": tok, "team": slug, "mustChange": False})

        if p == "/api/logout":
            tok = self.headers.get("X-Token", "")
            with LOCK:
                _reload_auth()
                if SESS.pop(tok, None) is not None:
                    _save(SESSIONS, SESS)
            return self._json(200, {"ok": True})

        if p == "/api/password":
            slug = self._team_rw()
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
                _reload_auth()
                ok, _ = check_password(slug, cur)
                if not ok:
                    audit("pw-change-fail", slug, self._ip(), self.headers.get("User-Agent", ""))
                    return self._json(403, {"error": "目前密碼錯誤 / Current password is wrong"})
                set_password(slug, new)
            return self._json(200, {"ok": True})

        if p == "/api/sync":
            # 客戶端沒有新資料時只送 {"rev": n} 當作輪詢；伺服器也沒變就回 nochange（省頻寬）
            slug = self._team_rw()
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
            slug = self._team_rw()
            if not slug:
                return
            d = self._body()
            if d is None:
                return
            prof = {k: v for k, v in d.items() if k in PROFILE_KEYS}
            if len(json.dumps(prof, ensure_ascii=False)) > 20000:
                return self._json(400, {"error": "太長了 / Profile too long"})
            prof["team"] = slug
            prof["ts"] = _now()
            with LOCK:
                prof["photos"] = list(PROF.get(slug, {}).get("photos") or [])   # 照片由 /api/photo 管理
                PROF[slug] = prof
                _write_json(PROFILES, PROF)
            return self._json(200, prof)

        if p == "/api/photo":
            # 上傳自己隊的機器照片（前端已縮到 ≤1280px 的 JPEG，base64 data URL）
            slug = self._team_rw()
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
                prof["ts"] = _now()
                _write_json(PROFILES, PROF)
            return self._json(200, {"url": url, "photos": photos})

        if p == "/api/photo/delete":
            slug = self._team_rw()
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
                    prof["ts"] = _now()
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
    ap.add_argument("--reset-password", metavar="SLUG",
                    help="把該隊帳號作廢並發一張新的認領碼（舊的密碼重設已經不安全，不再支援）")
    ap.add_argument("--gen-claims", action="store_true",
                    help="替所有還沒認領的國家產生認領碼，印出清單後結束（清單請私下發，不要貼群組）")
    ap.add_argument("--show-claim", metavar="SLUG", help="印出某一國目前的認領碼")
    ap.add_argument("--rotate-unused", action="store_true",
                    help="把所有還沒用掉的認領碼全部換新（外流時用，已認領的帳號不受影響）")
    ap.add_argument("--claim-status", action="store_true",
                    help="列出每一國的狀態（claimed / ready / none），給工具讀的")
    ap.add_argument("--claim-link", metavar="SLUG",
                    help="印出可以直接私訊給該隊的一鍵認領連結")
    ap.add_argument("--base-url", default="https://fgc-scout.duckdns.org/",
                    help="產生認領連結時用的網址")
    ap.add_argument("--audit", nargs="?", const=40, type=int, metavar="N",
                    help="印出最近 N 筆登入/認領/改密碼紀錄")
    ap.add_argument("--revoke-all", action="store_true",
                    help="把所有帳號作廢並重發認領碼（資料保留）。外洩後重新開帳用")
    ap.add_argument("--official-poll", type=int, default=120,
                    help="幾秒抓一次 results.first.global 的官方比分（預設 120）")
    ap.add_argument("--no-official", action="store_true", help="完全不抓官方比分")
    a = ap.parse_args()

    os.makedirs(TEAM_DIR, exist_ok=True)
    load_nations()
    ACC = _read_json(ACCOUNTS, {}) or {}
    SESS = _read_json(SESSIONS, {}) or {}
    PROF = _read_json(PROFILES, {}) or {}
    global CLAIM
    CLAIM = _read_json(CLAIMS, {}) or {}
    global OFFICIAL, OFFICIAL_POLL
    OFFICIAL = _read_json(OFFICIAL_FILE, OFFICIAL) or OFFICIAL
    OFFICIAL_POLL = 0 if a.no_official else a.official_poll

    def _drop_sessions(slug):
        for t in [t for t, v in SESS.items() if v.get("team") == slug]:
            SESS.pop(t)
        _save(SESSIONS, SESS)

    if a.reset_password:
        slug = a.reset_password.strip().lower()
        ACC.pop(slug, None)
        _save(ACCOUNTS, ACC)
        _drop_sessions(slug)
        code = issue_claim(slug)
        audit("reissue", slug, "cli")
        print(f"[ok] {slug} 的帳號已作廢，該隊所有裝置已登出。資料沒有動。")
        print(f"     新的認領碼：{code}")
        print(f"     請私訊給該隊本人，不要貼在群組。他們用這組碼登入並自己設密碼。")
        return

    if a.gen_claims:
        pool = sorted(NATION_SLUGS) if NATION_SLUGS else sorted(set(list(ACC) + list(CLAIM)))
        made = []
        for slug in pool:
            if slug in ACC:
                continue                       # 已經有人認領了，不重發
            c = CLAIM.get(slug)
            if c and not c.get("used"):
                continue                       # 已經有一張沒用掉的
            made.append((slug, issue_claim(slug)))
        print(f"[ok] 新發了 {len(made)} 張認領碼。已認領的國家不會重發。")
        print("     這份清單等同密碼，請私下一對一發給各隊，不要貼群組、不要進 git。")
        for slug, code in made:
            print(f"  {slug:<24} {code}")
        print(f"\n     完整清單存在 {CLAIMS}")
        return

    if a.show_claim:
        slug = a.show_claim.strip().lower()
        c = CLAIM.get(slug)
        if slug in ACC:
            print(f"[info] {slug} 已經被認領了（{ACC[slug].get('ts','')}）。要重發請用 --reset-password {slug}")
        elif not c:
            print(f"[info] {slug} 還沒有認領碼，跑 --gen-claims 產生")
        elif c.get("used"):
            print(f"[info] {slug} 的認領碼已經被用掉了（{c.get('usedAt','')} from {c.get('ip','')}）")
        else:
            print(f"{slug} 的認領碼：{c['code']}")
        return

    if a.rotate_unused:
        n = 0
        for slug in sorted(set(list(CLAIM) + (list(NATION_SLUGS) if NATION_SLUGS else []))):
            if slug in ACC:
                continue                     # 已經認領的不動，他們用的是自己的密碼
            c = CLAIM.get(slug)
            if c and c.get("used"):
                continue                     # 用掉的碼本來就沒用了
            issue_claim(slug)
            n += 1
        audit("rotate-unused", "", "cli", note="%d codes" % n)
        print("[ok] 換掉了 %d 張還沒用掉的認領碼。之前發出去但還沒被用的連結全部失效。" % n)
        print("     已經認領的隊伍不受影響，照樣用自己的密碼登入。")
        return

    if a.claim_status:
        pool = sorted(NATION_SLUGS) if NATION_SLUGS else sorted(set(list(ACC) + list(CLAIM)))
        for slug in pool:
            if slug in ACC:
                st = "claimed"
            else:
                c = CLAIM.get(slug)
                st = "ready" if (c and not c.get("used")) else "none"
            print("%s	%s" % (slug, st))
        return

    if a.claim_link:
        slug = a.claim_link.strip().lower()
        c = CLAIM.get(slug)
        if slug in ACC:
            print(f"[info] {slug} 已經認領過了。要重發請用 --reset-password {slug}")
            return
        if not c or c.get("used"):
            c = {"code": issue_claim(slug)}
            print(f"[info] {slug} 原本沒有可用的碼，已經發一張新的")
        base = a.base_url if a.base_url.endswith("/") else a.base_url + "/"
        link = f"{base}?claim={slug}&code={c['code']}"
        name = NATION_NAMES.get(slug, slug)
        print()
        print("把下面整段私訊給該隊（不要貼群組）：")
        print("-" * 64)
        print(f"Here is your team's sign-in link for the FGC 2026 scouting app.")
        print(f"Open it on your phone, then choose a password for your whole team:")
        print(f"{link}")
        print(f"The link works once and is only for {name}. Keep the password")
        print(f"somewhere everyone on your team can find it.")
        print("-" * 64)
        print()
        print(f"（認領碼本身：{c['code']}，如果他們想手動輸入）")
        return

    if a.audit is not None:
        if not os.path.isfile(AUDIT_LOG):
            print("[info] 還沒有任何稽核紀錄")
            return
        lines = open(AUDIT_LOG, encoding="utf-8").read().splitlines()[-a.audit:]
        print(f"最近 {len(lines)} 筆：")
        for ln in lines:
            try:
                r = json.loads(ln)
            except Exception:
                continue
            print("  %-19s %-16s %-14s %-15s %s" % (r.get("t", ""), r.get("event", ""),
                                                    r.get("team", ""), r.get("ip", ""), r.get("ua", "")[:44]))
        return

    if a.revoke_all:
        n = len(ACC)
        ACC.clear()
        _save(ACCOUNTS, ACC)
        SESS.clear()
        _save(SESSIONS, SESS)
        made = [(slug, issue_claim(slug)) for slug in (sorted(NATION_SLUGS) if NATION_SLUGS else [])]
        audit("revoke-all", "", "cli", note=f"{n} accounts")
        print(f"[ok] {n} 個帳號全部作廢，所有裝置登出。各隊的 scouting 資料都沒有動。")
        print(f"     重新發了 {len(made)} 張認領碼，用 --show-claim <slug> 查單一國家。")
        return

    if not os.path.isfile(os.path.join(WEB, "index.html")):
        print(f"[warn] 找不到 {os.path.join(WEB, 'index.html')}")

    if OFFICIAL_POLL:
        threading.Thread(target=official_loop, daemon=True).start()

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
    print(f"  隊伍數    {len(NATION_SLUGS) or '（不限）'}   已認領 {len(ACC)} 隊   待用認領碼 {sum(1 for c in CLAIM.values() if not c.get('used'))} 張")
    print(f"  資料目錄  {DATA_DIR}")
    print(f"  每日備份  {BACKUP_DIR}")
    print(f"  官方比分  {'每 %d 秒抓一次 results.first.global' % OFFICIAL_POLL if OFFICIAL_POLL else '關閉'}")
    print(f"  認領碼    python server.py --gen-claims / --show-claim <slug>")
    print(f"  重發帳號  python server.py --reset-password <slug>")
    print(f"  稽核紀錄  python server.py --audit 40")
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
