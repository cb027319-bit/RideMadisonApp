// Events tab: Madison-area events, each with a bike route there and the nearest bike parking.
// Pure logic (testable in Node); network calls are in events-api.ts.
// Data lives in Supabase (table `events`, migration 0007): Ride Madison's own picks, events
// submitted in the app (approved first), and concerts imported from Ticketmaster and SeatGeek.

import { distanceMeters } from './geo';
import type { BCycleStation } from './bcycle';
import { locale, t } from './i18n';
import type { Place } from './osm';

export type EventCategory = 'bike' | 'music' | 'community' | 'sports' | 'arts' | 'food' | 'family';
export type EventSource = 'curated' | 'partner' | 'ticketmaster' | 'seatgeek';

export interface RideEvent {
  id: string;
  source: EventSource;
  category: EventCategory;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  venue_name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  url: string | null;
  image_url: string | null;
  featured: boolean;
  /** Advertising partner behind a paid placement (labeled "Sponsored"). */
  partner_id?: string | null;
  /** USD, from migration 0010. Null = unknown. */
  price_min?: number | null;
  price_max?: number | null;
  /** true = free, false = paid, null = unknown (migration 0010). */
  is_free?: boolean | null;
  /** More categories the event is also listed under (migration 0010). */
  extra_categories?: EventCategory[] | null;
  /** Shared by the dates of a weekly repeating submission (migration 0010). */
  series_id?: string | null;
}

export const EVENT_CATEGORIES: EventCategory[] = ['bike', 'music', 'community', 'arts', 'sports', 'food', 'family'];

/** Category chips on the Events tab: Family right after Bike so parents find it without scrolling. */
export const FILTER_CATEGORIES: EventCategory[] = ['bike', 'family', 'music', 'community', 'arts', 'sports', 'food'];

/** How far ahead the tab looks. */
export const EVENTS_DAYS_AHEAD = 60;

/** A weekly series has at most this many dates (enforced by the server too). */
export const MAX_SERIES_WEEKS = 12;
/** Highest price the form accepts, in USD. */
export const MAX_PRICE = 10_000;

export type EventCost = 'free' | 'paid' | 'unknown';

export interface EventSubmission {
  title: string;
  category: EventCategory;
  startsAt: Date;
  endsAt: Date | null;
  /** Midnight-to-midnight event (may be sent for today until the day is over). */
  allDay?: boolean;
  venueName: string;
  address: string | null;
  latitude: number;
  longitude: number;
  url: string | null;
  description: string | null;
  contactEmail: string | null;
  cost?: EventCost;
  /** Price in USD when cost is 'paid' (optional). */
  price?: number | null;
  extraCategories?: EventCategory[];
  /** 1 = one date; 2–12 = repeats weekly for that many weeks. */
  weeks?: number;
}

/**
 * Reads a typed price: "25", "$25", "25.50", "25,50". Empty → null (no price given);
 * anything else unreadable or out of range → NaN.
 */
export function parsePrice(text: string): number | null {
  const s = text.trim().replace(/^\$\s*/, '').replace(',', '.');
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const n = Number(s);
  return n >= 0 && n <= MAX_PRICE ? n : NaN;
}

/** Problems with a submission, as i18n keys (empty = OK to send). */
export function validateSubmission(s: Partial<EventSubmission>, now = new Date()): string[] {
  const errs: string[] = [];
  const title = s.title?.trim() ?? '';
  if (title.length < 3) errs.push('events.err.title');
  if (!s.startsAt) errs.push('events.err.date');
  else {
    // An all-day event for today is fine until the day is over.
    const over = s.allDay && s.endsAt ? s.endsAt.getTime() <= now.getTime() : s.startsAt.getTime() < now.getTime() - 3_600_000;
    if (over) errs.push('events.err.past');
  }
  if (s.startsAt && s.endsAt && s.endsAt.getTime() < s.startsAt.getTime()) errs.push('events.err.end');
  if (s.latitude == null || s.longitude == null || !s.venueName?.trim()) errs.push('events.err.venue');
  if (s.cost === 'paid' && s.price != null && !(Number.isFinite(s.price) && s.price >= 0 && s.price <= MAX_PRICE)) {
    errs.push('events.err.price');
  }
  if (s.weeks != null && !(Number.isInteger(s.weeks) && s.weeks >= 1 && s.weeks <= MAX_SERIES_WEEKS)) errs.push('events.err.weeks');
  if (s.url && !/^https?:\/\/\S+\.\S+/i.test(s.url.trim())) errs.push('events.err.url');
  return errs;
}

