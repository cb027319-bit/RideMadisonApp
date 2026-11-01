import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { OfferPass } from '@/components/offer-pass';
import {
  BCYCLE_APP_ANDROID, BCYCLE_APP_ANDROID_WEB, BCYCLE_APP_IOS, BCYCLE_PRICING_URL, type BCycleStation,
} from '@/lib/bcycle';
import { BRAND, COLORS, FONT } from '@/lib/config';
import type { Selection } from '@/lib/data';
import { distanceMeters, formatDistance } from '@/lib/geo';
import { openStatus } from '@/lib/hours';
import { PATH_META, PLACE_META, timeAgo } from '@/lib/labels';
import { callPhone, openAppleBikeDirections, openBikeDirections, openWebsite } from '@/lib/links';
import type { ParkTrail } from '@/lib/parks';
import { CATEGORY_LABEL, initials, trackPartner, type Partner } from '@/lib/partners';
import { ebikeRule, TRAIL_PASS_URL, VERDICT_LABEL, verdictFor, type Trail } from '@/lib/trails';

interface Props {
  selection: Selection;
  location: { latitude: number; longitude: number } | null;
  /** Point to route to (for trails: the closest point on the trail). */
  target: { latitude: number; longitude: number };
  isEbikeRider?: boolean;
  /** Rider's e-bike class from onboarding ('1' | '2' | '3'), if known. */
  ebikeClass?: string | null;
  /** Corridor sponsor of the selected trail, if any. */
  sponsor?: Partner;
  /** Trail Partners within 0.5 mi of the selected trail. */
  trailPartners?: { partner: Partner; meters: number }[];
  onOpenPartner?: (p: Partner) => void;
  /** Trails inside the selected state park. */
  parkTrails?: { state: 'loading' | 'ready' | 'error'; trails: ParkTrail[] };
  onRetryParkTrails?: () => void;
  onClose: () => void;
  onRouteHere: (label: string) => void;
}

