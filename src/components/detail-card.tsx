import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { OfferPass } from '@/components/offer-pass';
import { roundMiles, shareBucket, track } from '@/lib/analytics';
import {
  BCYCLE_APP_ANDROID, BCYCLE_APP_ANDROID_WEB, BCYCLE_APP_IOS, BCYCLE_PRICING_URL, type BCycleStation,
} from '@/lib/bcycle';
import { COLORS, FONT } from '@/lib/config';
import type { Selection } from '@/lib/data';
import { distanceMeters, formatDistance } from '@/lib/geo';
import { openStatus } from '@/lib/hours';
import { t, useT } from '@/lib/i18n';
import { PATH_META, PLACE_META, timeAgo } from '@/lib/labels';
import { callPhone, openAppleBikeDirections, openBikeDirections, openWebsite } from '@/lib/links';
import { detailLabel } from '@/lib/osm';
import type { ParkTrail } from '@/lib/parks';
import { CATEGORY_LABEL, initials, trackPartner, type Partner } from '@/lib/partners';
import { makeStyles, useTheme } from '@/lib/theme';
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
  const { c } = useTheme();
  useT(); // re-render on language change
  const styles = useStyles();
  const dist = location
    ? formatDistance(distanceMeters(location.latitude, location.longitude, target.latitude, target.longitude))
    : null;
  const name = title(selection);
  const partner = selection.type === 'partner' ? selection.item : undefined;
  const trailId = selection.type === 'trail' ? selection.item.id : null;

  // Product analytics: a trail card or BCycle station opened (public places; no rider location).
  const selKey = `${selection.type}:${selection.item.id}`;
  useEffect(() => {
    if (selection.type === 'trail') {
      const tr = selection.item;
      track('trail_card_viewed', {
        trail_id: tr.id, trail_name: tr.name, trail_kind: tr.kind, length_mi: roundMiles(tr.lengthM),
        unpaved_share: shareBucket(tr.unpavedShare), pass_needed: verdictFor(tr.rules) !== 'free',
      });
    } else if (selection.type === 'station') {
      const st = selection.item;
      track('bcycle_station_viewed', { station_id: st.id, station_name: st.name, bikes_available: st.bikes > 0 });
    }
  }, [selKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <Text style={styles.kicker}>{kicker(selection)}{dist ? `  ·  ${t('map.away', { dist })}` : ''}</Text>
          <Text style={styles.title} numberOfLines={2} accessibilityRole="header">{name}</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('map.closeDetails')}>
          <Ionicons name="close-circle" size={30} color={c.textMuted} />
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
          label={selection.type === 'trail' ? t('map.routeToTrail') : t('map.routeHere')}
          primary
          onPress={() => {
            if (partner) trackPartner(partner, 'route', 'card');
            onRouteHere(name);
          }}
        />
        {selection.type === 'trail' && verdictFor(selection.item.rules) !== 'free' && (
          <Action icon="ticket-outline" label={t('map.buyPass')} onPress={() => void Linking.openURL(TRAIL_PASS_URL)} />
        )}
        {selection.type === 'park' && selection.item.website && (
          <Action icon="globe-outline" label={t('map.parkInfo')} onPress={() => openWebsite(selection.item.website!)} />
        )}
        {selection.type === 'station' && <Action icon="bicycle" label={t('map.rentBike')} onPress={openBCycleApp} />}
        {(selection.type === 'place' || selection.type === 'partner') && selection.item.phone && (
          <Action
            icon="call"
            label={t('map.call')}
            onPress={() => {
              if (partner) trackPartner(partner, 'call', 'card');
              callPhone(selection.item.phone!);
            }}
          />
        )}
        {(selection.type === 'place' || selection.type === 'partner') && selection.item.website && (
          <Action
            icon="globe-outline"
            label={t('map.website')}
            onPress={() => {
              if (partner) trackPartner(partner, 'website', 'card');
              openWebsite(selection.item.website!);
            }}
          />
        )}
        {selection.type !== 'trail' && <Action icon="map-outline" label={t('map.openInMaps')} onPress={openInMaps} />}
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
  const { c } = useTheme();
  const styles = useStyles();
  const status = openStatus(hours);
  if (!status) return hours ? <Text style={styles.line}>{t('map.hours.label', { hours })}</Text> : null;
  const openColor = c.dark ? '#A7F3D0' : '#065f46';
  return (
    <View style={[styles.openChip, status.open ? styles.openChipOpen : styles.openChipClosed]}>
      <Ionicons name="time-outline" size={15} color={status.open ? openColor : c.text} />
      <Text style={[styles.openText, status.open && { color: openColor }]}>{status.text}</Text>
    </View>
  );
}

