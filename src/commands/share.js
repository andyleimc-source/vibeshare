import path from 'node:path';
import { parseTtl, expiryFrom } from '../ttl.js';
import { makeChannelId, slugify } from '../channel.js';
import { stage } from '../stage.js';
import { runFirebaseJson } from '../firebase.js';
import { classifyFirebaseError, extractChannelUrl } from '../classify.js';
import { readConfig } from '../config.js';
import { runInit } from './init.js';
import * as ui from '../ui.js';

// Recursively find the deployed channel's { url, expireTime } in firebase's JSON result.
function findChannel(data) {
  if (!data || typeof data !== 'object') return null;
  if (typeof data.url === 'string' && data.url.includes('--')) {
    return { url: data.url, expireTime: data.expireTime || data.expire_time || null };
  }
  for (const v of Object.values(data)) {
    const hit = findChannel(v);
    if (hit) return hit;
  }
  return null;
}

export async function shareCmd(targetPath, opts) {
  const json = !!opts.json;

  if (!targetPath) {
    const e = new Error('Missing <path>. Usage: vibeshare share <file-or-folder> [--ttl 7d]');
    e.code = 'USAGE';
    e.exit = 1;
    throw e;
  }

  // --- preflight ---
  // An explicit --project lets advanced users (and our own smoke tests) skip
  // the saved-config requirement. Otherwise we need a configured project.
  let cfg = readConfig();
  let project = opts.project || cfg?.project;

  if (!project) {
    if (!json) {
      ui.warn('Not set up yet — running first-time setup.');
      await runInit({ json: false });
      cfg = readConfig();
      project = cfg?.project;
    }
    if (!project) {
      const code = 'NO_PROJECT';
      const hint = 'Run: vibeshare init';
      if (json) ui.emitJson({ ok: false, code, hint });
      else ui.errline(`${code}: ${hint}`);
      const e = new Error(code);
      e.code = code;
      e.exit = 2;
      e.handled = true;
      throw e;
    }
  }

  // --- ttl ---
  const ttl = parseTtl(opts.ttl);
  if (ttl.clamped && !json) ui.warn('TTL capped at Firebase max of 30d.');

  // --- stage ---
  const staged = stage(targetPath);
  if (!staged.hasIndex && !json) {
    ui.warn('No index.html at the root — the base URL may 404.');
  }

  const channelId = opts.name ? slugify(opts.name) : makeChannelId(staged.baseName, Date.now());
  const firebaseJson = path.join(staged.stageDir, 'firebase.json');

  const stop = json ? () => {} : ui.startSpinner(`Deploying ${staged.fileCount} file(s) to a ${ttl.duration} channel`);
  try {
    const r = await runFirebaseJson([
      'hosting:channel:deploy', channelId,
      '--expires', ttl.duration,
      '-P', project,
      '-c', firebaseJson,
      '--non-interactive',
    ]);
    stop();

    if (!r.ok) {
      const { code, hint } = classifyFirebaseError(r.stderr + ' ' + (r.error || '') + ' ' + r.raw);
      if (json) ui.emitJson({ ok: false, code, hint, stderr: r.stderr.trim() });
      else {
        ui.errline(`Deploy failed (${code}). ${hint}`);
        if (r.stderr.trim()) ui.info(ui.color.dim(r.stderr.trim().split('\n').slice(-3).join('\n')));
      }
      const e = new Error(code);
      e.code = code;
      e.exit = 2;
      e.handled = true;
      throw e;
    }

    const ch = findChannel(r.data) || { url: extractChannelUrl(r.raw), expireTime: null };
    const url = ch.url || extractChannelUrl(r.raw);
    const expiresAt = ch.expireTime || expiryFrom(Date.now(), ttl.seconds);

    if (json) {
      ui.emitJson({
        ok: true,
        url,
        channelId,
        project,
        expiresAt,
        ttl: ttl.duration,
        path: path.resolve(targetPath),
        files: staged.fileCount,
      });
    } else {
      ui.ok(`Shared  ${targetPath}  →  ${ui.color.bold(ui.color.cyan(url))}`);
      const when = expiresAt ? new Date(expiresAt).toISOString().slice(0, 16).replace('T', ' ') : `${ttl.duration}`;
      ui.info(ui.color.dim(`  expires  ${when} (${ttl.duration})    channel: ${channelId}`));
      ui.info(ui.color.dim(`  vibeshare unshare ${channelId}    to remove early`));
    }
    return { url, channelId, expiresAt };
  } finally {
    stop();
    staged.cleanup();
  }
}