/** RFC 4122 version-4 id from 16 random bytes (crypto.getRandomValues when available). */
export function uuidV4(bytes?: Uint8Array): string {
  let b = bytes;
  if (!b) {
    b = new Uint8Array(16);
    const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
    if (c?.getRandomValues) c.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  }
  const x = Array.from(b.slice(0, 16), (n) => n);
  x[6] = (x[6] & 0x0f) | 0x40;
  x[8] = (x[8] & 0x3f) | 0x80;
  const hex = x.map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The same local wall-clock time, `weeks` times, a week apart (DST-safe). Clamped to 1–12. */
export function weeklyDates(start: Date, weeks: number): Date[] {
  const n = Math.max(1, Math.min(MAX_SERIES_WEEKS, Math.floor(weeks) || 1));
  return Array.from(
    { length: n },
    (_, i) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * i, start.getHours(), start.getMinutes(), start.getSeconds()),
  );
}

/** A row for the events table (insert payload). */
export interface EventInsertRow {
  source: 'partner';
  status: 'pending';
  category: EventCategory;
  extra_categories: EventCategory[];
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  venue_name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  url: string | null;
  contact_email: string | null;
  is_free: boolean | null;
  price_min: number | null;
  price_max: number | null;
  series_id: string | null;
}

/**
 * Turns a submission into table rows: one per date. A weekly series shares one series_id
 * (from `newId`); a single date has none.
 */
export function submissionRows(s: EventSubmission, newId: () => string = () => uuidV4()): EventInsertRow[] {
  const dates = weeklyDates(s.startsAt, s.weeks ?? 1);
  const series = dates.length > 1 ? newId() : null;
  const length = s.endsAt ? s.endsAt.getTime() - s.startsAt.getTime() : null;
  const extras = [...new Set(s.extraCategories ?? [])].filter((c) => c !== s.category && EVENT_CATEGORIES.includes(c));
  const cost = s.cost ?? 'unknown';
  const price = cost === 'paid' && s.price != null && Number.isFinite(s.price) ? Math.round(s.price * 100) / 100 : null;
  return dates.map((d) => {
    let end: Date | null = null;
    if (length != null) {
      // All-day events end at the next local midnight; others keep their length.
      end = s.allDay ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1) : new Date(d.getTime() + length);
    }
    return {
      source: 'partner',
      status: 'pending',
      category: s.category,
      extra_categories: extras,
      title: s.title.trim().slice(0, 120),
      description: s.description?.trim().slice(0, 1000) || null,
      starts_at: d.toISOString(),
      ends_at: end?.toISOString() ?? null,
      venue_name: s.venueName.trim().slice(0, 120),
      address: s.address?.trim().slice(0, 200) || null,
      latitude: s.latitude,
      longitude: s.longitude,
      url: s.url?.trim() || null,
      contact_email: s.contactEmail?.trim().slice(0, 200) || null,
      is_free: cost === 'free' ? true : cost === 'paid' ? false : null,
      price_min: price,
      price_max: price,
      series_id: series,
    };
  });
}

/** Friendly message key for a failed submission. Raw server text is never shown. */
export function submitErrorKey(raw: string | null | undefined): string {
  const m = (raw ?? '').toLowerCase();
  if (/too many|waiting for review|pending submissions|limit/.test(m)) return 'events.err.tooMany';
  if (/network|fetch|timed? ?out|offline|connection|internet/.test(m)) return 'events.err.network';
  return 'events.err.generic';
}

// ---------- filters and grouping ----------

/** When an event happens: everything upcoming, today only, or this weekend. */
export type EventWhen = 'upcoming' | 'today' | 'weekend';
export type CategoryFilter = 'all' | EventCategory;
export interface EventFilter {
  when: EventWhen;
  category: CategoryFilter;
}
export const EVENT_WHENS: EventWhen[] = ['upcoming', 'today', 'weekend'];
export const NO_FILTER: EventFilter = { when: 'upcoming', category: 'all' };

/** Friday 00:00 → Sunday 23:59 of this week (or the coming one), in local time. */
export function weekendRange(now = new Date()): { start: Date; end: Date } {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = d.getDay(); // 0 Sun … 6 Sat
  // Sunday still counts as "this weekend"; Mon–Thu look ahead to Friday.
  const toFri = dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow;
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + toFri);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 3); // Monday 00:00
  return { start, end };
}