export function DetailCard({
  selection, location, target, isEbikeRider, ebikeClass, sponsor, trailPartners, onOpenPartner, parkTrails, onRetryParkTrails,
  onClose, onRouteHere,
}: Props) {
  const { height } = useWindowDimensions();
  const dist = location
    ? formatDistance(distanceMeters(location.latitude, location.longitude, target.latitude, target.longitude))
    : null;
  const name = title(selection);
  const partner = selection.type === 'partner' ? selection.item : undefined;
  const trailId = selection.type === 'trail' ? selection.item.id : null;

  // Ad reporting: a partner card opened, or a sponsor line / trail partner shown on a trail.
  useEffect(() => {
    if (partner) trackPartner(partner, 'open', 'card');
  }, [partner?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!trailId) return;
    if (sponsor) trackPartner(sponsor, 'impression', 'trail_sponsor');
    for (const t of trailPartners ?? []) trackPartner(t.partner, 'impression', 'trail_sponsor');
  }, [sponsor?.id, trailId, trailPartners?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const openInMaps = () => {
    if (partner) trackPartner(partner, 'directions', 'card');
    if (Platform.OS === 'ios') openAppleBikeDirections(target.latitude, target.longitude);
    else openBikeDirections(target.latitude, target.longitude);
  };

  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{kicker(selection)}{dist ? `  ·  ${dist} away` : ''}</Text>
          <Text style={styles.title} numberOfLines={2} accessibilityRole="header">{name}</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close details">
          <Ionicons name="close-circle" size={30} color={COLORS.muted} />
        </Pressable>
      </View>

      <ScrollView style={{ maxHeight: Math.max(260, height * 0.5) }} bounces={false}>
        {selection.type === 'park' ? (
          <ParkBody trails={parkTrails} onRetry={onRetryParkTrails} />
        ) : selection.type === 'trail' ? (
          <TrailBody
            trail={selection.item}
            isEbikeRider={isEbikeRider}
            ebikeClass={ebikeClass}
            sponsor={sponsor}
            trailPartners={trailPartners}
            onOpenPartner={onOpenPartner}
          />
        ) : (
          <Body selection={selection} />
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
        {selection.type === 'trail' && verdictFor(selection.item.rules) !== 'free' && (
          <Action icon="ticket-outline" label="Buy a pass (if needed)" onPress={() => void Linking.openURL(TRAIL_PASS_URL)} />
        )}
        {selection.type === 'park' && selection.item.website && (
          <Action icon="globe-outline" label="Park info" onPress={() => openWebsite(selection.item.website!)} />
        )}
        {selection.type === 'station' && <Action icon="bicycle" label="Rent a bike" onPress={openBCycleApp} />}
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
        {selection.type !== 'trail' && <Action icon="map-outline" label="Open in Maps" onPress={openInMaps} />}
      </View>
    </View>
  );
}

/** Open the BCycle app's store page (the app itself handles unlocking). */
function openBCycleApp() {
  if (Platform.OS === 'ios') void Linking.openURL(BCYCLE_APP_IOS);
  else if (Platform.OS === 'android') Linking.openURL(BCYCLE_APP_ANDROID).catch(() => Linking.openURL(BCYCLE_APP_ANDROID_WEB));
  else void Linking.openURL('https://madison.bcycle.com');
}

function OpenChip({ hours }: { hours?: string | null }) {
  const status = openStatus(hours);
  if (!status) return hours ? <Text style={styles.line}>Hours: {hours}</Text> : null;
  return (
    <View style={[styles.openChip, status.open ? styles.openChipOpen : styles.openChipClosed]}>
      <Ionicons name="time-outline" size={15} color={status.open ? '#065f46' : COLORS.text} />
      <Text style={[styles.openText, status.open && { color: '#065f46' }]}>{status.text}</Text>
    </View>
  );
}

function StationBody({ s }: { s: BCycleStation }) {
  const split = s.ebikes != null && s.classic != null && s.ebikes + s.classic === s.bikes;
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.counts}>
        {split ? (
          <>
            <Count value={s.ebikes!} label={s.ebikes === 1 ? 'e-bike' : 'e-bikes'} color={COLORS.bcycle} />
            <Count value={s.classic!} label="classic" color={COLORS.bcycle} />
          </>
        ) : (
          <Count value={s.bikes} label={s.bikes === 1 ? 'bike' : 'bikes'} color={COLORS.bcycle} />
        )}
        <Count value={s.docks} label="open spots to return" color={COLORS.text} />
      </View>
      {!s.renting && <Text style={styles.warn}>Not renting right now</Text>}
      {!s.returning && <Text style={styles.warn}>Not accepting returns right now</Text>}
      {s.address ? <Text style={styles.line}>{s.address}</Text> : null}
      <Text style={styles.help}>Unlock in the BCycle app · return to any station with open docks</Text>
      <Pressable onPress={() => void Linking.openURL(BCYCLE_PRICING_URL)} accessibilityRole="link" hitSlop={8} style={styles.linkRow}>
        <Text style={styles.link}>See BCycle prices</Text>
      </Pressable>
      <Text style={styles.source}>
        Live from Madison BCycle{s.lastReported ? ` · station reported ${timeAgo(s.lastReported * 1000)}` : ''}
      </Text>
    </View>
  );
}

function Body({ selection }: { selection: Selection }) {
  if (selection.type === 'partner') return <PartnerBody partner={selection.item} />;
  if (selection.type === 'station') return <StationBody s={selection.item} />;
  if (selection.type !== 'place') return null;
  const p = selection.item;
  return (
    <View style={{ gap: 4 }}>
      <OpenChip hours={p.hours} />
      {p.details.length > 0 && <Text style={styles.line}>{p.details.join('  ·  ')}</Text>}
      {p.address ? <Text style={styles.line}>{p.address}</Text> : null}
      <Text style={styles.source}>Source: OpenStreetMap{p.hours ? ' · confirm hours before you go' : ''}</Text>
    </View>
  );
}

