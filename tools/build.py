# -*- coding: utf-8 -*-
"""Build tools/FGC-Claim.exe from ClaimTool.cs.

Uses csc.exe, the C# compiler that ships with the .NET Framework on every
Windows machine, so there is nothing to install.

    python tools\build.py
"""
import io, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(HERE, 'ClaimTool.cs')
GEN = os.path.join(HERE, '_ClaimTool.gen.cs')
EXE = os.path.join(HERE, 'FGC-Claim.exe')
NATIONS = os.path.join(ROOT, 'web', 'nations.js')

CSC = r'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if not os.path.isfile(CSC):
    CSC = r'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
if not os.path.isfile(CSC):
    sys.exit('找不到 csc.exe，這台機器沒有 .NET Framework 4')


def nation_rows():
    txt = io.open(NATIONS, encoding='utf-8').read()
    m = re.search(r'window\.NATIONS\s*=\s*(\[.*?\]);', txt, re.S)
    if not m:
        sys.exit('讀不到 web/nations.js')
    rows = []
    for n in json.loads(m.group(1)):
        slug = n['slug']
        name = (n.get('name') or slug).replace('"', "'")
        rows.append('        "%s|%s",' % (slug, name))
    return rows


def main():
    rows = nation_rows()
    src = io.open(SRC, encoding='utf-8').read()
    assert '// NATIONS_PLACEHOLDER' in src, 'ClaimTool.cs 少了 NATIONS_PLACEHOLDER'
    src = src.replace('// NATIONS_PLACEHOLDER', '\n'.join(rows), 1)
    # csc 吃 UTF-8 BOM 才會正確處理中文字串
    io.open(GEN, 'wb').write(b'\xef\xbb\xbf' + src.encode('utf-8'))

    cmd = [CSC, '/nologo', '/target:winexe', '/optimize+', '/platform:anycpu',
           '/out:' + EXE,
           '/reference:System.dll', '/reference:System.Drawing.dll',
           '/reference:System.Windows.Forms.dll', '/reference:System.Core.dll',
           GEN]
    p = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if p.returncode != 0:
        out = (p.stdout or '') + (p.stderr or '')
        sys.stdout.buffer.write(out.encode('utf-8', 'replace'))
        sys.stdout.flush()
        sys.exit('編譯失敗')
    os.remove(GEN)
    print('好了：%s  (%d KB，%d 個國家)' % (EXE, os.path.getsize(EXE) // 1024, len(rows)))


if __name__ == '__main__':
    main()
