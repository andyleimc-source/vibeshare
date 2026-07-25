// Share one workspace between machines by making it a git repo.
//
// Why this exists: `firebase deploy` replaces the WHOLE site, and public/ is
// rebuilt to match the local pages/. So a machine that doesn't know about a page
// doesn't just fail to update it — it deletes it from the live site. Two
// machines each publishing from their own workspace therefore take turns wiping
// each other's pages, silently, with no error on either side.
//
// The fix is not to make deploys additive (Hosting has no such mode) but to give
// both machines the same pages/ to deploy from: pull before mutating, push after
// deploying. A pull that fails ABORTS the command — deploying against a stale
// workspace is exactly the data loss we're preventing.
//
// Only the ledger is tracked (pages/ + sources/). public/ is a build artifact,
// and meta.json / firebase.json / .firebaserc are machine-local.

import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from './store.js';

const GITIGNORE = `# vibeshare workspace — only the ledger (pages/ + sources/) is shared.
public/
logs/
meta.json
manifest.json
manifest.json.migrated
manifest.lock
firebase.json
.firebaserc
.firebase/
firebase-debug.log
*.tmp
`;

export const BRANCH = 'main';

function git(args, { check = true, cwd = dataDir() } = {}) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    if (!check) return null;
    const err = new Error(`git ${args[0]} failed: ${(e.stderr || e.message || '').toString().trim()}`);
    err.code = 'SYNC_GIT';
    throw err;
  }
}

/** Is the workspace under sync? (i.e. has it been `vibeshare sync init`-ed) */
export function isSyncEnabled() {
  return existsSync(path.join(dataDir(), '.git'));
}

export function remoteUrl() {
  return isSyncEnabled() ? git(['remote', 'get-url', 'origin'], { check: false }) : null;
}

function hasChanges() {
  return !!git(['status', '--porcelain'], { check: false });
}

/** Stage + commit everything outstanding. → true if a commit was made. */
function commitAll(message) {
  git(['add', '-A']);
  if (!hasChanges()) return false;
  const r = git(['commit', '-m', message], { check: false });
  if (r === null) {
    const e = new Error(
      'git commit failed in the vibeshare workspace. Most often this is an unset identity — ' +
      'set one with: git config --global user.email you@example.com',
    );
    e.code = 'SYNC_COMMIT';
    throw e;
  }
  return true;
}

function remoteBranchExists() {
  git(['fetch', 'origin', '--quiet'], { check: false });
  return git(['rev-parse', '--verify', `origin/${BRANCH}`], { check: false }) !== null;
}

// ───────────────────── conflict resolution ─────────────────────

function updatedAtOf(rev, slug) {
  const raw = git(['show', `${rev}:pages/${slug}.json`], { check: false });
  if (!raw) return null;
  try { return Date.parse(JSON.parse(raw).updatedAt) || 0; } catch { return 0; }
}

/** slug owning a conflicted path, or null if it isn't a ledger file. */
function slugOfPath(p) {
  if (p.startsWith('pages/') && p.endsWith('.json')) return p.slice(6, -5);
  if (p.startsWith('sources/') && p.endsWith('.html')) return p.slice(8, -5);
  return null;
}

/**
 * Auto-resolve a merge by taking, per page, whichever side has the newer
 * updatedAt — the same rule a human would apply, and the only one that makes
 * sense when the two sides are the same page edited on two machines. A page's
 * .json and .html always resolve to the SAME side so they can't end up
 * describing different content. Anything that isn't a ledger file is left
 * conflicted for a human.
 * @returns {string[]} paths that could not be resolved
 */
export function resolveConflicts() {
  const conflicted = (git(['diff', '--name-only', '--diff-filter=U'], { check: false }) || '')
    .split('\n').map((s) => s.trim()).filter(Boolean);
  const unresolved = [];
  const winner = new Map(); // slug → 'ours' | 'theirs'
  for (const p of conflicted) {
    const slug = slugOfPath(p);
    if (!slug) { unresolved.push(p); continue; }
    if (!winner.has(slug)) {
      const ours = updatedAtOf('HEAD', slug);
      const theirs = updatedAtOf('MERGE_HEAD', slug);
      winner.set(slug, (theirs ?? 0) > (ours ?? 0) ? 'theirs' : 'ours');
    }
    git(['checkout', `--${winner.get(slug)}`, '--', p], { check: false });
    git(['add', '--', p], { check: false });
  }
  return unresolved;
}

