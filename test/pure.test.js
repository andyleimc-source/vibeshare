import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTtl, BadTtlError, MAX_SECONDS } from '../src/ttl.js';
import { slugify, shortStamp, makeChannelId } from '../src/channel.js';
import { classifyFirebaseError, CODES, parseLoginList, extractChannelUrl } from '../src/classify.js';

test('parseTtl: defaults to 7d', () => {
  assert.equal(parseTtl().duration, '7d');
  assert.equal(parseTtl('').duration, '7d');
});

test('parseTtl: days, hours, bare number', () => {
  assert.deepEqual(parseTtl('3d'), { duration: '3d', seconds: 3 * 86400, clamped: false });
  assert.deepEqual(parseTtl('12h'), { duration: '12h', seconds: 12 * 3600, clamped: false });
  assert.equal(parseTtl('5').duration, '5d'); // bare number → days
  assert.equal(parseTtl('  30D ').duration, '30d'); // trim + case
});

test('parseTtl: clamps over 30d', () => {
  const r = parseTtl('60d');
  assert.equal(r.duration, '30d');
  assert.equal(r.seconds, MAX_SECONDS);
  assert.equal(r.clamped, true);
  assert.equal(parseTtl('1000h').clamped, true); // 1000h > 30d
});

test('parseTtl: rejects garbage / zero / negative', () => {
  for (const bad of ['abc', '0', '0d', '-3d', '3w', '', ' ', 'd', '3.5.2']) {
    if (bad === '' || bad === ' ') continue; // empty → default, tested above
    assert.throws(() => parseTtl(bad), BadTtlError, `should reject "${bad}"`);
  }
});

test('slugify: lowercases, strips, collapses, caps length', () => {
  assert.equal(slugify('Report.html'), 'report-html');
  assert.equal(slugify('  My Cool Page!! '), 'my-cool-page');
  assert.equal(slugify('---a---b---'), 'a-b');
  assert.equal(slugify('日本語ABC'), 'abc');
  assert.equal(slugify(''), '');
  assert.ok(slugify('x'.repeat(50)).length <= 20);
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
  assert.deepEqual(parseLoginList('Logged in as andylei.mc@gmail.com'), ['andylei.mc@gmail.com']);
  const multi = parseLoginList('Logged in as a@x.com\n- b@y.com (default)\n- c@z.com');
  assert.ok(multi.includes('a@x.com') && multi.includes('b@y.com') && multi.includes('c@z.com'));
});

test('extractChannelUrl', () => {
  const text = 'Channel URL (demo): https://mpc2026-4f4bd--demo-1k2j3.web.app [expires ...]';
  assert.equal(extractChannelUrl(text), 'https://mpc2026-4f4bd--demo-1k2j3.web.app');
  assert.equal(extractChannelUrl('no url here'), null);
});
