import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { COLORS } from '@/lib/config';
import type { Selection } from '@/lib/data';
import { distanceMeters, formatDistance } from '@/lib/geo';
import { PATH_META, PLACE_META, timeAgo } from '@/lib/labels';
import { callPhone, openBikeDirections, openWebsite } from '@/lib/links';
import type { ParkTrail } from '@/lib/parks';
import { CATEGORY_LABEL, initials, trackPartner, type Partner } from '@/lib/partners';
import { TRAIL_PASS_URL, type Trail } from '@/lib/trails';

interface Props {
  selection: Selection;
  location: { latitude: number; longitude: number } | null;
  /** Point to route to (for trails: the closest point on the trail). */
  target: { latitude: number; longitude: number };
  isEbikeRider?: boolean;
  /** Corridor sponsor of the selected trail, if any. */
  sponsor?: Partner;
  onOpenPartner?: (p: Partner) => void;
  /** Trails inside the selected state park. */
  parkTrails?: { state: 'loading' | 'ready' | 'error'; trails: ParkTrail[] };
  onRetryParkTrails?: () => void;
  onClose: () => void;
  onRouteHere: (label: string) => void;
}

export function DetailCard({
  selection, location, target, isEbikeRider, sponsor, onOpenPartner, parkTrails, onRetryParkTrails, onClose, onRouteHere,
}: Props) {
  const dist = location
    ? formatDistance(distanceMeters(location.latitude, location.longitude, target.latitude, target.longitude))
    : null;
  const name = title(selection);
  const partner = selection.type === 'partner' ? selection.item : undefined;

  // Ad reporting: a partner card opened, or a sponsor line shown on a trail.
  useEffect(() => {
    if (partner) trackPartner(partner, 'open', 'card');
  }, [partner?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (sponsor && selection.type === 'trail') trackPartner(sponsor, 'impression', 'trail_sponsor');
  }, [sponsor?.id, selection.type === 'trail' ? selection.item.id : null]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{kicker(selection)}{dist ? `  ·  ${dist} away` : ''}</Text>
          <Text style={styles.title} numberOfLines={2}>{name}</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close details">
          <Ionicons name="close-circle" size={28} color={COLORS.muted} />
        </Pressable>
      </View>

      {sponsor && selection.type === 'trail' && (
        <Pressable
          style={styles.sponsor}
          onPress={() => onOpenPartner?.(sponsor)}
          accessibilityRole="button"
          accessibilityLabel={`Presented by ${sponsor.name}`}>
          <PartnerMark partner={sponsor} size={30} />
          <View style={{ flex: 1 }}>
            <Text style={styles.sponsorLabel}>PRESENTED BY</Text>
            <Text style={styles.sponsorName} numberOfLines={1}>{sponsor.name}{sponsor.demo ? ' (sample)' : ''}</Text>
            {sponsor.offer ? <Text style={styles.sponsorOffer} numberOfLines={2}>{sponsor.offer}</Text> : null}
          </View>
          <Ionicons name="chevron-forward" size={18} color="#92400e" />
        </Pressable>
      )}

      <ScrollView style={{ maxHeight: 260 }} bounces={false}>
        {selection.type === 'park' ? (
          <ParkBody website={selection.item.website} trails={parkTrails} onRetry={onRetryParkTrails} />
        ) : (
          <Body selection={selection} isEbikeRider={isEbikeRider} />
        )}
      </ScrollView>

      <View style={styles.actions}>
        <Action
          icon="navigate"
          label={selection.type === 'trail' ? 'Route to trail' : 'Route here'}
          primary
          onPress={() => {
            if (partner) trackPartner(partner, 'route', 'card');
            onRouteHere(name);
          }}
        />
        {selection.type === 'trail' && selection.item.rules && (
          <Action icon="ticket-outline" label="Trail pass" onPress={() => void Linking.openURL(TRAIL_PASS_URL)} />
        )}
        {selection.type === 'park' && selection.item.website && (
          <Action icon="globe-outline" label="Park info" onPress={() => openWebsite(selection.item.website!)} />
        )}
        {selection.type === 'station' && (
          <Action icon="flash-outline" label="BCycle app" onPress={() => void Linking.openURL('https://madison.bcycle.com')} />
        )}
        {(selection.type === 'place' || selection.type === 'partner') && selection.item.phone && (
          <Action
            icon="call"
            label="Call"
            onPress={() => {
              if (partner) trackPartner(partner, 'call', 'card');
              callPhone(selection.item.phone!);
            }}
          />
        )}
        {(selection.type === 'place' || selection.type === 'partner') && selection.item.website && (
          <Action
            icon="globe-outline"
            label="Website"
            onPress={() => {
              if (partner) trackPartner(partner, 'website', 'card');
              openWebsite(selection.item.website!);
            }}
          />
        )}
        {selection.type !== 'trail' && (
          <Action
            icon="logo-google"
            label="Google Maps"
            onPress={() => {
              if (partner) trackPartner(partner, 'directions', 'card');
              openBikeDirections(target.latitude, target.longitude);
            }}
          />
        )}
      </View>
    </View>
  );
}

