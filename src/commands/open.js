import { runFirebase } from '../firebase.js';
import { readConfig } from '../config.js';
import { listCmd } from './list.js';
import { spawn } from 'node:child_process';
import * as ui from '../ui.js';

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
}

export async function openCmd(channelId, opts) {
  const cfg = readConfig();
  const project = opts.project || cfg?.project;
  if (!channelId) {
    const e = new Error('Missing <id>. Usage: vibeshare open <channel-id>'); e.code = 'USAGE'; e.exit = 1; throw e;
  }
  // Resolve the URL from the channel list, then open it ourselves (reliable across versions).
  const rows = await listCmd({ json: true, project });
  const match = rows.find((r) => r.id === channelId);
  if (match?.url) {
    if (!opts.json) ui.ok(`Opening ${match.url}`);
    else ui.emitJson({ ok: true, url: match.url });
    openBrowser(match.url);
    return;
  }
  // fallback to firebase's own opener
  await runFirebase(['hosting:channel:open', channelId, '-P', project]);
}
