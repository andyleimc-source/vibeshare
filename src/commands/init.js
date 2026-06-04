// First-run onboarding. Handles the pitfalls discovered building this tool:
// interactive OAuth login, multi-account authuser trap, and the ToS-not-accepted
// 403 that can only be cleared in the browser console.

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { spawn } from 'node:child_process';
import { runFirebase } from '../firebase.js';
import { checkLogin, listProjects } from '../doctor.js';
import { writeConfig } from '../config.js';
import { CODES } from '../classify.js';
import * as ui from '../ui.js';

async function ask(q) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(q)).trim();
  } finally {
    rl.close();
  }
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* ignore — we also print the URL */
  }
}

export async function runInit(opts = {}) {
  const json = !!opts.json;

  // 1) login
  let login = await checkLogin();
  if (!login.loggedIn) {
    if (json) {
      ui.emitJson({ ok: false, code: CODES.NOT_LOGGED_IN, hint: 'Run: firebase login' });
      const e = new Error(CODES.NOT_LOGGED_IN); e.code = CODES.NOT_LOGGED_IN; e.exit = 2; e.handled = true; throw e;
    }
    ui.info('Opening a browser to log in to Google/Firebase…');
    await runFirebase(['login'], { inherit: true });
    login = await checkLogin();
    if (!login.loggedIn) {
      ui.errline('Login did not complete. Re-run `vibeshare init`.');
      const e = new Error('LOGIN_FAILED'); e.code = CODES.NOT_LOGGED_IN; e.exit = 2; e.handled = true; throw e;
    }
  }

  // 2) pick account (multi-account guard)
  let account = login.accounts[0];
  if (login.accounts.length > 1 && !json) {
    ui.info('Multiple Google accounts found:');
    login.accounts.forEach((a, i) => ui.info(`  ${i + 1}. ${a}`));
    const pick = await ask(`Which account? [1-${login.accounts.length}] (default 1): `);
    const idx = Math.max(1, Math.min(login.accounts.length, parseInt(pick || '1', 10))) - 1;
    account = login.accounts[idx];
  }
  ui.ok(`Using account: ${account}`);

  // 3) project — loop through the ToS gate
  for (let attempt = 0; attempt < 5; attempt++) {
    const proj = await listProjects();

    if (proj.ok && proj.projects.length > 0) {
      let project = proj.projects[0].projectId;
      if (proj.projects.length > 1 && !json) {
        ui.info('Your Firebase projects:');
        proj.projects.forEach((p, i) => ui.info(`  ${i + 1}. ${p.projectId}${p.displayName ? '  (' + p.displayName + ')' : ''}`));
        const pick = await ask(`Which project? [1-${proj.projects.length}] (default 1): `);
        const idx = Math.max(1, Math.min(proj.projects.length, parseInt(pick || '1', 10))) - 1;
        project = proj.projects[idx].projectId;
      }
      const saved = writeConfig({ project, account, createdAt: new Date().toISOString() });
      ui.ok(`Set up complete. Project: ${ui.color.bold(project)}`);
      ui.info(ui.color.dim('  Try:  vibeshare share ./index.html'));
      if (json) ui.emitJson({ ok: true, project: saved.project, account: saved.account });
      return saved;
    }

    // No projects, or a 403/ToS/API error → guide to the console.
    const consoleUrl = `https://console.firebase.google.com/?authuser=${encodeURIComponent(account)}`;
    if (json) {
      ui.emitJson({ ok: false, code: proj.code || CODES.NO_PROJECT, hint: proj.hint, consoleUrl });
      const e = new Error(proj.code || CODES.NO_PROJECT); e.code = proj.code || CODES.NO_PROJECT; e.exit = 2; e.handled = true; throw e;
    }

    ui.warn('No usable Firebase project yet.');
    if (proj.code === CODES.TOS_REQUIRED) {
      ui.info('Firebase needs a one-time Terms of Service acceptance — this can only be done in the browser.');
    } else if (proj.code === CODES.API_DISABLED) {
      ui.info('The Firebase API is disabled for your project — opening the console re-enables it.');
    }
    ui.info(`Opening: ${ui.color.cyan(consoleUrl)}`);
    ui.info('  → Accept the terms, then create (or pick) a project. Use the SAME account shown above.');
    openBrowser(consoleUrl);
    const again = await ask('Press Enter when done (or type "q" to quit): ');
    if (again.toLowerCase() === 'q') {
      const e = new Error('ABORTED'); e.code = 'ABORTED'; e.exit = 1; e.handled = true; throw e;
    }
  }

  ui.errline('Still no project after several tries. Re-run `vibeshare init` once the console shows a project.');
  const e = new Error(CODES.NO_PROJECT); e.code = CODES.NO_PROJECT; e.exit = 2; e.handled = true; throw e;
}
