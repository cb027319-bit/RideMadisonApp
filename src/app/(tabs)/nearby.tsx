import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BCYCLE_PRICING_URL, bikeSummary } from '@/lib/bcycle';
import { BRAND, COLORS, FONT } from '@/lib/config';
import { useData, type Selection } from '@/lib/data';
import { distanceMeters, formatDistance } from '@/lib/geo';
import { openStatus } from '@/lib/hours';
import { PLACE_META, timeAgo } from '@/lib/labels';
import { distanceOrigin, OUTSIDE_NOTE } from '@/lib/origin';
import { isPartnerPlace, partnersToPin } from '@/lib/partners';
import { trailsByDistance, VERDICT_LABEL, verdictFor } from '@/lib/trails';

type Tab = 'bcycle' | 'trails' | 'shop' | 'repair' | 'food' | 'drink';

const TABS: { id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'bcycle', label: 'BCycle', icon: 'bicycle' },
  { id: 'trails', label: 'Trails', icon: 'trail-sign' },
  { id: 'shop', label: 'Shops', icon: 'storefront' },
  { id: 'repair', label: 'Fix-it', icon: 'construct' },
  { id: 'food', label: 'Eat', icon: 'restaurant' },
  { id: 'drink', label: 'Drink', icon: 'beer' },
];

/** Which partner categories appear at the top of each tab. */
const PARTNER_TAB: Record<string, Tab> = { shop: 'shop', food: 'food', drink: 'drink' };

interface Row {
  key: string;
  title: string;
  subtitle: string;
  /** "Open now · closes 10 pm" etc., when hours are known. */
  status?: { open: boolean; text: string };
  meters: number;
  badge?: { text: string; muted: boolean; partner?: boolean };
  selection: Selection;
}

