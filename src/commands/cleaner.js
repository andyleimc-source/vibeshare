// Optional background auto-expiry via macOS launchd. The tool works fine without
// it — `list`/`gc` apply due expiries lazily — but `cleaner install` adds a
// LaunchAgent that runs `vibeshare gc` every 15 minutes so pages close/delete on
// schedule even when you never touch the CLI.

import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { paths } from '../store.js';
import * as ui from '../ui.js';

const LABEL = 'com.vibeshare.gc';

function plistPath() {
  return path.join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function binPath() {
  // bin/vibeshare.js relative to this file (src/commands/cleaner.js)
  return fileURLToPath(new URL('../../bin/vibeshare.js', import.meta.url));
}

function buildPlist() {
  const nodeDir = path.dirname(process.execPath);
  const PATH = [nodeDir, `${homedir()}/.local/bin`, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  mkdirSync(paths.logs(), { recursive: true });
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${binPath()}</string>
    <string>gc</string>
    <string>--quiet</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${homedir()}</string>
    <key>PATH</key><string>${PATH}</string>
  </dict>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${path.join(paths.logs(), 'gc.out.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(paths.logs(), 'gc.err.log')}</string>
</dict>
</plist>
`;
}

function launchctl(args) {
  return spawnSync('launchctl', args, { encoding: 'utf8' });
}

export async function cleanerCmd(sub, opts) {
  const json = !!opts.json;
  if (platform() !== 'darwin') {
    const msg = 'Background cleaner uses macOS launchd. On Linux, add `vibeshare gc` to cron; on Windows, Task Scheduler.';
    if (json) ui.emitJson({ ok: false, code: 'UNSUPPORTED', message: msg }); else ui.warn(msg);
    return;
  }
  const uid = process.getuid();
  switch (sub) {
    case 'install': {
      writeFileSync(plistPath(), buildPlist());
      launchctl(['bootout', `gui/${uid}`, plistPath()]); // ignore failure if not loaded
      const r = launchctl(['bootstrap', `gui/${uid}`, plistPath()]);
      const ok = r.status === 0;
      if (json) ui.emitJson({ ok, label: LABEL, plist: plistPath() });
      else if (ok) ui.ok(`Background cleaner installed (runs every 15 min). Disable with: vibeshare cleaner uninstall`);
      else ui.errline(`launchctl bootstrap failed: ${(r.stderr || '').trim()}`);
      return;
    }
    case 'uninstall': {
      launchctl(['bootout', `gui/${uid}`, plistPath()]);
      if (existsSync(plistPath())) rmSync(plistPath(), { force: true });
      if (json) ui.emitJson({ ok: true, removed: LABEL }); else ui.ok('Background cleaner removed.');
      return;
    }
    case 'status':
    default: {
      const r = launchctl(['list', LABEL]);
      const loaded = r.status === 0;
      if (json) ui.emitJson({ ok: true, loaded, plist: existsSync(plistPath()) ? plistPath() : null });
      else ui.info(loaded ? `Cleaner is ${ui.color.bold('active')} (${LABEL}).` : 'Cleaner is not installed. Add it with: vibeshare cleaner install');
      return;
    }
  }
}
