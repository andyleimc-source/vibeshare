// Thin wrapper around the firebase-tools CLI.
// Resolution order: bundled firebase-tools (a hard dependency) → `firebase` on PATH.
// We never manage firebase's auth/config ourselves — login state lives in
// firebase-tools' own ~/.config/configstore and is shared globally.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

let cachedBin = null;

/** @returns {{ cmd: string, prefix: string[] } | null} how to invoke firebase */
export function resolveFirebase() {
  if (cachedBin !== null) return cachedBin;
  // 0) explicit override — a path to a `firebase` binary. Escape hatch for when
  //    the bundled firebase-tools is incompatible with the local Node version.
  const override = process.env.VIBESHARE_FIREBASE_BIN;
  if (override) {
    cachedBin = override === 'firebase' || override.includes('/')
      ? { cmd: override, prefix: [] }
      : { cmd: 'firebase', prefix: [] };
    return cachedBin;
  }
  // 1) bundled firebase-tools
  try {
    const pkgPath = require.resolve('firebase-tools/package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.firebase;
    if (binRel) {
      const binPath = path.join(path.dirname(pkgPath), binRel);
      cachedBin = { cmd: process.execPath, prefix: [binPath] };
      return cachedBin;
    }
  } catch {
    /* fall through to PATH */
  }
  // 2) `firebase` on PATH
  cachedBin = { cmd: 'firebase', prefix: [] };
  return cachedBin;
}

/**
 * Run firebase with captured output.
 * @returns {Promise<{ code:number, stdout:string, stderr:string }>}
 */
export function runFirebase(args, { inherit = false, cwd } = {}) {
  const { cmd, prefix } = resolveFirebase();
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...prefix, ...args], {
      cwd,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    if (!inherit) {
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
    }
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        const e = new Error('firebase CLI not found');
        e.code = 'FIREBASE_MISSING';
        return reject(e);
      }
      reject(err);
    });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * Extract the first complete top-level JSON value from arbitrary text.
 *
 * firebase can emit more than one JSON object on stdout (see runFirebaseJson),
 * which makes a plain JSON.parse of the whole stream throw "Extra data". Scans
 * brace/bracket depth while skipping over string literals and their escapes.
 *
 * @param {string} text
 * @returns {any|null} the first parsed value, or null if there isn't one
 */
export function parseFirstJson(text = '') {
  const s = String(text);
  const start = s.search(/[{[]/);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      if (--depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Run firebase with --json and parse the result.
 * firebase emits `{ status: "success"|"error", result?, error? }`.
 *
 * Exit codes from firebase-tools are NOT trustworthy on their own: the CLI
 * writes its result JSON, THEN fires a Google Analytics ping wrapped in a 5s
 * timeout, and a ping that can't complete (blocked network, proxy, offline)
 * rejects into the error path — which appends a SECOND `{"status":"error",
 * "error":"Timed out."}` object to stdout and exits non-zero, on a command that
 * already fully succeeded. Observed on firebase-tools 15.x.
 *
 * So judge by the FIRST JSON object: once `status:"success"` is on stdout the
 * command has already committed its work, and only the ping runs after it. Fall
 * back to the exit code only when there's no status marker to go on.
 *
 * @returns {Promise<{ ok:boolean, data:any, raw:string, code:number, stderr:string }>}
 */
export async function runFirebaseJson(args, opts = {}) {
  const res = await runFirebase([...args, '--json'], opts);
  const parsed = parseFirstJson(res.stdout);
  const ok =
    parsed?.status === 'success' ? true
    : parsed?.status === 'error' ? false
    : res.code === 0;
  return {
    ok,
    data: parsed?.result ?? parsed ?? null,
    error: parsed?.error ?? null,
    raw: res.stdout,
    stderr: res.stderr,
    code: res.code,
  };
}
