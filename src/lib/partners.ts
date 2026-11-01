// Advertising partners: featured map pins, trail sponsors, and ad reporting.
// Managed in Supabase (Table Editor → partners); sample partners appear only
// in development builds when no real partners are live yet.

import { cached } from './cache';
import { supabase } from './supabase';

export type PartnerTier = 'featured' | 'trail' | 'corridor';

export interface Partner {
  id: string;
  name: string;
  tier: PartnerTier;
  category: string;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  blurb: string | null;
  offer: string | null;
  color: string | null;
  logo_url: string | null;
  photo_url: string | null;
  sponsored_trail: string | null;
  osm_place_id: string | null;
  /** Opening hours in OpenStreetMap format, e.g. "Mo-Fr 10:00-18:00; Sa 10:00-16:00" (migration 0005). */
  hours?: string | null;
  /** Trail Partner tier: the trail this business is on, e.g. "Capital City State Trail" (migration 0005). */
  trail_name?: string | null;
  /** Code shown on the offer pass, if any (migration 0005). */
  offer_code?: string | null;
  /** Sample data for demos; never recorded or shipped. */
  demo?: boolean;
}

const BASE_COLUMNS =
  'id,name,tier,category,latitude,longitude,address,phone,website,blurb,offer,color,logo_url,photo_url,sponsored_trail,osm_place_id';
/** Added in 0005_partners_v1.sql; the app falls back to BASE_COLUMNS until that migration runs. */
const COLUMNS = `${BASE_COLUMNS},hours,trail_name,offer_code`;

export const CATEGORY_LABEL: Record<string, string> = {
  shop: 'Bike shop',
  food: 'Eat',
  drink: 'Drink',
  lodging: 'Lodging',
  service: 'Service',
  other: 'Local business',
};

/** Fictional businesses for showing shop owners what a placement looks like. */
export const DEMO_PARTNERS: Partner[] = [
  {
    id: 'demo-shop',
    name: 'Isthmus Bike Works',
    tier: 'trail',
    category: 'shop',
    latitude: 43.0789,
    longitude: -89.3714,
    address: 'Williamson St, Madison (sample)',
    phone: null,
    website: null,
    blurb: 'Full-service shop on the Capital City Trail. E-bike service, rentals and same-day flat fixes.',
    offer: '10% off any tune-up for Ride Madison riders. Show this screen.',
    color: '#7c3aed',
    logo_url: null,
    photo_url: null,
    sponsored_trail: null,
    osm_place_id: null,
    hours: 'Tu-Fr 10:00-18:00; Sa 10:00-16:00; Su,Mo off',
    trail_name: 'Capital City State Trail',
    offer_code: 'RIDEMAD10',
    demo: true,
  },
  {
    id: 'demo-cafe',
    name: 'Lakeside Coffee',
    tier: 'corridor',
    category: 'food',
    latitude: 43.0598,
    longitude: -89.3902,
    address: 'Near John Nolen Dr path (sample)',
    phone: null,
    website: null,
    blurb: 'Coffee and pastries steps from the trail, with bike racks out front.',
    offer: 'Free drip coffee with any pastry when you ride in.',
    color: '#b45309',
    logo_url: null,
    photo_url: null,
    sponsored_trail: 'Capital City State Trail',
    osm_place_id: null,
    hours: 'Mo-Fr 06:30-17:00; Sa,Su 07:00-17:00',
    trail_name: null,
    offer_code: null,
    demo: true,
  },
];

export async function fetchPartners(force = false): Promise<Partner[]> {
  let live: Partner[] = [];
  if (supabase) {
    try {
      const r = await cached('partners:v1', 60 * 60 * 1000, async () => {
        let { data, error } = await supabase!.from('partners').select(COLUMNS);
        // Before 0005_partners_v1.sql runs the new columns don't exist yet: use the original ones.
        if (error) ({ data, error } = await supabase!.from('partners').select(BASE_COLUMNS));
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as Partner[];
      }, { force });
      live = r.value;
    } catch {
      live = []; // table not set up yet or offline with no saved copy
    }
  }
  if (live.length === 0 && __DEV__) return DEMO_PARTNERS;
  return live;
}

export { isPartnerPlace, PARTNER_LAYER, partnersOnTrail, partnersToPin } from './partner-geo';

/** Corridor sponsor for a trail, matched by trail name. */
export function sponsorForTrail(partners: Partner[], trailName?: string): Partner | undefined {
  if (!trailName) return undefined;
  const n = trailName.trim().toLowerCase();
  return partners.find((p) => p.tier === 'corridor' && p.sponsored_trail?.trim().toLowerCase() === n);
}

export function initials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9À-ÿ ]/g, '').split(/\s+/).filter(Boolean);
  return (words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}

export type PartnerEvent = 'impression' | 'open' | 'call' | 'website' | 'directions' | 'route' | 'offer';

/** Fire-and-forget ad reporting (skipped for sample partners). */
export function trackPartner(p: Partner, event: PartnerEvent, placement: 'pin' | 'trail_sponsor' | 'card') {
  if (p.demo || !supabase) return;
  void supabase
    .from('partner_events')
    .insert({ partner_id: p.id, event, placement })
    .then(() => {}, () => {});
}
