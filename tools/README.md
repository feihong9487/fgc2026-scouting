# Claim tool

A small Windows window for handing out claim links at a competition, so you
do not have to remember ssh syntax with a queue of teams in front of you.

Pick a nation, press **取得認領連結**, and the message to send that team is on
your clipboard. It also has **重發** for a team that is locked out, and
**看最近的登入紀錄** for the auth audit log.

## Build

```
python tools\build.py
```

That produces `tools\FGC-Claim.exe` (about 24 KB). It compiles with `csc.exe`,
the C# compiler that ships with the .NET Framework on every Windows machine,
so there is nothing to install. The nation list is baked in from
`web/nations.js` at build time.

The exe is not committed: build it yourself rather than trusting a binary in
a public repo.

## What it needs

- `ssh` (Windows OpenSSH or the one bundled with Git for Windows)
- Your SSH key for the server

Server address and key path default to the public instance and
`%USERPROFILE%\.ssh\id_ed25519_fgc`. Change them under **伺服器設定**; they are
remembered in `claimtool.ini` next to the exe.

## The rule

One link per nation, sent to that team privately. A claim link in a group chat
hands that nation's account to everyone who can read it.
