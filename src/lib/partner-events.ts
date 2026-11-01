// Ad reporting rules shared by the app and mirrored in the
// record_partner_event database function (supabase/migrations/0004_v1_fixes.sql).
// Pure; unit-tested in tests/partner-events.test.ts.

export type PartnerEvent = 'impression' | 'open' | 'call' | 'website' | 'directions' | 'route' | 'offer';
export type PartnerPlacement = 'pin' | 'trail_sponsor' | 'card' | 'trail' | 'nearby' | 'offer';

export const PARTNER_EVENTS: readonly PartnerEvent[] = ['impression', 'open', 'call', 'website', 'directions', 'route', 'offer'];

/**
 * Remembers which impressions were already sent this app session, so a pin
 * scrolling in and out of view counts once. Taps are always sent.
 */
export class ImpressionDedupe {
  private seen = new Set<string>();

  /** True if this event should be sent (and records it). */
  shouldSend(partnerId: string, event: PartnerEvent, placement: string): boolean {
    if (event !== 'impression') return true;
    const key = `${partnerId}|${placement}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}

/** Random per-launch key (never stored) so the server can rate-limit signed-out riders. */
export function newSessionKey(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 16; i++) s += Math.floor(rand() * 36).toString(36);
  return s;
}
