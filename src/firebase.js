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
 * Run firebase with --json and parse the result.
 * firebase emits `{ status: "success"|"error", result?, error? }`.
 * @returns {Promise<{ ok:boolean, data:any, raw:string, code:number, stderr:string }>}
 */
export async function runFirebaseJson(args, opts = {}) {
  const res = await runFirebase([...args, '--json'], opts);
  let parsed = null;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    /* leave parsed null; caller may fall back to text scraping */
  }
  const ok = res.code === 0 && parsed?.status !== 'error';
  return {
    ok,
    data: parsed?.result ?? parsed ?? null,
    error: parsed?.error ?? null,
    raw: res.stdout,
    stderr: res.stderr,
    code: res.code,
  };
}
