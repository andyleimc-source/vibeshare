---
name: vibeshare
description: Deploy a local HTML file or folder to a public, auto-expiring URL via Firebase Hosting preview channels. Use when the user wants to "share this page", "give me a public link", "deploy this HTML", "send a preview link", "preview on my phone", "把这个页面分享出去", "生成一个公开链接", "发个预览链接", or asks to temporarily host/preview a local site.
---

# vibeshare — share a local page as a temporary public URL

Use the installed `vibeshare` CLI (bring-your-own Firebase, no central server). Do NOT reimplement deploys or write any firebase config yourself — the CLI handles staging.

## Steps
1. Identify the file/folder to share (default: the HTML the user just built, or the path they name).
2. Run: `vibeshare share <path> --ttl <ttl> --json`  (default ttl `7d`, max `30d`).
3. Parse the JSON and give the user the `url` and `expiresAt`.
4. List / remove on request: `vibeshare list --json`, `vibeshare unshare <id> --yes`.

## First run / errors
- If output has `"ok":false` with `NOT_LOGGED_IN`, `NO_PROJECT`, `TOS_REQUIRED`, or `API_DISABLED`: tell the user to run **`vibeshare init`** in their own terminal. It opens a browser for Google login / Firebase Terms — Claude cannot do that OAuth/ToS step.
- Run `vibeshare doctor --json` to diagnose setup and relay the `hint`.
- TTL over 30d is clamped automatically (Firebase limit) — mention it if relevant.

## Notes
- Always use `--json` so you can parse the result.
- The local file is the source of truth; expired links lose nothing.
