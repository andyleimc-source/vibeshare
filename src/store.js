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

/** Remove empty ancestor dirs of `p`, stopping at (and never removing) `stopAt`. */
function pruneEmptyDirs(p, stopAt) {
  let dir = path.dirname(p);
  while (dir.startsWith(stopAt) && dir !== stopAt) {
    try {
      if (readdirSync(dir).length > 0) break;
      rmSync(dir, { recursive: false, force: true });
    } catch { break; }
    dir = path.dirname(dir);
  }
}

/**
 * Remove a slug's deployed artifact + retained source (manifest entry handled
 * by the caller). Surgical on purpose: slugs can nest ("project/asset"), so we
 * only delete this page's own index.html and prune now-empty parents — a
 * recursive rm of the page dir could take live child pages with it.
 */
export function removePageFiles(slug) {
  const indexHtml = path.join(paths.pageDir(slug), 'index.html');
  rmSync(indexHtml, { force: true });
  pruneEmptyDirs(indexHtml, paths.public());
  const source = paths.source(slug);
  rmSync(source, { force: true });
  pruneEmptyDirs(source, paths.sources());
}

/** List page dirs (relative, possibly nested) under public/ that hold an index.html — for reconcile drift detection. */
export function publicSlugs() {
  const out = [];
  const root = paths.public();
  const walk = (rel) => {
    const abs = rel ? path.join(root, rel) : root;
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (existsSync(path.join(root, childRel, 'index.html'))) out.push(childRel);
      walk(childRel);
    }
  };
  walk('');
  return out;
}
