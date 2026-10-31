import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COLORS } from '@/lib/config';
import type { Selection } from '@/lib/data';
import { distanceMeters, formatDistance } from '@/lib/geo';
import { PATH_META, PLACE_META, timeAgo } from '@/lib/labels';
import { callPhone, openBikeDirections, openWebsite } from '@/lib/links';

interface Props {
  selection: Selection;
  location: { latitude: number; longitude: number } | null;
  onClose: () => void;
  onRouteHere: (label: string) => void;
}

export function DetailCard({ selection, location, onClose, onRouteHere }: Props) {
  const center = selectionCenter(selection);
  const dist = location
    ? formatDistance(distanceMeters(location.latitude, location.longitude, center.latitude, center.longitude))
    : null;

  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{kicker(selection)}{dist ? `  ·  ${dist} away` : ''}</Text>
          <Text style={styles.title} numberOfLines={2}>{title(selection)}</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close details">
          <Ionicons name="close-circle" size={28} color={COLORS.muted} />
        </Pressable>
      </View>

      <Body selection={selection} />

      {selection.type !== 'path' && (
        <View style={styles.actions}>
          <Action icon="navigate" label="Route here" primary onPress={() => onRouteHere(title(selection))} />
          <Action icon="bicycle" label="Google Maps" onPress={() => openBikeDirections(center.latitude, center.longitude)} />
          {selection.type === 'place' && selection.item.phone && (
            <Action icon="call" label="Call" onPress={() => callPhone(selection.item.phone!)} />
          )}
          {selection.type === 'place' && selection.item.website && (
            <Action icon="globe-outline" label="Website" onPress={() => openWebsite(selection.item.website!)} />
          )}
        </View>
      )}
    </View>
  );
}

function Body({ selection }: { selection: Selection }) {
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
        {s.lastReported ? <Text style={styles.muted}>Station reported {timeAgo(s.lastReported * 1000)}</Text> : null}
      </View>
    );
  }
  if (selection.type === 'place') {
    const p = selection.item;
    return (
      <View>
        {p.address ? <Text style={styles.line}>{p.address}</Text> : null}
        {p.hours ? <Text style={styles.line}>Hours: {p.hours}</Text> : null}
        {p.details.length > 0 && <Text style={styles.line}>{p.details.join('  ·  ')}</Text>}
      </View>
    );
  }
  const path = selection.item;
  return <View>{path.surface ? <Text style={styles.line}>Surface: {path.surface.replace(/_/g, ' ')}</Text> : null}</View>;
}

function Count({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View style={styles.count}>
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
      <Ionicons name={icon} size={18} color={primary ? '#fff' : COLORS.brand} />
      <Text style={[styles.actionText, primary && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export function selectionCenter(s: Selection): { latitude: number; longitude: number } {
  if (s.type === 'path') {
    const c = s.item.coords[Math.floor(s.item.coords.length / 2)];
    return { latitude: c[1], longitude: c[0] };
  }
  return { latitude: s.item.lat, longitude: s.item.lon };
}

function kicker(s: Selection): string {
  if (s.type === 'station') return 'BCycle station';
  if (s.type === 'place') return PLACE_META[s.item.kind].label;
  return PATH_META[s.item.kind].label;
}

function title(s: Selection): string {
  if (s.type === 'station') return s.item.name;
  if (s.type === 'place') return s.item.name ?? PLACE_META[s.item.kind].fallbackName;
  return s.item.name ?? PATH_META[s.item.kind].label;
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
  muted: { fontSize: 13, color: COLORS.muted, marginTop: 4 },
  warn: { fontSize: 14, color: '#b91c1c', fontWeight: '600', marginTop: 2 },
  counts: { flexDirection: 'row', gap: 24, marginVertical: 4 },
  count: { alignItems: 'flex-start' },
  countValue: { fontSize: 30, fontWeight: '800' },
  countLabel: { fontSize: 13, color: COLORS.muted },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.brand,
  },
  actionPrimary: { backgroundColor: COLORS.brand },
  actionText: { fontSize: 15, fontWeight: '600', color: COLORS.brand },
});