function StationBody({ s }: { s: BCycleStation }) {
  const { c } = useTheme();
  const styles = useStyles();
  const bc = c.dark ? '#93B4F5' : COLORS.bcycle;
  const split = s.ebikes != null && s.classic != null && s.ebikes + s.classic === s.bikes;
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.counts}>
        {split ? (
          <>
            <Count value={s.ebikes!} label={t('map.count.ebikes', { count: s.ebikes! })} color={bc} />
            <Count value={s.classic!} label={t('map.count.classic', { count: s.classic! })} color={bc} />
          </>
        ) : (
          <Count value={s.bikes} label={t('map.count.bikes', { count: s.bikes })} color={bc} />
        )}
        <Count value={s.docks} label={t('map.count.docks', { count: s.docks })} color={c.text} />
      </View>
      {!s.renting && <Text style={styles.warn}>{t('map.notRenting')}</Text>}
      {!s.returning && <Text style={styles.warn}>{t('map.notReturning')}</Text>}
      {s.address ? <Text style={styles.line}>{s.address}</Text> : null}
      <Text style={styles.help}>{t('map.bcycleHelp')}</Text>
      <Pressable onPress={() => void Linking.openURL(BCYCLE_PRICING_URL)} accessibilityRole="link" hitSlop={8} style={styles.linkRow}>
        <Text style={styles.link}>{t('map.bcyclePrices')}</Text>
      </Pressable>
      <Text style={styles.source}>
        {t('map.liveFrom')}
        {s.lastReported ? ` · ${t('map.stationReported', { ago: timeAgo(s.lastReported * 1000) })}` : ''}
      </Text>
    </View>
  );
}

function Body({ selection }: { selection: Selection }) {
  if (selection.type === 'partner') return <PartnerBody partner={selection.item} />;
  if (selection.type === 'station') return <StationBody s={selection.item} />;
  return <PlaceBody selection={selection} />;
}

function PlaceBody({ selection }: { selection: Selection }) {
  const styles = useStyles();
  if (selection.type !== 'place') return null;
  const p = selection.item;
  return (
    <View style={{ gap: 4 }}>
      <OpenChip hours={p.hours} />
      {p.details.length > 0 && <Text style={styles.line}>{p.details.map(detailLabel).join('  ·  ')}</Text>}
      {p.address ? <Text style={styles.line}>{p.address}</Text> : null}
      <Text style={styles.source}>{t('map.sourceOsm')}{p.hours ? ` · ${t('map.confirmHours')}` : ''}</Text>
    </View>
  );
}

function ParkBody({ trails, onRetry }: { trails?: Props['parkTrails']; onRetry?: () => void }) {
  const { c } = useTheme();
  const styles = useStyles();
  const bikeCount = trails?.trails.filter((pt) => pt.access === 'bike').length ?? 0;
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.rules}>
        <Text style={styles.rulesTitle} accessibilityRole="header">{t('map.goodToKnow')}</Text>
        <Rule icon="car-outline" text={t('map.park.carPass')} />
        <Rule icon="ticket-outline" text={t('map.park.trailPass')} />
      </View>

      <Text style={styles.sectionTitle} accessibilityRole="header">
        {t('map.park.trailsTitle')}
        {trails?.state === 'ready'
          ? `  ·  ${t('map.park.mapped', { count: trails.trails.length })}${bikeCount ? `, ${t('map.park.openToBikes', { count: bikeCount })}` : ''}`
          : ''}
      </Text>
      {(!trails || trails.state === 'loading') && <Text style={styles.muted}>{t('map.park.loading')}</Text>}
      {trails?.state === 'error' && (
        <Pressable onPress={onRetry} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={styles.warn}>{t('map.park.error')}</Text>
        </Pressable>
      )}
      {trails?.state === 'ready' && trails.trails.length === 0 && (
        <Text style={styles.muted}>{t('map.park.none')}</Text>
      )}
      {trails?.state === 'ready' &&
        trails.trails.map((pt) => (
          <View key={pt.name} style={styles.parkTrail}>
            <Ionicons
              name={pt.access === 'bike' ? 'bicycle' : pt.access === 'no_bike' ? 'walk' : 'help-circle-outline'}
              size={18}
              color={pt.access === 'bike' ? (c.dark ? c.success : COLORS.pathPaved) : c.textMuted}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.parkTrailName}>{pt.name}</Text>
              <Text style={styles.muted}>
                {formatDistance(pt.lengthM)}
                {'  ·  '}
                {pt.access === 'bike'
                  ? t(pt.mtb ? 'map.park.mtb' : 'map.park.bikesOk')
                  : t(pt.access === 'no_bike' ? 'map.park.hikingOnly' : 'map.park.checkSigns')}
                {pt.surface ? `  ·  ${pt.surface.replace(/_/g, ' ')}` : ''}
              </Text>
            </View>
          </View>
        ))}
      <Text style={styles.source}>{t('map.park.source')}</Text>
    </View>
  );
}

