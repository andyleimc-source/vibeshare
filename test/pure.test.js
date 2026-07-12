import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWhen, parseDurationSeconds, BadWhenError, relativeLabel } from '../src/when.js';
import { gateHtml, normalizeEmail } from '../src/gate.js';
import { slugify, slugifyPath, shortStamp, makeChannelId } from '../src/channel.js';
import { classifyFirebaseError, CODES, parseLoginList, extractChannelUrl } from '../src/classify.js';

test('parseDurationSeconds: units, bare days, compounds', () => {
  assert.equal(parseDurationSeconds('30m'), 1800);
  assert.equal(parseDurationSeconds('2h'), 7200);
  assert.equal(parseDurationSeconds('3d'), 3 * 86400);
  assert.equal(parseDurationSeconds('2w'), 2 * 604800);
  assert.equal(parseDurationSeconds('7'), 7 * 86400); // bare → days
  assert.equal(parseDurationSeconds('1d12h'), 86400 + 12 * 3600); // compound
  assert.equal(parseDurationSeconds('3x'), null); // stray unit
  assert.equal(parseDurationSeconds('abc'), null);
});

test('resolveWhen: relative is unbounded (no 30d cap)', () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  assert.equal(resolveWhen('60d', now).getTime(), now + 60 * 86400 * 1000); // > 30d, allowed
  assert.equal(resolveWhen('2h', now).getTime(), now + 7200 * 1000);
});

test('resolveWhen: absolute date + datetime', () => {
  assert.equal(resolveWhen('2026-07-01').getFullYear(), 2026);
  assert.match(resolveWhen('2026-07-01T18:30').toISOString(), /2026-07-01T/);
});

test('resolveWhen: rejects garbage / zero / negative', () => {
  for (const bad of ['abc', '0', '0d', '-3d', 'd', '', ' ', '3.5.2x']) {
    assert.throws(() => resolveWhen(bad), BadWhenError, `should reject "${bad}"`);
  }
});

test('relativeLabel: relative + overdue', () => {
  const now = Date.UTC(2026, 0, 1);
  assert.equal(relativeLabel(new Date(now + 3 * 86400e3).toISOString(), now), 'in 3d');
  assert.equal(relativeLabel(new Date(now - 1000).toISOString(), now), 'overdue');
  assert.equal(relativeLabel(null), '—');
});

test('gate: anyone passes through, gated modes are encrypted (no plaintext leak)', () => {
  const PAGE = '<!doctype html><h1>SECRET-MARKER-机密</h1>';
  assert.equal(gateHtml(PAGE, { mode: 'anyone' }), PAGE);
  for (const spec of [
    { mode: 'password', pin: '4821' },
    { mode: 'email', emails: ['a@b.com'] },
    { mode: 'email_password', emails: ['a@b.com'], pin: '9999' },
  ]) {
    const out = gateHtml(PAGE, spec);
    assert.ok(!out.includes('SECRET-MARKER'), `${spec.mode} must not leak plaintext`);
    assert.ok(out.includes('crypto.subtle'), `${spec.mode} must embed the client gate`);
  }
  assert.equal(normalizeEmail('  Alice@X.COM '), 'alice@x.com');
});

test('slugify: lowercases, strips, collapses, caps length', () => {
  assert.equal(slugify('Report.html'), 'report-html');
  assert.equal(slugify('  My Cool Page!! '), 'my-cool-page');
  assert.equal(slugify('---a---b---'), 'a-b');
  assert.equal(slugify('日本語ABC'), 'abc');
  assert.equal(slugify(''), '');
  assert.ok(slugify('x'.repeat(50)).length <= 20);
});

test('slugifyPath: nested slugs, sanitized per segment', () => {
  assert.equal(slugifyPath('sage/Brand Guidelines'), 'sage/brand-guidelines');
  assert.equal(slugifyPath('landing'), 'landing');            // flat stays flat
  assert.equal(slugifyPath('//a///b/'), 'a/b');               // empty segments drop
  assert.equal(slugifyPath('../..//etc/passwd'), 'etc/passwd'); // no traversal
  assert.equal(slugifyPath('a/b/c/d/e'), 'a/b/c-d-e');        // depth caps at 3
  assert.equal(slugifyPath(''), '');
  assert.ok(slugifyPath('x'.repeat(80)).length <= 32);        // 32/segment for paths
});

test('shortStamp + makeChannelId', () => {
  assert.equal(shortStamp(0), '0');
  const id = makeChannelId('Report.html', 1717500000000);
  assert.match(id, /^report-html-[a-z0-9]+$/);
  assert.equal(makeChannelId('', 1717500000000).split('-')[0], 'site'); // empty → site
  assert.ok(makeChannelId('x'.repeat(80), 1717500000000).length <= 40);
});

test('classifyFirebaseError: ToS / permission', () => {
  assert.equal(classifyFirebaseError('Error: The caller does not have permission').code, CODES.TOS_REQUIRED);
  assert.equal(classifyFirebaseError('PERMISSION_DENIED').code, CODES.TOS_REQUIRED);
});

test('classifyFirebaseError: API disabled wins over generic 403', () => {
  const msg = 'Firebase Management API firebase.googleapis.com has not been used in project before or it is disabled';
  assert.equal(classifyFirebaseError(msg).code, CODES.API_DISABLED);
});

test('classifyFirebaseError: login / reauth / project / quota', () => {
  assert.equal(classifyFirebaseError('Error: not authenticated, have you run firebase login?').code, CODES.NOT_LOGGED_IN);
  assert.equal(classifyFirebaseError('credentials are no longer valid').code, CODES.AUTH_EXPIRED);
  assert.equal(classifyFirebaseError('Failed to get Firebase project foo. Please make sure the project exists').code, CODES.NO_PROJECT);
  assert.equal(classifyFirebaseError('Quota exceeded for resource').code, CODES.QUOTA);
  assert.equal(classifyFirebaseError('some weird unrelated error').code, CODES.DEPLOY_FAILED);
});

test('parseLoginList: single + multi', () => {
  assert.deepEqual(parseLoginList('Logged in as user@example.com'), ['user@example.com']);
  const multi = parseLoginList('Logged in as a@x.com\n- b@y.com (default)\n- c@z.com');
  assert.ok(multi.includes('a@x.com') && multi.includes('b@y.com') && multi.includes('c@z.com'));
});

test('extractChannelUrl', () => {
  const text = 'Channel URL (demo): https://myproject-1234--demo-1k2j3.web.app [expires ...]';
  assert.equal(extractChannelUrl(text), 'https://myproject-1234--demo-1k2j3.web.app');
  assert.equal(extractChannelUrl('no url here'), null);
});
