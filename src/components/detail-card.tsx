import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { COLORS } from '@/lib/config';
import type { Selection } from '@/lib/data';
import { distanceMeters, formatDistance } from '@/lib/geo';
import { PATH_META, PLACE_META, timeAgo } from '@/lib/labels';
import { callPhone, openBikeDirections, openWebsite } from '@/lib/links';
import { TRAIL_PASS_URL, type Trail } from '@/lib/trails';

interface Props {
  selection: Selection;
  location: { latitude: number; longitude: number } | null;
  /** Point to route to (for trails: the closest point on the trail). */
  target: { latitude: number; longitude: number };
  isEbikeRider?: boolean;
  onClose: () => void;
  onRouteHere: (label: string) => void;
}

export function DetailCard({ selection, location, target, isEbikeRider, onClose, onRouteHere }: Props) {
  const dist = location
    ? formatDistance(distanceMeters(location.latitude, location.longitude, target.latitude, target.longitude))
    : null;
  const name = title(selection);

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

      <ScrollView style={{ maxHeight: 260 }} bounces={false}>
        <Body selection={selection} isEbikeRider={isEbikeRider} />
      </ScrollView>

      <View style={styles.actions}>
        <Action
          icon="navigate"
          label={selection.type === 'trail' ? 'Route to trail' : 'Route here'}
          primary
          onPress={() => onRouteHere(name)}
        />
        {selection.type === 'trail' && selection.item.rules && (
          <Action icon="ticket-outline" label="Trail pass" onPress={() => void Linking.openURL(TRAIL_PASS_URL)} />
        )}
        {selection.type === 'station' && (
          <Action icon="flash-outline" label="BCycle app" onPress={() => void Linking.openURL('https://madison.bcycle.com')} />
        )}
        {selection.type === 'place' && selection.item.phone && (
          <Action icon="call" label="Call" onPress={() => callPhone(selection.item.phone!)} />
        )}
        {selection.type === 'place' && selection.item.website && (
          <Action icon="globe-outline" label="Website" onPress={() => openWebsite(selection.item.website!)} />
        )}
        {selection.type !== 'trail' && (
          <Action icon="logo-google" label="Google Maps" onPress={() => openBikeDirections(target.latitude, target.longitude)} />
        )}
      </View>
    </View>
  );
}

function Body({ selection, isEbikeRider }: { selection: Selection; isEbikeRider?: boolean }) {
  if (selection.type === 'trail') return <TrailBody trail={selection.item} isEbikeRider={isEbikeRider} />;
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
  if (s.type === 'place') return PLACE_META[s.item.kind].label;
  return s.item.kind === 'lane' ? 'Bike lane' : PATH_META[s.item.kind].label;
}

function title(s: Selection): string {
  if (s.type === 'station') return s.item.name;
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