function SponsoredBadge({ demo }: { demo?: boolean }) {
  const { c } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.partnerBadge}>
      <Ionicons name="star" size={13} color={c.onGold} />
      <Text style={styles.partnerBadgeText}>{demo ? t('map.sponsoredSample') : t('common.sponsored')}</Text>
    </View>
  );
}

function PartnerBody({ partner }: { partner: Partner }) {
  const [passOpen, setPassOpen] = useState(false);
  const styles = useStyles();
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
          <Text style={styles.offerLabel}>{t('map.riderOffer')}</Text>
          <Text style={styles.offerText}>{partner.offer}</Text>
          <Pressable
            style={({ pressed }) => [styles.offerButton, pressed && { opacity: 0.8 }]}
            onPress={() => {
              trackPartner(partner, 'offer', 'card');
              setPassOpen(true);
            }}
            accessibilityRole="button"
            accessibilityHint={t('map.useOfferHint')}>
            <Ionicons name="pricetag" size={16} color="#fff" />
            <Text style={styles.offerButtonText}>{t('map.useOffer')}</Text>
          </Pressable>
        </View>
      ) : null}
      {partner.address ? <Text style={styles.muted}>{partner.address}</Text> : null}
      <Text style={styles.source}>{t('map.sponsoredListing')}</Text>
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
  const { c } = useTheme();
  const styles = useStyles();
  const paved = trail.unpavedShare < 0.1;
  const unpaved = trail.unpavedShare > 0.9;
  const surfaceText = paved
    ? t('map.surface.paved')
    : unpaved
      ? t('map.surface.unpavedLong')
      : t('map.surface.mixed', { pct: Math.round(trail.unpavedShare * 100) });
  const r = trail.rules;
  const verdict = verdictFor(r);
  const ebikeText = ebikeRule(r, isEbikeRider ? ebikeClass : null);
  const others = (trailPartners ?? []).filter((t) => t.partner.id !== sponsor?.id);

  if (trail.kind === 'lane') {
    return (
      <View style={{ gap: 6 }}>
        <View style={styles.stats}>
          <Stat label={t('map.lengthMapped')} value={formatDistance(trail.lengthM)} />
        </View>
        <Text style={styles.line}>{t('map.laneNote')}</Text>
        <Text style={styles.source}>{t('map.osmSource')}</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <View style={styles.rules}>
        <View style={styles.rulesHead}>
          <Text style={styles.rulesTitle} accessibilityRole="header">{t('map.canIRide')}</Text>
          <View
            style={[styles.verdict, verdict === 'free' ? styles.verdictFree : styles.verdictPass]}
            accessibilityLabel={t('map.trailPassA11y', { verdict: VERDICT_LABEL[verdict] })}>
            <Text style={[styles.verdictText, verdict === 'free' && { color: '#fff' }]}>{VERDICT_LABEL[verdict]}</Text>
          </View>
        </View>
        <Rule icon="checkmark-circle" text={t('map.bikesWelcome')} strong color={c.dark ? c.success : COLORS.pathPaved} />
        <Rule icon="ticket-outline" text={r ? r.pass : t('map.noPass')} highlight={!!r} />
        {isEbikeRider ? (
          <Rule icon="flash-outline" text={ebikeText} highlight />
        ) : (
          <>
            <Pressable
              onPress={() => setEbikeOpen((o) => !o)}
              style={styles.disclosure}
              accessibilityRole="button"
              accessibilityState={{ expanded: ebikeOpen }}>
              <Ionicons name="flash-outline" size={16} color={c.textMuted} />
              <Text style={styles.disclosureText}>{t('map.ebikeRules')}</Text>
              <Ionicons name={ebikeOpen ? 'chevron-up' : 'chevron-down'} size={16} color={c.textMuted} />
            </Pressable>
            {ebikeOpen && <Rule icon="information-circle-outline" text={ebikeText} />}
          </>
        )}
        {r ? (
          <Pressable onPress={() => void Linking.openURL(r.url)} accessibilityRole="link" style={styles.linkRow}>
            <Text style={styles.link}>{t('map.rulesFrom', { manager: r.manager })}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.stats}>
        <Stat label={t('map.lengthMapped')} value={formatDistance(trail.lengthM)} />
        <Stat label={t('map.surface')} value={surfaceText} />
      </View>
      {trail.surface ? <Text style={styles.muted}>{t('map.mostly', { surface: trail.surface.replace(/_/g, ' ') })}</Text> : null}

      {sponsor && (
        <Pressable
          style={styles.sponsor}
          onPress={() => onOpenPartner?.(sponsor)}
          accessibilityRole="button"
          accessibilityLabel={t('map.presentedByA11y', { name: sponsor.name })}>
          <PartnerMark partner={sponsor} size={24} />
          <Text style={styles.sponsorText} numberOfLines={2}>
            {t('map.presentedBy')} <Text style={{ fontFamily: FONT.bold }}>{sponsor.name}</Text>
            {sponsor.demo ? ` ${t('map.sampleTag')}` : ''} · {t('common.sponsored')}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
        </Pressable>
      )}

      {others.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={styles.sectionTitle} accessibilityRole="header">{t('map.nearbyOnTrail')}</Text>
          {others.map(({ partner: p, meters }) => (
            <Pressable
              key={p.id}
              style={styles.trailPartner}
              onPress={() => onOpenPartner?.(p)}
              accessibilityRole="button"
              accessibilityLabel={t('map.offTrailA11y', { name: p.name, dist: formatDistance(meters) })}>
              <PartnerMark partner={p} size={30} />
              <View style={{ flex: 1 }}>
                <Text style={styles.parkTrailName} numberOfLines={1}>{p.name}{p.demo ? ` ${t('map.sampleTag')}` : ''}</Text>
                <Text style={styles.muted} numberOfLines={2}>
                  {meters < 60 ? t('map.onTrail') : t('map.offTrail', { dist: formatDistance(meters) })}
                  {p.offer ? `  ·  ${p.offer}` : ''}
                </Text>
              </View>
              <View style={styles.partnerBadgeSmall}><Text style={styles.partnerBadgeText}>{t('common.sponsored')}</Text></View>
            </Pressable>
          ))}
        </View>
      )}
      <Text style={styles.source}>{t('map.osmSource')}</Text>
    </View>
  );
}

