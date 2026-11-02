// events-sync throttling. Pure (no Deno/Node APIs) so it's unit-tested.
//
// The daily cron calls events-sync with the app's public key, so anyone who has
// that key could call it in a loop and burn the Ticketmaster quota. A run is
// refused (429) when the last successful run was under 20 minutes ago, or when
// another run started under 3 minutes ago and hasn't finished. A request with
// header x-sync-token equal to the SNAPSHOT_TOKEN secret always runs.

/** sync_state keys (migration 0010). */
export const SYNC_KEY = 'events-sync';
export const SYNC_START_KEY = 'events-sync:start';

export const MIN_GAP_MS = 20 * 60_000;
export const IN_PROGRESS_MS = 3 * 60_000;

export interface ThrottleInput {
  /** last_run of SYNC_KEY: the last successful run (ISO string), if any. */
  lastSuccess?: string | null;
  /** last_run of SYNC_START_KEY: when the last run started (ISO string), if any. */
  lastStart?: string | null;
  now: number;
  /** Value of the x-sync-token request header (null when absent). */
  token?: string | null;
  /** The SNAPSHOT_TOKEN secret (undefined when not set). */
  secret?: string | null;
}

export type ThrottleDecision =
  | { run: true; bypass: boolean }
  | { run: false; retryAfterSec: number };

/** Same length and every character equal, without stopping at the first difference. */
export function tokenMatches(token: string | null | undefined, secret: string | null | undefined): boolean {
  if (!token || !secret || token.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= token.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

export function throttleDecision(i: ThrottleInput): ThrottleDecision {
  if (tokenMatches(i.token, i.secret)) return { run: true, bypass: true };
  const success = ms(i.lastSuccess);
  const start = ms(i.lastStart);
  let until = 0;
  // A clock in the future (bad data) counts as "just now".
  if (success != null) until = Math.max(until, Math.min(success, i.now) + MIN_GAP_MS);
  // A run that started after the last success and hasn't finished yet.
  if (start != null && (success == null || start > success)) {
    until = Math.max(until, Math.min(start, i.now) + IN_PROGRESS_MS);
  }
  if (until > i.now) return { run: false, retryAfterSec: Math.ceil((until - i.now) / 1000) };
  return { run: true, bypass: false };
}
