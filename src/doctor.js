// Preflight checks shared by `doctor`, `init`, and `share`.

import { runFirebase, runFirebaseJson, resolveFirebase } from './firebase.js';
import { classifyFirebaseError, parseLoginList, CODES } from './classify.js';
import { readConfig } from './config.js';

/** Is a firebase binary resolvable at all? */
export function checkFirebasePresent() {
  const r = resolveFirebase();
  return { present: true, via: r.cmd === process.execPath ? 'bundled' : 'PATH' };
}

/** @returns {Promise<{ loggedIn:boolean, accounts:string[] }>} */
export async function checkLogin() {
  const res = await runFirebase(['login:list']);
  const accounts = parseLoginList(res.stdout + '\n' + res.stderr);
  return { loggedIn: accounts.length > 0, accounts };
}

/** @returns {Promise<{ ok:boolean, projects:Array, code?:string, hint?:string }>} */
export async function listProjects() {
  const r = await runFirebaseJson(['projects:list']);
  if (!r.ok) {
    const { code, hint } = classifyFirebaseError(r.stderr + ' ' + (r.error || '') + ' ' + r.raw);
    return { ok: false, projects: [], code, hint };
  }
  const arr = Array.isArray(r.data) ? r.data : r.data?.projects || [];
  return { ok: true, projects: arr };
}

/**
 * Full preflight. Returns a structured report; never throws.
 * @returns {Promise<{ ok:boolean, checks:object, code?:string, hint?:string }>}
 */
export async function doctor() {
  const checks = {};
  checks.firebase = checkFirebasePresent();

  const login = await checkLogin();
  checks.login = login;
  if (!login.loggedIn) {
    return { ok: false, checks, code: CODES.NOT_LOGGED_IN, hint: 'Run: firebase login' };
  }

  const cfg = readConfig();
  checks.config = cfg ? { project: cfg.project, account: cfg.account } : null;

  // account drift guard
  if (cfg?.account && !login.accounts.includes(cfg.account)) {
    checks.accountMismatch = { expected: cfg.account, available: login.accounts };
  }

  const proj = await listProjects();
  checks.projects = proj.ok ? proj.projects.map((p) => p.projectId) : [];
  if (!proj.ok) {
    return { ok: false, checks, code: proj.code, hint: proj.hint };
  }

  if (!cfg?.project) {
    return { ok: false, checks, code: CODES.NO_PROJECT, hint: 'Run: vibeshare init' };
  }
  if (!checks.projects.includes(cfg.project)) {
    return {
      ok: false,
      checks,
      code: CODES.NO_PROJECT,
      hint: `Configured project "${cfg.project}" not visible to ${cfg.account || 'this account'}. Run: vibeshare init`,
    };
  }

  return { ok: true, checks };
}