function Rule({ icon, text, highlight, strong, color }: {
  icon: keyof typeof Ionicons.glyphMap; text: string; highlight?: boolean; strong?: boolean; color?: string;
}) {
  const { c } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.rule}>
      <Ionicons name={icon} size={18} color={color ?? (highlight ? (c.dark ? c.gold : '#92400e') : c.textMuted)} style={{ marginTop: 1 }} />
      <Text style={[styles.ruleText, (highlight || strong) && { fontFamily: FONT.bold }]}>{text}</Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function Count({ value, label, color }: { value: number; label: string; color: string }) {
  const styles = useStyles();
  return (
    <View style={{ flexShrink: 1 }}>
      <Text style={[styles.countValue, { color }]}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

function Action({ icon, label, onPress, primary }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; primary?: boolean }) {
  const { c } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.action, primary && styles.actionPrimary, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={16} color={primary ? c.onPrimary : c.primary} />
      <Text style={[styles.actionText, primary && { color: c.onPrimary }]}>{label}</Text>
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
  if (s.type === 'station') return t('map.kicker.station');
  if (s.type === 'partner') return CATEGORY_LABEL[s.item.category] ?? t('map.category.other');
  if (s.type === 'park') return /recreation area/i.test(s.item.name) ? t('map.kicker.recArea') : t('map.kicker.statePark');
  if (s.type === 'place') return PLACE_META[s.item.kind].label;
  return s.item.kind === 'lane' ? t('map.kicker.bikeLane') : PATH_META[s.item.kind].label;
}

function title(s: Selection): string {
  if (s.type === 'station') return s.item.name;
  if (s.type === 'partner') return s.item.name;
  if (s.type === 'park') return s.item.name;
  if (s.type === 'place') return s.item.name ?? PLACE_META[s.item.kind].fallbackName;
  return s.item.name ?? (s.item.kind === 'lane' ? t('map.kicker.bikeLane') : t('map.kicker.unnamedPath'));
}

const useStyles = makeStyles((c) => ({
  card: {
    backgroundColor: c.surface,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    shadowColor: c.shadow,
    shadowOpacity: c.dark ? 0.5 : 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  kicker: { fontSize: 13, fontFamily: FONT.bold, color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { fontSize: 20, fontFamily: FONT.black, color: c.text, marginTop: 2 },
  line: { fontSize: 15, color: c.text, marginTop: 2 },
  muted: { fontSize: 14, color: c.textMuted },
  help: { fontSize: 14, color: c.text, lineHeight: 19 },
  source: { fontSize: 13, color: c.textMuted, marginTop: 6 },
  warn: { fontSize: 14, color: c.danger, fontWeight: '600', marginTop: 2 },
  counts: { flexDirection: 'row', gap: 24, marginVertical: 4 },
  countValue: { fontSize: 32, fontFamily: FONT.black },
  countLabel: { fontSize: 14, color: c.textMuted },
  stats: { flexDirection: 'row', gap: 12 },
  statLabel: { fontSize: 13, color: c.textMuted },
  statValue: { fontSize: 16, fontFamily: FONT.black, color: c.text, marginTop: 2 },
  sectionTitle: { fontSize: 15, fontFamily: FONT.black, color: c.text, marginTop: 4 },
  parkTrail: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  parkTrailName: { fontSize: 15, fontWeight: '600', color: c.text },
  sponsor: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border,
  },
  sponsorText: { flex: 1, fontSize: 14, color: c.text },
  trailPartner: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 4 },
  photo: { width: '100%', height: 140, borderRadius: 12, backgroundColor: c.surfaceAlt },
  partnerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: c.gold,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },
  partnerBadgeSmall: { backgroundColor: c.gold, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  partnerBadgeText: { fontSize: 13, fontFamily: FONT.bold, color: c.onGold },
  openChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },
  openChipOpen: { backgroundColor: c.dark ? '#064E3B' : '#d1fae5' },
  openChipClosed: { backgroundColor: c.surfaceAlt },
  openText: { fontSize: 14, fontFamily: FONT.bold, color: c.text },
  offer: { backgroundColor: c.dark ? '#052E22' : '#ecfdf5', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.dark ? '#065F46' : '#a7f3d0', gap: 6 },
  offerLabel: { fontSize: 13, fontFamily: FONT.bold, color: c.dark ? '#A7F3D0' : '#065f46', textTransform: 'uppercase', letterSpacing: 0.6 },
  offerText: { fontSize: 15, fontWeight: '600', color: c.text },
  offerButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'flex-start',
    minHeight: 44, paddingHorizontal: 16, borderRadius: 999, backgroundColor: '#065f46', marginTop: 2,
  },
  offerButtonText: { fontSize: 15, fontFamily: FONT.bold, color: '#fff' },
  rules: { backgroundColor: c.dark ? '#2A2110' : '#fffbeb', borderRadius: 12, padding: 12, gap: 8 },
  rulesHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  rulesTitle: { fontSize: 16, fontFamily: FONT.black, color: c.dark ? c.gold : '#92400e' },
  verdict: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  verdictFree: { backgroundColor: COLORS.pathPaved },
  verdictPass: { backgroundColor: c.gold },
  verdictText: { fontSize: 14, fontFamily: FONT.black, color: c.onGold },
  rule: { flexDirection: 'row', gap: 8 },
  ruleText: { flex: 1, fontSize: 15, color: c.text, lineHeight: 20 },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  disclosureText: { flex: 1, fontSize: 15, fontFamily: FONT.bold, color: c.text },
  linkRow: { minHeight: 44, justifyContent: 'center' },
  link: { fontSize: 14, color: c.primary, textDecorationLine: 'underline' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.primary,
  },
  actionPrimary: { backgroundColor: c.primary },
  actionText: { fontSize: 15, fontFamily: FONT.bold, color: c.primary },
}));
