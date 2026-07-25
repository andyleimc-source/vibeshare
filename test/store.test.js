// Storage layout + cross-machine sync. These tests drive a real workspace and
// real git repos in a temp dir: the whole point of the split-by-page layout is
// how it behaves under `git merge`, which a mock cannot tell you anything about.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Point the workspace at a fresh temp dir, then import store/sync against it. */
async function freshWorkspace() {
  const dir = mkdtempSync(path.join(tmpdir(), 'vibeshare-test-'));
  process.env.XDG_DATA_HOME = dir;
  // Bust the module cache so dataDir() re-reads the env for each test.
  const bust = `?t=${Math.random()}`;
  const store = await import('../src/store.js' + bust);
  const sync = await import('../src/sync.js' + bust);
  return { dir: path.join(dir, 'vibeshare'), store, sync, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function page(slug, updatedAt, extra = {}) {
  return {
    slug, title: slug, status: 'enabled', access: 'anyone', emails: [], pin: null,
    expireAt: null, expireAction: 'disable', createdAt: '2026-01-01T00:00:00.000Z', updatedAt, ...extra,
  };
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitIdentity(cwd) {
  git(cwd, ['config', 'user.email', 'test@example.com']);
  git(cwd, ['config', 'user.name', 'vibeshare test']);
}

test('store: pages round-trip through one file per slug, nested slugs included', async (t) => {
  const { dir, store, cleanup } = await freshWorkspace();
  t.after(cleanup);
  store.ensureWorkspace('proj');

  const m = store.readManifest();
  m.pages['reelie/report'] = page('reelie/report', '2026-07-25T00:00:00.000Z');
  m.pages['flat'] = page('flat', '2026-07-25T00:00:00.000Z');
  store.writeManifest(m);

  assert.ok(existsSync(path.join(dir, 'pages', 'reelie', 'report.json')));
  assert.ok(existsSync(path.join(dir, 'pages', 'flat.json')));
  assert.ok(!existsSync(path.join(dir, 'manifest.json')), 'no single-file manifest is written');

  const back = store.readManifest();
  assert.deepEqual(Object.keys(back.pages).sort(), ['flat', 'reelie/report']);
  assert.equal(back.pages['reelie/report'].title, 'reelie/report');
  assert.equal(back.project, 'proj');
});

test('store: dropping a page deletes its file and prunes the empty dir', async (t) => {
  const { dir, store, cleanup } = await freshWorkspace();
  t.after(cleanup);
  store.ensureWorkspace('proj');
  const m = store.readManifest();
  m.pages['ns/only'] = page('ns/only', '2026-07-25T00:00:00.000Z');
  store.writeManifest(m);
  assert.ok(existsSync(path.join(dir, 'pages', 'ns', 'only.json')));

  delete m.pages['ns/only'];
  store.writeManifest(m);
  assert.ok(!existsSync(path.join(dir, 'pages', 'ns', 'only.json')));
  assert.ok(!existsSync(path.join(dir, 'pages', 'ns')), 'empty namespace dir is pruned');
  assert.deepEqual(store.readManifest().pages, {});
});

test('store: a legacy manifest.json migrates to pages/ and is kept as a backup', async (t) => {
  const { dir, store, cleanup } = await freshWorkspace();
  t.after(cleanup);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    version: 1, project: 'old-proj', lastDeploy: '2026-07-25T12:53:07.514Z',
    pages: { 'a/b': page('a/b', '2026-07-25T00:00:00.000Z'), flat: page('flat', '2026-07-25T00:00:00.000Z') },
  }));

  const m = store.readManifest();
  assert.deepEqual(Object.keys(m.pages).sort(), ['a/b', 'flat']);
  assert.equal(m.project, 'old-proj');
  assert.equal(m.lastDeploy, '2026-07-25T12:53:07.514Z');
  assert.ok(existsSync(path.join(dir, 'manifest.json.migrated')), 'old manifest kept for recovery');
  assert.ok(!existsSync(path.join(dir, 'manifest.json')));
  assert.ok(existsSync(path.join(dir, 'pages', 'a', 'b.json')));
});