function Body({ selection, isEbikeRider }: { selection: Selection; isEbikeRider?: boolean }) {
  if (selection.type === 'trail') return <TrailBody trail={selection.item} isEbikeRider={isEbikeRider} />;
  if (selection.type === 'partner') return <PartnerBody partner={selection.item} />;
  if (selection.type === 'park') return null; // rendered by ParkBody
  if (selection.type === 'station') {
    const s = selection.item;
    return (
      <View>
        <View style={styles.counts}>
          <Count value={s.bikes} label={s.ebikes != null && s.ebikes === s.bikes ? 'e-bikes' : 'bikes'} color={COLORS.bcycle} />
          <Count value={s.docks} label="open docks" color={COLORS.text} />
        </View>
        {!s.renting && <Text style={styles.warn}>Not renting right now</Text>}
        {!s.returning && <Text style={styles.warn}>Not accepting returns right now</Text>}
        {s.address ? <Text style={styles.line}>{s.address}</Text> : null}
        <Text style={styles.source}>
          Live from Madison BCycle{s.lastReported ? ` · station reported ${timeAgo(s.lastReported * 1000)}` : ''}
        </Text>
      </View>
    );
  }
  const p = selection.item;
  return (
    <View>
      {p.address ? <Text style={styles.line}>{p.address}</Text> : null}
      {p.hours ? <Text style={styles.line}>Hours: {p.hours}</Text> : null}
      {p.details.length > 0 && <Text style={styles.line}>{p.details.join('  ·  ')}</Text>}
      <Text style={styles.source}>Source: OpenStreetMap · confirm hours before you go</Text>
    </View>
  );
}

function ParkBody({ trails, onRetry }: {
  website?: string; trails?: Props['parkTrails']; onRetry?: () => void;
}) {
  const bikeCount = trails?.trails.filter((t) => t.access === 'bike').length ?? 0;
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.rules}>
        <Text style={styles.rulesTitle}>Good to know</Text>
        <Rule icon="car-outline" text="Cars stopping in Wisconsin state parks need a vehicle admission pass." />
        <Rule icon="ticket-outline" text="Biking some park trails needs a state trail pass (age 16+, $5/day or $25/year). Check signs at the trailhead." />
      </View>

      <Text style={styles.sectionTitle}>
        Trails in this park
        {trails?.state === 'ready' ? `  ·  ${trails.trails.length} mapped${bikeCount ? `, ${bikeCount} open to bikes` : ''}` : ''}
      </Text>
      {(!trails || trails.state === 'loading') && <Text style={styles.muted}>Loading trails…</Text>}
      {trails?.state === 'error' && (
        <Pressable onPress={onRetry}>
          <Text style={styles.warn}>Couldn&apos;t load trails. Tap to retry.</Text>
        </Pressable>
      )}
      {trails?.state === 'ready' && trails.trails.length === 0 && (
        <Text style={styles.muted}>No named trails are mapped here yet.</Text>
      )}
      {trails?.state === 'ready' &&
        trails.trails.map((t) => (
          <View key={t.name} style={styles.parkTrail}>
            <Ionicons
              name={t.access === 'bike' ? 'bicycle' : t.access === 'no_bike' ? 'walk' : 'help-circle-outline'}
              size={18}
              color={t.access === 'bike' ? '#15803d' : t.access === 'no_bike' ? '#a16207' : COLORS.muted}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.parkTrailName} numberOfLines={1}>{t.name}</Text>
              <Text style={styles.muted}>
                {formatDistance(t.lengthM)}
                {'  ·  '}
                {t.access === 'bike' ? (t.mtb ? 'Mountain bike' : 'Bikes OK') : t.access === 'no_bike' ? 'Hiking only' : 'Check signs for bikes'}
                {t.surface ? `  ·  ${t.surface.replace(/_/g, ' ')}` : ''}
              </Text>
            </View>
          </View>
        ))}
      <Text style={styles.source}>Map data: OpenStreetMap contributors · park rules: WI DNR</Text>
    </View>
  );
}

