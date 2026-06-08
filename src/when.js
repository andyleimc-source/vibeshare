// Parse a "when" expression into an absolute expiry Date.
// Unlike v0.1's ttl.js (capped at Firebase's 30d channel limit), the managed
// model tracks expiry in our own manifest + sweeps it ourselves, so durations
// are unbounded.
//
// Accepts:
//   relative:  30m  2h  3d  2w  (and compounds: 1d12h)  — m/h/d/w
//   bare number → days (e.g. "7" = 7d)
//   absolute:  YYYY-MM-DD  or  YYYY-MM-DDTHH:MM  (interpreted in local time)

const UNIT_SECONDS = { m: 60, h: 3600, d: 86400, w: 604800 };

export class BadWhenError extends Error {
  constructor(input) {
    super(
      `Invalid time value: "${input}". Use 30m / 2h / 3d / 2w, a bare number of days, or a date like 2026-07-01 or 2026-07-01T18:00.`,
    );
    this.code = 'BAD_WHEN';
    this.input = input;
  }
}

/** Parse a relative duration ("2h", "3d", "1d12h", bare days) → seconds, or null. */
export function parseDurationSeconds(input) {
  const raw = String(input).trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(raw)) return Math.round(Number(raw) * UNIT_SECONDS.d); // bare → days
  const re = /(\d+(?:\.\d+)?)\s*([mhdw])/g;
  let total = 0;
  let matched = false;
  let consumed = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    matched = true;
    total += Number(m[1]) * UNIT_SECONDS[m[2]];
    consumed += m[0].length;
  }
  // Reject stray characters (e.g. "3x" or "3d!") — every char must belong to a unit group.
  if (!matched || consumed !== raw.replace(/\s+/g, '').length) return null;
  return Math.round(total);
}

/**
 * Resolve a "when" expression to an absolute Date.
 * @param {string} input
 * @param {number} [nowMs] reference time (for testability)
 * @returns {Date}
 * @throws {BadWhenError}
 */
export function resolveWhen(input, nowMs = Date.now()) {
  if (input == null || input === '') throw new BadWhenError(input);
  const raw = String(input).trim();

  // Absolute date / datetime (local time).
  if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(raw)) {
    const iso = raw.replace(' ', 'T');
    const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
    if (Number.isNaN(d.getTime())) throw new BadWhenError(input);
    return d;
  }

  const seconds = parseDurationSeconds(raw);
  if (seconds == null || seconds <= 0) throw new BadWhenError(input);
  return new Date(nowMs + seconds * 1000);
}

/** Human-friendly relative label for an absolute expiry, e.g. "in 6d", "in 90m", "overdue". */
export function relativeLabel(targetIso, nowMs = Date.now()) {
  if (!targetIso) return '—';
  const diff = new Date(targetIso).getTime() - nowMs;
  if (Number.isNaN(diff)) return '—';
  if (diff <= 0) return 'overdue';
  const s = Math.round(diff / 1000);
  if (s < 3600) return `in ${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `in ${Math.round(s / 3600)}h`;
  if (s < 604800) return `in ${Math.round(s / 86400)}d`;
  return `in ${Math.round(s / 604800)}w`;
}
