// `vibeshare sync` — share one workspace across machines. See src/sync.js for
// why this exists (short version: a deploy replaces the whole site, so two
// machines with separate workspaces delete each other's pages).

import { isSyncEnabled, syncInit, syncPull, syncPush, syncStatus, remoteUrl } from '../sync.js';
import { ensureWorkspace, readManifest, withLock } from '../store.js';
import { reconcile } from '../render.js';
import { deploy } from '../deploy.js';
import { readConfig } from '../config.js';
import * as ui from '../ui.js';

function usage(msg) {
  const e = new Error(msg); e.code = 'USAGE'; e.exit = 1; e.handled = false; return e;
}

export async function syncCmd(sub, arg, opts = {}) {
  const project = opts.project || readConfig()?.project || null;
  ensureWorkspace(project);

  if (sub === 'init') {
    if (!arg) throw usage('Missing <git-url>. Usage: vibeshare sync init git@github.com:you/vibeshare-state.git');
    const res = syncInit(arg);
    const pages = Object.keys(readManifest().pages).length;
    if (opts.json) ui.emitJson({ ok: true, ...res, pages });
    else {
      ui.ok(`Workspace synced with ${ui.color.cyan(res.url)}`);
      ui.info(ui.color.dim(`  ${pages} page(s) in the shared ledger · ${res.dir}`));
      ui.info(ui.color.dim('  Run the same command on your other machine to join it.'));
    }
    return;
  }

  if (sub === 'status') {
    const st = syncStatus();
    if (opts.json) { ui.emitJson({ ok: true, ...st }); return; }
    if (!st.enabled) {
      ui.info(`Sync is off — this workspace is local to this machine (${st.dir}).`);
      ui.info(ui.color.dim('  Enable with: vibeshare sync init <git-url>'));
      return;
    }
    ui.info(`Synced with ${ui.color.cyan(st.remote)}`);
    ui.info(ui.color.dim(`  ${st.ahead} unpushed · ${st.behind} unpulled${st.dirty ? ' · uncommitted changes' : ''}`));
    return;
  }

  if (sub && sub !== 'now') throw usage(`Unknown: vibeshare sync ${sub}. Use: sync | sync init <git-url> | sync status`);

  // bare `vibeshare sync` — pull, then redeploy so the live site matches the
  // merged ledger, then push. This is the repair path when a push failed or
  // another machine published while this one was offline.
  if (!isSyncEnabled()) throw usage('Sync is not set up. Run: vibeshare sync init <git-url>');
  if (!project) throw usage('No Firebase project configured. Run: vibeshare init');
  await withLock(async () => {
    syncPull();
    reconcile(readManifest());
    await deploy(project);
    const { warning } = syncPush('vibeshare: sync');
    if (warning) ui.warn(warning);
  });
  const pages = Object.keys(readManifest().pages).length;
  if (opts.json) ui.emitJson({ ok: true, synced: true, pages, remote: remoteUrl() });
  else ui.ok(`In sync — ${pages} page(s) live.`);
}
