// Managed (root-domain) model: pages live at https://<project>.web.app/<slug>/,
// tracked in a local manifest, with two orthogonal axes — status (enabled|
// disabled) and access (anyone|password|email|email_password) — plus optional
// expiry whose default action is DISABLE (not delete). Delete is always manual.

import { readFileSync, statSync, copyFileSync, mkdirSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ACCESS_MODES, normalizeEmail } from './gate.js';
import { resolveWhen, relativeLabel } from './when.js';
import { slugifyPath } from './channel.js';
import { paths, readManifest, removePageFiles, ensureWorkspace } from './store.js';
import { transact, pageUrl } from './deploy.js';
import { readConfig } from './config.js';
import * as ui from './ui.js';

function resolveProject(opts) {
  const project = opts.project || readConfig()?.project;
  if (!project) {
    const e = new Error('No Firebase project configured. Run: vibeshare init');
    e.code = 'NO_PROJECT'; e.exit = 2; e.handled = false;
    throw e;
  }
  return project;
}

function usage(msg) {
  const e = new Error(msg); e.code = 'USAGE'; e.exit = 1; e.handled = false; return e;
}

function genPin() {
  return String(randomInt(0, 10000)).padStart(4, '0');
}

function titleFromHtml(html, fallback) {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return (m && m[1].trim()) || fallback;
}

/**
 * Namespace for the default slug: pages deploy to <namespace>/<file> so every
 * project gets its own directory on the site. Uses the enclosing git repo's
 * folder name when available, else the cwd's folder name.
 */
function defaultNamespace(file) {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: path.dirname(path.resolve(file)), stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (top) return path.basename(top);
  } catch { /* not a git repo */ }
  return path.basename(process.cwd());
}

/** Read access flags off the parsed opts → {mode, pin, emails, generated}. */
export function accessFromOpts(opts) {
  const emails = (typeof opts.email === 'string' ? opts.email : '')
    .split(',').map(normalizeEmail).filter(Boolean);
  // --password / --pin: value if provided, else auto-generate a 4-digit PIN.
  let pin = null, generated = false, wantsPass = false;
  for (const k of ['password', 'pin']) {
    if (opts[k] !== undefined) {
      wantsPass = true;
      if (typeof opts[k] === 'string' && opts[k] !== '') pin = opts[k];
    }
  }
  if (wantsPass && pin == null) { pin = genPin(); generated = true; }

  let mode;
  if (emails.length && wantsPass) mode = 'email_password';
  else if (emails.length) mode = 'email';
  else if (wantsPass) mode = 'password';
  else mode = 'anyone';
  if (!ACCESS_MODES.has(mode)) throw usage(`Unknown access mode: ${mode}`);
  const rawPin = (mode === 'password' || mode === 'email_password') ? pin : null;
  return { mode, rawPin, emails, generated };
}

function applyAccess(page, acc) {
  page.access = acc.mode;
  page.emails = acc.emails || [];
  page.pin = (acc.mode === 'password' || acc.mode === 'email_password') ? acc.rawPin : null;
}

function accessLabel(page) {
  switch (page.access) {
    case 'password': return 'password 🔒';
    case 'email': return 'email 🔒';
    case 'email_password': return 'email+pass 🔒';
    default: return 'anyone';
  }
}

/** Lazy expiry: apply any past-due expiry to the manifest in place. → changed bool. */
export function sweep(manifest, nowMs = Date.now()) {
  let changed = false;
  for (const [slug, page] of Object.entries(manifest.pages)) {
    if (!page.expireAt) continue;
    if (new Date(page.expireAt).getTime() > nowMs) continue;
    if (page.expireAction === 'delete') {
      removePageFiles(slug);
      delete manifest.pages[slug];
    } else {
      page.status = 'disabled';
      page.expireAt = null;
      page.updatedAt = new Date().toISOString();
    }
    changed = true;
  }
  return changed;
}

function getPage(manifest, slug) {
  const page = manifest.pages[slug];
  if (!page) throw usage(`No such page: "${slug}". See: vibeshare list`);
  return page;
}

function pinNote(acc) {
  if (acc.mode === 'password' || acc.mode === 'email_password') {
    const how = acc.generated ? '(auto-generated)' : '';
    return acc.generated
      ? `  password ${ui.color.bold(acc.rawPin)} ${how}  ·  4-digit PINs are brute-forceable — use a longer one for anything sensitive`
      : `  password set`;
  }
  return null;
}

