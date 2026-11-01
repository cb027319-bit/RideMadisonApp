// Ride stats and badges (gamification). Pure functions over the rider's ride
// log so they can be unit-tested and computed anywhere.

import { SUGGESTED_RIDES } from './suggested';

const MI = 1609.344;
const FT = 0.3048;
/** Average US passenger car, EPA: about 400 g CO2 per mile. */
const CO2_KG_PER_MILE = 0.4;

/** One recorded ride. Distances in meters, times in seconds. */
export interface RideLog {
  id: string;
  startedAt: number; // epoch ms
  distanceM: number;
  movingS: number;
  elapsedS: number;
  climbM: number;
  maxSpeedMps: number;
  title: string;
  /** Suggested ride id when the ride was one of ours. */
  rideId?: string | null;
}

export interface RideStats {
  rides: number;
  miles: number;
  movingS: number;
  avgMph: number;
  topMph: number;
  longestMiles: number;
  climbFt: number;
  co2Kg: number;
  milesThisWeek: number;
  milesThisMonth: number;
  weekStreak: number;
  suggestedDone: number;
}

/** Monday 00:00 local time of the week containing `t`. */
export function weekStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d.getTime();
}

/** Consecutive weeks (ending this week or last week) with at least one ride. */
export function weekStreak(logs: RideLog[], now = Date.now()): number {
  const weeks = new Set(logs.map((l) => weekStart(l.startedAt)));
  let cursor = weekStart(now);
  // A ride this week isn't required yet: the streak survives until the week ends.
  if (!weeks.has(cursor)) cursor = weekStart(cursor - 3 * 86400000);
  let n = 0;
  while (weeks.has(cursor)) {
    n++;
    cursor = weekStart(cursor - 3 * 86400000);
  }
  return n;
}

const SUGGESTED_NAMES = new Map(SUGGESTED_RIDES.map((r) => [r.name.toLowerCase(), r.id]));

function suggestedIdOf(l: RideLog): string | null {
  return l.rideId ?? SUGGESTED_NAMES.get(l.title.toLowerCase()) ?? null;
}

export function summarize(logs: RideLog[], now = Date.now()): RideStats {
  const distance = logs.reduce((s, l) => s + l.distanceM, 0);
  const moving = logs.reduce((s, l) => s + l.movingS, 0);
  const wk = weekStart(now);
  const month = new Date(now);
  month.setDate(1);
  month.setHours(0, 0, 0, 0);
  const miles = distance / MI;
  return {
    rides: logs.length,
    miles,
    movingS: moving,
    avgMph: moving > 0 ? miles / (moving / 3600) : 0,
    topMph: logs.reduce((m, l) => Math.max(m, l.maxSpeedMps), 0) * 2.236936,
    longestMiles: logs.reduce((m, l) => Math.max(m, l.distanceM), 0) / MI,
    climbFt: logs.reduce((s, l) => s + l.climbM, 0) / FT,
    co2Kg: miles * CO2_KG_PER_MILE,
    milesThisWeek: logs.filter((l) => l.startedAt >= wk).reduce((s, l) => s + l.distanceM, 0) / MI,
    milesThisMonth: logs.filter((l) => l.startedAt >= month.getTime()).reduce((s, l) => s + l.distanceM, 0) / MI,
    weekStreak: weekStreak(logs, now),
    suggestedDone: new Set(logs.map(suggestedIdOf).filter(Boolean)).size,
  };
}

export type BadgeIcon =
  | 'flag' | 'bicycle' | 'trophy' | 'ribbon' | 'medal' | 'trending-up' | 'sunny' | 'moon'
  | 'flame' | 'map' | 'leaf' | 'speedometer' | 'water' | 'star';

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: BadgeIcon;
  /** Progress 0–1 toward earning it. 1 = earned. */
  progress: (s: RideStats, logs: RideLog[]) => number;
}

const ratio = (v: number, goal: number) => Math.max(0, Math.min(1, v / goal));
const hourOf = (t: number) => new Date(t).getHours();
const longest = (logs: RideLog[]) => logs.reduce((m, l) => Math.max(m, l.distanceM), 0) / MI;
const didRide = (logs: RideLog[], id: string) => logs.some((l) => suggestedIdOf(l) === id);

