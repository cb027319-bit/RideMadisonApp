import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';

import { EventForm } from '@/components/event-form';
import { useAuth } from '@/lib/auth';
import { cached } from '@/lib/cache';
import { FONT } from '@/lib/config';
import { useData } from '@/lib/data';
import {
  CATEGORY_ICON, EVENT_CATEGORIES, filterEvents, groupByDay, nearestParking, timeLabel, type EventFilter, type RideEvent,
} from '@/lib/events';
import { fetchEvents } from '@/lib/events-api';
import { formatDistance } from '@/lib/geo';
import { lang as currentLang, useT } from '@/lib/i18n';
import { useRoute } from '@/lib/route';
import { makeStyles, useTheme } from '@/lib/theme';

const EVENTS_TTL_MS = 30 * 60 * 1000;
const FILTERS: EventFilter[] = ['all', 'weekend', ...EVENT_CATEGORIES];

export default function EventsScreen() {
  const { t, lang } = useT();
  const { c } = useTheme();
  const styles = useStyles();
  const navigation = useNavigation();
  const { places } = useData();
  const { routeTo } = useRoute();
  const auth = useAuth();

  const [events, setEvents] = useState<RideEvent[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [stale, setStale] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<EventFilter>('all');
  const [open, setOpen] = useState<RideEvent | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(
    (force = false) =>
      cached('events:v1', EVENTS_TTL_MS, () => fetchEvents(), { force }).then(
        (r) => {
          setEvents(r.value);
          setStale(r.stale);
          setState('ready');
        },
        () => setState((s) => (s === 'ready' ? s : 'error')),
      ),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const add = useCallback(() => {
    if (auth.requireAccount(t('events.form.needsAccount'))) setAdding(true);
  }, [auth, t]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={add} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('events.addA11y')} style={styles.headerBtn}>
          <Ionicons name="add-circle-outline" size={26} color={c.primary} />
        </Pressable>
      ),
    });
  }, [navigation, add, c.primary, t, styles.headerBtn]);

  // lang: day titles and times are formatted in the current language.
  const sections = useMemo(() => groupByDay(filterEvents(events, filter)), [events, filter, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  };

  const rideThere = (e: RideEvent) => {
    if (e.latitude == null || e.longitude == null) return;
    routeTo({ latitude: e.latitude, longitude: e.longitude }, e.venue_name ?? e.title);
    setOpen(null);
    router.navigate('/route');
  };

  const filterLabel = (f: EventFilter) => (f === 'all' ? t('events.filter.all') : f === 'weekend' ? t('events.filter.weekend') : t(`events.cat.${f}`));

  const empty =
    state === 'loading' ? (
      <View style={styles.emptyBox}>
        <ActivityIndicator color={c.primary} />
        <Text style={styles.empty}>{t('events.loading')}</Text>
      </View>
    ) : state === 'error' ? (
      <Pressable style={styles.emptyBox} onPress={() => void load(true)} accessibilityRole="button">
        <Text style={styles.empty}>{t('events.loadError')}</Text>
      </Pressable>
    ) : (
      <Text style={styles.empty}>{events.length ? t('events.emptyFilter') : t('events.empty')}</Text>
    );

  const addCard = (
    <Pressable onPress={add} style={({ pressed }) => [styles.addCard, pressed && { opacity: 0.85 }]} accessibilityRole="button">
      <Ionicons name="calendar-outline" size={22} color={c.onPrimary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.addTitle}>{t('events.addPrompt')}</Text>
        <Text style={styles.addSub}>{t('events.addPromptSub')}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.onPrimary} />
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={styles.segment}
        accessibilityRole="tablist">
        {FILTERS.map((f) => {
          const active = filter === f;
          const icon = f === 'all' ? 'apps' : f === 'weekend' ? 'sunny' : CATEGORY_ICON[f];
          return (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.segmentItem, active && styles.segmentActive]}>
              <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={16} color={active ? c.onPrimary : c.textFaint} />
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{filterLabel(f)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {stale && <Text style={styles.note}>{t('events.offlineNote')}</Text>}

      <SectionList
        sections={sections}
        keyExtractor={(e) => e.id}
        stickySectionHeadersEnabled
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={empty}
        ListFooterComponent={state === 'ready' ? addCard : undefined}
        renderSectionHeader={({ section }) => (
          <Text style={styles.dayHeader} accessibilityRole="header">
            {section.title}
          </Text>
        )}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item }) => {
          const parking = nearestParking(item, places);
          const canRide = item.latitude != null && item.longitude != null;
          return (
            <Pressable
              onPress={() => setOpen(item)}
              accessibilityRole="button"
              accessibilityHint={t('events.openA11y')}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.pressed }]}>
              <View style={[styles.catIcon, item.category === 'bike' && styles.catIconBike]}>
                <Ionicons
                  name={CATEGORY_ICON[item.category] as keyof typeof Ionicons.glyphMap}
                  size={18}
                  color={item.category === 'bike' ? c.onAccent : c.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.time}>{timeLabel(item)}</Text>
                <Text style={styles.title} numberOfLines={2}>
                  {item.title}
                </Text>
                {item.venue_name ? (
                  <Text style={styles.venue} numberOfLines={1}>
                    {item.venue_name}
                  </Text>
                ) : null}
                {parking ? (
                  <Text style={styles.parking} numberOfLines={1}>
                    <Ionicons name="bicycle" size={13} color={c.textMuted} /> {t('events.parkingNear', { dist: formatDistance(parking.meters) })}
                  </Text>
                ) : null}
                {item.featured ? <Text style={styles.featured}>{t('events.featured')}</Text> : null}
              </View>
              {canRide && (
                <Pressable
                  onPress={() => rideThere(item)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={t('events.rideThereA11y', { name: item.venue_name ?? item.title })}
                  style={({ pressed }) => [styles.rideBtn, pressed && { opacity: 0.85 }]}>
                  <Ionicons name="navigate" size={16} color={c.onAccent} />
                  <Text style={styles.rideText}>{t('events.rideThere')}</Text>
                </Pressable>
              )}
            </Pressable>
          );
        }}
      />

      <EventDetail event={open} places={places} onClose={() => setOpen(null)} onRide={rideThere} />
      {adding && <EventForm visible email={auth.session?.user.email ?? null} onClose={() => setAdding(false)} />}
    </View>
  );
}

