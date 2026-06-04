// Output helpers: human-friendly (colored, to stderr for status) + JSON mode.
// JSON always goes to stdout as the LAST line so it's cleanly parseable.

const isTTY = process.stderr.isTTY;
const c = (code) => (s) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
export const color = {
  green: c('32'),
  red: c('31'),
  yellow: c('33'),
  dim: c('2'),
  bold: c('1'),
  cyan: c('36'),
};

// Status/progress goes to stderr so stdout stays clean for --json consumers.
export function info(msg) {
  process.stderr.write(msg + '\n');
}
export function warn(msg) {
  process.stderr.write(color.yellow('⚠ ' + msg) + '\n');
}
export function errline(msg) {
  process.stderr.write(color.red('✖ ' + msg) + '\n');
}
export function ok(msg) {
  process.stderr.write(color.green('✓ ' + msg) + '\n');
}

/** Emit the final machine-readable result on stdout (JSON mode). */
export function emitJson(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

let spinnerTimer = null;
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export function startSpinner(label) {
  if (!isTTY) {
    info(label + '…');
    return () => {};
  }
  let i = 0;
  spinnerTimer = setInterval(() => {
    process.stderr.write(`\r${color.cyan(FRAMES[i++ % FRAMES.length])} ${label}`);
  }, 80);
  return () => {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
    process.stderr.write('\r\x1b[K'); // clear line
  };
}