/** Today 00:00 → tomorrow 00:00, local time. */
export function todayRange(now = new Date()): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { start, end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) };
}

const endOf = (e: RideEvent) => new Date(e.ends_at ?? new Date(new Date(e.starts_at).getTime() + 3 * 3_600_000).toISOString());

/** Main category plus any extra ones, without repeats. */
export function eventCategories(e: Pick<RideEvent, 'category' | 'extra_categories'>): EventCategory[] {
  return [...new Set([e.category, ...(e.extra_categories ?? [])])];
}

/** Both filters apply together: e.g. Family events this weekend. Events that are over are dropped. */
export function filterEvents(events: RideEvent[], filter: EventFilter, now = new Date()): RideEvent[] {
  const range = filter.when === 'today' ? todayRange(now) : filter.when === 'weekend' ? weekendRange(now) : null;
  return events.filter((e) => {
    const end = endOf(e);
    if (end.getTime() <= now.getTime()) return false;
    if (range && !(new Date(e.starts_at) < range.end && end > range.start)) return false;
    return filter.category === 'all' || eventCategories(e).includes(filter.category);
  });
}

/** Featured events starting in the next `days` days (and not over), soonest first, at most `max`. */
export function featuredEvents(events: RideEvent[], now = new Date(), days = 14, max = 5): RideEvent[] {
  const until = now.getTime() + days * 86_400_000;
  return events
    .filter((e) => e.featured && endOf(e).getTime() > now.getTime() && new Date(e.starts_at).getTime() <= until)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, max);
}

/** Banner images are shown only from https URLs. */
export function safeImageUrl(url: string | null | undefined): string | null {
  const u = url?.trim();
  return u && /^https:\/\/\S+$/i.test(u) ? u : null;
}

// ---------- price ----------

const dollars = (n: number) => `$${Number.isInteger(n) ? String(n) : n.toFixed(2)}`;

/** "Free", "$25", "$25–$80", "From $25", or null when the price is unknown. */
export function priceLabel(e: Pick<RideEvent, 'is_free' | 'price_min' | 'price_max'>): string | null {
  const min = e.price_min != null && Number.isFinite(Number(e.price_min)) ? Number(e.price_min) : null;
  const max = e.price_max != null && Number.isFinite(Number(e.price_max)) ? Number(e.price_max) : null;
  if (e.is_free === true || (min === 0 && (max == null || max === 0))) return t('events.price.free');
  if (min != null && max != null && max > min) return `${dollars(min)}–${dollars(max)}`;
  if (min != null && max == null) return t('events.price.from', { price: dollars(min) });
  if (min != null) return dollars(min);
  if (max != null) return dollars(max);
  return null;
}

export interface EventSection {
  /** Local day, YYYY-MM-DD. */
  key: string;
  title: string;
  data: RideEvent[];
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** "Today", "Tomorrow", then "Sat, Nov 7". */
export function dayTitle(d: Date, now = new Date()): string {
  const k = dayKey(d);
  if (k === dayKey(now)) return t('events.today');
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (k === dayKey(tomorrow)) return t('events.tomorrow');
  return capitalize(d.toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' }));
}

/** Spanish weekdays come lowercase from Intl ("sáb, 7 de nov."); headers start with a capital. */
export function capitalize(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase(locale()) + s.slice(1) : s;
}

/** "Saturday, November 7" in the current language. */
export function longDate(d: Date): string {
  return capitalize(d.toLocaleDateString(locale(), { weekday: 'long', month: 'long', day: 'numeric' }));
}

/**
 * Groups by start day. Events already underway (started before today) are listed under today.
 * Featured events come first within each day, then by start time.
 */
export function groupByDay(events: RideEvent[], now = new Date()): EventSection[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const map = new Map<string, { date: Date; data: RideEvent[] }>();
  for (const e of events) {
    const start = new Date(e.starts_at);
    const day = start < today ? today : new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const k = dayKey(day);
    if (!map.has(k)) map.set(k, { date: day, data: [] });
    map.get(k)!.data.push(e);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, { date, data }]) => ({
      key,
      title: dayTitle(date, now),
      data: data.sort((a, b) => Number(b.featured) - Number(a.featured) || a.starts_at.localeCompare(b.starts_at)),
    }));
}