export const BADGES: Badge[] = [
  { id: 'first-ride', name: 'First Ride', description: 'Finish your first ride with Ride Madison', icon: 'flag', progress: (s) => ratio(s.rides, 1) },
  { id: 'ten-rides', name: 'Regular', description: 'Finish 10 rides', icon: 'bicycle', progress: (s) => ratio(s.rides, 10) },
  { id: 'fifty-rides', name: 'Habit Formed', description: 'Finish 50 rides', icon: 'star', progress: (s) => ratio(s.rides, 50) },
  { id: 'miles-25', name: '25 Miles', description: 'Ride 25 miles in total', icon: 'ribbon', progress: (s) => ratio(s.miles, 25) },
  { id: 'miles-100', name: 'Century Club', description: 'Ride 100 miles in total', icon: 'medal', progress: (s) => ratio(s.miles, 100) },
  { id: 'miles-500', name: '500 Miles', description: 'Ride 500 miles in total', icon: 'trophy', progress: (s) => ratio(s.miles, 500) },
  { id: 'ride-10', name: 'Double Digits', description: 'Ride 10 miles in one go', icon: 'speedometer', progress: (_s, l) => ratio(longest(l), 10) },
  { id: 'ride-25', name: 'Long Haul', description: 'Ride 25 miles in one go', icon: 'trending-up', progress: (_s, l) => ratio(longest(l), 25) },
  { id: 'climb-1000', name: 'Hill Seeker', description: 'Climb 1,000 ft in total', icon: 'trending-up', progress: (s) => ratio(s.climbFt, 1000) },
  { id: 'streak-4', name: 'Four-Week Streak', description: 'Ride at least once a week for 4 weeks in a row', icon: 'flame', progress: (s) => ratio(s.weekStreak, 4) },
  { id: 'early-bird', name: 'Early Bird', description: 'Start a ride before 7 am', icon: 'sunny', progress: (_s, l) => (l.some((x) => hourOf(x.startedAt) < 7 && hourOf(x.startedAt) >= 4) ? 1 : 0) },
  { id: 'night-owl', name: 'Night Owl', description: 'Start a ride after 8 pm', icon: 'moon', progress: (_s, l) => (l.some((x) => hourOf(x.startedAt) >= 20) ? 1 : 0) },
  { id: 'monona', name: 'Lake Monona Loop', description: 'Ride the Lake Monona Loop', icon: 'water', progress: (_s, l) => (didRide(l, 'monona-loop') ? 1 : 0) },
  { id: 'explorer', name: 'Explorer', description: 'Ride 5 different suggested rides', icon: 'map', progress: (s) => ratio(s.suggestedDone, 5) },
  { id: 'green-50', name: 'Car-Free Champ', description: 'Save about 20 kg of CO2 (50 miles not driven)', icon: 'leaf', progress: (s) => ratio(s.miles, 50) },
];

export function badgeProgress(logs: RideLog[], now = Date.now()) {
  const s = summarize(logs, now);
  return BADGES.map((b) => ({ ...b, value: b.progress(s, logs), earned: b.progress(s, logs) >= 1 }));
}

/** Badges earned by `after` that weren't earned by `before` (for the "New badge!" moment). */
export function newlyEarned(before: RideLog[], after: RideLog[], now = Date.now()): Badge[] {
  const had = new Set(badgeProgress(before, now).filter((b) => b.earned).map((b) => b.id));
  return badgeProgress(after, now).filter((b) => b.earned && !had.has(b.id));
}

// ---------- Recording ----------

/** Accumulates distance, moving time and top speed from GPS fixes. */
export interface Recorder {
  distanceM: number;
  movingS: number;
  maxSpeedMps: number;
  last: { lat: number; lon: number; t: number } | null;
}

export const newRecorder = (): Recorder => ({ distanceM: 0, movingS: 0, maxSpeedMps: 0, last: null });

function meters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Add a GPS fix. Ignores jumps (GPS glitches) and counts time only while moving. */
export function addFix(r: Recorder, lat: number, lon: number, t: number, gpsSpeed: number | null): Recorder {
  const here = { lat, lon, t };
  if (!r.last) return { ...r, last: here };
  const dt = (t - r.last.t) / 1000;
  if (dt <= 0) return r;
  const d = meters(r.last, here);
  const speed = d / dt;
  // > 22 m/s (~50 mph) is not a bike: treat as a glitch and re-anchor.
  if (speed > 22) return { ...r, last: here };
  const moving = speed > 0.8 && dt < 30;
  const top = gpsSpeed != null && gpsSpeed >= 0 && gpsSpeed < 22 ? gpsSpeed : speed;
  return {
    distanceM: r.distanceM + (dt < 30 ? d : 0),
    movingS: r.movingS + (moving ? dt : 0),
    maxSpeedMps: moving ? Math.max(r.maxSpeedMps, top) : r.maxSpeedMps,
    last: here,
  };
}

/** Rides shorter than this aren't logged (a quick test or a false start). */
export const MIN_LOG_M = 300;
