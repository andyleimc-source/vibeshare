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

  if (report.ok) ui.ok('All good — ready to share.');
  else {
    ui.errline(`${report.code}: ${report.hint}`);
    const e = new Error(report.code); e.code = report.code; e.exit = 2; e.handled = true; throw e;
  }
  return report;
}
