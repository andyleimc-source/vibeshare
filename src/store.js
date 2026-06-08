// Workspace + manifest: the source of truth for the managed (root-domain) model.
//
// Because `firebase deploy` does a FULL SYNC of the public/ folder, we keep a
// local workspace whose public/ is rebuilt to exactly match the manifest before
// every deploy. The manifest — not Firebase — is authoritative.
//
//   <data>/vibeshare/
//     manifest.json        the source of truth
//     manifest.lock        advisory lock (flock) serializing writes + deploys
//     firebase.json        hosting config (public/, cleanUrls)
//     .firebaserc          default project
//     sources/<slug>.html  retained plaintext original (for re-gate / unlock)
//     public/<slug>/...    deployed artifact (plain | gated | disabled stub)
//     public/index.html    generic landing (never lists slugs)
//     public/404.html      generic not-found
//     logs/                gc + deploy logs

import { homedir } from 'node:os';
import {
  mkdirSync, readFileSync, writeFileSync, renameSync, existsSync,
  rmSync, openSync, closeSync, readdirSync,
} from 'node:fs';
import path from 'node:path';

export function dataDir() {
  const base = process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share');
  return path.join(base, 'vibeshare');
}

export const paths = {
  root: dataDir,
  manifest: () => path.join(dataDir(), 'manifest.json'),
  lock: () => path.join(dataDir(), 'manifest.lock'),
  firebaseJson: () => path.join(dataDir(), 'firebase.json'),
  firebaserc: () => path.join(dataDir(), '.firebaserc'),
  sources: () => path.join(dataDir(), 'sources'),
  public: () => path.join(dataDir(), 'public'),
  pageDir: (slug) => path.join(dataDir(), 'public', slug),
  source: (slug) => path.join(dataDir(), 'sources', `${slug}.html`),
  logs: () => path.join(dataDir(), 'logs'),
};

const FIREBASE_JSON = {
  hosting: {
    public: 'public',
    ignore: ['firebase.json', '**/.*', '**/node_modules/**'],
    cleanUrls: true,
    appAssociation: 'NONE',
  },
};

/** Create the workspace skeleton (idempotent). Writes .firebaserc when project given. */
export function ensureWorkspace(project) {
  for (const d of [dataDir(), paths.sources(), paths.public(), paths.logs()]) {
    mkdirSync(d, { recursive: true, mode: 0o700 });
  }
  if (!existsSync(paths.firebaseJson())) {
    writeFileSync(paths.firebaseJson(), JSON.stringify(FIREBASE_JSON, null, 2) + '\n');
  }
  if (project) {
    writeFileSync(paths.firebaserc(), JSON.stringify({ projects: { default: project } }, null, 2) + '\n');
  }
  if (!existsSync(paths.manifest())) {
    writeManifest({ version: 1, project: project || null, pages: {} });
  }
}

export function emptyManifest(project = null) {
  return { version: 1, project, pages: {} };
}

export function readManifest() {
  try {
    const m = JSON.parse(readFileSync(paths.manifest(), 'utf8'));
    if (!m.pages) m.pages = {};
    return m;
  } catch {
    return emptyManifest();
  }
}

/** Atomic write (temp + rename), 0600 (the manifest holds PINs). */
export function writeManifest(manifest) {
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  const tmp = paths.manifest() + '.tmp';
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, paths.manifest());
}

/**
 * Run `fn` while holding an exclusive advisory lock so concurrent commands /
 * the gc sweep never interleave manifest writes or deploys.
 * Uses an exclusive create flag as a simple cross-process mutex with a stale
 * timeout (locks older than 2 min are assumed crashed and broken).
 */
export async function withLock(fn, { timeoutMs = 30000 } = {}) {
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  const lock = paths.lock();
  const start = Date.now();
  let fd = null;
  for (;;) {
    try {
      fd = openSync(lock, 'wx'); // exclusive create
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // stale-lock breaker
      try {
        const age = Date.now() - (readFileSync(lock, 'utf8') | 0);
        if (age > 120000) { rmSync(lock, { force: true }); continue; }
      } catch { /* ignore */ }
      if (Date.now() - start > timeoutMs) {
        const err = new Error('Another vibeshare operation is in progress (lock held). Try again shortly.');
        err.code = 'LOCKED';
        throw err;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  try {
    writeFileSync(lock, String(Date.now()));
    return await fn();
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(lock, { force: true });
  }
}

/** Remove a slug's deployed artifact + retained source (manifest entry handled by caller). */
export function removePageFiles(slug) {
  rmSync(paths.pageDir(slug), { recursive: true, force: true });
  rmSync(paths.source(slug), { force: true });
}

/** List slug dirs currently present under public/ (for reconcile drift detection). */
export function publicSlugs() {
  try {
    return readdirSync(paths.public(), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}