function PartnerBody({ partner }: { partner: Partner }) {
  return (
    <View style={{ gap: 8 }}>
      {partner.photo_url ? (
        <Image source={{ uri: partner.photo_url }} style={styles.photo} contentFit="cover" accessibilityIgnoresInvertColors />
      ) : null}
      <View style={styles.partnerBadge}>
        <Ionicons name="ribbon" size={13} color="#92400e" />
        <Text style={styles.partnerBadgeText}>Ride Madison partner{partner.demo ? ' · sample' : ''}</Text>
      </View>
      {partner.blurb ? <Text style={styles.line}>{partner.blurb}</Text> : null}
      {partner.offer ? (
        <View style={styles.offer}>
          <Text style={styles.offerLabel}>RIDER OFFER</Text>
          <Text style={styles.offerText}>{partner.offer}</Text>
        </View>
      ) : null}
      {partner.address ? <Text style={styles.muted}>{partner.address}</Text> : null}
      <Text style={styles.source}>Sponsored listing</Text>
    </View>
  );
}

/** Round brand mark: logo if provided, otherwise initials on the brand color. */
export function PartnerMark({ partner, size }: { partner: Partner; size: number }) {
  const r = size / 2;
  if (partner.logo_url) {
    return <Image source={{ uri: partner.logo_url }} style={{ width: size, height: size, borderRadius: r }} contentFit="cover" />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: r, backgroundColor: partner.color ?? COLORS.brand, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.38 }}>{initials(partner.name)}</Text>
    </View>
  );
}

function TrailBody({ trail, isEbikeRider }: { trail: Trail; isEbikeRider?: boolean }) {
  const paved = trail.unpavedShare < 0.1;
  const unpaved = trail.unpavedShare > 0.9;
  const surfaceText = paved ? 'Paved' : unpaved ? 'Unpaved (gravel/crushed stone)' : `Mixed, ${Math.round(trail.unpavedShare * 100)}% unpaved`;
  const r = trail.rules;
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.stats}>
        <Stat label="Length mapped" value={formatDistance(trail.lengthM)} />
        <Stat label="Surface" value={surfaceText} />
      </View>
      {trail.surface ? <Text style={styles.muted}>Mostly {trail.surface.replace(/_/g, ' ')}</Text> : null}

      {trail.kind !== 'lane' && (
        <View style={styles.rules} accessibilityLabel="Can I ride here?">
          <Text style={styles.rulesTitle}>Can I ride here?</Text>
          {r ? (
            <>
              <Rule icon="ticket-outline" text={r.pass} highlight />
              <Rule icon="flash-outline" text={r.ebikes} highlight={isEbikeRider} />
              <Pressable onPress={() => void Linking.openURL(r.url)}>
                <Text style={styles.link}>Rules from {r.manager} · checked Oct 2026</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Rule icon="checkmark-circle-outline" text="No trail pass needed as far as we know." />
              <Rule icon="flash-outline" text="E-bikes: follow posted signs; some county and city paths limit classes or speed." highlight={isEbikeRider} />
            </>
          )}
        </View>
      )}
      {trail.kind === 'lane' && <Text style={styles.line}>On-street bike lane. Ride with traffic.</Text>}
      <Text style={styles.source}>Map data: OpenStreetMap contributors</Text>
    </View>
  );
}

