import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { runFirebase } from '../firebase.js';
import { classifyFirebaseError } from '../classify.js';
import { readConfig } from '../config.js';
import * as ui from '../ui.js';

export async function unshareCmd(channelId, opts) {
  const json = !!opts.json;
  const cfg = readConfig();
  const project = opts.project || cfg?.project;

  if (!channelId) {
    const e = new Error('Missing <id>. Usage: vibeshare unshare <channel-id>'); e.code = 'USAGE'; e.exit = 1; throw e;
  }
  if (!project) {
    if (json) ui.emitJson({ ok: false, code: 'NO_PROJECT', hint: 'Run: vibeshare init' });
    else ui.errline('No project configured. Run: vibeshare init');
    const e = new Error('NO_PROJECT'); e.code = 'NO_PROJECT'; e.exit = 2; e.handled = true; throw e;
  }

  if (!opts.yes && !json) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const ans = (await rl.question(`Remove channel "${channelId}"? [y/N]: `)).trim().toLowerCase();
    rl.close();
    if (ans !== 'y' && ans !== 'yes') {
      ui.info('Cancelled.');
      return;
    }
  }

  const r = await runFirebase(['hosting:channel:delete', channelId, '-P', project, '--force']);
  if (r.code !== 0) {
    const { code, hint } = classifyFirebaseError(r.stderr);
    if (json) ui.emitJson({ ok: false, code, hint, stderr: r.stderr.trim() });
    else ui.errline(`Failed to remove "${channelId}" (${code}). ${hint}`);
    const e = new Error(code); e.code = code; e.exit = 2; e.handled = true; throw e;
  }

  if (json) ui.emitJson({ ok: true, removed: channelId });
  else ui.ok(`Removed channel: ${channelId}`);
}
