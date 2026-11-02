// Product analytics: event names, privacy rules and helpers. Pure (no React
// Native imports) so it runs in tests; ./analytics wires it to PostHog.
// Event list and properties: docs/analytics-events.md.

import type { PartnerEvent } from './partner-events';

const METERS_PER_MILE = 1609.344;

/** Where a planned route came from. */
export type RouteSource = 'search' | 'trail_card' | 'map_card' | 'event' | 'suggested_ride' | 'saved_ride' | 'map_long_press';

/** Allowed property values: flat primitives only, so no coordinates arrays or route geometry can slip in. */
export type PropValue = string | number | boolean | null | undefined;
export type Props = Record<string, PropValue>;
/** What actually goes to PostHog after sanitize(). */
export type CleanProps = Record<string, string | number | boolean | null>;

/** Every event the app sends, with its properties. */
export interface EventMap {
  app_opened: Props;
  onboarding_completed: { skipped: boolean; bike_type?: string; comfort?: string; ebike_class?: string | null };
  search_performed: { query_length: number; result_count: number; mode: 'stop' | 'start' };
  route_started: { distance_mi: number; profile: string; bike_type?: string; source: RouteSource; stops: number; round_trip: boolean };
  navigation_started: { distance_mi: number; profile: string; bike_type?: string; suggested_ride: boolean };
  navigation_completed: NavEndProps;
  navigation_abandoned: NavEndProps;
  trail_card_viewed: { trail_id: string; trail_name?: string; trail_kind: string; length_mi: number; unpaved_share: string; pass_needed: boolean };
  layer_toggled: { layer: string; on: boolean; from: 'chips' | 'layers_sheet' };
  bcycle_station_viewed: { station_id: string; station_name: string; bikes_available: boolean };
  event_viewed: { event_id: string; event_title: string; category: string; sponsored: boolean };
  event_route_started: { event_id: string; event_title: string; category: string; sponsored: boolean };
  suggested_ride_opened: { ride_id: string; ride_name: string; action: 'plan' | 'preview'; distance_mi?: number };
  flyover_preview_started: { distance_mi: number; profile: string; suggested_ride: boolean };
  analytics_opted_in: Props;
  sponsored_listing_impression: SponsorProps;
  sponsored_listing_tap: SponsorProps & { action: Exclude<PartnerEvent, 'impression' | 'offer'> };
  offer_viewed: SponsorProps;
}

export interface NavEndProps {
  distance_mi: number;
  ridden_mi: number;
  pct_complete: number;
  duration_min: number;
  profile: string;
  suggested_ride: boolean;
  simulated: boolean;
}

export interface SponsorProps {
  partner_id: string;
  partner_name?: string;
  /** Same placement values the Supabase partner_events table uses (pin, trail_sponsor, card, events, ...). */
  placement: string;
  tier?: string;
  event_id?: string;
}

export type EventName = keyof EventMap;

/** Property names that must never be sent (location, route shape, personal info, typed text). */
const BLOCKED = new Set([
  'lat', 'lon', 'lng', 'latitude', 'longitude', 'coords', 'coordinates', 'location', 'geometry', 'polyline', 'route',
  'address', 'email', 'name', 'full_name', 'first_name', 'last_name', 'phone', 'query', 'text', 'search',
]);

