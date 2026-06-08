---
name: vibeshare
description: Share a local HTML page as a managed public URL on the user's own Firebase, with open/close control, password / email access gates, and scheduled auto-close. Use when the user wants to "share this page", "give me a public link", "deploy this HTML", "send a preview link", "preview on my phone", "password-protect this page", "only let X see it", "close/unpublish the page", "把这个页面分享出去", "生成一个公开链接", "加个密码", "设个有效期", "关闭这个页面".
---

# vibeshare — share a local page as a managed public URL

Use the installed `vibeshare` CLI (bring-your-own Firebase, no central server). Do NOT reimplement deploys or write firebase config yourself — the CLI handles staging, encryption, and the manifest.

Pages live at `https://<project>.web.app/<slug>/` and have two independent axes — **status** (open/closed) and **access** (anyone / password / email / email+password) — plus optional **expiry** (default action: close, not delete).

## Deploy

`vibeshare <file.html> [access] [--expire <when>] [--name <slug>] --json`

Access flags (compose; default = anyone):
- `--password [PIN]` — bare flag auto-generates a 4-digit PIN; pass a value for a custom/longer password.
- `--email a@b.com,c@d.com` — restrict to an email allow-list (soft gate; emails aren't secret).
- `--email … --password …` — require a valid email AND the password (recommended for real gating).

`--expire <when>`: `30m`, `2h`, `3d`, `2w`, a bare number of days, or `2026-07-01[THH:MM]`. Add `--delete` to delete instead of close at expiry.

Parse the JSON; give the user the `url` and (if present) the `pin`. The PIN is shown once — surface it clearly.

## Manage

- `vibeshare list --json` — all pages with status, access, expiry, url.
- `vibeshare disable <slug>` / `vibeshare enable <slug>` — close (content kept) / re-open.
- `vibeshare access <slug> [access flags] --json` — change the gate any time.
- `vibeshare expire <slug> <when> [--delete]` / `vibeshare keep <slug>` — schedule / cancel auto-close.
- `vibeshare rm <slug> --json` — delete for good.
- `vibeshare open <slug>` — open in browser.

## First run / errors

- If output is `"ok":false` with `NOT_LOGGED_IN`, `NO_PROJECT`, `TOS_REQUIRED`, or `API_DISABLED`: tell the user to run **`vibeshare init`** in their own terminal (browser OAuth/ToS — you can't do that step).
- `vibeshare doctor --json` diagnoses setup; relay the `hint`.
- If a deploy fails with a module/firebase error on a very new Node, suggest `VIBESHARE_FIREBASE_BIN=$(which firebase)`.

## Notes

- Always use `--json` so you can parse results.
- The user's local file is the source of truth; closing/expiring loses nothing.
- Security: password = real client-side AES encryption; a 4-digit PIN is brute-forceable — recommend a longer password for sensitive content. Email-only is a soft gate.
- vibeshare manages the whole Hosting site of its project — assume a dedicated preview project.
