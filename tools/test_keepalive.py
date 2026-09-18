"""keep-alive 連線不同步的回歸測試。

伺服器若在「還沒讀請求內文」的情況下就回應，剩下的位元組會留在 socket 裡，
被反向代理（Caddy）重用連線時變成下一個請求的起始行，表現為 501 Unsupported method。
下一個請求可能是別隊的登入或認領 —— 一個人被擋下，順手弄壞另一個人的驗證。

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


def probe(label, first):
    s = socket.create_connection(("127.0.0.1", PORT), 5)
    s.settimeout(5)
    f = s.makefile("rwb")
    f.write(first)
    f.flush()
    try:
        r1 = read_one(f)
    except Exception as e:
        r1 = "(no reply: %s)" % e
    # 同一條連線上再送一個請求，就像反向代理重用連線那樣
    f.write(b"GET /health HTTP/1.1" + CRLF + b"Host: x" + CRLF + b"Connection: close" + CRLF + CRLF)
    f.flush()
    try:
        r2 = read_one(f)
    except Exception as e:
        r2 = "(no reply: %s)" % e
    s.close()
    # 內文過大那條依設計會直接收掉連線，不算失敗
    ok = ("200" in r2) or (label.endswith("huge body") and "no reply" in r2)
    print("  [%s] %-30s 1st: %-24s then: %s" % ("OK " if ok else "BAD", label, r1, r2))
    return ok


CASES = [
    ("POST /api/sync bad token",   req(b"POST", b"/api/sync", b'{"rev":0}', b"bogus")),
    ("POST /api/password no auth", req(b"POST", b"/api/password", b'{"current":"x","new":"yyyy"}')),
    ("POST /api/claim wrong code", req(b"POST", b"/api/claim", b'{"team":"ireland","code":"X","password":"test1234"}')),
    ("POST /api/profile no auth",  req(b"POST", b"/api/profile", b"{}")),
    ("POST /api/login bad team",   req(b"POST", b"/api/login", b'{"team":"NOPE!!","password":"whatever12"}')),
    ("POST /api/login unclaimed",  req(b"POST", b"/api/login", b'{"team":"kenya","password":"whatever12"}')),
    ("POST /api/photo no auth",    req(b"POST", b"/api/photo", b'{"jpg":"x"}')),
    ("POST /api/claim huge body",  CRLF.join([b"POST /api/claim HTTP/1.1", b"Host: x",
                                              b"Content-Type: application/json",
                                              b"Content-Length: 20000000"]) + CRLF + CRLF + b"{}"),
]

res = [probe(l, b) for l, b in CASES]
print("  => %s (%d/%d 條連線在下一個請求上仍然正常)"
      % ("ALL CLEAN" if all(res) else "DESYNC PRESENT", sum(res), len(res)))
sys.exit(0 if all(res) else 1)
