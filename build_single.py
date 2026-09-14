#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 web/ 合併成單一檔案 FGC2026_Scouting.html（iPad 直接開檔的離線版：不同步、不能登入/發布，其餘功能可用）。
CSS / JS 直接內嵌，圖片轉成 data URI；離線版的國旗會自動改用 emoji（app.js 在 file:// 下的行為）。"""
import base64, mimetypes, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "web")
rd = lambda n: open(os.path.join(WEB, n), encoding="utf-8").read()


def data_uri(name):
    p = os.path.join(WEB, name)
    if not os.path.isfile(p):
        return name
    mt = mimetypes.guess_type(p)[0] or "application/octet-stream"
    return f"data:{mt};base64," + base64.b64encode(open(p, "rb").read()).decode()


html = rd("index.html")

# 1. <link rel="stylesheet" href="app.css?v=N"> → 內嵌 <style>
html = re.sub(r'<link rel="stylesheet" href="([^"?]+)[^"]*">',
              lambda m: "<style>\n" + rd(m.group(1)) + "</style>", html, count=1)

# 2. 每個 <script src="x.js?v=N"></script> → 內嵌
html = re.sub(r'<script src="([^"?]+)[^"]*"></script>',
              lambda m: "<script>\n" + rd(m.group(1)) + "\n</script>", html)

# 3. 本地圖片 → data URI
html = re.sub(r'(src|href)="((?:fgc2026-\d+\.png|poster\.jpg))"',
              lambda m: f'{m.group(1)}="{data_uri(m.group(2))}"', html)

out = os.path.join(HERE, "FGC2026_Scouting.html")
open(out, "w", encoding="utf-8").write(html)
left = re.findall(r'<script src="[^"]+"', html) + re.findall(r'<link rel="stylesheet"[^>]+>', html)
print(f"wrote {out}  {len(html.encode('utf-8'))/1024:.0f} KB")
print("not inlined:", left or "none")