test('store: stableStringify sorts keys so two machines produce identical bytes', async (t) => {
  const { store, cleanup } = await freshWorkspace();
  t.after(cleanup);
  const a = store.stableStringify({ b: 1, a: { d: 2, c: [{ f: 1, e: 2 }] } });
  const b = store.stableStringify({ a: { c: [{ e: 2, f: 1 }], d: 2 }, b: 1 });
  assert.equal(a, b);
});

test('sync: two machines editing different pages merge without conflict', async (t) => {
  const { dir, store, sync, cleanup } = await freshWorkspace();
  t.after(cleanup);
  const bare = mkdtempSync(path.join(tmpdir(), 'vibeshare-remote-'));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  git(bare, ['init', '--bare', '-b', 'main']);

  // machine A publishes one page and pushes
  store.ensureWorkspace('proj');
  const a = store.readManifest();
  a.pages['work/one'] = page('work/one', '2026-07-25T10:00:00.000Z');
  store.writeManifest(a);
  mkdirSync(path.join(dir, 'sources', 'work'), { recursive: true });
  writeFileSync(path.join(dir, 'sources', 'work', 'one.html'), '<h1>one</h1>');
  git(dir, ['init', '-b', 'main']);
  gitIdentity(dir);
  sync.syncInit(bare);

  // machine B: an independent clone adds a different page and pushes
  const bDir = mkdtempSync(path.join(tmpdir(), 'vibeshare-b-'));
  t.after(() => rmSync(bDir, { recursive: true, force: true }));
  git(bDir, ['clone', bare, 'ws']);
  const bWs = path.join(bDir, 'ws');
  gitIdentity(bWs);
  mkdirSync(path.join(bWs, 'pages', 'mkp'), { recursive: true });
  writeFileSync(path.join(bWs, 'pages', 'mkp', 'two.json'),
    store.stableStringify(page('mkp/two', '2026-07-25T11:00:00.000Z')));
  git(bWs, ['add', '-A']);
  git(bWs, ['commit', '-m', 'b adds a page']);
  git(bWs, ['push', 'origin', 'main']);

  // machine A pulls → both pages present, nothing lost
  sync.syncPull();
  const merged = store.readManifest();
  assert.deepEqual(Object.keys(merged.pages).sort(), ['mkp/two', 'work/one'],
    'the other machine\'s page must survive — losing it is the bug this whole layout exists to prevent');
});

test('sync: the same page edited on both machines resolves to the newer updatedAt', async (t) => {
  const { dir, store, sync, cleanup } = await freshWorkspace();
  t.after(cleanup);
  const bare = mkdtempSync(path.join(tmpdir(), 'vibeshare-remote2-'));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  git(bare, ['init', '--bare', '-b', 'main']);

  store.ensureWorkspace('proj');
  const a = store.readManifest();
  a.pages['shared'] = page('shared', '2026-07-25T10:00:00.000Z', { title: 'from A' });
  store.writeManifest(a);
  git(dir, ['init', '-b', 'main']);
  gitIdentity(dir);
  sync.syncInit(bare);

  // B edits the same page LATER
  const bDir = mkdtempSync(path.join(tmpdir(), 'vibeshare-b2-'));
  t.after(() => rmSync(bDir, { recursive: true, force: true }));
  git(bDir, ['clone', bare, 'ws']);
  const bWs = path.join(bDir, 'ws');
  gitIdentity(bWs);
  writeFileSync(path.join(bWs, 'pages', 'shared.json'),
    store.stableStringify(page('shared', '2026-07-25T20:00:00.000Z', { title: 'from B (newer)' })));
  git(bWs, ['add', '-A']);
  git(bWs, ['commit', '-m', 'b edits shared']);
  git(bWs, ['push', 'origin', 'main']);

  // A edits it too, EARLIER, then pulls → B wins on updatedAt
  const a2 = store.readManifest();
  a2.pages['shared'] = page('shared', '2026-07-25T12:00:00.000Z', { title: 'from A (older)' });
  store.writeManifest(a2);
  sync.syncPull();
  assert.equal(store.readManifest().pages['shared'].title, 'from B (newer)');
});

