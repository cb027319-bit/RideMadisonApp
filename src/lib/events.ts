// Events tab: Madison-area events, each with a bike route there and the nearest bike parking.
// Pure logic (testable in Node); network calls are in events-api.ts.
// Data lives in Supabase (table `events`, migration 0007): Ride Madison's own picks, events
// submitted in the app (approved first), and concerts imported from Ticketmaster and SeatGeek.

import { distanceMeters } from './geo';
import { lang, t } from './i18n';
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
}

export const EVENT_CATEGORIES: EventCategory[] = ['bike', 'music', 'community', 'arts', 'sports', 'food', 'family'];

/** How far ahead the tab looks. */
export const EVENTS_DAYS_AHEAD = 60;

export interface EventSubmission {
  title: string;
  category: EventCategory;
  startsAt: Date;
  endsAt: Date | null;
  venueName: string;
  address: string | null;
  latitude: number;
  longitude: number;
  url: string | null;
  description: string | null;
  contactEmail: string | null;
}

/** Problems with a submission, as i18n keys (empty = OK to send). */
export function validateSubmission(s: Partial<EventSubmission>, now = new Date()): string[] {
  const errs: string[] = [];
  const title = s.title?.trim() ?? '';
  if (title.length < 3) errs.push('events.err.title');
  if (!s.startsAt) errs.push('events.err.date');
  else if (s.startsAt.getTime() < now.getTime() - 3_600_000) errs.push('events.err.past');
  if (s.startsAt && s.endsAt && s.endsAt.getTime() < s.startsAt.getTime()) errs.push('events.err.end');
  if (s.latitude == null || s.longitude == null || !s.venueName?.trim()) errs.push('events.err.venue');
  if (s.url && !/^https?:\/\/\S+\.\S+/i.test(s.url.trim())) errs.push('events.err.url');
  return errs;
}

// ---------- filters and grouping ----------

export type EventFilter = 'all' | 'weekend' | EventCategory;

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

const endOf = (e: RideEvent) => new Date(e.ends_at ?? new Date(new Date(e.starts_at).getTime() + 3 * 3_600_000).toISOString());

export function filterEvents(events: RideEvent[], filter: EventFilter, now = new Date()): RideEvent[] {
  const live = events.filter((e) => endOf(e).getTime() > now.getTime());
  if (filter === 'all') return live;
  if (filter === 'weekend') {
    const { start, end } = weekendRange(now);
    return live.filter((e) => new Date(e.starts_at) < end && endOf(e) > start);
  }
  return live.filter((e) => e.category === filter);
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
  return d.toLocaleDateString(lang() === 'es' ? 'es-US' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' });
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
  const loc = lang() === 'es' ? 'es-US' : 'en-US';
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

export const CATEGORY_ICON: Record<EventCategory, string> = {
  bike: 'bicycle',
  music: 'musical-notes',
  community: 'people',
  arts: 'color-palette',
  sports: 'trophy',
  food: 'restaurant',
  family: 'happy',
};