// ─────────────────────────── commands ───────────────────────────

export async function shareCmd(file, opts) {
  const json = !!opts.json;
  const project = resolveProject(opts);
  if (!file) throw usage('Missing <file>. Usage: vibeshare <file.html> [--password|--email a@b.com] [--expire 3d]');

  let st;
  try { st = statSync(path.resolve(file)); } catch { const e = new Error(`Path not found: ${file}`); e.code = 'PATH_NOT_FOUND'; throw e; }
  if (st.isDirectory()) throw usage('Folders are not supported in the managed model yet — pass a single .html file.');

  const html = readFileSync(path.resolve(file), 'utf8');
  // --name/--slug is used verbatim (may itself be "a/b" or a flat "a");
  // otherwise pages nest under the project's namespace: <repo-or-cwd>/<file>.
  const named = opts.name || opts.slug;
  const slug = (named
    ? slugifyPath(named)
    : slugifyPath(`${defaultNamespace(file)}/${path.basename(file, path.extname(file))}`)) || 'page';
  const title = opts.title || titleFromHtml(html, slug);
  const acc = accessFromOpts(opts);
  const expireAt = opts.expire ? resolveWhen(opts.expire).toISOString() : null;
  const expireAction = opts['then-delete'] ? 'delete' : 'disable';

  const existing = readManifest().pages[slug];
  if (existing && !opts.force && !opts.yes) {
    throw usage(`A page "${slug}" already exists. Re-run with --force to overwrite, or --name to pick another slug.`);
  }

  const now = new Date().toISOString();
  await transact(project, (m) => {
    mkdirSync(path.dirname(paths.source(slug)), { recursive: true });
    copyFileSync(path.resolve(file), paths.source(slug));
    const page = m.pages[slug] || { slug, createdAt: now };
    page.title = title;
    page.sourcePath = path.resolve(file);
    page.status = 'enabled';
    applyAccess(page, acc);
    page.expireAt = expireAt;
    page.expireAction = expireAction;
    page.updatedAt = now;
    page.url = pageUrl(project, slug);
    m.pages[slug] = page;
  });

  const url = pageUrl(project, slug);
  if (json) {
    ui.emitJson({ ok: true, slug, url, access: acc.mode, pin: acc.rawPin || null, expiresAt: expireAt, expireAction });
  } else {
    ui.ok(`Shared  ${file}  →  ${ui.color.bold(ui.color.cyan(url))}`);
    const note = pinNote(acc); if (note) ui.info(ui.color.dim(note));
    if (acc.mode === 'email' || acc.mode === 'email_password') ui.info(ui.color.dim(`  allowed: ${acc.emails.join(', ')}`));
    if (expireAt) ui.info(ui.color.dim(`  expires ${relativeLabel(expireAt)} (${new Date(expireAt).toISOString().slice(0,16).replace('T',' ')}) → ${expireAction}`));
    ui.info(ui.color.dim(`  vibeshare disable ${slug}  ·  vibeshare rm ${slug}`));
  }
  return { slug, url };
}

export async function listCmd(opts) {
  const json = !!opts.json;
  const project = resolveProject(opts);
  ensureWorkspace(project);
  // lazy sweep — apply due expiries; redeploy only if something changed.
  let manifest = readManifest();
  if (sweep(manifest)) {
    await transact(project, (m) => { sweep(m); });
    manifest = readManifest();
  }
  const pages = Object.values(manifest.pages);
  if (json) { ui.emitJson({ ok: true, project, pages }); return pages; }
  if (pages.length === 0) { ui.info(ui.color.dim('No pages. Try:  vibeshare ./index.html')); return pages; }
  for (const p of pages.sort((a, b) => (a.slug < b.slug ? -1 : 1))) {
    const status = p.status === 'disabled' ? ui.color.dim('closed') : ui.color.bold('open  ');
    const exp = p.expireAt ? relativeLabel(p.expireAt) + `→${p.expireAction}` : '—';
    ui.info(`${status} ${p.slug.padEnd(22)} ${accessLabel(p).padEnd(14)} ${exp.padEnd(16)} ${ui.color.cyan(p.url)}`);
  }
  ui.info(ui.color.dim(`\n${pages.length} page(s) · ${project}`));
  return pages;
}

