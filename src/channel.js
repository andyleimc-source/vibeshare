// Channel-id generation + sanitization.
// Firebase channel ids → become part of the subdomain
//   https://<project>--<channelId>-<hash>.web.app
// Subdomains cap at 63 chars, so we keep the slug short.

const MAX_SLUG = 20;

/** Sanitize an arbitrary string into a valid, short channel slug. */
export function slugify(input) {
  const s = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // non-alnum → hyphen
    .replace(/^-+|-+$/g, '') // trim hyphens
    .replace(/-{2,}/g, '-') // collapse
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, ''); // trim again after slice
  return s;
}

/** base36 of a timestamp, last 5 chars — a short, monotonic-ish uniquifier. */
export function shortStamp(timeMs) {
  return Math.floor(timeMs).toString(36).slice(-5);
}

/**
 * Build a channel id from a human-friendly base name + a time-based suffix.
 * e.g. makeChannelId("Report.html", 1717500000000) -> "report-abcde"
 * Falls back to "site" when the base slugifies to empty.
 */
export function makeChannelId(baseName, timeMs) {
  const base = slugify(baseName) || 'site';
  return `${base}-${shortStamp(timeMs)}`.slice(0, 40);
}