/** Drops blocked keys and anything that isn't a flat primitive. */
export function sanitize(props: Record<string, unknown> | undefined): CleanProps {
  const out: CleanProps = {};
  if (!props) return out;
  for (const [k, v] of Object.entries(props)) {
    if (BLOCKED.has(k.toLowerCase())) continue;
    if (v === undefined) continue;
    if (v === null || typeof v === 'string' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** Meters to miles, rounded to the nearest `step` (default 0.5 mi). */
export function roundMiles(meters: number | null | undefined, step = 0.5): number {
  if (meters == null || !Number.isFinite(meters) || meters <= 0) return 0;
  const mi = meters / METERS_PER_MILE;
  return Math.round(mi / step) * step;
}

/** 0..1 → whole percent rounded to the nearest 10, clamped to 0..100. */
export function pctBucket(fraction: number): number {
  if (!Number.isFinite(fraction) || fraction <= 0) return 0;
  return Math.min(100, Math.round((fraction * 100) / 10) * 10);
}

/** 0..1 share (e.g. unpaved share of a trail) → coarse bucket label. */
export function shareBucket(fraction: number | null | undefined): string {
  if (fraction == null || !Number.isFinite(fraction) || fraction <= 0) return 'none';
  if (fraction < 0.25) return 'under_25';
  if (fraction < 0.5) return '25_50';
  if (fraction < 0.75) return '50_75';
  return '75_plus';
}

/** Minutes, rounded to the nearest 5. */
export function roundMinutes(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round(seconds / 300) * 5;
}

/** Expo Router pathname → screen name ("/" is the map). Params are never sent. */
export function screenName(pathname: string | null | undefined): string {
  const p = (pathname ?? '').split('?')[0].replace(/^\/+|\/+$/g, '');
  return p === '' ? 'map' : p;
}

/** Supabase partner event kind → PostHog event name (same moments, same counting). */
export function sponsorEventName(kind: PartnerEvent): 'sponsored_listing_impression' | 'sponsored_listing_tap' | 'offer_viewed' {
  if (kind === 'impression') return 'sponsored_listing_impression';
  if (kind === 'offer') return 'offer_viewed';
  return 'sponsored_listing_tap';
}

/** The part of a PostHog client the app uses (lets tests pass a fake). */
export interface AnalyticsClient {
  capture(event: string, properties?: CleanProps): void;
  screen(name: string, properties?: CleanProps): unknown;
  identify(distinctId: string): void;
  reset(): void;
  optIn(): unknown;
  optOut(): unknown;
}

const MAX_BUFFER = 50;

/**
 * Event sending with the rider's opt-out applied. With no client (no key set)
 * everything is a silent no-op. Until the saved preference is known, events
 * wait in a small buffer and are then sent or dropped.
 */
export function createAnalytics(client: AnalyticsClient | null) {
  let enabled: boolean | null = null;
  let identified: string | null = null;
  let buffer: (() => void)[] = [];

  const run = (fn: () => void) => {
    if (!client || enabled === false) return;
    if (enabled === null) {
      if (buffer.length < MAX_BUFFER) buffer.push(fn);
      return;
    }
    try {
      fn();
    } catch {
      // analytics must never break the app
    }
  };

  return {
    /** True when a PostHog key is configured. */
    configured: !!client,
    track<E extends EventName>(event: E, props?: EventMap[E]) {
      const clean = sanitize(props as Record<string, unknown> | undefined);
      run(() => client!.capture(event, clean));
    },
    screen(pathname: string | null | undefined) {
      const name = screenName(pathname);
      run(() => void client!.screen(name));
    },
    /** Signed-in rider: the opaque account id only, no traits. */
    identify(userId: string) {
      if (identified === userId) return;
      identified = userId;
      run(() => client!.identify(userId));
    },
    /** Signed out: forget the account id and start a new anonymous id. */
    reset() {
      if (identified === null) return;
      identified = null;
      if (!client) return;
      try {
        client.reset();
        // reset() also clears PostHog's own opt-out flag: apply the rider's choice again.
        if (enabled === false) void client.optOut();
      } catch {
        // ignore
      }
    },
    /** The rider's "Share anonymous usage stats" choice. */
    setEnabled(on: boolean) {
      if (enabled === on) return;
      const wasKnown = enabled !== null;
      enabled = on;
      if (!client) {
        buffer = [];
        return;
      }
      try {
        if (on) void client.optIn();
        else void client.optOut();
      } catch {
        // ignore
      }
      const pending = buffer;
      buffer = [];
      if (on) for (const fn of pending) run(fn);
      if (on && wasKnown) {
        const id = identified;
        if (id) run(() => client.identify(id));
        run(() => client.capture('analytics_opted_in', {}));
      }
    },
    /** For tests. */
    get pending() {
      return buffer.length;
    },
  };
}

export type Analytics = ReturnType<typeof createAnalytics>;
