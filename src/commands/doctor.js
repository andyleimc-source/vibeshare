import { doctor } from '../doctor.js';
import * as ui from '../ui.js';

export async function doctorCmd(opts) {
  const json = !!opts.json;
  const report = await doctor();

  if (json) {
    ui.emitJson(report);
    if (!report.ok) {
      const e = new Error(report.code); e.code = report.code; e.exit = 2; e.handled = true; throw e;
    }
    return report;
  }

  const c = report.checks;
  const mark = (b) => (b ? ui.color.green('✓') : ui.color.red('✖'));
  ui.info(ui.color.bold('vibeshare doctor'));
  ui.info(`  ${mark(!!c.firebase?.present)} firebase CLI (${c.firebase?.via || '—'})`);
  ui.info(`  ${mark(!!c.login?.loggedIn)} logged in${c.login?.accounts?.length ? ': ' + c.login.accounts.join(', ') : ''}`);
  if (c.accountMismatch) {
    ui.warn(`account drift: config expects ${c.accountMismatch.expected}, but logged in as ${c.accountMismatch.available.join(', ')}`);
  }
  ui.info(`  ${mark(!!c.config?.project)} configured project${c.config?.project ? ': ' + c.config.project : ''}`);
  ui.info(`  ${mark(Array.isArray(c.projects) && c.projects.length > 0)} visible projects${c.projects?.length ? ': ' + c.projects.join(', ') : ''}`);

  const L = c.ledger;
  if (L) {
    ui.info(`  ${mark(L.ok)} ledger: ${L.pages} page(s)`);
    // Listed in full on purpose: this is the one place that shows the whole
    // damage, and every entry is a page that cannot be re-rendered or updated.
    for (const slug of L.missingSources) ui.warn(`no source retained for "${slug}" — it cannot be updated or rebuilt; re-share the file to restore it`);
    for (const slug of L.orphanSources) ui.warn(`orphan source "${slug}.html" has no page record — leftover from a removed page`);
  }

  // A damaged ledger is not a setup failure — publishing still works (render.js
  // degrades rather than aborts) — so it must not change the exit code. It must
  // change what we SAY, though: "All good" under a ✖ line is how this went
  // unnoticed in the first place.
  if (report.ok) {
    const damaged = (c.ledger?.missingSources?.length || 0) + (c.ledger?.orphanSources?.length || 0);
    if (damaged) ui.warn(`Ready to share, but ${damaged} ledger entr${damaged === 1 ? 'y needs' : 'ies need'} attention (above).`);
    else ui.ok('All good — ready to share.');
  }
  else {
    ui.errline(`${report.code}: ${report.hint}`);
    const e = new Error(report.code); e.code = report.code; e.exit = 2; e.handled = true; throw e;
  }
  return report;
}
