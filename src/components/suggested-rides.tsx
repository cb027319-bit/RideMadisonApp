// Suggested rides browser: filter classic Madison rides by length, type and
// distance from you. Rides are measured with the bike router the first time
// and cached, so the numbers shown are real.

import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { cached } from '@/lib/cache';
import { COLORS, MADISON_CENTER } from '@/lib/config';
import { simplify, type LonLat } from '@/lib/geo';
import { fetchRoute, formatDuration, metersToFeet, type LatLon, type RouteResult } from '@/lib/routing';
import {
  closestMiles, filterRides, FROM_ME_FILTERS, LENGTH_FILTERS, RIDE_TYPE_LABEL, rideTypeOf, routePoints,
  SUGGESTED_RIDES, type FromMeFilter, type LengthFilter, type MeasuredRide, type RideType, type SuggestedRide,
} from '@/lib/suggested';

const ACCENT = '#7c3aed';
const TTL = 30 * 24 * 3600 * 1000;

/** Keep cached rides light: ~2 m line simplification. */
function lighten(r: RouteResult): RouteResult {
  const line: LonLat[] = r.coords.map((c) => [c.longitude, c.latitude]);
  const idx = new Map(line.map((c, i) => [c, i] as const));
  const keep = new Set(simplify(line, 0.00002).map((c) => idx.get(c)!));
  return { ...r, coords: r.coords.filter((_, i) => keep.has(i)), elevations: r.elevations.filter((_, i) => keep.has(i)) };
}

const measure = (ride: SuggestedRide) =>
  cached(`suggested:v1:${ride.id}`, TTL, async () => lighten(await fetchRoute(routePoints(ride), ride.profile)));

interface Props {
  visible: boolean;
  location: LatLon | null;
  onClose: () => void;
  onPick: (ride: SuggestedRide, result?: RouteResult) => void;
}

export function SuggestedRidesSheet({ visible, location, onClose, onPick }: Props) {
  const [results, setResults] = useState<Record<string, RouteResult | 'error'>>({});
  const [length, setLength] = useState<LengthFilter>('any');
  const [type, setType] = useState<RideType | 'any'>('any');
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

  const origin = location ?? MADISON_CENTER;
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
          <Text style={styles.title}>Suggested rides</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>

        <FilterRow label="Length" options={LENGTH_FILTERS.map((l) => ({ id: l.id, label: l.label }))} value={length} onChange={setLength} />
        <FilterRow
          label="Type"
          options={[{ id: 'any', label: 'Any type' }, ...(Object.keys(RIDE_TYPE_LABEL) as RideType[]).map((t) => ({ id: t, label: RIDE_TYPE_LABEL[t] }))]}
          value={type}
          onChange={setType}
        />
        <FilterRow
          label={location ? 'From you' : 'From the Capitol'}
          options={FROM_ME_FILTERS.map((f) => ({ id: f.id, label: f.label }))}
          value={fromMe}
          onChange={setFromMe}
        />

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
            <RideCard m={item} failed={results[item.ride.id] === 'error'} onPress={() => onPick(item.ride, item.result)} />
          )}
        />
      </View>
    </Modal>
  );
}

function FilterRow<T extends string>({ label, options, value, onChange }: {
  label: string; options: { id: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <View style={styles.filterRow}>
      <Text style={styles.filterLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 16 }}>
        {options.map((o) => (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === o.id }}
            style={[styles.chip, value === o.id && styles.chipOn]}>
            <Text style={[styles.chipText, value === o.id && styles.chipTextOn]}>{o.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function RideCard({ m, failed, onPress }: { m: MeasuredRide; failed: boolean; onPress: () => void }) {
  const r = m.result;
  const t = rideTypeOf(r?.breakdown) ?? m.ride.expectedType;
  const b = r?.breakdown;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]} accessibilityRole="button">
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{m.ride.name}</Text>
          <Text style={styles.cardArea}>{m.ride.area}</Text>
        </View>
        <View style={[styles.typeBadge, { backgroundColor: TYPE_COLOR[t] }]}>
          <Text style={styles.typeText}>{RIDE_TYPE_LABEL[t]}</Text>
        </View>
      </View>

      {r ? (
        <Text style={styles.stats}>
          {(r.distanceM / 1609.344).toFixed(1)} mi  ·  {formatDuration(r.timeS)}  ·  {metersToFeet(r.climbM)} ft climb
          {b ? `  ·  ${Math.round((1 - b.unpaved) * 100)}% paved` : ''}
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
          {m.fromMeMi != null ? (m.fromMeMi < 0.3 ? 'Starts right here' : `${m.fromMeMi.toFixed(1)} mi away`) : ''}
          {'  ·  '}
          {m.ride.shape === 'loop' ? 'Loop' : 'Out and back'}
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.ride}>Ride this</Text>
        <Ionicons name="chevron-forward" size={16} color={ACCENT} />
      </View>
    </Pressable>
  );
}

const TYPE_COLOR: Record<RideType, string> = { trail: '#15803d', gravel: '#a16207', road: '#2563eb' };

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: '#f9fafb' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: COLORS.bg },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.text },
  done: { fontSize: 16, fontWeight: '700', color: ACCENT },
  filterRow: { backgroundColor: COLORS.bg, paddingLeft: 16, paddingBottom: 10, gap: 6 },
  filterLabel: { fontSize: 12, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.bg },
  chipOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  chipTextOn: { color: '#fff' },
  measuring: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  measuringText: { fontSize: 13, color: COLORS.muted },
  empty: { textAlign: 'center', color: COLORS.muted, padding: 24 },
  card: {
    backgroundColor: COLORS.bg, borderRadius: 16, padding: 14, gap: 8,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardTitle: { fontSize: 17, fontWeight: '800', color: COLORS.text },
  cardArea: { fontSize: 13, color: COLORS.muted, marginTop: 2 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  typeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  stats: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  statsMuted: { fontSize: 14, color: COLORS.muted },
  mixBar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: '#e5e7eb' },
  desc: { fontSize: 14, color: COLORS.text, lineHeight: 19 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footText: { fontSize: 13, color: COLORS.muted },
  ride: { fontSize: 14, fontWeight: '700', color: ACCENT },
});
