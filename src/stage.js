// Build a temp staging dir so a deploy never writes firebase config into the
// user's own repo. We always COPY the source into STAGE/public (never move,
// never mutate the user's files), then point a temp firebase.json at it.

import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, statSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const FIREBASE_JSON = {
  hosting: { public: 'public', ignore: ['firebase.json', '**/.*', '**/node_modules/**'] },
};

function shouldSkip(name) {
  return name === 'node_modules' || name.startsWith('.');
}

function countFiles(dir) {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countFiles(path.join(dir, entry.name));
    else n += 1;
  }
  return n;
}

/**
 * Stage a file or directory for deploy.
 * @param {string} srcPath
 * @returns {{ stageDir:string, publicDir:string, fileCount:number, cleanup:()=>void, baseName:string }}
 * @throws {Error & {code:'PATH_NOT_FOUND'}}
 */
export function stage(srcPath) {
  const abs = path.resolve(srcPath);
  let st;
  try {
    st = statSync(abs);
  } catch {
    const e = new Error(`Path not found: ${srcPath}`);
    e.code = 'PATH_NOT_FOUND';
    throw e;
  }

  const stageDir = mkdtempSync(path.join(tmpdir(), 'vibeshare-'));
  const publicDir = path.join(stageDir, 'public');
  mkdirSync(publicDir, { recursive: true });

  const cleanup = () => {
    try {
      rmSync(stageDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };

  try {
    let baseName;
    if (st.isDirectory()) {
      baseName = path.basename(abs);
      // recursive copy with ignore filter
      cpDir(abs, publicDir);
      if (!existsSync(path.join(publicDir, 'index.html'))) {
        // not fatal — warn handled by caller via fileCount/hasIndex
      }
    } else {
      baseName = path.basename(abs);
      const name = path.basename(abs);
      copyFileSync(abs, path.join(publicDir, name));
      // ensure root renders: alias any single file to index.html if needed
      if (name.toLowerCase() !== 'index.html') {
        copyFileSync(abs, path.join(publicDir, 'index.html'));
      }
    }

    writeFileSync(path.join(stageDir, 'firebase.json'), JSON.stringify(FIREBASE_JSON, null, 2));
    const fileCount = countFiles(publicDir);
    return { stageDir, publicDir, fileCount, cleanup, baseName, hasIndex: existsSync(path.join(publicDir, 'index.html')) };
  } catch (err) {
    cleanup();
    throw err;
  }
}

// Manual recursive copy honoring the ignore rules (node's cpSync filter works,
// but doing it by hand keeps behavior identical across node versions).
function cpDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (shouldSkip(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) cpDir(s, d);
    else if (entry.isFile()) copyFileSync(s, d);
    // symlinks/other: skip
  }
}
