// Events tab network calls (Supabase table `events`, migration 0007). Logic lives in events.ts.

import { EVENTS_DAYS_AHEAD, type EventSubmission, type RideEvent } from './events';
import { t } from './i18n';
import { supabase } from './supabase';

const COLUMNS =
  'id,source,category,title,description,starts_at,ends_at,venue_name,address,latitude,longitude,url,image_url,featured';

export async function fetchEvents(now = new Date()): Promise<RideEvent[]> {
  if (!supabase) return [];
  const until = new Date(now.getTime() + EVENTS_DAYS_AHEAD * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('events')
    .select(COLUMNS)
    .eq('status', 'approved')
    .lte('starts_at', until)
    .order('starts_at', { ascending: true })
    .limit(400);
  if (error) throw new Error(error.message);
  return (data ?? []) as RideEvent[];
}

/** Sends an event for review. Throws with a readable message on failure. */
export async function submitEvent(s: EventSubmission): Promise<void> {
  if (!supabase) throw new Error(t('events.err.offline'));
  const { error } = await supabase.from('events').insert({
    source: 'partner',
    status: 'pending',
    category: s.category,
    title: s.title.trim().slice(0, 120),
    description: s.description?.trim().slice(0, 1000) || null,
    starts_at: s.startsAt.toISOString(),
    ends_at: s.endsAt?.toISOString() ?? null,
    venue_name: s.venueName.trim().slice(0, 120),
    address: s.address?.trim().slice(0, 200) || null,
    latitude: s.latitude,
    longitude: s.longitude,
    url: s.url?.trim() || null,
    contact_email: s.contactEmail?.trim().slice(0, 200) || null,
  });
  if (error) throw new Error(/too many/i.test(error.message) ? t('events.err.tooMany') : error.message);
}

