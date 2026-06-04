# vibeshare

**Share a local HTML file or folder as a public, auto-expiring URL — in one command.**

You vibe-coded an HTML page locally. Now you want to show it to someone, preview it on your phone, or drop a link in a chat. `vibeshare` deploys it to a real public URL that **expires on its own** after a few days. The local file stays the source of truth — when the link expires, nothing of yours is lost.

```bash
npm install -g vibeshare
vibeshare init                 # one-time: log in + pick a free Firebase project
vibeshare ./index.html         # → https://<project>--<id>-<hash>.web.app  (lives 7 days)
```

## Why

- **Preview anywhere** — desktop → phone, or send to a teammate/client. No more "it only works on my machine."
- **Ephemeral by design** — set a lifetime; the link auto-deletes when it's up. No cleanup, no clutter.
- **Bring your own free Firebase** — no central server, nothing to pay for, no one else holding your data. Runs entirely on your own free Firebase Hosting (Spark plan).

## Install

```bash
npm install -g vibeshare
```

Requires Node 18+. `firebase-tools` ships bundled — nothing else to install.

## Setup (once)

```bash
vibeshare init
```

This logs you into Google/Firebase in your browser and picks (or helps you create) a free Firebase project. First-time Firebase users will be sent to the console once to accept the Terms of Service — that step can only be done in the browser. After that you're set forever.

## Use

```bash
vibeshare ./site                 # deploy a folder (default 7-day lifetime)
vibeshare ./report.html          # deploy a single file
vibeshare ./index.html --ttl 1d  # custom lifetime: 12h, 3d, 30d (max 30d)
vibeshare ./index.html --open    # open the link after deploying

vibeshare list                   # see your active links
vibeshare unshare <id>           # remove a link early
vibeshare open <id>              # open a link in the browser
vibeshare doctor                 # check your setup
```

Add `--json` to any command for machine-readable output (used by the Claude Code skill).

## How it works

`vibeshare` wraps [Firebase Hosting **preview channels**](https://firebase.google.com/docs/hosting/test-preview-deploy#preview-channels), which have native expiration (default 7 days, max 30). Each share is one channel under your project; Firebase auto-deletes it when it expires. Your files are copied into a temporary staging directory before deploy, so **`vibeshare` never writes Firebase config into your project folder.**

## Claude Code skill

This repo ships a thin Claude Code skill (`skill/SKILL.md`). Symlink it into your skills dir so Claude can share pages for you:

```bash
ln -s "$(npm root -g)/vibeshare/skill/SKILL.md" ~/.claude/skills/vibeshare/SKILL.md
```

Then just say "share this page" in Claude Code.

## License

MIT © Andy Lei
