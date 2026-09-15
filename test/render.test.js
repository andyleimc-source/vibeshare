// reconcile() must never let one damaged page take the whole site down.
//
// The ledger can legitimately hold a page whose source is missing: pages
// published before sources/ was tracked, a half-finished merge, a file lost on
// one machine. renderPage() used to readFileSync() straight into an ENOENT,
// which aborted reconcile — and because every command deploys through
// transact(→reconcile), a single such page bricked *all* publishing with an
// error naming only a path. These tests pin the degraded behaviour instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function freshWorkspace() {
  const dir = mkdtempSync(path.join(tmpdir(), 'vibeshare-render-'));
  process.env.XDG_DATA_HOME = dir;
  const bust = `?t=${Math.random()}`;
  const store = await import('../src/store.js' + bust);
  const render = await import('../src/render.js' + bust);
  return { dir: path.join(dir, 'vibeshare'), store, render, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function page(slug, extra = {}) {
  return {
    slug, title: slug, status: 'enabled', access: 'anyone', emails: [], pin: null,
    expireAt: null, expireAction: 'disable',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
  };
}

function writeSource(dir, slug, html) {
  const f = path.join(dir, 'sources', `${slug}.html`);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, html);
}

function deployed(dir, slug) {
  const f = path.join(dir, 'public', slug, 'index.html');
  return existsSync(f) ? readFileSync(f, 'utf8') : null;
}

test('reconcile: a page with no source does not abort the other pages', async (t) => {
  const { dir, store, render, cleanup } = await freshWorkspace();
  t.after(cleanup);
  store.ensureWorkspace('demo');
  writeSource(dir, 'good', '<h1>good</h1>');
  const manifest = { version: 1, project: 'demo', pages: { good: page('good'), broken: page('broken') } };

  const res = render.reconcile(manifest);

  assert.equal(deployed(dir, 'good'), '<h1>good</h1>', 'the healthy page still deploys');
  assert.ok(res.warnings.some((w) => w.includes('broken')), 'the damaged page is reported');
});

test('reconcile: a missing source keeps whatever is already live for that page', async (t) => {
  const { dir, store, render, cleanup } = await freshWorkspace();
  t.after(cleanup);
  store.ensureWorkspace('demo');
  const live = path.join(dir, 'public', 'legacy', 'index.html');
  mkdirSync(path.dirname(live), { recursive: true });
  writeFileSync(live, '<h1>published before sources were kept</h1>');

  const res = render.reconcile({ version: 1, project: 'demo', pages: { legacy: page('legacy') } });

  assert.equal(deployed(dir, 'legacy'), '<h1>published before sources were kept</h1>',
    'the already-published artifact is preserved, not replaced or dropped');
  assert.ok(res.warnings.some((w) => w.includes('legacy')));
});

test('reconcile: a missing source with nothing live falls back to a stub, not a crash', async (t) => {
  const { dir, store, render, cleanup } = await freshWorkspace();
  t.after(cleanup);
  store.ensureWorkspace('demo');

  const res = render.reconcile({ version: 1, project: 'demo', pages: { gone: page('gone') } });

  const out = deployed(dir, 'gone');
  assert.ok(out && out.length > 0, 'something is deployed rather than the command dying');
  assert.ok(res.warnings.some((w) => w.includes('gone')));
});

test('reconcile: a gated page with no source never falls back to serving plaintext', async (t) => {
  const { dir, store, render, cleanup } = await freshWorkspace();
  t.after(cleanup);
  store.ensureWorkspace('demo');
  const live = path.join(dir, 'public', 'secret', 'index.html');
  mkdirSync(path.dirname(live), { recursive: true });
  writeFileSync(live, '<h1>gate</h1>');

  const res = render.reconcile({
    version: 1, project: 'demo',
    pages: { secret: page('secret', { access: 'password', pin: '1234' }) },
  });

  assert.equal(deployed(dir, 'secret'), '<h1>gate</h1>');
  assert.ok(res.warnings.some((w) => w.includes('secret')));
});

test('reconcile: a healthy workspace reports no warnings', async (t) => {
  const { dir, store, render, cleanup } = await freshWorkspace();
  t.after(cleanup);
  store.ensureWorkspace('demo');
  writeSource(dir, 'a', '<h1>a</h1>');
  const res = render.reconcile({ version: 1, project: 'demo', pages: { a: page('a') } });
  assert.deepEqual(res.warnings, []);
});

// ── ledger integrity ────────────────────────────────────────────────────────
// The failure that motivated all of this was invisible until a deploy died:
// the ledger held page records whose sources/ file was gone. `doctor` should
// say so plainly, before anyone tries to publish.

test('checkLedger: reports pages whose source file is gone', async (t) => {
  const { dir, store, cleanup } = await freshWorkspace();
  t.after(cleanup);
  store.ensureWorkspace('demo');
  const bust = `?t=${Math.random()}`;
  const { checkLedger } = await import('../src/doctor.js' + bust);

  store.writeManifest({ version: 1, project: 'demo', pages: { ok: page('ok'), broken: page('broken') } });
  writeSource(dir, 'ok', '<h1>ok</h1>');

  const r = checkLedger();
  assert.equal(r.pages, 2);
  assert.deepEqual(r.missingSources, ['broken']);
  assert.equal(r.ok, false);
});

test('checkLedger: a consistent ledger passes', async (t) => {
  const { dir, store, cleanup } = await freshWorkspace();
  t.after(cleanup);
  store.ensureWorkspace('demo');
  const bust = `?t=${Math.random()}`;
  const { checkLedger } = await import('../src/doctor.js' + bust);

  store.writeManifest({ version: 1, project: 'demo', pages: { ok: page('ok') } });
  writeSource(dir, 'ok', '<h1>ok</h1>');

  const r = checkLedger();
  assert.equal(r.ok, true);
  assert.deepEqual(r.missingSources, []);
});
