// Full-sync deploy of the workspace public/ folder to the project's live site,
// plus the high-level mutate→reconcile→deploy transaction used by every command.

import { runFirebaseJson } from './firebase.js';
import { classifyFirebaseError } from './classify.js';
import { paths, readManifest, writeManifest, withLock, ensureWorkspace } from './store.js';
import { reconcile } from './render.js';

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
 * @param {string} project
 * @param {(m:object)=>({redeploy?:boolean}|void)} mutator
 */
export async function transact(project, mutator) {
  ensureWorkspace(project);
  return withLock(async () => {
    const manifest = readManifest();
    if (!manifest.project) manifest.project = project;
    const snapshot = JSON.stringify(manifest); // for rollback; taken pre-mutation
    const res = mutator(manifest) || {};
    writeManifest(manifest);
    if (res.redeploy === false) return { manifest, deployed: false };
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
    return { manifest, deployed: true };
  });
}
