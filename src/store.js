// Workspace + manifest: the source of truth for the managed (root-domain) model.
//
// Because `firebase deploy` does a FULL SYNC of the public/ folder, we keep a
// local workspace whose public/ is rebuilt to exactly match the manifest before
// every deploy. The manifest — not Firebase — is authoritative.
//
//   <data>/vibeshare/
//     pages/<slug>.json    one file per page — the source of truth (git-synced)
//     sources/<slug>.html  retained plaintext original (for re-gate / unlock)
//     meta.json            machine-local: schema version, project, lastDeploy
//     manifest.lock        advisory lock (flock) serializing writes + deploys
//     firebase.json        hosting config (public/, cleanUrls)
//     .firebaserc          default project
//     public/<slug>/...    deployed artifact (plain | gated | disabled stub)
//     public/index.html    generic landing (never lists slugs)
//     public/404.html      generic not-found
//     logs/                gc + deploy logs
//
// Pages are stored ONE FILE PER PAGE rather than in a single manifest.json.
// Both layouts are equivalent locally, but only the split one survives being
// shared between machines: with `vibeshare sync` the workspace is a git repo,
// and a single manifest.json would collide on every push because every command
// rewrites it. Split by slug, two machines editing different pages never touch
// the same file, so git merges them without a conflict. See sync.js.

import { homedir } from 'node:os';
import {
  mkdirSync, readFileSync, writeFileSync, renameSync, existsSync,
  rmSync, rmdirSync, openSync, closeSync, readdirSync,
} from 'node:fs';
import path from 'node:path';

export function dataDir() {
  const base = process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share');
  return path.join(base, 'vibeshare');
}

export const paths = {
  root: dataDir,
  meta: () => path.join(dataDir(), 'meta.json'),
  pages: () => path.join(dataDir(), 'pages'),
  page: (slug) => path.join(dataDir(), 'pages', `${slug}.json`),
  legacyManifest: () => path.join(dataDir(), 'manifest.json'),
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
  for (const d of [dataDir(), paths.sources(), paths.public(), paths.pages(), paths.logs()]) {
    mkdirSync(d, { recursive: true, mode: 0o700 });
  }
  if (!existsSync(paths.firebaseJson())) {
    writeFileSync(paths.firebaseJson(), JSON.stringify(FIREBASE_JSON, null, 2) + '\n');
  }
  if (project) {
    writeFileSync(paths.firebaserc(), JSON.stringify({ projects: { default: project } }, null, 2) + '\n');
  }
  migrateLegacyManifest(project);
  if (!existsSync(paths.meta())) {
    writeMeta({ version: 1, project: project || null });
  }
}

export function emptyManifest(project = null) {
  return { version: 1, project, pages: {} };
}

// ─────────────────────── page files ───────────────────────

/**
 * Serialize with sorted keys so the same page written on two machines produces
 * byte-identical files — otherwise git sees a conflict on key order alone.
 */
export function stableStringify(value) {
  const sortKeys = (v) => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sortKeys(value), null, 2) + '\n';
}

/** Recursively list slugs that have a pages/<slug>.json. */
export function pageSlugs() {
  const out = [];
  const root = paths.pages();
  const walk = (rel) => {
    const abs = rel ? path.join(root, rel) : root;
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(childRel);
      else if (e.name.endsWith('.json')) out.push(childRel.slice(0, -5));
    }
  };
  walk('');
  return out;
}

function readMeta() {
  try { return JSON.parse(readFileSync(paths.meta(), 'utf8')); } catch { return {}; }
}

function writeMeta(meta) {
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  const tmp = paths.meta() + '.tmp';
  writeFileSync(tmp, stableStringify(meta), { mode: 0o600 });
  renameSync(tmp, paths.meta());
}

/**
 * One-time move from the single-file manifest.json to pages/<slug>.json.
 * Keeps the old file as manifest.json.migrated — this rewrites the source of
 * truth, so the previous state stays recoverable by hand.
 */
export function migrateLegacyManifest() {
  const legacy = paths.legacyManifest();
  if (!existsSync(legacy)) return false;
  let old;
  try { old = JSON.parse(readFileSync(legacy, 'utf8')); } catch { return false; }
  if (!old || !old.pages) return false;
  mkdirSync(paths.pages(), { recursive: true, mode: 0o700 });
  for (const [slug, page] of Object.entries(old.pages)) writePage(slug, page);
  writeMeta({ version: 1, project: old.project || null, lastDeploy: old.lastDeploy || null });
  renameSync(legacy, legacy + '.migrated');
  return true;
}

function writePage(slug, page) {
  const file = paths.page(slug);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const body = stableStringify({ ...page, slug });
  // Skip no-op writes: an unchanged mtime keeps `git status` quiet and avoids
  // empty commits when a command touches a page without changing it.
  try { if (readFileSync(file, 'utf8') === body) return; } catch { /* new file */ }
  const tmp = file + '.tmp';
  writeFileSync(tmp, body, { mode: 0o600 });
  renameSync(tmp, file);
}

// ─────────────────────── manifest API ───────────────────────

/**
 * Assemble the in-memory manifest from meta.json + pages/. The shape is
 * unchanged from the single-file era, so callers need not care how it's stored.
 */
export function readManifest() {
  migrateLegacyManifest();
  const meta = readMeta();
  const pages = {};
  for (const slug of pageSlugs()) {
    try {
      const page = JSON.parse(readFileSync(paths.page(slug), 'utf8'));
      pages[slug] = { ...page, slug };
    } catch { /* skip unreadable/half-written page file */ }
  }
  return { version: meta.version || 1, project: meta.project ?? null, lastDeploy: meta.lastDeploy ?? null, pages };
}

/** Persist the manifest: meta.json + one file per page, deleting dropped pages. */
export function writeManifest(manifest) {
  mkdirSync(paths.pages(), { recursive: true, mode: 0o700 });
  writeMeta({
    version: manifest.version || 1,
    project: manifest.project ?? null,
    lastDeploy: manifest.lastDeploy ?? null,
  });
  const want = new Set(Object.keys(manifest.pages || {}));
  for (const [slug, page] of Object.entries(manifest.pages || {})) writePage(slug, page);
  for (const slug of pageSlugs()) {
    if (want.has(slug)) continue;
    const file = paths.page(slug);
    rmSync(file, { force: true });
    pruneEmptyDirs(file, paths.pages());
  }
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

/**
 * Remove empty ancestor dirs of `p`, stopping at (and never removing) `stopAt`.
 * rmdirSync, not rmSync: rmSync without `recursive` refuses to remove a
 * directory at all, so this used to throw into the catch on every call and
 * leave the empty dirs behind.
 */
function pruneEmptyDirs(p, stopAt) {
  let dir = path.dirname(p);
  while (dir.startsWith(stopAt) && dir !== stopAt) {
    try {
      if (readdirSync(dir).length > 0) break;
      rmdirSync(dir);
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
