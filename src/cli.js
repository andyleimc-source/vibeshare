import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  shareCmd, listCmd, enableCmd, disableCmd, accessCmd,
  expireCmd, keepCmd, rmCmd, openCmd, gcCmd,
} from './manage.js';
import { runInit } from './commands/init.js';
import { doctorCmd } from './commands/doctor.js';
import { cleanerCmd } from './commands/cleaner.js';
import * as ui from './ui.js';

const require = createRequire(import.meta.url);

// Flags that take a value. --password/--pin take an OPTIONAL value (a bare
// --password auto-generates a 4-digit PIN).
const VALUE_FLAGS = new Set(['--name', '--slug', '--title', '--email', '--expire', '--project']);
const OPTIONAL_VALUE = new Set(['--password', '--pin']);
const ALIASES = {
  '-P': '--project', '--id': '--name', '-e': '--expire', '--expires': '--expire',
  '-p': '--password', '-y': '--yes', '-h': '--help', '-v': '--version',
};

function parse(argv) {
  const positionals = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('-') && a !== '-') {
      const norm = ALIASES[a] || a;
      const key = norm.replace(/^--/, '');
      if (VALUE_FLAGS.has(norm)) {
        opts[key] = argv[++i];
      } else if (OPTIONAL_VALUE.has(norm)) {
        const next = argv[i + 1];
        opts[key] = next !== undefined && !next.startsWith('-') ? argv[++i] : '';
      } else {
        opts[key] = true;
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, opts };
}

function version() {
  return JSON.parse(readFileSync(require.resolve('../package.json'), 'utf8')).version;
}

const HELP = `vibeshare — share a local HTML page as a managed public URL with access control.

Pages live at https://<project>.web.app/<slug>/ and have two independent axes —
open/closed and how they're accessed — plus optional auto-expiry.

Slugs are hierarchical: the default is <folder>/<file> (the enclosing git repo
or cwd name, then the filename), e.g. sage/brand-guidelines. Pass --name to
override — "--name docs/api/v2" nests (max 3 levels), "--name landing" is flat.

Usage:
  vibeshare <file.html> [access] [--expire 3d] [--name slug]   deploy & get a link
  vibeshare list                                               list your pages
  vibeshare enable  <slug>                                     open (serve) a page
  vibeshare disable <slug>                                     close it (content kept)
  vibeshare access  <slug> [access]                            change how it's accessed
  vibeshare expire  <slug> <when> [--delete]                   auto-close (default) at a time
  vibeshare keep    <slug>                                     cancel auto-expiry
  vibeshare rm      <slug>                                     delete it for good
  vibeshare open    <slug>                                     open it in the browser
  vibeshare gc                                                 apply due expiries now
  vibeshare cleaner install|uninstall|status                  background auto-expiry (launchd)
  vibeshare init                                               first-time setup (login + project)
  vibeshare doctor                                             check your setup

Access (compose freely; default = anyone):
  --password [PIN]    require a password (bare flag auto-generates a 4-digit PIN)
  --email a@b,c@d     require one of these emails (soft gate — emails aren't secret)
  --email … --password …   require a valid email AND the password (recommended)

Options:
  --expire <when>     30m, 2h, 3d, 2w, a bare number of days, or 2026-07-01[THH:MM]
  --delete            with expire: delete instead of just closing at expiry
  --name, --slug <s>  custom slug, "/" nests (default: <repo-or-cwd>/<filename>)
  --title <s>         page title shown on the gate (default: <title> or slug)
  --project, -P <id>  Firebase project (default: configured)
  --force             overwrite an existing slug
  --json              machine-readable output
  --help, -h          this help     --version, -v   print version

Backend: bring-your-own free Firebase Hosting. Run \`vibeshare init\` once.`;

const COMMANDS = new Set(['share', 'list', 'enable', 'disable', 'access', 'expire', 'keep', 'rm', 'delete', 'remove', 'open', 'gc', 'cleaner', 'init', 'doctor', 'help']);

export async function main(argv) {
  const { positionals, opts } = parse(argv);
  if (opts.version) { process.stdout.write(version() + '\n'); return 0; }
  if (opts.help && positionals.length === 0) { process.stdout.write(HELP + '\n'); return 0; }

  let cmd = positionals[0];
  let rest = positionals.slice(1);
  if (!cmd || !COMMANDS.has(cmd)) { cmd = 'share'; rest = positionals; }

  try {
    switch (cmd) {
      case 'help': process.stdout.write(HELP + '\n'); return 0;
      case 'share': await shareCmd(rest[0], opts); return 0;
      case 'list': await listCmd(opts); return 0;
      case 'enable': await enableCmd(rest[0], opts); return 0;
      case 'disable': await disableCmd(rest[0], opts); return 0;
      case 'access': await accessCmd(rest[0], opts); return 0;
      case 'expire': await expireCmd(rest[0], rest[1], opts); return 0;
      case 'keep': await keepCmd(rest[0], opts); return 0;
      case 'rm':
      case 'delete':
      case 'remove': await rmCmd(rest[0], opts); return 0;
      case 'open': await openCmd(rest[0], opts); return 0;
      case 'gc': await gcCmd(opts); return 0;
      case 'cleaner': await cleanerCmd(rest[0], opts); return 0;
      case 'init': await runInit(opts); return 0;
      case 'doctor': await doctorCmd(opts); return 0;
      default: process.stdout.write(HELP + '\n'); return 1;
    }
  } catch (err) {
    if (!err.handled) {
      if (opts.json) ui.emitJson({ ok: false, code: err.code || 'ERROR', message: err.message });
      else ui.errline(err.message || String(err));
    }
    return err.exit || 1;
  }
}
