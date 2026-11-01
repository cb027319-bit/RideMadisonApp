// Suggested rides browser: filter classic Madison rides by length, type and
// distance from you. Rides are measured with the bike router the first time
// and cached, so the numbers shown are real.

import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { cached } from '@/lib/cache';
import { BRAND, COLORS, COVERAGE_BBOX, FONT, MADISON_CENTER } from '@/lib/config';
import { formatDistance, pointInBBox, simplify, type LonLat } from '@/lib/geo';
import { thinResult } from '@/lib/planner';
import { fetchRoute, formatDuration, metersToFeet, type LatLon, type RouteResult } from '@/lib/routing';
import {
  closestMiles, filterRides, FROM_ME_FILTERS, LENGTH_FILTERS, rideTypeLabel, rideTypeOf, routePoints,
  SUGGESTED_RIDES, TYPE_FILTERS, type FromMeFilter, type LengthFilter, type MeasuredRide, type RideType, type SuggestedRide,
  type TypeFilter,
} from '@/lib/suggested';

const ACCENT = BRAND.navy;
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
          <Text style={styles.title} accessibilityRole="header">Suggested rides</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" style={styles.doneBtn}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>

        <FilterRow label="Length" options={LENGTH_FILTERS} value={length} onChange={setLength} />
        <FilterRow label="Type" options={TYPE_FILTERS} value={type} onChange={setType} />
        <FilterRow
          label={inArea ? 'From you' : 'From the Capitol'}
          options={FROM_ME_FILTERS}
          value={fromMe}
          onChange={setFromMe}
        />
        {location && !inArea && <Text style={styles.note}>You’re outside Madison: distances from the Capitol.</Text>}
        <View style={styles.legend} accessible accessibilityLabel="Color key for the ride mix bars: green, trails and paths; blue, bike lanes; light green, quiet streets; orange, busier roads">
          {MIX.map((m) => (
            <View key={m.key} style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: m.color }]} />
              <Text style={styles.legendText}>{m.label}</Text>
            </View>
          ))}
        </View>

        {pending > 0 && (
          <View style={styles.measuring}>
            <ActivityIndicator size="small" color={ACCENT} />
            <Text style={styles.measuringText}>
              Measuring rides… {SUGGESTED_RIDES.length - pending}/{SUGGESTED_RIDES.length}
            </Text>
          </View>
        )}

        <FlatList
          data={shown}
          keyExtractor={(m) => m.ride.id}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {pending > 0 ? 'Still measuring. More rides will appear in a moment.' : 'No rides match. Try widening a filter.'}
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

const MIX = [
  { key: 'path', label: 'Trails & paths', color: '#15803d' },
  { key: 'lane', label: 'Bike lanes', color: '#2563eb' },
  { key: 'quiet', label: 'Quiet streets', color: '#86efac' },
  { key: 'road', label: 'Busier roads', color: '#f97316' },
] as const;

function FilterRow<T extends string>({ label, options, value, onChange }: {
  label: string; options: { id: T; label: string; a11y?: string }[]; value: T; onChange: (v: T) => void;
}) {
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
  const r = m.result;
  const b = r?.breakdown;
  const t = rideTypeOf(b) ?? m.ride.expectedType;
  const typeLabel = rideTypeLabel(t, b);
  const away = m.fromMeMi != null
    ? m.fromMeMi < 0.3 && inArea ? 'Starts right here' : `${formatDistance(m.fromMeMi * 1609.344)} ${inArea ? 'away' : 'from the Capitol'}`
    : '';
  const shape = m.ride.shape === 'loop' ? 'Loop' : 'Out and back';
  const a11y = [m.ride.name, r ? formatDistance(r.distanceM).replace(' mi', ' miles') : null, typeLabel].filter(Boolean).join(', ');
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
          <View style={[styles.typeBadge, { backgroundColor: TYPE_COLOR[t] }]}>
            <Text style={styles.typeText}>{typeLabel}</Text>
          </View>
        </View>

        {r ? (
          <Text style={styles.stats}>
            {formatDistance(r.distanceM)}  ·  {formatDuration(r.timeS)}  ·  {metersToFeet(r.climbM)} ft climb
            {b ? `  ·  ${Math.round(b.path * 100)}% car-free  ·  ${Math.round((1 - b.unpaved) * 100)}% paved` : ''}
          </Text>
        ) : (
          <Text style={styles.statsMuted}>{failed ? 'Couldn’t measure right now' : 'Measuring…'}</Text>
        )}
        {b && (
          <View style={styles.mixBar}>
            <View style={{ flex: b.path, backgroundColor: '#15803d' }} />
            <View style={{ flex: b.lane, backgroundColor: '#2563eb' }} />
            <View style={{ flex: b.quiet, backgroundColor: '#86efac' }} />
            <View style={{ flex: b.road, backgroundColor: '#f97316' }} />
          </View>
        )}
        <Text style={styles.desc}>{m.ride.description}</Text>
        <View style={styles.cardFoot}>
          <Ionicons name="location-outline" size={14} color={COLORS.muted} />
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
          accessibilityLabel={`Preview ${m.ride.name}`}>
          <Ionicons name="play-circle" size={18} color={ACCENT} />
          <Text style={styles.previewText}>Preview</Text>
        </Pressable>
        <Pressable
          style={styles.rideBtn}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`Use this ride: ${m.ride.name}`}
          accessibilityHint="Loads it in the planner, ready to start">
          <Text style={styles.rideBtnText}>Use this ride</Text>
          <Ionicons name="chevron-forward" size={16} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

const TYPE_COLOR: Record<RideType, string> = { trail: '#15803d', gravel: '#a16207', road: '#2563eb' };

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: BRAND.cream },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: COLORS.bg },
  title: { fontSize: 24, fontFamily: FONT.black, color: COLORS.text },
  done: { fontSize: 16, fontWeight: '700', color: ACCENT },
  doneBtn: { minHeight: 44, justifyContent: 'center' },
  note: { fontSize: 14, color: COLORS.muted, backgroundColor: COLORS.bg, paddingHorizontal: 16, paddingBottom: 8 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, backgroundColor: COLORS.bg, paddingHorizontal: 16, paddingBottom: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 14, height: 8, borderRadius: 2 },
  legendText: { fontSize: 13, color: COLORS.muted },
  filterRow: { backgroundColor: COLORS.bg, paddingLeft: 16, paddingBottom: 10, gap: 6 },
  filterLabel: { fontSize: 13, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  chip: { paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.bg },
  chipOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  chipTextOn: { color: '#fff' },
  measuring: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  measuringText: { fontSize: 14, color: COLORS.muted },
  empty: { textAlign: 'center', color: COLORS.muted, padding: 24, fontSize: 15 },
  card: {
    backgroundColor: COLORS.bg, borderRadius: 16, padding: 14, gap: 8,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardTitle: { fontSize: 18, fontFamily: FONT.black, color: COLORS.text },
  cardArea: { fontSize: 14, color: COLORS.muted, marginTop: 2 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  typeText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  stats: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.text },
  statsMuted: { fontSize: 14, color: COLORS.muted },
  mixBar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: '#e5e7eb' },
  desc: { fontSize: 15, color: COLORS.text, lineHeight: 21 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footText: { fontSize: 14, color: COLORS.muted, flexShrink: 1 },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  previewBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5,
    borderColor: ACCENT, borderRadius: 12, minHeight: 44,
  },
  previewText: { color: ACCENT, fontWeight: '700', fontSize: 14 },
  rideBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: BRAND.red,
    borderRadius: 12, minHeight: 44,
  },
  rideBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