function ParkBody({ trails, onRetry }: { trails?: Props['parkTrails']; onRetry?: () => void }) {
  const bikeCount = trails?.trails.filter((t) => t.access === 'bike').length ?? 0;
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.rules}>
        <Text style={styles.rulesTitle} accessibilityRole="header">Good to know</Text>
        <Rule icon="car-outline" text="Cars stopping in Wisconsin state parks need a vehicle admission pass." />
        <Rule icon="ticket-outline" text="Biking some park trails needs a state trail pass (age 16+, $5/day or $25/year). Check signs at the trailhead." />
      </View>

      <Text style={styles.sectionTitle} accessibilityRole="header">
        Trails in this park
        {trails?.state === 'ready' ? `  ·  ${trails.trails.length} mapped${bikeCount ? `, ${bikeCount} open to bikes` : ''}` : ''}
      </Text>
      {(!trails || trails.state === 'loading') && <Text style={styles.muted}>Loading trails…</Text>}
      {trails?.state === 'error' && (
        <Pressable onPress={onRetry} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
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
              color={t.access === 'bike' ? COLORS.pathPaved : COLORS.muted}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.parkTrailName}>{t.name}</Text>
              <Text style={styles.muted}>
                {formatDistance(t.lengthM)}
                {'  ·  '}
                {t.access === 'bike' ? (t.mtb ? 'Mountain bike trail' : 'Bikes allowed (check signs)') : t.access === 'no_bike' ? 'Hiking only' : 'Check signs for bikes'}
                {t.surface ? `  ·  ${t.surface.replace(/_/g, ' ')}` : ''}
              </Text>
            </View>
          </View>
        ))}
      <Text style={styles.source}>Map data: OpenStreetMap contributors · park rules: WI DNR</Text>
    </View>
  );
}

function SponsoredBadge({ demo }: { demo?: boolean }) {
  return (
    <View style={styles.partnerBadge}>
      <Ionicons name="star" size={13} color={BRAND.navy} />
      <Text style={styles.partnerBadgeText}>Sponsored{demo ? ' · sample' : ''}</Text>
    </View>
  );
}

