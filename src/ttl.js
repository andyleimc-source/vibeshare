// TTL parsing + clamping for Firebase Hosting preview channels.
// Firebase 原生限制：最大 30 天，默认 7 天。

export const MAX_SECONDS = 30 * 24 * 3600; // 30d hard limit (Firebase)
export const DEFAULT_TTL = '7d';

const UNIT_SECONDS = { h: 3600, d: 24 * 3600 };

export class BadTtlError extends Error {
  constructor(input) {
    super(`Invalid --ttl value: "${input}". Use forms like 12h, 3d, 30d, or a bare number of days.`);
    this.code = 'BAD_TTL';
    this.input = input;
  }
}

/**
 * Parse a TTL string into a normalized duration usable by `firebase --expires`.
 * Accepts: "12h", "3d", "30d", or a bare number (interpreted as days).
 * Clamps anything above 30d down to 30d (Firebase's max) and flags it.
 *
 * @returns {{ duration: string, seconds: number, clamped: boolean }}
 * @throws {BadTtlError} on unparseable / zero / negative input
 */
export function parseTtl(input) {
  if (input == null || input === '') return parseTtl(DEFAULT_TTL);

  const raw = String(input).trim().toLowerCase();
  // bare number → days
  const match = /^(\d+(?:\.\d+)?)\s*(h|d)?$/.exec(raw);
  if (!match) throw new BadTtlError(input);

  const value = Number(match[1]);
  const unit = match[2] || 'd';
  if (!Number.isFinite(value) || value <= 0) throw new BadTtlError(input);

  let seconds = Math.round(value * UNIT_SECONDS[unit]);
  let clamped = false;
  if (seconds > MAX_SECONDS) {
    seconds = MAX_SECONDS;
    clamped = true;
  }

  // Firebase accepts compact duration strings; emit hours when sub-day, else days.
  const duration = clamped
    ? '30d'
    : unit === 'h' && seconds < UNIT_SECONDS.d
      ? `${Math.round(seconds / UNIT_SECONDS.h)}h`
      : `${Math.round(seconds / UNIT_SECONDS.d)}d`;

  return { duration, seconds, clamped };
}

/** Compute an absolute expiry ISO timestamp from now + seconds. */
export function expiryFrom(nowMs, seconds) {
  return new Date(nowMs + seconds * 1000).toISOString();
}