// ───────────────────────── public API ─────────────────────────

/**
 * Bring the workspace up to date with the remote. Throws on anything that would
 * leave us deploying a stale ledger. No-op when sync isn't set up.
 */
export function syncPull() {
  if (!isSyncEnabled()) return { synced: false };
  commitAll('vibeshare: local changes');
  if (!remoteBranchExists()) return { synced: true, merged: false };
  const merged = git(['merge', '--no-edit', `origin/${BRANCH}`], { check: false });
  if (merged !== null) return { synced: true, merged: true };

  const unresolved = resolveConflicts();
  if (unresolved.length) {
    git(['merge', '--abort'], { check: false });
    const e = new Error(
      `Could not auto-merge the shared vibeshare state: ${unresolved.join(', ')}. ` +
      `Resolve it by hand in ${dataDir()} (git status), then re-run.`,
    );
    e.code = 'SYNC_CONFLICT';
    throw e;
  }
  if (git(['commit', '--no-edit'], { check: false }) === null) {
    git(['merge', '--abort'], { check: false });
    const e = new Error(`Could not complete the merge of shared vibeshare state in ${dataDir()}.`);
    e.code = 'SYNC_CONFLICT';
    throw e;
  }
  return { synced: true, merged: true, autoResolved: true };
}

/**
 * Publish the ledger after a successful deploy. Best-effort by design: the
 * pages are already live, so a push failure must not fail the command — it is
 * reported and the next command's pull picks it up.
 * @returns {{pushed:boolean, warning?:string}}
 */
export function syncPush(message = 'vibeshare: update pages') {
  if (!isSyncEnabled()) return { pushed: false };
  try {
    commitAll(message);
    if (git(['push', 'origin', BRANCH], { check: false }) === null) {
      return { pushed: false, warning: 'Deployed, but pushing the shared state failed — run `vibeshare sync` when back online.' };
    }
    return { pushed: true };
  } catch (e) {
    return { pushed: false, warning: `Deployed, but the shared state was not saved: ${e.message}` };
  }
}

/**
 * Turn this workspace into a synced one, merging whatever the remote already
 * holds (that merge is how a second machine's pages join the ledger).
 */
export function syncInit(url) {
  if (!existsSync(path.join(dataDir(), '.git'))) git(['init', '-b', BRANCH]);
  writeFileSync(path.join(dataDir(), '.gitignore'), GITIGNORE);
  if (remoteUrl()) git(['remote', 'set-url', 'origin', url]);
  else git(['remote', 'add', 'origin', url]);
  commitAll('vibeshare: adopt shared state');
  if (remoteBranchExists()) {
    const merged = git(['merge', '--no-edit', '--allow-unrelated-histories', `origin/${BRANCH}`], { check: false });
    if (merged === null) {
      const unresolved = resolveConflicts();
      if (unresolved.length) {
        git(['merge', '--abort'], { check: false });
        const e = new Error(`Could not auto-merge remote state: ${unresolved.join(', ')}. Resolve by hand in ${dataDir()}.`);
        e.code = 'SYNC_CONFLICT';
        throw e;
      }
      git(['commit', '--no-edit'], { check: false });
    }
  }
  git(['push', '-u', 'origin', BRANCH]);
  return { url, dir: dataDir() };
}

/** Human-readable state for `vibeshare sync status`. */
export function syncStatus() {
  if (!isSyncEnabled()) return { enabled: false, dir: dataDir() };
  git(['fetch', 'origin', '--quiet'], { check: false });
  const ahead = git(['rev-list', '--count', `origin/${BRANCH}..${BRANCH}`], { check: false });
  const behind = git(['rev-list', '--count', `${BRANCH}..origin/${BRANCH}`], { check: false });
  return {
    enabled: true,
    dir: dataDir(),
    remote: remoteUrl(),
    ahead: Number(ahead || 0),
    behind: Number(behind || 0),
    dirty: hasChanges(),
  };
}
