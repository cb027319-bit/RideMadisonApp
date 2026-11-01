// Suggested rides browser: filter classic Madison rides by length, type and
// distance from you. Rides are measured with the bike router the first time
// and cached, so the numbers shown are real.

import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { cached } from '@/lib/cache';
import { COVERAGE_BBOX, FONT, MADISON_CENTER } from '@/lib/config';
import { formatDistance, pointInBBox, simplify, type LonLat } from '@/lib/geo';
import { useT } from '@/lib/i18n';
import { thinResult } from '@/lib/planner';
import { fetchRoute, formatDuration, metersToFeet, type LatLon, type RouteResult } from '@/lib/routing';
import {
  closestMiles, filterRides, FROM_ME_FILTERS, LENGTH_FILTERS, rideTypeLabel, rideTypeOf, routePoints,
  SUGGESTED_RIDES, TYPE_FILTERS, type FromMeFilter, type LengthFilter, type MeasuredRide, type RideType, type SuggestedRide,
  type TypeFilter,
} from '@/lib/suggested';
import { makeStyles, useTheme, type Palette } from '@/lib/theme';
const TTL = 30 * 24 * 3600 * 1000;

/** Keep cached rides light: ~2 m line simplification. */
function lighten(r: RouteResult): RouteResult {
  const line: LonLat[] = r.coords.map((c) => [c.longitude, c.latitude]);
  const idx = new Map(line.map((c, i) => [c, i] as const));
  const keep = new Set(simplify(line, 0.00002).map((c) => idx.get(c)!));
  return thinResult(r, (i) => keep.has(i));
}

// v2: results now carry turn cues and street names.
const measure = (ride: SuggestedRide) =>
  cached(`suggested:v2:${ride.id}`, TTL, async () => lighten(await fetchRoute(routePoints(ride), ride.profile)));

interface Props {
  visible: boolean;
  location: LatLon | null;
  onClose: () => void;
  onPick: (ride: SuggestedRide, result?: RouteResult) => void;
  onPreview: (ride: SuggestedRide, result: RouteResult) => void;
}

export function SuggestedRidesSheet({ visible, location, onClose, onPick, onPreview }: Props) {
  const styles = useStyles();
  const { c } = useTheme();
  const { t } = useT();
  const mix = mixColors(c);
  const [results, setResults] = useState<Record<string, RouteResult | 'error'>>({});
  const [length, setLength] = useState<LengthFilter>('any');
  const [type, setType] = useState<TypeFilter>('any');
  const [fromMe, setFromMe] = useState<FromMeFilter>('any');

  // Measure rides one at a time (polite to the free routing server), cached for a month.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      for (const ride of SUGGESTED_RIDES) {
        if (cancelled) return;
        if (results[ride.id] && results[ride.id] !== 'error') continue;
        try {
          const r = await measure(ride);
          if (!cancelled) setResults((m) => ({ ...m, [ride.id]: r.value }));
        } catch {
          if (!cancelled) setResults((m) => ({ ...m, [ride.id]: 'error' }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const [minLon, minLat, maxLon, maxLat] = COVERAGE_BBOX;
  const inArea = !!location && pointInBBox(location.latitude, location.longitude, { minLon, minLat, maxLon, maxLat });
  const origin = inArea && location ? location : MADISON_CENTER;
  const measured = useMemo<MeasuredRide[]>(
    () =>
      SUGGESTED_RIDES.map((ride) => {
        const r = results[ride.id];
        const result = r && r !== 'error' ? r : undefined;
        return { ride, result, fromMeMi: closestMiles(origin, ride, result) };
      }),
    [results, origin.latitude, origin.longitude], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const shown = filterRides(measured, { length, type, fromMe });
  const pending = SUGGESTED_RIDES.filter((r) => !results[r.id]).length;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">{t('route.suggested')}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" style={styles.doneBtn}>
            <Text style={styles.done}>{t('common.done')}</Text>
          </Pressable>
        </View>

        <FilterRow label={t('route.sug.length')} options={LENGTH_FILTERS} value={length} onChange={setLength} />
        <FilterRow label={t('route.sug.type')} options={TYPE_FILTERS} value={type} onChange={setType} />
        <FilterRow
          label={inArea ? t('route.sug.fromYou') : t('route.sug.fromCapitol')}
          options={FROM_ME_FILTERS}
          value={fromMe}
          onChange={setFromMe}
        />
        {location && !inArea && <Text style={styles.note}>{t('route.sug.outside')}</Text>}
        <View style={styles.legend} accessible accessibilityLabel={t('route.sug.legendA11y')}>
          {MIX_KEYS.map((k) => (
            <View key={k} style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: mix[k] }]} />
              <Text style={styles.legendText}>{t(`route.mixCap.${k}`)}</Text>
            </View>
          ))}
        </View>

        {pending > 0 && (
          <View style={styles.measuring}>
            <ActivityIndicator size="small" color={c.primary} />
            <Text style={styles.measuringText}>
              {t('route.sug.measuring', { done: SUGGESTED_RIDES.length - pending, total: SUGGESTED_RIDES.length })}
            </Text>
          </View>
        )}

        <FlatList
          data={shown}
          keyExtractor={(m) => m.ride.id}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {pending > 0 ? t('route.sug.stillMeasuring') : t('route.sug.noMatch')}
            </Text>
          }
          renderItem={({ item }) => (
            <RideCard
              m={item}
              failed={results[item.ride.id] === 'error'}
              inArea={inArea}
              onPress={() => onPick(item.ride, item.result)}
              onPreview={item.result ? () => onPreview(item.ride, item.result!) : undefined}
            />
          )}
        />
      </View>
    </Modal>
  );
}

