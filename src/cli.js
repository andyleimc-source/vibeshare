import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { shareCmd } from './commands/share.js';
import { listCmd } from './commands/list.js';
import { unshareCmd } from './commands/unshare.js';
import { openCmd } from './commands/open.js';
import { doctorCmd } from './commands/doctor.js';
import { runInit } from './commands/init.js';
import * as ui from './ui.js';

const require = createRequire(import.meta.url);

const FLAGS_WITH_VALUE = new Set(['--ttl', '-e', '--expires', '--project', '-P', '--name', '--id']);
const ALIASES = { '-e': '--ttl', '--expires': '--ttl', '-P': '--project', '--id': '--name', '-y': '--yes', '-h': '--help', '-v': '--version' };

function parse(argv) {
  const positionals = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (a.startsWith('-')) {
      const norm = ALIASES[a] || a;
      if (FLAGS_WITH_VALUE.has(a) || FLAGS_WITH_VALUE.has(norm)) {
        opts[norm.replace(/^--/, '')] = argv[++i];
      } else {
        opts[norm.replace(/^--/, '')] = true;
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, opts };
}

function version() {
  const pkg = JSON.parse(readFileSync(require.resolve('../package.json'), 'utf8'));
  return pkg.version;
}

const HELP = `vibeshare — share a local HTML file/folder as a public, auto-expiring URL.

Usage:
  vibeshare <path> [--ttl 7d] [--name <slug>] [--open]   deploy & get a link (default)
  vibeshare share <path> [...]                            same as above
  vibeshare list                                          list active links
  vibeshare unshare <id>                                  remove a link early
  vibeshare open <id>                                     open a link in the browser
  vibeshare init                                          first-time setup (login + project)
  vibeshare doctor                                        check your setup

Options:
  --ttl, -e <dur>     lifetime: 12h, 3d, 30d, or bare days (default 7d, max 30d)
  --name, --id <s>    custom channel id (default: auto from filename + timestamp)
  --project, -P <id>  Firebase project id (default: configured)
  --open              open the URL after deploying
  --json              machine-readable output (implies non-interactive)
  --yes, -y           skip confirmations
  --debug             verbose firebase output
  --help, -h          this help
  --version, -v       print version

Backend: bring-your-own free Firebase Hosting. Run \`vibeshare init\` once.`;

const COMMANDS = new Set(['share', 'list', 'unshare', 'rm', 'delete', 'open', 'init', 'doctor', 'help']);

export async function main(argv) {
  const { positionals, opts } = parse(argv);

  if (opts.version) { process.stdout.write(version() + '\n'); return 0; }
  if (opts.help && positionals.length === 0) { process.stdout.write(HELP + '\n'); return 0; }

  let cmd = positionals[0];
  let rest = positionals.slice(1);
  // default command = share (when first positional isn't a known command)
  if (!cmd || !COMMANDS.has(cmd)) {
    cmd = 'share';
    rest = positionals;
  }

  try {
    switch (cmd) {
      case 'help': process.stdout.write(HELP + '\n'); return 0;
      case 'share': await shareCmd(rest[0], opts); return 0;
      case 'list': await listCmd(opts); return 0;
      case 'unshare':
      case 'rm':
      case 'delete': await unshareCmd(rest[0], opts); return 0;
      case 'open': await openCmd(rest[0], opts); return 0;
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