/** "7:30 PM" or "7:30 – 10 PM"; "All day" for midnight-to-midnight events. */
export function timeLabel(e: RideEvent): string {
  const loc = locale();
  const s = new Date(e.starts_at);
  const fmt = (d: Date) => d.toLocaleTimeString(loc, { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined });
  if (e.ends_at) {
    const end = new Date(e.ends_at);
    if (s.getHours() === 0 && s.getMinutes() === 0 && end.getTime() - s.getTime() >= 23 * 3_600_000) return t('events.allDay');
    if (dayKey(end) === dayKey(s)) return `${fmt(s)} – ${fmt(end)}`;
  }
  return fmt(s);
}

// ---------- getting there ----------

/** Bike parking within this distance of the venue is worth mentioning. */
export const PARKING_RADIUS_M = 400;

export function nearestParking(e: Pick<RideEvent, 'latitude' | 'longitude'>, places: Place[]): { place: Place; meters: number } | null {
  if (e.latitude == null || e.longitude == null) return null;
  let best: { place: Place; meters: number } | null = null;
  for (const p of places) {
    if (p.kind !== 'parking') continue;
    const m = distanceMeters(e.latitude, e.longitude, p.lat, p.lon);
    if (m <= PARKING_RADIUS_M && (!best || m < best.meters)) best = { place: p, meters: m };
  }
  return best;
}

/** BCycle docks within this distance of the venue are worth mentioning. */
export const STATION_RADIUS_M = 500;

/**
 * Closest BCycle station within 500 m of the venue that has open docks or bikes, so riders
 * on a rental know where to end it.
 */
export function nearestStation(
  e: Pick<RideEvent, 'latitude' | 'longitude'>,
  stations: BCycleStation[],
  radius = STATION_RADIUS_M,
): { station: BCycleStation; meters: number } | null {
  if (e.latitude == null || e.longitude == null) return null;
  let best: { station: BCycleStation; meters: number } | null = null;
  for (const s of stations) {
    if (s.docks <= 0 && s.bikes <= 0) continue;
    const m = distanceMeters(e.latitude, e.longitude, s.lat, s.lon);
    if (m <= radius && (!best || m < best.meters)) best = { station: s, meters: m };
  }
  return best;
}

/** One line to read for an event row: title, day and time, venue, price. */
export function rowA11yLabel(e: RideEvent, now = new Date()): string {
  const start = new Date(e.starts_at);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = dayTitle(start < today ? today : start, now);
  return [e.title, `${day}, ${timeLabel(e)}`, e.venue_name, priceLabel(e)].filter(Boolean).join(', ');
}

// ---------- your submissions ----------

export type SubmissionStatus = 'pending' | 'approved' | 'rejected';

export interface MySubmission {
  id: string;
  series_id: string | null;
  title: string;
  starts_at: string;
  status: SubmissionStatus | string;
  created_at: string;
}

export interface SubmissionGroup {
  /** series_id, or the row id for a single date. */
  key: string;
  seriesId: string | null;
  title: string;
  /** Dates, soonest first. */
  rows: MySubmission[];
  /** The status shared by every date, or null when they differ. */
  status: string | null;
  /** Newest created_at in the group (groups are listed newest first). */
  createdAt: string;
}

/** Groups "Your events" by weekly series; newest submission first. */
export function groupSubmissions(rows: MySubmission[]): SubmissionGroup[] {
  const map = new Map<string, MySubmission[]>();
  for (const r of rows) {
    const k = r.series_id ?? r.id;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  return [...map.entries()]
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      const statuses = new Set(sorted.map((r) => r.status));
      return {
        key,
        seriesId: sorted[0].series_id,
        title: sorted[0].title,
        rows: sorted,
        status: statuses.size === 1 ? sorted[0].status : null,
        createdAt: sorted.reduce((m, r) => (r.created_at > m ? r.created_at : m), ''),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The group's next date that hasn't started yet (or its first date if all have). */
export function nextSubmission(g: Pick<SubmissionGroup, 'rows'>, now = new Date()): MySubmission {
  return g.rows.find((r) => new Date(r.starts_at).getTime() > now.getTime()) ?? g.rows[0];
}

/** "Waiting for review" / "Live" / "Not approved". */
export function statusKey(status: string): string {
  return status === 'approved' ? 'events.mine.live' : status === 'rejected' ? 'events.mine.rejected' : 'events.mine.pending';
}

export const CATEGORY_ICON: Record<EventCategory, string> = {
  bike: 'bicycle',
  music: 'musical-notes',
  community: 'people',
  arts: 'color-palette',
  sports: 'trophy',
  food: 'restaurant',
  family: 'happy',
};
