// Ticketmaster Discovery API → rows for the `events` table. Pure (no Deno/Node APIs) so it's unit-tested.

export interface TmVenue {
  name?: string;
  address?: { line1?: string };
  city?: { name?: string };
  state?: { stateCode?: string };
  location?: { latitude?: string; longitude?: string };
}

export interface TmEvent {
  id: string;
  name: string;
  url?: string;
  info?: string;
  dates?: {
    start?: { localDate?: string; localTime?: string; dateTime?: string; dateTBD?: boolean; dateTBA?: boolean; noSpecificTime?: boolean };
    status?: { code?: string };
  };
  classifications?: { segment?: { name?: string }; genre?: { name?: string } }[];
  images?: { url: string; width?: number; ratio?: string }[];
  _embedded?: { venues?: TmVenue[] };
}

export interface EventRow {
  source: 'ticketmaster';
  source_id: string;
  status: 'approved' | 'rejected';
  category: 'music' | 'sports' | 'arts' | 'family' | 'community';
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
}

/** "GMT-5" → -300. Madison is on Central time. */
export function chicagoOffsetMinutes(at: Date): number {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', timeZoneName: 'shortOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = part?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return -360;
  const mins = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '-' ? -mins : mins;
}

/** Local Madison date + time → UTC ISO string. */
export function chicagoToUtc(localDate: string, localTime = '00:00:00'): string {
  const [y, mo, d] = localDate.split('-').map(Number);
  const [h, mi, s] = localTime.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  const offset = chicagoOffsetMinutes(new Date(guess));
  return new Date(guess - offset * 60_000).toISOString();
}

function category(e: TmEvent): EventRow['category'] {
  const c = e.classifications?.[0];
  const seg = c?.segment?.name?.toLowerCase() ?? '';
  const genre = c?.genre?.name?.toLowerCase() ?? '';
  if (seg === 'music') return 'music';
  if (seg === 'sports') return 'sports';
  if (genre.includes('family') || genre.includes('children')) return 'family';
  if (seg.startsWith('arts')) return 'arts';
  return 'community';
}

/** A wide image around 640–1100 px, else the widest one. */
function image(e: TmEvent): string | null {
  const imgs = (e.images ?? []).filter((i) => i.url?.startsWith('https://'));
  if (!imgs.length) return null;
  const wide = imgs.filter((i) => i.ratio === '16_9' && (i.width ?? 0) >= 640 && (i.width ?? 0) <= 1200);
  const pick = (wide.length ? wide : imgs).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  return pick.url;
}

const num = (s?: string) => {
  const n = s == null ? NaN : Number(s);
  return Number.isFinite(n) ? n : null;
};

export function mapTicketmaster(e: TmEvent): EventRow | null {
  const start = e.dates?.start;
  if (!e.id || !e.name || !start?.localDate || start.dateTBD || start.dateTBA) return null;
  const allDay = !start.dateTime && (!start.localTime || start.noSpecificTime);
  const startsAt = start.dateTime ?? chicagoToUtc(start.localDate, start.localTime ?? '00:00:00');
  const endsAt = allDay ? new Date(new Date(startsAt).getTime() + 86_400_000).toISOString() : null;
  const v = e._embedded?.venues?.[0];
  const address = [v?.address?.line1, v?.city?.name, v?.state?.stateCode].filter(Boolean).join(', ') || null;
  return {
    source: 'ticketmaster',
    source_id: e.id,
    status: e.dates?.status?.code === 'cancelled' ? 'rejected' : 'approved',
    category: category(e),
    title: e.name.trim().slice(0, 120),
    description: e.info ? e.info.trim().slice(0, 1000) : null,
    starts_at: startsAt,
    ends_at: endsAt,
    venue_name: v?.name?.trim().slice(0, 120) ?? null,
    address: address ? address.slice(0, 200) : null,
    latitude: num(v?.location?.latitude),
    longitude: num(v?.location?.longitude),
    url: e.url?.startsWith('http') ? e.url : null,
    image_url: image(e),
  };
}
