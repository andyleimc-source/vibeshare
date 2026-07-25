// Full-sync deploy of the workspace public/ folder to the project's live site,
// plus the high-level mutate→reconcile→deploy transaction used by every command.

import { runFirebaseJson } from './firebase.js';
import { classifyFirebaseError } from './classify.js';
import { paths, readManifest, writeManifest, withLock, ensureWorkspace } from './store.js';
import { reconcile } from './render.js';
import { syncPull, syncPush } from './sync.js';

/** Live URL for a page on the project's default Hosting site. */
export function pageUrl(project, slug) {
  return `https://${project}.web.app/${slug}/`;
}

/** Run `firebase deploy --only hosting` against the workspace. */
export async function deploy(project) {
  const r = await runFirebaseJson([
    'deploy', '--only', 'hosting',
    '-c', paths.firebaseJson(),
    '-P', project,
    '--non-interactive',
  ]);
  if (!r.ok) {
    const { code, hint } = classifyFirebaseError(r.stderr + ' ' + (r.error || '') + ' ' + r.raw);
    const e = new Error(`Deploy failed (${code}). ${hint}`);
    e.code = code; e.handled = false;
    throw e;
  }
  return r;
}

/**
 * The standard transaction: take the lock, mutate the manifest via `mutator`,
 * reconcile public/ to match, then deploy (unless the mutator returns
 * {redeploy:false} for manifest-only changes like scheduling).
 *
 * When the workspace is synced (see sync.js) it is pulled BEFORE reading the
 * manifest and pushed after a successful deploy. The pull is not an
 * optimisation: a deploy full-syncs the site from the local ledger, so acting
 * on a stale one would delete every page another machine has published since.
 *
 * @param {string} project
 * @param {(m:object)=>({redeploy?:boolean}|void)} mutator
 * @returns {Promise<{manifest:object, deployed:boolean, warning?:string}>}
 */
export async function transact(project, mutator) {
  ensureWorkspace(project);
  return withLock(async () => {
    syncPull();
    const manifest = readManifest();
    if (!manifest.project) manifest.project = project;
    const snapshot = JSON.stringify(manifest); // for rollback; taken pre-mutation
    const res = mutator(manifest) || {};
    writeManifest(manifest);
    if (res.redeploy === false) {
      const { warning } = syncPush('vibeshare: update schedule');
      return { manifest, deployed: false, warning };
    }
    reconcile(manifest);
    try {
      await deploy(project);
    } catch (err) {
      // The manifest is written before the deploy that publishes it, so a failed
      // deploy would otherwise strand it describing pages that never went live —
      // and the next attempt bounces off "a page already exists" for a page that
      // does not. A failed `firebase deploy` leaves the live release untouched,
      // so rewinding to the pre-mutation snapshot restores local/remote parity.
      const restored = JSON.parse(snapshot);
      writeManifest(restored);
      reconcile(restored);
      throw err;
    }
    manifest.lastDeploy = new Date().toISOString();
    writeManifest(manifest);
    const { warning } = syncPush();
    return { manifest, deployed: true, warning };
  });
}
