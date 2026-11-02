// Events tab network calls (Supabase table `events`, migrations 0007 and 0010). Logic lives in events.ts.

import {
  EVENTS_DAYS_AHEAD, submissionRows, submitErrorKey, type EventSubmission, type MySubmission, type RideEvent,
} from './events';
import { supabase } from './supabase';

const BASE_COLUMNS =
  'id,source,category,title,description,starts_at,ends_at,venue_name,address,latitude,longitude,url,image_url,featured,partner_id';
/** Added in 0010_events_v2.sql; the app falls back to BASE_COLUMNS until that migration runs. */
const COLUMNS = `${BASE_COLUMNS},price_min,price_max,is_free,extra_categories,series_id`;

export async function fetchEvents(now = new Date()): Promise<RideEvent[]> {
  if (!supabase) return [];
  const until = new Date(now.getTime() + EVENTS_DAYS_AHEAD * 86_400_000).toISOString();
  const query = (columns: string) =>
    supabase!
      .from('events')
      .select(columns)
      .eq('status', 'approved')
      .lte('starts_at', until)
      .order('starts_at', { ascending: true })
      .limit(400);
  let { data, error } = await query(COLUMNS);
  if (error) ({ data, error } = await query(BASE_COLUMNS));
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RideEvent[]).map((e) => ({
    ...e,
    // numeric columns can arrive as strings
    price_min: e.price_min == null ? null : Number(e.price_min),
    price_max: e.price_max == null ? null : Number(e.price_max),
    extra_categories: e.extra_categories ?? [],
  }));
}

/**
 * Sends an event (or every date of a weekly series, in one request) for review.
 * Throws an Error whose message is an i18n key (events.err.*); never raw server text.
 */
export async function submitEvent(s: EventSubmission): Promise<void> {
  if (!supabase) throw new Error('events.err.offline');
  let error: { message: string } | null = null;
  try {
    ({ error } = await supabase.from('events').insert(submissionRows(s)));
  } catch (e) {
    throw new Error(submitErrorKey(e instanceof Error ? e.message : String(e)));
  }
  if (error) throw new Error(submitErrorKey(error.message));
}

/** The signed-in rider's own submissions, newest first (any status). */
export async function fetchMySubmissions(): Promise<MySubmission[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('my_event_submissions');
  if (error) throw new Error(error.message);
  return (data ?? []) as MySubmission[];
}

/** Withdraws one of the rider's submissions (or its whole weekly series). Returns rows removed. */
export async function withdrawEvent(id: string, wholeSeries: boolean): Promise<number> {
  if (!supabase) throw new Error('events.err.offline');
  const { data, error } = await supabase.rpc('withdraw_event', { p_id: id, p_whole_series: wholeSeries });
  if (error) throw new Error(error.message);
  return typeof data === 'number' ? data : 0;
}