const MIX_KEYS = ['path', 'lane', 'quiet', 'road'] as const;

/** Ride mix colours (same hues as the map); slightly brighter in dark mode. */
function mixColors(c: Palette): Record<(typeof MIX_KEYS)[number], string> {
  return c.dark
    ? { path: '#22C55E', lane: '#60A5FA', quiet: '#86EFAC', road: '#FB923C' }
    : { path: '#15803d', lane: '#2563eb', quiet: '#86efac', road: '#f97316' };
}

function FilterRow<T extends string>({ label, options, value, onChange }: {
  label: string; options: { id: T; label: string; a11y?: string }[]; value: T; onChange: (v: T) => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.filterRow}>
      <Text style={styles.filterLabel} accessibilityRole="header">{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 16 }}>
        {options.map((o) => (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            accessibilityRole="radio"
            accessibilityLabel={o.a11y ?? o.label}
            accessibilityState={{ selected: value === o.id }}
            style={[styles.chip, value === o.id && styles.chipOn]}>
            <Text style={[styles.chipText, value === o.id && styles.chipTextOn]}>{o.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function RideCard({ m, failed, inArea, onPress, onPreview }: {
  m: MeasuredRide; failed: boolean; inArea: boolean; onPress: () => void; onPreview?: () => void;
}) {
  const styles = useStyles();
  const { c } = useTheme();
  const { t } = useT();
  const mix = mixColors(c);
  const r = m.result;
  const b = r?.breakdown;
  const kind = rideTypeOf(b) ?? m.ride.expectedType;
  const typeLabel = rideTypeLabel(kind, b);
  const awayDist = m.fromMeMi != null ? formatDistance(m.fromMeMi * 1609.344) : '';
  const away = m.fromMeMi != null
    ? m.fromMeMi < 0.3 && inArea ? t('route.sug.startsHere') : t(inArea ? 'route.sug.away' : 'route.sug.fromCapitolDist', { dist: awayDist })
    : '';
  const shape = m.ride.shape === 'loop' ? t('route.sug.loop') : t('route.sug.outBack');
  const a11y = [m.ride.name, r ? formatDistance(r.distanceM).replace(' mi', ` ${t('route.milesWord')}`) : null, typeLabel].filter(Boolean).join(', ');
  return (
    <View style={styles.card}>
      <View
        accessible
        accessibilityLabel={a11y}
        accessibilityHint={`${m.ride.description} ${[away, shape].filter(Boolean).join('. ')}.`}
        style={{ gap: 8 }}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{m.ride.name}</Text>
            <Text style={styles.cardArea}>{m.ride.area}</Text>
          </View>
          <View style={[styles.typeBadge, { backgroundColor: TYPE_COLOR[kind] }]}>
            <Text style={styles.typeText}>{typeLabel}</Text>
          </View>
        </View>

        {r ? (
          <Text style={styles.stats}>
            {formatDistance(r.distanceM)}  ·  {formatDuration(r.timeS)}  ·  {t('route.climb', { n: metersToFeet(r.climbM) })}
            {b ? `  ·  ${t('route.carFree', { pct: Math.round(b.path * 100) })}  ·  ${t('route.paved', { pct: Math.round((1 - b.unpaved) * 100) })}` : ''}
          </Text>
        ) : (
          <Text style={styles.statsMuted}>{failed ? t('route.sug.couldntMeasure') : t('route.sug.measuringOne')}</Text>
        )}
        {b && (
          <View style={styles.mixBar}>
            {MIX_KEYS.map((k) => (
              <View key={k} style={{ flex: b[k], backgroundColor: mix[k] }} />
            ))}
          </View>
        )}
        <Text style={styles.desc}>{m.ride.description}</Text>
        <View style={styles.cardFoot}>
          <Ionicons name="location-outline" size={14} color={c.textMuted} />
          <Text style={styles.footText}>
            {away}
            {away ? '  ·  ' : ''}
            {shape}
          </Text>
        </View>
      </View>
      <View style={styles.cardActions}>
        <Pressable
          style={[styles.previewBtn, !onPreview && { opacity: 0.4 }]}
          disabled={!onPreview}
          onPress={onPreview}
          accessibilityRole="button"
          accessibilityState={{ disabled: !onPreview }}
          accessibilityLabel={t('route.sug.previewNamed', { name: m.ride.name })}>
          <Ionicons name="play-circle" size={18} color={c.primary} />
          <Text style={styles.previewText}>{t('route.preview')}</Text>
        </Pressable>
        <Pressable
          style={styles.rideBtn}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={t('route.sug.useRideNamed', { name: m.ride.name })}
          accessibilityHint={t('route.sug.useRideHint')}>
          <Text style={styles.rideBtnText}>{t('route.sug.useRide')}</Text>
          <Ionicons name="chevron-forward" size={16} color={c.onAccent} />
        </Pressable>
      </View>
    </View>
  );
}

const TYPE_COLOR: Record<RideType, string> = { trail: '#15803d', gravel: '#a16207', road: '#2563eb' };

const useStyles = makeStyles((c) => ({
  sheet: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: c.surface },
  title: { fontSize: 24, fontFamily: FONT.black, color: c.text },
  done: { fontSize: 16, fontWeight: '700', color: c.primary },
  doneBtn: { minHeight: 44, justifyContent: 'center' },
  note: { fontSize: 14, color: c.textMuted, backgroundColor: c.surface, paddingHorizontal: 16, paddingBottom: 8 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, backgroundColor: c.surface, paddingHorizontal: 16, paddingBottom: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 14, height: 8, borderRadius: 2 },
  legendText: { fontSize: 13, color: c.textMuted },
  filterRow: { backgroundColor: c.surface, paddingLeft: 16, paddingBottom: 10, gap: 6 },
  filterLabel: { fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  chip: { paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  chipText: { fontSize: 14, fontWeight: '600', color: c.text },
  chipTextOn: { color: c.onPrimary },
  measuring: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  measuringText: { fontSize: 14, color: c.textMuted },
  empty: { textAlign: 'center', color: c.textMuted, padding: 24, fontSize: 15 },
  card: {
    backgroundColor: c.surface, borderRadius: 16, padding: 14, gap: 8,
    shadowColor: c.shadow, shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardTitle: { fontSize: 18, fontFamily: FONT.black, color: c.text },
  cardArea: { fontSize: 14, color: c.textMuted, marginTop: 2 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  typeText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  stats: { fontSize: 15, fontFamily: FONT.bold, color: c.text },
  statsMuted: { fontSize: 14, color: c.textMuted },
  mixBar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: c.surfaceAlt },
  desc: { fontSize: 15, color: c.text, lineHeight: 21 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footText: { fontSize: 14, color: c.textMuted, flexShrink: 1 },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  previewBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5,
    borderColor: c.primary, borderRadius: 12, minHeight: 44,
  },
  previewText: { color: c.primary, fontWeight: '700', fontSize: 14 },
  rideBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: c.accent,
    borderRadius: 12, minHeight: 44,
  },
  rideBtnText: { color: c.onAccent, fontWeight: '700', fontSize: 14 },
}));