function Rule({ icon, text, highlight }: { icon: keyof typeof Ionicons.glyphMap; text: string; highlight?: boolean }) {
  return (
    <View style={styles.rule}>
      <Ionicons name={icon} size={16} color={highlight ? '#b45309' : COLORS.muted} style={{ marginTop: 1 }} />
      <Text style={[styles.ruleText, highlight && { color: COLORS.text, fontWeight: '600' }]}>{text}</Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function Count({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View>
      <Text style={[styles.countValue, { color }]}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

function Action({ icon, label, onPress, primary }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.action, primary && styles.actionPrimary, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={16} color={primary ? '#fff' : COLORS.brand} />
      <Text style={[styles.actionText, primary && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

/** Where a selection sits on the map (for trails, the middle of the longest piece). */
export function selectionCenter(s: Selection, pathCoords?: [number, number][]): { latitude: number; longitude: number } {
  if (s.type === 'partner') {
    return { latitude: s.item.latitude ?? 43.0731, longitude: s.item.longitude ?? -89.3844 };
  }
  if (s.type === 'park') return { latitude: s.item.lat, longitude: s.item.lon };
  if (s.type === 'trail') {
    if (pathCoords?.length) {
      const c = pathCoords[Math.floor(pathCoords.length / 2)];
      return { latitude: c[1], longitude: c[0] };
    }
    const b = s.item.bbox;
    return { latitude: (b.minLat + b.maxLat) / 2, longitude: (b.minLon + b.maxLon) / 2 };
  }
  return { latitude: s.item.lat, longitude: s.item.lon };
}

function kicker(s: Selection): string {
  if (s.type === 'station') return 'BCycle station';
  if (s.type === 'partner') return CATEGORY_LABEL[s.item.category] ?? 'Local business';
  if (s.type === 'park') return /recreation area/i.test(s.item.name) ? 'State recreation area' : 'Wisconsin state park';
  if (s.type === 'place') return PLACE_META[s.item.kind].label;
  return s.item.kind === 'lane' ? 'Bike lane' : PATH_META[s.item.kind].label;
}

function title(s: Selection): string {
  if (s.type === 'station') return s.item.name;
  if (s.type === 'partner') return s.item.name;
  if (s.type === 'park') return s.item.name;
  if (s.type === 'place') return s.item.name ?? PLACE_META[s.item.kind].fallbackName;
  return s.item.name ?? (s.item.kind === 'lane' ? 'Bike lane' : 'Unnamed path');
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.bg,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  kicker: { fontSize: 12, fontWeight: '600', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { fontSize: 19, fontWeight: '700', color: COLORS.text, marginTop: 2 },
  line: { fontSize: 15, color: COLORS.text, marginTop: 2 },
  muted: { fontSize: 13, color: COLORS.muted },
  source: { fontSize: 11, color: COLORS.muted, marginTop: 6 },
  warn: { fontSize: 14, color: '#b91c1c', fontWeight: '600', marginTop: 2 },
  counts: { flexDirection: 'row', gap: 24, marginVertical: 4 },
  countValue: { fontSize: 30, fontWeight: '800' },
  countLabel: { fontSize: 13, color: COLORS.muted },
  stats: { flexDirection: 'row', gap: 12 },
  statLabel: { fontSize: 12, color: COLORS.muted },
  statValue: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginTop: 2 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: COLORS.text, marginTop: 4 },
  parkTrail: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  parkTrailName: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  sponsor: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fffbeb', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#fde68a',
  },
  sponsorLabel: { fontSize: 10, fontWeight: '800', color: '#92400e', letterSpacing: 0.6 },
  sponsorName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  sponsorOffer: { fontSize: 13, color: COLORS.text, marginTop: 1 },
  photo: { width: '100%', height: 140, borderRadius: 12, backgroundColor: '#f3f4f6' },
  partnerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: '#fef3c7',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  partnerBadgeText: { fontSize: 12, fontWeight: '700', color: '#92400e' },
  offer: { backgroundColor: '#ecfdf5', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#a7f3d0' },
  offerLabel: { fontSize: 10, fontWeight: '800', color: '#047857', letterSpacing: 0.6 },
  offerText: { fontSize: 15, fontWeight: '600', color: COLORS.text, marginTop: 2 },
  rules: { backgroundColor: '#fffbeb', borderRadius: 12, padding: 12, gap: 6, marginTop: 4 },
  rulesTitle: { fontSize: 14, fontWeight: '800', color: '#92400e' },
  rule: { flexDirection: 'row', gap: 8 },
  ruleText: { flex: 1, fontSize: 14, color: COLORS.text, lineHeight: 19 },
  link: { fontSize: 12, color: COLORS.brand, textDecorationLine: 'underline', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.brand,
  },
  actionPrimary: { backgroundColor: COLORS.brand },
  actionText: { fontSize: 14, fontWeight: '600', color: COLORS.brand },
});