function EventDetail({
  event: e, places, onClose, onRide,
}: {
  event: RideEvent | null;
  places: ReturnType<typeof useData>['places'];
  onClose: () => void;
  onRide: (e: RideEvent) => void;
}) {
  const { t } = useT();
  const { c } = useTheme();
  const styles = useStyles();
  const parking = e ? nearestParking(e, places) : null;
  const date = e
    ? new Date(e.starts_at).toLocaleDateString(currentLang() === 'es' ? 'es-US' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : '';
  return (
    <Modal visible={!!e} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {e && (
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetKicker}>{t(`events.cat.${e.category}`)}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" style={styles.doneBtn}>
              <Text style={styles.done}>{t('common.done')}</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody}>
            <Text style={styles.sheetTitle} accessibilityRole="header">
              {e.title}
            </Text>
            {e.featured ? <Text style={styles.featured}>{t('events.featured')}</Text> : null}
            <View style={styles.infoRow}>
              <Ionicons name="time-outline" size={20} color={c.textMuted} />
              <Text style={styles.infoText}>
                {date} · {timeLabel(e)}
              </Text>
            </View>
            {e.venue_name || e.address ? (
              <View style={styles.infoRow}>
                <Ionicons name="location-outline" size={20} color={c.textMuted} />
                <Text style={styles.infoText}>{[e.venue_name, e.address].filter(Boolean).join('\n')}</Text>
              </View>
            ) : null}
            <View style={styles.infoRow}>
              <Ionicons name="bicycle-outline" size={20} color={c.textMuted} />
              <Text style={styles.infoText}>
                {parking ? t('events.parkingNear', { dist: formatDistance(parking.meters) }) : t('events.noParking')}
              </Text>
            </View>
            {e.description ? <Text style={styles.description}>{e.description}</Text> : null}

            {e.latitude != null && e.longitude != null && (
              <Pressable
                onPress={() => onRide(e)}
                style={({ pressed }) => [styles.bigRide, pressed && { opacity: 0.9 }]}
                accessibilityRole="button"
                accessibilityLabel={t('events.rideThereA11y', { name: e.venue_name ?? e.title })}>
                <Ionicons name="navigate" size={22} color={c.onAccent} />
                <Text style={styles.bigRideText}>{t('events.rideThere')}</Text>
              </Pressable>
            )}
            {e.url ? (
              <Pressable
                onPress={() => void Linking.openURL(e.url!)}
                style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.8 }]}
                accessibilityRole="link">
                <Ionicons name={e.source === 'ticketmaster' ? 'ticket-outline' : 'open-outline'} size={20} color={c.primary} />
                <Text style={styles.linkText}>
                  {e.source === 'ticketmaster' ? t('events.ticketmaster') : e.category === 'music' ? t('events.tickets') : t('events.moreInfo')}
                </Text>
              </Pressable>
            ) : null}
            {e.source === 'ticketmaster' ? <Text style={styles.attribution}>{t('events.fromTicketmaster')}</Text> : null}
          </ScrollView>
        </View>
      )}
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.bg },
  headerBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  segment: { paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  segmentItem: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 999, backgroundColor: c.surfaceAlt,
  },
  segmentActive: { backgroundColor: c.primary },
  segmentText: { fontSize: 14, fontFamily: FONT.bold, color: c.textFaint },
  segmentTextActive: { color: c.onPrimary },
  note: { fontSize: 14, color: c.textMuted, paddingHorizontal: 16, paddingBottom: 6 },
  dayHeader: {
    fontSize: 15, fontFamily: FONT.black, color: c.text, backgroundColor: c.bg, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12, minHeight: 64 },
  catIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceAlt },
  catIconBike: { backgroundColor: c.accent },
  time: { fontSize: 13, fontFamily: FONT.bold, color: c.textMuted },
  title: { fontSize: 16, fontFamily: FONT.bold, color: c.text, marginTop: 1 },
  venue: { fontSize: 14, color: c.textMuted, marginTop: 2 },
  parking: { fontSize: 13, color: c.textMuted, marginTop: 2 },
  featured: {
    alignSelf: 'flex-start', marginTop: 4, fontSize: 12, fontWeight: '700', color: c.onGold, backgroundColor: c.gold,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden',
  },
  rideBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingHorizontal: 10, borderRadius: 10, backgroundColor: c.accent,
  },
  rideText: { fontSize: 13, fontFamily: FONT.bold, color: c.onAccent },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 64 },
  empty: { textAlign: 'center', fontSize: 15, color: c.textMuted, padding: 16 },
  emptyBox: { alignItems: 'center', padding: 24, gap: 8 },
  addCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, margin: 16, padding: 14, borderRadius: 14, backgroundColor: c.primary,
  },
  addTitle: { fontSize: 16, fontFamily: FONT.bold, color: c.onPrimary },
  addSub: { fontSize: 13, color: c.onPrimary, opacity: 0.85, marginTop: 2 },
  sheet: { flex: 1, backgroundColor: c.bg },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12 },
  sheetKicker: { fontSize: 14, fontFamily: FONT.bold, color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  doneBtn: { minHeight: 44, justifyContent: 'center' },
  done: { fontSize: 16, fontFamily: FONT.bold, color: c.primary },
  sheetBody: { padding: 16, gap: 14, paddingBottom: 40 },
  sheetTitle: { fontSize: 24, fontFamily: FONT.black, color: c.text },
  infoRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  infoText: { flex: 1, fontSize: 16, color: c.text, lineHeight: 22 },
  description: { fontSize: 15, color: c.text, lineHeight: 22 },
  bigRide: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 52, borderRadius: 14, backgroundColor: c.accent,
  },
  bigRideText: { fontSize: 17, fontFamily: FONT.bold, color: c.onAccent },
  linkBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, borderRadius: 14,
    borderWidth: 1.5, borderColor: c.primary,
  },
  linkText: { fontSize: 16, fontFamily: FONT.bold, color: c.primary },
  attribution: { fontSize: 12, color: c.textMuted, textAlign: 'center' },
}));
