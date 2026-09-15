// Reconcile the workspace public/ folder to exactly match the manifest, then it
// is ready for a full-sync `firebase deploy`. Each page renders to one of:
//   - disabled            → a "page closed" stub
//   - enabled + anyone    → the plaintext source
//   - enabled + gated     → a client-side-encrypted gate (see gate.js)
//
// A page whose retained source is missing does NOT abort the run. Every command
// deploys through transact(→reconcile), so throwing here bricks all publishing
// over one damaged page — which is exactly what happened to a ledger holding
// pages from before sources/ was tracked. Such a page instead keeps whatever is
// already deployed for it (so a full-sync deploy cannot silently delete a live
// page we simply can't re-render) and is reported in the returned warnings.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { paths, publicSlugs, removePageFiles } from './store.js';
import { gateHtml, disabledStub, unavailableStub, landingPage } from './gate.js';

/**
 * Render a single page's deployed artifact from its retained source + manifest
 * entry.
 * @returns {string|null} a warning when the page could not be rendered from source
 */
export function renderPage(page) {
  const dir = paths.pageDir(page.slug);
  const out = path.join(dir, 'index.html');
  mkdirSync(dir, { recursive: true });

  if (page.status === 'disabled') {
    writeFileSync(out, disabledStub(page.title));
    return null;
  }

  let src;
  try {
    src = readFileSync(paths.source(page.slug), 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // No source to render from. Preserving the existing artifact is the safe
    // failure: it is what visitors already see, and a gated page keeps serving
    // its gate rather than being downgraded. Only when nothing was ever
    // deployed do we put up a stub, so the deploy still has a file to publish.
    if (existsSync(out)) {
      return `${page.slug}: source file is missing — kept the page that is already live (it cannot be re-rendered until the source is restored).`;
    }
    writeFileSync(out, unavailableStub(page.title));
    return `${page.slug}: source file is missing and nothing was published before — serving a placeholder.`;
  }

  writeFileSync(out, page.access === 'anyone'
    ? src
    : gateHtml(src, { mode: page.access, pin: page.pin, emails: page.emails, title: page.title }));
  return null;
}

/**
 * Make public/ match the manifest exactly:
 *  - (re)render every page in the manifest
 *  - drop any public/<slug>/ not in the manifest (drift / removed pages)
 *  - (re)write the generic landing + 404 (never leak slugs)
 * @returns {{warnings: string[]}} pages that could not be rendered from source
 */
export function reconcile(manifest) {
  const slugs = new Set(Object.keys(manifest.pages));
  const warnings = [];
  for (const page of Object.values(manifest.pages)) {
    const w = renderPage(page);
    if (w) warnings.push(w);
  }
  for (const dir of publicSlugs()) {
    if (!slugs.has(dir)) removePageFiles(dir);
  }
  mkdirSync(paths.public(), { recursive: true });
  const landing = landingPage();
  writeFileSync(path.join(paths.public(), 'index.html'), landing);
  writeFileSync(path.join(paths.public(), '404.html'), landing);
  return { warnings };
}