test('sync: a page deleted on one machine stays deleted after the other pulls', async (t) => {
  const { dir, store, sync, cleanup } = await freshWorkspace();
  t.after(cleanup);
  const bare = mkdtempSync(path.join(tmpdir(), 'vibeshare-remote3-'));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  git(bare, ['init', '--bare', '-b', 'main']);

  store.ensureWorkspace('proj');
  const a = store.readManifest();
  a.pages['gone'] = page('gone', '2026-07-25T10:00:00.000Z');
  a.pages['stays'] = page('stays', '2026-07-25T10:00:00.000Z');
  store.writeManifest(a);
  git(dir, ['init', '-b', 'main']);
  gitIdentity(dir);
  sync.syncInit(bare);

  const bDir = mkdtempSync(path.join(tmpdir(), 'vibeshare-b3-'));
  t.after(() => rmSync(bDir, { recursive: true, force: true }));
  git(bDir, ['clone', bare, 'ws']);
  const bWs = path.join(bDir, 'ws');
  gitIdentity(bWs);
  rmSync(path.join(bWs, 'pages', 'gone.json'));
  git(bWs, ['add', '-A']);
  git(bWs, ['commit', '-m', 'b removes a page']);
  git(bWs, ['push', 'origin', 'main']);

  sync.syncPull();
  assert.deepEqual(Object.keys(store.readManifest().pages), ['stays']);
});

test('sync: syncInit merges what the remote already has (unrelated histories)', async (t) => {
  const { dir, store, sync, cleanup } = await freshWorkspace();
  t.after(cleanup);
  const bare = mkdtempSync(path.join(tmpdir(), 'vibeshare-remote4-'));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  git(bare, ['init', '--bare', '-b', 'main']);

  // remote already holds another machine's ledger, with its own history
  const seed = mkdtempSync(path.join(tmpdir(), 'vibeshare-seed-'));
  t.after(() => rmSync(seed, { recursive: true, force: true }));
  git(seed, ['init', '-b', 'main']);
  gitIdentity(seed);
  mkdirSync(path.join(seed, 'pages', 'sage'), { recursive: true });
  writeFileSync(path.join(seed, 'pages', 'sage', 'guide.json'),
    store.stableStringify(page('sage/guide', '2026-07-20T00:00:00.000Z')));
  git(seed, ['add', '-A']);
  git(seed, ['commit', '-m', 'seed']);
  git(seed, ['remote', 'add', 'origin', bare]);
  git(seed, ['push', '-u', 'origin', 'main']);

  // this machine has its own, never-shared ledger
  store.ensureWorkspace('proj');
  const m = store.readManifest();
  m.pages['reelie/report'] = page('reelie/report', '2026-07-25T00:00:00.000Z');
  store.writeManifest(m);
  git(dir, ['init', '-b', 'main']);
  gitIdentity(dir);
  sync.syncInit(bare);

  assert.deepEqual(Object.keys(store.readManifest().pages).sort(), ['reelie/report', 'sage/guide']);
});

test('sync: public/ and machine-local files are never shared', async (t) => {
  const { dir, store, sync, cleanup } = await freshWorkspace();
  t.after(cleanup);
  const bare = mkdtempSync(path.join(tmpdir(), 'vibeshare-remote5-'));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  git(bare, ['init', '--bare', '-b', 'main']);

  store.ensureWorkspace('proj');
  mkdirSync(path.join(dir, 'public', 'x'), { recursive: true });
  writeFileSync(path.join(dir, 'public', 'x', 'index.html'), 'artifact');
  git(dir, ['init', '-b', 'main']);
  gitIdentity(dir);
  sync.syncInit(bare);

  const tracked = git(dir, ['ls-files']).split('\n');
  assert.ok(!tracked.some((f) => f.startsWith('public/')), 'build artifacts stay local');
  assert.ok(!tracked.includes('meta.json'), 'lastDeploy/project are machine-local');
  assert.ok(!tracked.includes('.firebaserc'));
});
