import { runFirebaseJson } from '../firebase.js';
import { classifyFirebaseError } from '../classify.js';
import { readConfig } from '../config.js';
import * as ui from '../ui.js';

export async function listCmd(opts) {
  const json = !!opts.json;
  const cfg = readConfig();
  const project = opts.project || cfg?.project;
  if (!project) {
    if (json) ui.emitJson({ ok: false, code: 'NO_PROJECT', hint: 'Run: vibeshare init' });
    else ui.errline('No project configured. Run: vibeshare init');
    const e = new Error('NO_PROJECT'); e.code = 'NO_PROJECT'; e.exit = 2; e.handled = true; throw e;
  }

  const r = await runFirebaseJson(['hosting:channel:list', '-P', project]);
  if (!r.ok) {
    const { code, hint } = classifyFirebaseError(r.stderr + ' ' + (r.error || ''));
    if (json) ui.emitJson({ ok: false, code, hint });
    else ui.errline(`${code}: ${hint}`);
    const e = new Error(code); e.code = code; e.exit = 2; e.handled = true; throw e;
  }

  const channels = (r.data?.channels || r.data || []).filter((ch) => ch && ch.name);
  const rows = channels.map((ch) => ({
    id: (ch.name || '').split('/').pop(),
    url: ch.url,
    expiresAt: ch.expireTime || null,
    createdAt: ch.createTime || null,
  }));

  if (json) {
    ui.emitJson({ ok: true, project, channels: rows });
    return rows;
  }

  if (rows.length === 0) {
    ui.info(ui.color.dim('No active channels.'));
    return rows;
  }
  for (const row of rows) {
    const exp = row.expiresAt ? new Date(row.expiresAt).toISOString().slice(0, 16).replace('T', ' ') : 'live';
    ui.info(`${ui.color.bold(row.id.padEnd(24))} ${ui.color.cyan(row.url)}`);
    ui.info(ui.color.dim(`  expires ${exp}`));
  }
  return rows;
}
