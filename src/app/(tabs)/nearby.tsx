import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { COLORS, MADISON_CENTER } from '@/lib/config';
import { useData, type Selection } from '@/lib/data';
import { distanceMeters, formatDistance } from '@/lib/geo';
import { PLACE_META, timeAgo } from '@/lib/labels';

type Tab = 'bcycle' | 'shop' | 'repair';

const TABS: { id: Tab; label: string }[] = [
  { id: 'bcycle', label: 'BCycle' },
  { id: 'shop', label: 'Bike shops' },
  { id: 'repair', label: 'Fix-it' },
];

interface Row {
  key: string;
  title: string;
  subtitle: string;
  meters: number;
  badge?: { text: string; muted: boolean };
  selection: Selection;
}

export default function NearbyScreen() {
  const { stations, places, location, locationDenied, stationsUpdatedAt, refreshStations, focus } = useData();
  const [tab, setTab] = useState<Tab>('bcycle');
  const [refreshing, setRefreshing] = useState(false);
  const origin = location ?? MADISON_CENTER;

  const rows = useMemo<Row[]>(() => {
    const dist = (lat: number, lon: number) => distanceMeters(origin.latitude, origin.longitude, lat, lon);
    let list: Row[];
    if (tab === 'bcycle') {
      list = stations.map((s) => ({
        key: s.id,
        title: s.name,
        subtitle: `${s.docks} open docks${s.renting ? '' : '  ·  not renting'}`,
        meters: dist(s.lat, s.lon),
        badge: { text: `${s.bikes} ${s.bikes === 1 ? 'bike' : 'bikes'}`, muted: !s.renting || s.bikes === 0 },
        selection: { type: 'station', item: s },
      }));
    } else {
      list = places
        .filter((p) => p.kind === tab)
        .map((p) => ({
          key: p.id,
          title: p.name ?? PLACE_META[p.kind].fallbackName,
          subtitle: [p.address, ...p.details].filter(Boolean).join('  ·  ') || PLACE_META[p.kind].label,
          meters: dist(p.lat, p.lon),
          selection: { type: 'place', item: p },
        }));
    }
    return list.sort((a, b) => a.meters - b.meters).slice(0, 100);
  }, [tab, stations, places, origin.latitude, origin.longitude]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshStations();
    setRefreshing(false);
  };

  const open = (row: Row) => {
    focus(row.selection);
    router.navigate('/');
  };

  return (
    <View style={styles.container}>
      <View style={styles.segment} accessibilityRole="tablist">
        {TABS.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => setTab(t.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.id }}
            style={[styles.segmentItem, tab === t.id && styles.segmentActive]}>
            <Text style={[styles.segmentText, tab === t.id && styles.segmentTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.note}>
        {location ? 'Sorted by distance from you' : locationDenied ? 'Location off: sorted from the Capitol' : 'Finding your location…'}
        {tab === 'bcycle' && stationsUpdatedAt ? `  ·  updated ${timeAgo(stationsUpdatedAt)}` : ''}
      </Text>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        refreshControl={tab === 'bcycle' ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        ListEmptyComponent={<Text style={styles.empty}>Nothing to show yet. Check your connection and pull to refresh.</Text>}
        renderItem={({ item }) => (
          <Pressable onPress={() => open(item)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: '#f3f4f6' }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.subtitle} numberOfLines={1}>{item.subtitle}</Text>
            </View>
            <View style={styles.right}>
              {item.badge && (
                <Text style={[styles.badge, item.badge.muted && styles.badgeMuted]}>{item.badge.text}</Text>
              )}
              <Text style={styles.distance}>{formatDistance(item.meters)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  segment: { flexDirection: 'row', margin: 12, backgroundColor: '#f3f4f6', borderRadius: 10, padding: 3 },
  segmentItem: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: COLORS.bg, elevation: 1, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 2 },
  segmentText: { fontSize: 14, fontWeight: '600', color: COLORS.muted },
  segmentTextActive: { color: COLORS.text },
  note: { fontSize: 13, color: COLORS.muted, paddingHorizontal: 16, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  title: { fontSize: 16, fontWeight: '600', color: COLORS.text },
  subtitle: { fontSize: 13, color: COLORS.muted, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 2 },
  badge: {
    fontSize: 12, fontWeight: '700', color: '#fff', backgroundColor: COLORS.bcycle,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden',
  },
  badgeMuted: { backgroundColor: '#9ca3af' },
  distance: { fontSize: 13, color: COLORS.text, fontWeight: '500' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border, marginLeft: 16 },
  empty: { textAlign: 'center', color: COLORS.muted, padding: 32 },
});
