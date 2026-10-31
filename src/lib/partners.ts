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
  /** Sample data for demos; never recorded or shipped. */
  demo?: boolean;
}

const COLUMNS =
  'id,name,tier,category,latitude,longitude,address,phone,website,blurb,offer,color,logo_url,photo_url,sponsored_trail,osm_place_id';

export const CATEGORY_LABEL: Record<string, string> = {
  shop: 'Bike shop',
  food: 'Food',
  drink: 'Drinks',
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
    demo: true,
  },
];

export async function fetchPartners(force = false): Promise<Partner[]> {
  let live: Partner[] = [];
  if (supabase) {
    const r = await cached('partners:v1', 60 * 60 * 1000, async () => {
      const { data, error } = await supabase!.from('partners').select(COLUMNS);
      if (error) throw new Error(error.message);
      return (data ?? []) as Partner[];
    }, { force });
    live = r.value;
  }
  if (live.length === 0 && __DEV__) return DEMO_PARTNERS;
  return live;
}

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

export type PartnerEvent = 'impression' | 'open' | 'call' | 'website' | 'directions' | 'route';

/** Fire-and-forget ad reporting (skipped for sample partners). */
export function trackPartner(p: Partner, event: PartnerEvent, placement: 'pin' | 'trail_sponsor' | 'card') {
  if (p.demo || !supabase) return;
  void supabase
    .from('partner_events')
    .insert({ partner_id: p.id, event, placement })
    .then(() => {}, () => {});
}