export async function enableCmd(slug, opts) {
  const project = resolveProject(opts);
  await transact(project, (m) => { getPage(m, slug).status = 'enabled'; m.pages[slug].updatedAt = new Date().toISOString(); });
  if (opts.json) ui.emitJson({ ok: true, slug, status: 'enabled' }); else ui.ok(`Opened  ${slug}  →  ${ui.color.cyan(pageUrl(project, slug))}`);
}

export async function disableCmd(slug, opts) {
  const project = resolveProject(opts);
  await transact(project, (m) => { getPage(m, slug).status = 'disabled'; m.pages[slug].updatedAt = new Date().toISOString(); });
  if (opts.json) ui.emitJson({ ok: true, slug, status: 'disabled' }); else ui.ok(`Closed  ${slug}  (content kept; re-open with: vibeshare enable ${slug})`);
}

export async function accessCmd(slug, opts) {
  const project = resolveProject(opts);
  const acc = accessFromOpts(opts);
  await transact(project, (m) => { const p = getPage(m, slug); applyAccess(p, acc); p.updatedAt = new Date().toISOString(); });
  if (opts.json) ui.emitJson({ ok: true, slug, access: acc.mode, pin: acc.rawPin || null });
  else { ui.ok(`Access for ${slug}: ${accessLabel({ access: acc.mode })}`); const n = pinNote(acc); if (n) ui.info(ui.color.dim(n)); if (acc.emails.length) ui.info(ui.color.dim(`  allowed: ${acc.emails.join(', ')}`)); }
}

export async function expireCmd(slug, when, opts) {
  const project = resolveProject(opts);
  if (!when) throw usage('Missing <when>. Usage: vibeshare expire <slug> 3d   (or 2h / 2026-07-01)');
  const at = resolveWhen(when).toISOString();
  const action = opts['delete'] ? 'delete' : 'disable';
  await transact(project, (m) => { const p = getPage(m, slug); p.expireAt = at; p.expireAction = action; p.updatedAt = new Date().toISOString(); return { redeploy: false }; });
  if (opts.json) ui.emitJson({ ok: true, slug, expiresAt: at, expireAction: action });
  else ui.ok(`${slug} will ${action} ${relativeLabel(at)} (${new Date(at).toISOString().slice(0,16).replace('T',' ')})`);
}

export async function keepCmd(slug, opts) {
  const project = resolveProject(opts);
  await transact(project, (m) => { const p = getPage(m, slug); p.expireAt = null; p.updatedAt = new Date().toISOString(); return { redeploy: false }; });
  if (opts.json) ui.emitJson({ ok: true, slug, expiresAt: null }); else ui.ok(`${slug} will stay until you remove it.`);
}

export async function rmCmd(slug, opts) {
  const project = resolveProject(opts);
  if (!slug) throw usage('Missing <slug>. Usage: vibeshare rm <slug>');
  if (!readManifest().pages[slug]) throw usage(`No such page: "${slug}".`);
  await transact(project, (m) => { removePageFiles(slug); delete m.pages[slug]; });
  if (opts.json) ui.emitJson({ ok: true, removed: slug }); else ui.ok(`Removed ${slug}.`);
}

export async function gcCmd(opts) {
  const project = resolveProject(opts);
  ensureWorkspace(project);
  const before = readManifest();
  if (!sweep(structuredClone(before))) { if (opts.json) ui.emitJson({ ok: true, changed: false }); else if (!opts.quiet) ui.info('Nothing expired.'); return; }
  const { manifest } = await transact(project, (m) => { sweep(m); });
  if (opts.json) ui.emitJson({ ok: true, changed: true, pages: Object.keys(manifest.pages) });
  else ui.ok('Swept expired pages.');
}

export async function openCmd(slug, opts) {
  const project = resolveProject(opts);
  const p = readManifest().pages[slug];
  if (!p) throw usage(`No such page: "${slug}".`);
  const url = pageUrl(project, slug);
  const { spawn } = await import('node:child_process');
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try { spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref(); } catch { /* ignore */ }
  if (opts.json) ui.emitJson({ ok: true, slug, url }); else ui.info(`Opening ${ui.color.cyan(url)}`);
}
