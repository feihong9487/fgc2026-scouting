# Claim tool

A small Windows window for handing out claim links at a competition, so you
do not have to remember ssh syntax with a queue of teams in front of you.

Pick a nation, press **取得認領連結**, and the message to send that team is on
your clipboard. **重發** voids a locked-out team's account and issues a fresh
link. **看最近的登入紀錄** shows the auth audit log. Nations already claimed
are marked with a dot, and **只看還沒認領的** hides them.

## Command line

```
FGC-Claim.exe --link "New Zealand"     print the message for one nation
FGC-Claim.exe --link thailand          the slug works too
FGC-Claim.exe --selftest               check nation resolution against the live list
```

`--selftest` exists because this went wrong once: typing "Kazakhstan" issued a
link for Venezuela. It now resolves every nation three ways (name, slug, the
dropdown label) and refuses anything it cannot match exactly, because guessing
here means sending one nation's account to another team.

## Build

```
python tools\build.py
```

That produces `tools\FGC-Claim.exe`, about 36 KB. It compiles with `csc.exe`,
the C# compiler that ships with the .NET Framework on every Windows machine,
so there is nothing to install.

The nation list is fetched from the live site at start-up, not from the build.
A baked-in list goes stale silently: the first build shipped with 175 nations
and could not issue a link for the 32 added later. The compiled-in copy is
only the offline fallback, and the window says so when it falls back.

The exe is not committed: build it yourself rather than trusting a binary in a
public repo.

## What it needs

- `ssh` (Windows OpenSSH, or the one bundled with Git for Windows)
- Your SSH key for the server

Server, key path and site URL default to the public instance and
`%USERPROFILE%\.ssh\id_ed25519_fgc`. Change them under **伺服器設定**; they are
remembered in `claimtool.ini` next to the exe.

## The rule

One link per nation, sent to that team privately. A claim link in a group chat
hands that nation's account to everyone who can read it. If a batch of links
leaks, `python3 server.py --rotate-unused` on the server invalidates every
unused code at once without touching teams who have already signed in.