export default function NearbyScreen() {
  const {
    stations, places, partners, trails, pathById, foodState, foodError, loadFood, location, locationDenied, stationsUpdatedAt,
    refreshAll, focus,
  } = useData();
  const [tab, setTab] = useState<Tab>('bcycle');
  const [refreshing, setRefreshing] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);
  const { origin, fromMe, outside } = distanceOrigin(location);

  // Measuring every trail is the slow part: only when the Trails tab is open.
  const trailRows = useMemo<Row[]>(() => {
    if (tab !== 'trails') return [];
    return trailsByDistance(trails, pathById, origin)
      .slice(0, 60)
      .map(({ trail: t, meters }) => {
        const surface = t.unpavedShare < 0.1 ? 'Paved' : t.unpavedShare > 0.9 ? 'Unpaved' : 'Partly unpaved';
        const verdict = verdictFor(t.rules);
        return {
          key: t.id,
          title: t.name ?? 'Trail',
          subtitle: [formatDistance(t.lengthM), surface, verdict === 'free' ? null : VERDICT_LABEL[verdict]].filter(Boolean).join('  ·  '),
          meters,
          selection: { type: 'trail' as const, item: t },
        };
      });
  }, [tab, trails, pathById, origin.latitude, origin.longitude]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo<Row[]>(() => {
    if (tab === 'trails') return trailRows;
    const dist = (lat: number, lon: number) => distanceMeters(origin.latitude, origin.longitude, lat, lon);
    let list: Row[];
    if (tab === 'bcycle') {
      list = stations.map((s) => ({
        key: s.id,
        title: s.name,
        subtitle: `${s.docks} open ${s.docks === 1 ? 'spot' : 'spots'} to return${s.renting ? '' : '  ·  not renting'}`,
        meters: dist(s.lat, s.lon),
        badge: { text: bikeSummary(s), muted: !s.renting || s.bikes === 0 },
        selection: { type: 'station', item: s },
      }));
    } else {
      list = places
        .filter((p) => p.kind === tab && !isPartnerPlace(p, partners))
        .map((p) => ({
          key: p.id,
          title: p.name ?? PLACE_META[p.kind].fallbackName,
          subtitle: [...p.details, p.address].filter(Boolean).join('  ·  ') || PLACE_META[p.kind].label,
          status: openStatus(p.hours) ?? undefined,
          meters: dist(p.lat, p.lon),
          selection: { type: 'place', item: p },
        }));
    }
    const sorted = list.sort((a, b) => a.meters - b.meters).slice(0, 100);
    // Paying partners for this category are pinned to the top only when close by (max 2), clearly labeled.
    const featured: Row[] = partnersToPin(partners, origin, (p) => PARTNER_TAB[p.category] === tab).map(({ partner: p, meters }) => ({
      key: `partner:${p.id}`,
      title: p.name,
      subtitle: p.offer ?? p.blurb ?? p.address ?? '',
      status: openStatus(p.hours) ?? undefined,
      meters,
      badge: { text: p.demo ? 'Sponsored · sample' : 'Sponsored', muted: false, partner: true },
      selection: { type: 'partner' as const, item: p },
    }));
    return [...featured, ...sorted];
  }, [tab, trailRows, stations, places, partners, origin.latitude, origin.longitude]); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = async () => {
    setRefreshing(true);
    if (tab === 'food' || tab === 'drink') loadFood(true);
    else await refreshAll();
    setRefreshing(false);
  };

  const open = (row: Row) => {
    focus(row.selection);
    router.navigate('/');
  };

  // Loading / error message for Eat and Drink. Shown under any partner rows too, so a
  // sponsored listing never hides that the rest of the list is still loading.
  const foodTab = tab === 'food' || tab === 'drink' ? tab : null;
  const what = foodTab === 'drink' ? 'bars and breweries' : 'restaurants and cafés';
  const status =
    foodTab && foodState[foodTab] === 'loading' ? (
      <View style={styles.emptyBox}>
        <ActivityIndicator color={COLORS.brand} />
        <Text style={styles.empty}>Loading {what}… this can take up to 30 seconds the first time.</Text>
      </View>
    ) : foodTab && foodState[foodTab] === 'error' ? (
      <Pressable style={styles.emptyBox} onPress={() => loadFood(true)} accessibilityRole="button">
        <Text style={styles.empty}>Couldn&apos;t load {what}. Check your connection and tap to try again.</Text>
        {__DEV__ && foodError[foodTab] ? <Text style={styles.errorText}>{foodError[foodTab]}</Text> : null}
      </Pressable>
    ) : null;

  const emptyText =
    tab === 'trails' ? 'Trails are still loading. Pull down to refresh.' : 'Nothing to show yet. Check your connection and try again.';

  const bcycleHowTo =
    tab === 'bcycle' ? (
      <View style={styles.howTo}>
        <Pressable
          onPress={() => setHowToOpen((o) => !o)}
          style={styles.howToHead}
          accessibilityRole="button"
          accessibilityState={{ expanded: howToOpen }}>
          <Ionicons name="help-circle-outline" size={20} color={COLORS.brand} />
          <Text style={styles.howToTitle}>New to BCycle?</Text>
          <Ionicons name={howToOpen ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.brand} />
        </Pressable>
        {howToOpen && (
          <View style={{ gap: 4, paddingBottom: 4 }}>
            <Text style={styles.howToText}>1. Get the BCycle app and pay per ride or buy a pass.</Text>
            <Text style={styles.howToText}>2. Unlock a bike at any station with the app.</Text>
            <Text style={styles.howToText}>3. Return it to any station with an open spot. Most bikes are e-bikes.</Text>
            <Pressable onPress={() => void Linking.openURL(BCYCLE_PRICING_URL)} accessibilityRole="link" style={styles.linkRow}>
              <Text style={styles.link}>See BCycle prices</Text>
            </Pressable>
          </View>
        )}
      </View>
    ) : null;

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={styles.segment}
        accessibilityRole="tablist">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => {
                setTab(t.id);
                if (t.id === 'food' || t.id === 'drink') loadFood();
              }}
              accessibilityRole="tab"
              accessibilityLabel={t.label}
              accessibilityState={{ selected: active }}
              style={[styles.segmentItem, active && styles.segmentActive]}>
              <Ionicons name={t.icon} size={16} color={active ? '#fff' : COLORS.inactive} />
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={styles.note}>
        {outside ? OUTSIDE_NOTE : fromMe ? 'Sorted by distance from you' : locationDenied ? 'Location off: sorted from the Capitol' : 'Finding your location…'}
        {tab === 'bcycle' && stationsUpdatedAt ? `  ·  updated ${timeAgo(stationsUpdatedAt)}` : ''}
      </Text>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        ListHeaderComponent={bcycleHowTo ?? undefined}
        ListEmptyComponent={status ?? <Text style={styles.empty}>{emptyText}</Text>}
        ListFooterComponent={rows.length > 0 && status ? status : undefined}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => open(item)}
            accessibilityRole="button"
            accessibilityHint="Opens details on the map"
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: '#f3f4f6' }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
              {item.subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{item.subtitle}</Text> : null}
              {item.status ? (
                <Text style={[styles.open, !item.status.open && styles.closed]} numberOfLines={1}>{item.status.text}</Text>
              ) : null}
            </View>
            <View style={styles.right}>
              {item.badge && (
                <Text style={[styles.badge, item.badge.muted && styles.badgeMuted, item.badge.partner && styles.badgePartner]}>
                  {item.badge.text}
                </Text>
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
  segment: { paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  segmentItem: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 999,
    backgroundColor: '#f3f4f6',
  },
  segmentActive: { backgroundColor: BRAND.navy },
  segmentText: { fontSize: 14, fontFamily: FONT.bold, color: COLORS.inactive },
  segmentTextActive: { color: '#fff' },
  note: { fontSize: 14, color: COLORS.muted, paddingHorizontal: 16, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10, minHeight: 56 },
  title: { fontSize: 16, fontFamily: FONT.bold, color: COLORS.text },
  subtitle: { fontSize: 14, color: COLORS.muted, marginTop: 2 },
  open: { fontSize: 14, fontFamily: FONT.bold, color: '#065f46', marginTop: 2 },
  closed: { color: COLORS.muted },
  right: { alignItems: 'flex-end', gap: 2, maxWidth: '40%' },
  badge: {
    fontSize: 13, fontWeight: '700', color: '#fff', backgroundColor: COLORS.bcycle, textAlign: 'center',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden',
  },
  badgeMuted: { backgroundColor: COLORS.bcycleEmpty },
  badgePartner: { backgroundColor: BRAND.gold, color: BRAND.navy },
  distance: { fontSize: 14, color: COLORS.text, fontWeight: '500' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border, marginLeft: 16 },
  empty: { textAlign: 'center', fontSize: 15, color: COLORS.muted, padding: 16 },
  emptyBox: { alignItems: 'center', padding: 24, gap: 8 },
  errorText: { fontSize: 13, color: '#b91c1c', textAlign: 'center', paddingHorizontal: 16 },
  howTo: { marginHorizontal: 16, marginBottom: 6, paddingHorizontal: 12, borderRadius: 12, backgroundColor: BRAND.cream },
  howToHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  howToTitle: { flex: 1, fontSize: 15, fontFamily: FONT.bold, color: COLORS.brand },
  howToText: { fontSize: 14, color: COLORS.text, lineHeight: 19 },
  linkRow: { minHeight: 44, justifyContent: 'center' },
  link: { fontSize: 14, color: COLORS.brand, textDecorationLine: 'underline' },
});
