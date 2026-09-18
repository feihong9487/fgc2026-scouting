"""keep-alive 連線不同步的回歸測試。

伺服器若在「還沒讀請求內文」的情況下就回應，剩下的位元組會留在 socket 裡，
被反向代理（Caddy）重用連線時變成下一個請求的起始行，表現為 501 Unsupported method。
下一個請求可能是別隊的登入或認領 —— 一個人被擋下，順手弄壞另一個人的驗證。

第二組測試（同一條連線上連續丟好幾個帶內文的請求）不能省：BaseHTTPRequestHandler
在一條連線上共用同一個 handler 物件，第一版修正忘了把「內文讀過了」的旗標逐次歸零，
單一請求的測試全過，上線後照樣壞。

用法：先在本機起一份伺服器（python server.py --port 8096 --host 127.0.0.1），
      再跑 python tools/test_keepalive.py 8096。全部 OK 才算過。
"""
import socket, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8096
CRLF = "\r\n".encode()


def req(method, path, body, token=None):
    """Content-Length 一律由內文算出來 —— 手寫最容易算錯一個位元組。"""
    lines = [method + b" " + path + b" HTTP/1.1",
             b"Host: x",
             b"Content-Type: application/json",
             b"Content-Length: " + str(len(body)).encode()]
    if token:
        lines.append(b"X-Token: " + token)
    return CRLF.join(lines) + CRLF + CRLF + body


GET_HEALTH = CRLF.join([b"GET /health HTTP/1.1", b"Host: x"]) + CRLF + CRLF


def read_one(f):
    """完整讀掉一個 HTTP 回應（狀態行 + 標頭 + Content-Length 內文）。"""
    status = f.readline().decode("latin1").strip()
    n = 0
    while True:
        line = f.readline().decode("latin1").strip()
        if not line:
            break
        if line.lower().startswith("content-length:"):
            n = int(line.split(":")[1].strip())
    if n:
        f.read(n)
    return status


def send_all(label, requests, expect_last="200"):
    """在同一條連線上依序送出所有請求，回傳每個回應的狀態行。"""
    s = socket.create_connection(("127.0.0.1", PORT), 5)
    s.settimeout(5)
    f = s.makefile("rwb")
    out = []
    for r in requests:
        try:                                  # 連線被伺服器切斷也要照樣回報，不要讓測試自己炸掉
            f.write(r)
            f.flush()
            out.append(read_one(f))
        except Exception as e:
            out.append("(連線斷了: %s)" % type(e).__name__)
            break
    s.close()
    ok = (len(out) == len(requests)) and all("501" not in r for r in out) and expect_last in out[-1]
    print("  [%s] %-34s %s" % ("OK " if ok else "BAD", label,
                               " | ".join(r.replace("HTTP/1.1 ", "") for r in out)))
    return ok


REJECTED = [
    ("sync 壞 token",   req(b"POST", b"/api/sync", b'{"rev":0}', b"bogus")),
    ("password 未登入", req(b"POST", b"/api/password", b'{"current":"x","new":"yyyy"}')),
    ("claim 錯的碼",    req(b"POST", b"/api/claim", b'{"team":"ireland","code":"X","password":"test1234"}')),
    ("profile 未登入",  req(b"POST", b"/api/profile", b"{}")),
    ("login 隊名不合法", req(b"POST", b"/api/login", b'{"team":"NOPE!!","password":"whatever12"}')),
    ("login 未認領",    req(b"POST", b"/api/login", b'{"team":"kenya","password":"whatever12"}')),
    ("photo 未登入",    req(b"POST", b"/api/photo", b'{"jpg":"x"}')),
]

res = []
print("── 單一被拒請求，之後連線還能用嗎 ──")
for label, r in REJECTED:
    res.append(send_all(label, [r, GET_HEALTH]))

print("── 同一條連線連續多個被拒請求（反向代理就是這樣重用連線）──")
res.append(send_all("七個被拒請求接一個 GET", [r for _, r in REJECTED] + [GET_HEALTH]))
res.append(send_all("被拒 → 正常 → 被拒 → GET",
                    [REJECTED[0][1], GET_HEALTH, REJECTED[1][1], GET_HEALTH]))

print("── 內文過大：不吞，直接收掉連線 ──")
huge = CRLF.join([b"POST /api/claim HTTP/1.1", b"Host: x", b"Content-Type: application/json",
                  b"Content-Length: 20000000"]) + CRLF + CRLF + b"{}"
s = socket.create_connection(("127.0.0.1", PORT), 5); s.settimeout(5)
f = s.makefile("rwb"); f.write(huge); f.flush()
first = read_one(f)
f.write(GET_HEALTH); f.flush()
try:
    after = read_one(f)
except Exception:
    after = "(connection closed)"
s.close()
big_ok = "400" in first and "501" not in after
print("  [%s] %-34s %s | %s" % ("OK " if big_ok else "BAD", "超大內文", first, after))
res.append(big_ok)

print("=> %s（%d/%d）" % ("ALL CLEAN" if all(res) else "DESYNC PRESENT", sum(res), len(res)))
sys.exit(0 if all(res) else 1)
