// Reconcile the workspace public/ folder to exactly match the manifest, then it
// is ready for a full-sync `firebase deploy`. Each page renders to one of:
//   - disabled            → a "page closed" stub
//   - enabled + anyone    → the plaintext source
//   - enabled + gated     → a client-side-encrypted gate (see gate.js)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { paths, publicSlugs, removePageFiles } from './store.js';
import { gateHtml, disabledStub, landingPage } from './gate.js';

/** Render a single page's deployed artifact from its retained source + manifest entry. */
export function renderPage(page) {
  const dir = paths.pageDir(page.slug);
  mkdirSync(dir, { recursive: true });
  let out;
  if (page.status === 'disabled') {
    out = disabledStub(page.title);
  } else {
    const src = readFileSync(paths.source(page.slug), 'utf8');
    out = page.access === 'anyone'
      ? src
      : gateHtml(src, { mode: page.access, pin: page.pin, emails: page.emails, title: page.title });
  }
  writeFileSync(path.join(dir, 'index.html'), out);
}

/**
 * Make public/ match the manifest exactly:
 *  - (re)render every page in the manifest
 *  - drop any public/<slug>/ not in the manifest (drift / removed pages)
 *  - (re)write the generic landing + 404 (never leak slugs)
 */
export function reconcile(manifest) {
  const slugs = new Set(Object.keys(manifest.pages));
  for (const page of Object.values(manifest.pages)) renderPage(page);
  for (const dir of publicSlugs()) {
    if (!slugs.has(dir)) removePageFiles(dir);
  }
  mkdirSync(paths.public(), { recursive: true });
  const landing = landingPage();
  writeFileSync(path.join(paths.public(), 'index.html'), landing);
  writeFileSync(path.join(paths.public(), '404.html'), landing);
}
