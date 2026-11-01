import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LocationPrompt } from '@/components/location-prompt';
import { BCYCLE_PRICING_URL, bikeSummary } from '@/lib/bcycle';
import { COLORS, FONT } from '@/lib/config';
import { useData, type Selection } from '@/lib/data';
import { distanceMeters, formatDistance } from '@/lib/geo';
import { openStatus } from '@/lib/hours';
import { useT } from '@/lib/i18n';
import { PLACE_META, timeAgo } from '@/lib/labels';
import { detailLabel } from '@/lib/osm';
import { distanceOrigin, outsideNote } from '@/lib/origin';
import { isPartnerPlace, partnersToPin } from '@/lib/partners';
import { makeStyles, useTheme } from '@/lib/theme';
import { trailsByDistance, VERDICT_LABEL, verdictFor } from '@/lib/trails';

type Tab = 'bcycle' | 'trails' | 'shop' | 'repair' | 'food' | 'drink';

/** `label` is an i18n key (BCycle is a brand name and stays as-is). */
const TABS: { id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'bcycle', label: 'BCycle', icon: 'bicycle' },
  { id: 'trails', label: 'map.layer.trails', icon: 'trail-sign' },
  { id: 'shop', label: 'map.tabs.shops', icon: 'storefront' },
  { id: 'repair', label: 'map.tabs.fixit', icon: 'construct' },
  { id: 'food', label: 'map.place.food', icon: 'restaurant' },
  { id: 'drink', label: 'map.place.drink', icon: 'beer' },
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
    stations, places, partners, trails, pathById, foodState, foodError, loadFood, location, stationsUpdatedAt,
    refreshAll, focus,
  } = useData();
  const [tab, setTab] = useState<Tab>('bcycle');
  const [refreshing, setRefreshing] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);
  const { origin, fromMe, outside } = distanceOrigin(location);
  const { t, lang } = useT();
  const { c } = useTheme();
  const styles = useStyles();

  // Measuring every trail is the slow part: only when the Trails tab is open.
  const trailRows = useMemo<Row[]>(() => {
    if (tab !== 'trails') return [];
    return trailsByDistance(trails, pathById, origin)
      .slice(0, 60)
      .map(({ trail: tr, meters }) => {
        const surface = t(tr.unpavedShare < 0.1 ? 'map.surface.paved' : tr.unpavedShare > 0.9 ? 'map.surface.unpaved' : 'map.surface.partly');
        const verdict = verdictFor(tr.rules);
        return {
          key: tr.id,
          title: tr.name ?? t('map.trail'),
          subtitle: [formatDistance(tr.lengthM), surface, verdict === 'free' ? null : VERDICT_LABEL[verdict]].filter(Boolean).join('  ·  '),
          meters,
          selection: { type: 'trail' as const, item: tr },
        };
      });
  }, [tab, trails, pathById, origin.latitude, origin.longitude, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo<Row[]>(() => {
    if (tab === 'trails') return trailRows;
    const dist = (lat: number, lon: number) => distanceMeters(origin.latitude, origin.longitude, lat, lon);
    let list: Row[];
    if (tab === 'bcycle') {
      list = stations.map((s) => ({
        key: s.id,
        title: s.name,
        subtitle: `${t('map.openSpots', { count: s.docks })}${s.renting ? '' : `  ·  ${t('map.notRentingShort')}`}`,
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
          subtitle: [...p.details.map(detailLabel), p.address].filter(Boolean).join('  ·  ') || PLACE_META[p.kind].label,
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
      badge: { text: p.demo ? t('map.sponsoredSample') : t('common.sponsored'), muted: false, partner: true },
      selection: { type: 'partner' as const, item: p },
    }));
    return [...featured, ...sorted];
    // lang: subtitles and hours text are built in the current language.
  }, [tab, trailRows, stations, places, partners, origin.latitude, origin.longitude, t, lang]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const what = t(foodTab === 'drink' ? 'map.what.drink' : 'map.what.food');
  const status =
    foodTab && foodState[foodTab] === 'loading' ? (
      <View style={styles.emptyBox}>
        <ActivityIndicator color={c.primary} />
        <Text style={styles.empty}>{t('map.loadingWhat', { what })}</Text>
      </View>
    ) : foodTab && foodState[foodTab] === 'error' ? (
      <Pressable style={styles.emptyBox} onPress={() => loadFood(true)} accessibilityRole="button">
        <Text style={styles.empty}>{t('map.loadError', { what })}</Text>
        {__DEV__ && foodError[foodTab] ? <Text style={styles.errorText}>{foodError[foodTab]}</Text> : null}
      </Pressable>
    ) : null;

  const emptyText =
    tab === 'trails' ? t('map.emptyTrails') : t('map.emptyGeneric');

  const bcycleHowTo =
    tab === 'bcycle' ? (
      <View style={styles.howTo}>
        <Pressable
          onPress={() => setHowToOpen((o) => !o)}
          style={styles.howToHead}
          accessibilityRole="button"
          accessibilityState={{ expanded: howToOpen }}>
          <Ionicons name="help-circle-outline" size={20} color={c.primary} />
          <Text style={styles.howToTitle}>{t('map.newToBcycle')}</Text>
          <Ionicons name={howToOpen ? 'chevron-up' : 'chevron-down'} size={18} color={c.primary} />
        </Pressable>
        {howToOpen && (
          <View style={{ gap: 4, paddingBottom: 4 }}>
            <Text style={styles.howToText}>{t('map.howto1')}</Text>
            <Text style={styles.howToText}>{t('map.howto2')}</Text>
            <Text style={styles.howToText}>{t('map.howto3')}</Text>
            <Pressable onPress={() => void Linking.openURL(BCYCLE_PRICING_URL)} accessibilityRole="link" style={styles.linkRow}>
              <Text style={styles.link}>{t('map.bcyclePrices')}</Text>
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
        {TABS.map((tb) => {
          const active = tab === tb.id;
          const label = tb.id === 'bcycle' ? tb.label : t(tb.label);
          return (
            <Pressable
              key={tb.id}
              onPress={() => {
                setTab(tb.id);
                if (tb.id === 'food' || tb.id === 'drink') loadFood();
              }}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: active }}
              style={[styles.segmentItem, active && styles.segmentActive]}>
              <Ionicons name={tb.icon} size={16} color={active ? c.onPrimary : c.textFaint} />
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={styles.note}>
        {outside ? outsideNote() : fromMe ? t('map.sortedFromYou') : t('map.sortedFromCapitol')}
        {tab === 'bcycle' && stationsUpdatedAt ? `  ·  ${t('map.updatedAgo', { ago: timeAgo(stationsUpdatedAt) })}` : ''}
      </Text>
      <LocationPrompt action={t('map.sortByDistance')} />

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
            accessibilityHint={t('map.opensOnMap')}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.pressed }]}>
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
            <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
          </Pressable>
        )}
      />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.bg },
  segment: { paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  segmentItem: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 999,
    backgroundColor: c.surfaceAlt,
  },
  segmentActive: { backgroundColor: c.primary },
  segmentText: { fontSize: 14, fontFamily: FONT.bold, color: c.textFaint },
  segmentTextActive: { color: c.onPrimary },
  note: { fontSize: 14, color: c.textMuted, paddingHorizontal: 16, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10, minHeight: 56 },
  title: { fontSize: 16, fontFamily: FONT.bold, color: c.text },
  subtitle: { fontSize: 14, color: c.textMuted, marginTop: 2 },
  open: { fontSize: 14, fontFamily: FONT.bold, color: c.dark ? c.success : '#065f46', marginTop: 2 },
  closed: { color: c.textMuted },
  right: { alignItems: 'flex-end', gap: 2, maxWidth: '40%' },
  badge: {
    fontSize: 13, fontWeight: '700', color: '#fff', backgroundColor: c.dark ? '#3B5BA9' : COLORS.bcycle, textAlign: 'center',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden',
  },
  badgeMuted: { backgroundColor: COLORS.bcycleEmpty },
  badgePartner: { backgroundColor: c.gold, color: c.onGold },
  distance: { fontSize: 14, color: c.text, fontWeight: '500' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 16 },
  empty: { textAlign: 'center', fontSize: 15, color: c.textMuted, padding: 16 },
  emptyBox: { alignItems: 'center', padding: 24, gap: 8 },
  errorText: { fontSize: 13, color: c.danger, textAlign: 'center', paddingHorizontal: 16 },
  howTo: { marginHorizontal: 16, marginBottom: 6, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.surfaceAlt },
  howToHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  howToTitle: { flex: 1, fontSize: 15, fontFamily: FONT.bold, color: c.primary },
  howToText: { fontSize: 14, color: c.text, lineHeight: 19 },
  linkRow: { minHeight: 44, justifyContent: 'center' },
  link: { fontSize: 14, color: c.primary, textDecorationLine: 'underline' },
}));
