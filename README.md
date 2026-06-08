<div align="right">English | <a href="./README.zh-CN.md">简体中文</a></div>

# vibeshare

**Share a local HTML page as a managed public URL — with open/close control, password or email access, and scheduled auto-close.**

You vibe-coded an HTML page locally. Now you want to show it to someone, preview it on your phone, gate it behind a password, or let only a couple of people in. `vibeshare` deploys it to a real public URL on **your own free Firebase** and lets you manage it like a Google Doc share: open it to anyone, lock it with a password, restrict it to specific emails, close it (without deleting), or have it auto-close on a schedule.

```bash
npm install -g vibeshare
vibeshare init                            # one-time: log in + pick a free Firebase project
vibeshare ./report.html                   # → https://<project>.web.app/report/
vibeshare ./report.html --password        # ...gated by an auto-generated 4-digit PIN
```

## Features

- 🌐 **One-command deploy** — turn any local `.html` into a real public URL on your own free Firebase.
- 🔓 **Open to anyone** — share a plain link, no gate.
- 🔑 **Password gate** — auto 4-digit PIN or your own password; the page is encrypted in the browser (AES-256), so the content never ships in the clear.
- 📧 **Email gate** — restrict to an allow-list of emails; or require **email + password** together.
- 🟢 **Open / close anytime** — close a page (content kept locally) and re-open it later, like toggling a Google Doc's sharing.
- ⏰ **Scheduled auto-close** — set any lifetime (`2h`, `3d`, `2026-07-01`); pages **close** at expiry by default (delete only if you ask).
- 🗑️ **Delete for good** — remove a page whenever you want.
- 📋 **List & manage** — see every page's status, access mode, and expiry at a glance.
- 🔒 **Yours alone** — no central server, no accounts to create with us, nothing to pay. Your files stay the source of truth.

## Why

- **Preview anywhere** — desktop → phone, or send to a teammate/client. Links live on your project's root domain (`<project>.web.app/<slug>/`), which resolves reliably everywhere.
- **Control access like a Doc** — anyone-with-the-link, a password, a specific email allow-list, or email **and** password together. Switch a page between these at any time.
- **Open / close, don't just delete** — close a page and the content is kept locally; re-open it whenever. Expiry **closes** pages by default (delete is always an explicit choice).
- **Bring your own free Firebase** — no central server, nothing to pay for, no one else holding your data. Runs entirely on Firebase Hosting's free Spark plan.

## Install

```bash
npm install -g vibeshare
```

Requires Node 18+. `firebase-tools` ships bundled. (On very new Node versions where the bundled copy misbehaves, set `VIBESHARE_FIREBASE_BIN=$(which firebase)` to use a system Firebase CLI.)

## Setup (once)

```bash
vibeshare init
```

Logs you into Google/Firebase in your browser and picks (or helps you create) a free Firebase project. First-time Firebase users accept the Terms of Service once in the browser. **Dedicate a project to vibeshare** — it manages that project's Hosting site as a whole.

## Use

```bash
# deploy
vibeshare ./report.html                          # open to anyone
vibeshare ./report.html --password               # auto-generated 4-digit PIN
vibeshare ./report.html --password 1234          # your own password
vibeshare ./report.html --email a@x.com,b@y.com  # only these emails
vibeshare ./report.html --email a@x.com --password 1234   # email AND password
vibeshare ./report.html --expire 3d              # auto-close in 3 days (also 2h, 2w, 2026-07-01)
vibeshare ./report.html --name launch            # custom slug → /launch/

# manage
vibeshare list                                   # all pages: open/closed · access · expiry · URL
vibeshare disable <slug>                          # close (content kept)
vibeshare enable  <slug>                          # re-open
vibeshare access  <slug> --password 9999          # change the access gate any time
vibeshare access  <slug> --email a@x.com          # → switch to email-only
vibeshare expire  <slug> 12h                       # schedule auto-close (--delete to delete instead)
vibeshare keep    <slug>                            # cancel a scheduled expiry
vibeshare rm      <slug>                            # delete for good
vibeshare open    <slug>                            # open in browser

# background auto-expiry (optional, macOS)
vibeshare cleaner install                          # runs `gc` every 15 min via launchd
vibeshare gc                                       # apply due expiries right now
```

Add `--json` to any command for machine-readable output (used by the Claude Code skill).

## Access gates & security

Gated pages are **encrypted in the browser** (Web Crypto: AES-256-GCM, with the key derived via PBKDF2-SHA256). The plaintext never ships in the page — without valid credentials the content can't be read.

- **Password** — real cryptographic protection. A 4-digit PIN is convenient but **offline-brute-forceable** (10,000 combinations, no server rate-limit); use a longer password for anything sensitive.
- **Email** — a *soft* gate: emails aren't secret, so anyone who knows an allowed address can enter. Good for "only my client", not for secrets.
- **Email + password** — the password provides the real lock; the email identifies who's entering. Recommended when you want both gating and a known audience.

> Real, verified email sign-in (Google / email-link) is on the roadmap — it requires Firebase Authentication and is a heavier setup than the client-side gates above.

## How it works

A page lives at `https://<project>.web.app/<slug>/`. vibeshare keeps a local workspace (`~/.local/share/vibeshare/`) with a manifest as the source of truth and your original files retained locally; on every change it rebuilds the deploy folder to match and runs a full `firebase deploy`. Because a deploy replaces the whole site, **dedicate a Firebase project to vibeshare.** Expiry is tracked in the manifest (so durations are unbounded, unlike Firebase's 30-day preview channels) and applied by `vibeshare gc` — lazily on any command, or on a schedule via `vibeshare cleaner install`.

## Claude Code skill

This repo ships a thin Claude Code skill (`skill/SKILL.md`). Symlink it into your skills dir:

```bash
ln -s "$(npm root -g)/vibeshare/skill/SKILL.md" ~/.claude/skills/vibeshare/SKILL.md
```

Then just say "share this page" in Claude Code.

## License

MIT © Andy Lei