function PartnerBody({ partner }: { partner: Partner }) {
  const [passOpen, setPassOpen] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      {partner.photo_url ? (
        <Image source={{ uri: partner.photo_url }} style={styles.photo} contentFit="cover" accessibilityIgnoresInvertColors />
      ) : null}
      <SponsoredBadge demo={partner.demo} />
      {partner.blurb ? <Text style={styles.line}>{partner.blurb}</Text> : null}
      <OpenChip hours={partner.hours} />
      {partner.offer ? (
        <View style={styles.offer}>
          <Text style={styles.offerLabel}>Rider offer</Text>
          <Text style={styles.offerText}>{partner.offer}</Text>
          <Pressable
            style={({ pressed }) => [styles.offerButton, pressed && { opacity: 0.8 }]}
            onPress={() => {
              trackPartner(partner, 'offer', 'card');
              setPassOpen(true);
            }}
            accessibilityRole="button"
            accessibilityHint="Opens a full-screen pass to show staff">
            <Ionicons name="pricetag" size={16} color="#fff" />
            <Text style={styles.offerButtonText}>Use offer</Text>
          </Pressable>
        </View>
      ) : null}
      {partner.address ? <Text style={styles.muted}>{partner.address}</Text> : null}
      <Text style={styles.source}>Sponsored listing</Text>
      {partner.offer ? <OfferPass partner={partner} visible={passOpen} onClose={() => setPassOpen(false)} /> : null}
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

function TrailBody({ trail, isEbikeRider, ebikeClass, sponsor, trailPartners, onOpenPartner }: {
  trail: Trail;
  isEbikeRider?: boolean;
  ebikeClass?: string | null;
  sponsor?: Partner;
  trailPartners?: { partner: Partner; meters: number }[];
  onOpenPartner?: (p: Partner) => void;
}) {
  const [ebikeOpen, setEbikeOpen] = useState(false);
  const paved = trail.unpavedShare < 0.1;
  const unpaved = trail.unpavedShare > 0.9;
  const surfaceText = paved ? 'Paved' : unpaved ? 'Unpaved (gravel or crushed stone)' : `Mixed, ${Math.round(trail.unpavedShare * 100)}% unpaved`;
  const r = trail.rules;
  const verdict = verdictFor(r);
  const ebikeText = ebikeRule(r, isEbikeRider ? ebikeClass : null);
  const others = (trailPartners ?? []).filter((t) => t.partner.id !== sponsor?.id);

  if (trail.kind === 'lane') {
    return (
      <View style={{ gap: 6 }}>
        <View style={styles.stats}>
          <Stat label="Length mapped" value={formatDistance(trail.lengthM)} />
        </View>
        <Text style={styles.line}>On-street bike lane. Ride with traffic.</Text>
        <Text style={styles.source}>Map data: OpenStreetMap contributors</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <View style={styles.rules}>
        <View style={styles.rulesHead}>
          <Text style={styles.rulesTitle} accessibilityRole="header">Can I ride here?</Text>
          <View
            style={[styles.verdict, verdict === 'free' ? styles.verdictFree : styles.verdictPass]}
            accessibilityLabel={`Trail pass: ${VERDICT_LABEL[verdict]}`}>
            <Text style={[styles.verdictText, verdict === 'free' && { color: '#fff' }]}>{VERDICT_LABEL[verdict]}</Text>
          </View>
        </View>
        <Rule icon="checkmark-circle" text="Bikes welcome" strong color={COLORS.pathPaved} />
        <Rule icon="ticket-outline" text={r ? r.pass : 'No trail pass needed.'} highlight={!!r} />
        {isEbikeRider ? (
          <Rule icon="flash-outline" text={ebikeText} highlight />
        ) : (
          <>
            <Pressable
              onPress={() => setEbikeOpen((o) => !o)}
              style={styles.disclosure}
              accessibilityRole="button"
              accessibilityState={{ expanded: ebikeOpen }}>
              <Ionicons name="flash-outline" size={16} color={COLORS.muted} />
              <Text style={styles.disclosureText}>E-bike rules</Text>
              <Ionicons name={ebikeOpen ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.muted} />
            </Pressable>
            {ebikeOpen && <Rule icon="information-circle-outline" text={ebikeText} />}
          </>
        )}
        {r ? (
          <Pressable onPress={() => void Linking.openURL(r.url)} accessibilityRole="link" style={styles.linkRow}>
            <Text style={styles.link}>Rules from {r.manager} · checked Oct 2026</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.stats}>
        <Stat label="Length mapped" value={formatDistance(trail.lengthM)} />
        <Stat label="Surface" value={surfaceText} />
      </View>
      {trail.surface ? <Text style={styles.muted}>Mostly {trail.surface.replace(/_/g, ' ')}</Text> : null}

      {sponsor && (
        <Pressable
          style={styles.sponsor}
          onPress={() => onOpenPartner?.(sponsor)}
          accessibilityRole="button"
          accessibilityLabel={`Sponsored: presented by ${sponsor.name}`}>
          <PartnerMark partner={sponsor} size={24} />
          <Text style={styles.sponsorText} numberOfLines={2}>
            Presented by <Text style={{ fontFamily: FONT.bold }}>{sponsor.name}</Text>
            {sponsor.demo ? ' (sample)' : ''} · Sponsored
          </Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.muted} />
        </Pressable>
      )}

      {others.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={styles.sectionTitle} accessibilityRole="header">Nearby on this trail</Text>
          {others.map(({ partner: p, meters }) => (
            <Pressable
              key={p.id}
              style={styles.trailPartner}
              onPress={() => onOpenPartner?.(p)}
              accessibilityRole="button"
              accessibilityLabel={`Sponsored: ${p.name}, ${formatDistance(meters)} off the trail`}>
              <PartnerMark partner={p} size={30} />
              <View style={{ flex: 1 }}>
                <Text style={styles.parkTrailName} numberOfLines={1}>{p.name}{p.demo ? ' (sample)' : ''}</Text>
                <Text style={styles.muted} numberOfLines={2}>
                  {meters < 60 ? 'On the trail' : `${formatDistance(meters)} off the trail`}
                  {p.offer ? `  ·  ${p.offer}` : ''}
                </Text>
              </View>
              <View style={styles.partnerBadgeSmall}><Text style={styles.partnerBadgeText}>Sponsored</Text></View>
            </Pressable>
          ))}
        </View>
      )}
      <Text style={styles.source}>Map data: OpenStreetMap contributors</Text>
    </View>
  );
}

function Rule({ icon, text, highlight, strong, color }: {
  icon: keyof typeof Ionicons.glyphMap; text: string; highlight?: boolean; strong?: boolean; color?: string;
}) {
  return (
    <View style={styles.rule}>
      <Ionicons name={icon} size={18} color={color ?? (highlight ? '#92400e' : COLORS.muted)} style={{ marginTop: 1 }} />
      <Text style={[styles.ruleText, (highlight || strong) && { fontFamily: FONT.bold }]}>{text}</Text>
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
    <View style={{ flexShrink: 1 }}>
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
  kicker: { fontSize: 13, fontFamily: FONT.bold, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { fontSize: 20, fontFamily: FONT.black, color: COLORS.text, marginTop: 2 },
  line: { fontSize: 15, color: COLORS.text, marginTop: 2 },
  muted: { fontSize: 14, color: COLORS.muted },
  help: { fontSize: 14, color: COLORS.text, lineHeight: 19 },
  source: { fontSize: 13, color: COLORS.muted, marginTop: 6 },
  warn: { fontSize: 14, color: '#b91c1c', fontWeight: '600', marginTop: 2 },
  counts: { flexDirection: 'row', gap: 24, marginVertical: 4 },
  countValue: { fontSize: 32, fontFamily: FONT.black },
  countLabel: { fontSize: 14, color: COLORS.muted },
  stats: { flexDirection: 'row', gap: 12 },
  statLabel: { fontSize: 13, color: COLORS.muted },
  statValue: { fontSize: 16, fontFamily: FONT.black, color: COLORS.text, marginTop: 2 },
  sectionTitle: { fontSize: 15, fontFamily: FONT.black, color: COLORS.text, marginTop: 4 },
  parkTrail: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  parkTrailName: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  sponsor: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border,
  },
  sponsorText: { flex: 1, fontSize: 14, color: COLORS.text },
  trailPartner: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 4 },
  photo: { width: '100%', height: 140, borderRadius: 12, backgroundColor: '#f3f4f6' },
  partnerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: BRAND.gold,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },
  partnerBadgeSmall: { backgroundColor: BRAND.gold, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  partnerBadgeText: { fontSize: 13, fontFamily: FONT.bold, color: BRAND.navy },
  openChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },
  openChipOpen: { backgroundColor: '#d1fae5' },
  openChipClosed: { backgroundColor: BRAND.limestone },
  openText: { fontSize: 14, fontFamily: FONT.bold, color: COLORS.text },
  offer: { backgroundColor: '#ecfdf5', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#a7f3d0', gap: 6 },
  offerLabel: { fontSize: 13, fontFamily: FONT.bold, color: '#065f46', textTransform: 'uppercase', letterSpacing: 0.6 },
  offerText: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  offerButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'flex-start',
    minHeight: 44, paddingHorizontal: 16, borderRadius: 999, backgroundColor: '#065f46', marginTop: 2,
  },
  offerButtonText: { fontSize: 15, fontFamily: FONT.bold, color: '#fff' },
  rules: { backgroundColor: '#fffbeb', borderRadius: 12, padding: 12, gap: 8 },
  rulesHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  rulesTitle: { fontSize: 16, fontFamily: FONT.black, color: '#92400e' },
  verdict: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  verdictFree: { backgroundColor: COLORS.pathPaved },
  verdictPass: { backgroundColor: BRAND.gold },
  verdictText: { fontSize: 14, fontFamily: FONT.black, color: BRAND.navy },
  rule: { flexDirection: 'row', gap: 8 },
  ruleText: { flex: 1, fontSize: 15, color: COLORS.text, lineHeight: 20 },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  disclosureText: { flex: 1, fontSize: 15, fontFamily: FONT.bold, color: COLORS.text },
  linkRow: { minHeight: 44, justifyContent: 'center' },
  link: { fontSize: 14, color: COLORS.brand, textDecorationLine: 'underline' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.brand,
  },
  actionPrimary: { backgroundColor: COLORS.brand },
  actionText: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.brand },
});
