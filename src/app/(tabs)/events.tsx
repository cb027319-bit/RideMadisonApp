import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert, Linking, Modal, Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, Text,
  useWindowDimensions, View, type NativeScrollEvent, type ListViewToken, type NativeSyntheticEvent,
} from 'react-native';

import { EventForm } from '@/components/event-form';
import { useAuth } from '@/lib/auth';
import type { BCycleStation } from '@/lib/bcycle';
import { cached } from '@/lib/cache';
import { FONT } from '@/lib/config';
import { useData } from '@/lib/data';
import {
  CATEGORY_ICON, dayTitle, EVENT_WHENS, featuredEvents, FILTER_CATEGORIES, filterEvents, groupByDay, groupSubmissions, longDate,
  NO_FILTER, nearestParking, nextSubmission, nearestStation, priceLabel, rowA11yLabel, safeImageUrl, statusKey, timeLabel,
  type CategoryFilter, type EventFilter, type MySubmission, type RideEvent, type SubmissionGroup,
} from '@/lib/events';
import { fetchEvents, fetchMySubmissions, withdrawEvent } from '@/lib/events-api';
import { formatDistance } from '@/lib/geo';
import { locale, useT } from '@/lib/i18n';
import { trackPartner, type Partner, type PartnerEvent } from '@/lib/partners';
import { useRoute } from '@/lib/route';
import { makeStyles, useTheme } from '@/lib/theme';

const EVENTS_TTL_MS = 30 * 60 * 1000;
const CATEGORY_CHIPS: CategoryFilter[] = ['all', ...FILTER_CATEGORIES];
/** At this text size the Ride there button moves under the event text. */
const LARGE_TEXT = 1.3;

/** Ad reporting for events with an advertising partner (placement 'events'; impressions count once per session). */
function trackEvent(e: RideEvent, kind: PartnerEvent) {
  if (e.partner_id) trackPartner({ id: e.partner_id } as Partner, kind, 'events');
}

/** Stable (module-level) so the list never sees a new viewability callback. */
function onViewableItemsChanged({ viewableItems }: { viewableItems: ListViewToken[] }) {
  for (const v of viewableItems) {
    const e = v.item as RideEvent | undefined;
    if (e && typeof e === 'object' && e.partner_id) trackEvent(e, 'impression');
  }
}

/** "BCycle dock 180 m · 6 open docks" (or bikes, when the dock is full). */
function stationText(t: ReturnType<typeof useT>['t'], s: { station: BCycleStation; meters: number }): string {
  const dist = formatDistance(s.meters);
  return s.station.docks > 0
    ? t('events.bcycleDocks', { dist, count: s.station.docks })
    : t('events.bcycleBikes', { dist, count: s.station.bikes });
}

export default function EventsScreen() {
  const { t, lang } = useT();
  const { c } = useTheme();
  const styles = useStyles();
  const navigation = useNavigation();
  const { fontScale } = useWindowDimensions();
  const large = fontScale >= LARGE_TEXT;
  const { places, stations } = useData();
  const { routeTo } = useRoute();
  const auth = useAuth();
  const signedIn = !!auth.session;

  const [events, setEvents] = useState<RideEvent[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [stale, setStale] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<EventFilter>(NO_FILTER);
  const [open, setOpen] = useState<RideEvent | null>(null);
  const [adding, setAdding] = useState(false);
  const [pendingAdd, setPendingAdd] = useState(false);
  const [mineOpen, setMineOpen] = useState(false);
  const [chipWidths, setChipWidths] = useState({ view: 0, content: 0 });
  const [chipsAtEnd, setChipsAtEnd] = useState(false);

  const load = useCallback(
    (force = false) =>
      cached('events:v2', EVENTS_TTL_MS, () => fetchEvents(), { force }).then(
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
    else setPendingAdd(true);
  }, [auth, t]);

  // After signing in from the "+" gate, open the form once the sign-in sheet has closed.
  useEffect(() => {
    if (!pendingAdd || auth.sheet) return;
    const timer = setTimeout(() => {
      setPendingAdd(false);
      if (auth.session) setAdding(true);
    }, 400);
    return () => clearTimeout(timer);
  }, [pendingAdd, auth.sheet, auth.session]);

  // Leaving the tab forgets a pending "+" so the form never pops up later somewhere else.
  useFocusEffect(useCallback(() => () => setPendingAdd(false), []));

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerBtns}>
          {signedIn && (
            <Pressable
              onPress={() => setMineOpen(true)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t('events.mine.openA11y')}
              style={styles.headerBtn}>
              <Ionicons name="list-outline" size={26} color={c.primary} />
            </Pressable>
          )}
          <Pressable onPress={add} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('events.addA11y')} style={styles.headerBtn}>
            <Ionicons name="add-circle-outline" size={26} color={c.primary} />
          </Pressable>
        </View>
      ),
    });
  }, [navigation, add, c.primary, t, styles.headerBtn, styles.headerBtns, signedIn]);

  // lang: day titles and times are formatted in the current language.
  const filtered = useMemo(() => filterEvents(events, filter), [events, filter]);
  const sections = useMemo(() => groupByDay(filtered), [filtered, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const featured = useMemo(() => featuredEvents(filtered), [filtered]);

  // Featured cards are always on screen at the top: count each sponsor once per session.
  useEffect(() => {
    for (const e of featured) trackEvent(e, 'impression');
  }, [featured]);

  const whenPhrase = (f: EventFilter) => t(`events.whenPhrase.${f.when}`);
  const emptyText = (f: EventFilter) =>
    f.category === 'all'
      ? t('events.emptyFilteredAll', { when: whenPhrase(f) })
      : t('events.emptyFiltered', { cat: t(`events.cat.${f.category}`), when: whenPhrase(f) });

  const choose = (next: EventFilter) => {
    setFilter(next);
    const n = filterEvents(events, next).length;
    AccessibilityInfo.announceForAccessibility(n ? t('events.count', { count: n }) : emptyText(next));
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  };

  const openEvent = (e: RideEvent) => {
    trackEvent(e, 'open');
    setOpen(e);
  };

  const rideThere = (e: RideEvent) => {
    if (e.latitude == null || e.longitude == null) return;
    trackEvent(e, 'route');
    routeTo({ latitude: e.latitude, longitude: e.longitude }, e.venue_name ?? e.title);
    setOpen(null);
    router.navigate('/route');
  };

  const onChipScroll = (ev: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = ev.nativeEvent;
    setChipsAtEnd(contentOffset.x + layoutMeasurement.width >= contentSize.width - 8);
  };
  const showChipCue = chipWidths.content > chipWidths.view + 4 && !chipsAtEnd;

  const filtersOn = filter.when !== NO_FILTER.when || filter.category !== NO_FILTER.category;
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
    ) : events.length && filtersOn ? (
      <View style={styles.emptyBox}>
        <Text style={styles.empty}>{emptyText(filter)}</Text>
        <Pressable
          onPress={() => choose(NO_FILTER)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.showAll, pressed && { opacity: 0.8 }]}>
          <Text style={styles.showAllText}>{t('events.showAll')}</Text>
        </Pressable>
      </View>
    ) : (
      <Text style={styles.empty}>{t('events.empty')}</Text>
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

  const featuredBlock = featured.length ? (
    <View style={styles.featuredBlock}>
      <Text style={styles.featuredHeader} accessibilityRole="header">
        {t('events.featuredHeader')}
      </Text>
      {featured.map((e) => (
        <FeaturedCard key={e.id} event={e} onOpen={openEvent} />
      ))}
    </View>
  ) : undefined;

  return (
    <View style={styles.container}>
      <View style={styles.filters}>
        <View style={styles.segmented} accessibilityRole="tablist" accessibilityLabel={t('events.whenA11y')}>
          {EVENT_WHENS.map((w) => {
            const active = filter.when === w;
            return (
              <Pressable
                key={w}
                onPress={() => choose({ ...filter, when: w })}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[styles.segmentBtn, active && styles.segmentBtnActive]}>
                <Text style={[styles.segmentBtnText, active && styles.segmentBtnTextActive]}>{t(`events.when.${w}`)}</Text>
              </Pressable>
            );
          })}
        </View>
        <View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={styles.chips}
            onScroll={onChipScroll}
            scrollEventThrottle={32}
            onLayout={(ev) => {
              const view = ev.nativeEvent.layout.width;
              setChipWidths((w) => (w.view === view ? w : { ...w, view }));
            }}
            onContentSizeChange={(content) => setChipWidths((w) => (w.content === content ? w : { ...w, content }))}>
            {CATEGORY_CHIPS.map((cat) => {
              const active = filter.category === cat;
              const icon = cat === 'all' ? 'apps' : CATEGORY_ICON[cat];
              return (
                <Pressable
                  key={cat}
                  onPress={() => choose({ ...filter, category: cat })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.chip, active && styles.chipActive]}>
                  <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={16} color={active ? c.onPrimary : c.textFaint} />
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {cat === 'all' ? t('events.filter.all') : t(`events.cat.${cat}`)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {showChipCue && (
            <View pointerEvents="none" style={styles.chipCue} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={[styles.fadeStrip, { opacity: 0.35 }]} />
              <View style={[styles.fadeStrip, { opacity: 0.7 }]} />
              <View style={[styles.fadeEnd]}>
                <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
              </View>
            </View>
          )}
        </View>
      </View>
      {stale && <Text style={styles.note}>{t('events.offlineNote')}</Text>}

      <SectionList
        sections={sections}
        keyExtractor={(e) => e.id}
        stickySectionHeadersEnabled
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={featuredBlock}
        ListEmptyComponent={empty}
        ListFooterComponent={state === 'ready' ? addCard : undefined}
        onViewableItemsChanged={onViewableItemsChanged}
        renderSectionHeader={({ section }) => (
          <Text style={styles.dayHeader} accessibilityRole="header">
            {section.title}
          </Text>
        )}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item }) => {
          const parking = nearestParking(item, places);
          const dock = nearestStation(item, stations);
          const price = priceLabel(item);
          const canRide = item.latitude != null && item.longitude != null;
          const pill = item.partner_id ? t('events.sponsored') : item.featured ? t('events.featured') : null;
          return (
            <View style={[styles.row, large && styles.rowLarge]}>
              <Pressable
                onPress={() => openEvent(item)}
                accessibilityRole="button"
                accessibilityLabel={rowA11yLabel(item)}
                accessibilityHint={t('events.openA11y')}
                style={({ pressed }) => [styles.rowMain, !large && styles.rowMainWide, pressed && { backgroundColor: c.pressed }]}>
                <View style={[styles.catIcon, item.category === 'bike' && styles.catIconBike]}>
                  <Ionicons
                    name={CATEGORY_ICON[item.category] as keyof typeof Ionicons.glyphMap}
                    size={18}
                    color={item.category === 'bike' ? c.onAccent : c.primary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.time}>{[timeLabel(item), price].filter(Boolean).join(' · ')}</Text>
                  <Text style={styles.title}>{item.title}</Text>
                  {item.venue_name ? (
                    <Text style={styles.venue} numberOfLines={large ? undefined : 2}>
                      {item.venue_name}
                    </Text>
                  ) : null}
                  {parking ? (
                    <Text style={styles.parking}>
                      <Ionicons name="bicycle" size={13} color={c.textMuted} /> {t('events.parkingNear', { dist: formatDistance(parking.meters) })}
                    </Text>
                  ) : null}
                  {dock ? (
                    <Text style={styles.parking}>
                      <Ionicons name="swap-horizontal" size={13} color={c.textMuted} /> {stationText(t, dock)}
                    </Text>
                  ) : null}
                  {pill ? <Text style={styles.featured}>{pill}</Text> : null}
                </View>
              </Pressable>
              {canRide && (
                <Pressable
                  onPress={() => rideThere(item)}
                  accessibilityRole="button"
                  accessibilityLabel={t('events.rideThereA11y', { name: item.venue_name ?? item.title })}
                  style={({ pressed }) => [styles.rideBtn, large && styles.rideBtnLarge, pressed && { opacity: 0.85 }]}>
                  <Ionicons name="navigate" size={16} color={c.onAccent} />
                  <Text style={styles.rideText}>{t('events.rideThere')}</Text>
                </Pressable>
              )}
            </View>
          );
        }}
      />

      <EventDetail
        event={open}
        places={places}
        stations={stations}
        onClose={() => setOpen(null)}
        onRide={rideThere}
        onLink={(e) => trackEvent(e, 'website')}
      />
      {adding && (
        <EventForm
          visible
          email={auth.session?.user.email ?? null}
          onClose={() => {
            setAdding(false);
            setPendingAdd(false);
          }}
        />
      )}
      {mineOpen && <MyEvents onClose={() => setMineOpen(false)} onChanged={() => void load(true)} />}
    </View>
  );
}

function FeaturedCard({ event: e, onOpen }: { event: RideEvent; onOpen: (e: RideEvent) => void }) {
  const { t } = useT();
  const styles = useStyles();
  const [broken, setBroken] = useState(false);
  const image = broken ? null : safeImageUrl(e.image_url);
  const label = e.partner_id ? t('events.sponsored') : t('events.featured');
  const price = priceLabel(e);
  const start = new Date(e.starts_at);
  return (
    <Pressable
      onPress={() => onOpen(e)}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${rowA11yLabel(e)}`}
      accessibilityHint={t('events.openA11y')}
      style={({ pressed }) => [styles.featuredCard, pressed && { opacity: 0.9 }]}>
      {image ? (
        <Image
          source={{ uri: image }}
          style={styles.banner}
          contentFit="cover"
          transition={150}
          onError={() => setBroken(true)}
          accessible={false}
        />
      ) : null}
      <View style={styles.featuredBody}>
        <Text style={styles.featured}>{label}</Text>
        <Text style={styles.featuredTitle}>{e.title}</Text>
        <Text style={styles.time}>{[`${dayTitle(start)}, ${timeLabel(e)}`, price].filter(Boolean).join(' · ')}</Text>
        {e.venue_name ? <Text style={styles.venue}>{e.venue_name}</Text> : null}
      </View>
    </Pressable>
  );
}

function EventDetail({
  event: e, places, stations, onClose, onRide, onLink,
}: {
  event: RideEvent | null;
  places: ReturnType<typeof useData>['places'];
  stations: BCycleStation[];
  onClose: () => void;
  onRide: (e: RideEvent) => void;
  onLink: (e: RideEvent) => void;
}) {
  const { t } = useT();
  const { c } = useTheme();
  const styles = useStyles();
  const [brokenImage, setBrokenImage] = useState<string | null>(null);
  const parking = e ? nearestParking(e, places) : null;
  const dock = e ? nearestStation(e, stations) : null;
  const price = e ? priceLabel(e) : null;
  const image = e && brokenImage !== e.id ? safeImageUrl(e.image_url) : null;
  const date = e ? longDate(new Date(e.starts_at)) : '';
  const kicker = e
    ? [t(`events.cat.${e.category}`), e.partner_id ? t('events.sponsored') : e.featured ? t('events.featured') : null]
        .filter(Boolean)
        .join(' · ')
    : '';
  return (
    <Modal visible={!!e} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {e && (
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" style={styles.doneBtn}>
              <Text style={styles.done}>{t('common.done')}</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody}>
            {image ? (
              <Image
                source={{ uri: image }}
                style={styles.detailBanner}
                contentFit="cover"
                onError={() => setBrokenImage(e.id)}
                accessible={false}
              />
            ) : null}
            <Text style={styles.sheetTitle} accessibilityRole="header">
              {e.title}
            </Text>
            <Text style={styles.sheetKicker}>{kicker}</Text>
            <View style={styles.infoRow}>
              <Ionicons name="time-outline" size={20} color={c.textMuted} />
              <Text style={styles.infoText}>
                {date} · {timeLabel(e)}
              </Text>
            </View>
            {price ? (
              <View style={styles.infoRow} accessible accessibilityLabel={t('events.priceA11y', { price })}>
                <Ionicons name="pricetag-outline" size={20} color={c.textMuted} />
                <Text style={styles.infoText}>{price}</Text>
              </View>
            ) : null}
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
            {dock ? (
              <View style={styles.infoRow}>
                <Ionicons name="swap-horizontal-outline" size={20} color={c.textMuted} />
                <Text style={styles.infoText}>
                  {stationText(t, dock)}
                  {'\n'}
                  <Text style={styles.infoSub}>{dock.station.name}</Text>
                </Text>
              </View>
            ) : null}
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
                onPress={() => {
                  onLink(e);
                  void Linking.openURL(e.url!);
                }}
                style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.8 }]}
                accessibilityRole="link">
                <Ionicons name={e.source === 'ticketmaster' || e.source === 'seatgeek' ? 'ticket-outline' : 'open-outline'} size={20} color={c.primary} />
                <Text style={styles.linkText}>
                  {e.source === 'ticketmaster'
                    ? t('events.ticketmaster')
                    : e.source === 'seatgeek'
                      ? t('events.seatgeek')
                      : e.category === 'music' ? t('events.tickets') : t('events.moreInfo')}
                </Text>
              </Pressable>
            ) : null}
            {e.source === 'ticketmaster' ? <Text style={styles.attribution}>{t('events.fromTicketmaster')}</Text> : null}
            {e.source === 'seatgeek' ? <Text style={styles.attribution}>{t('events.fromSeatgeek')}</Text> : null}
          </ScrollView>
        </View>
      )}
    </Modal>
  );
}

/** "Your events": the rider's own submissions, with status and Withdraw. Mount only while open. */
function MyEvents({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const styles = useStyles();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rows, setRows] = useState<MySubmission[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetchMySubmissions().then(
        (r) => {
          setRows(r);
          setState('ready');
        },
        () => setState((s) => (s === 'ready' ? s : 'error')),
      ),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => groupSubmissions(rows), [rows]);

  const run = (g: SubmissionGroup, id: string, whole: boolean) => {
    setBusy(g.key);
    withdrawEvent(id, whole)
      .then(
        () => {
          AccessibilityInfo.announceForAccessibility(t('events.mine.withdrawn'));
          onChanged();
          return load();
        },
        () => Alert.alert(t('events.mine.withdrawError')),
      )
      .finally(() => setBusy(null));
  };

  const withdraw = (g: SubmissionGroup) => {
    const next = nextSubmission(g);
    if (g.seriesId && g.rows.length > 1) {
      Alert.alert(t('events.mine.confirmSeriesTitle'), t('events.mine.confirmSeriesBody', { count: g.rows.length }), [
        { text: t('events.mine.keep'), style: 'cancel' },
        { text: t('events.mine.onlyDate', { date: dayTitle(new Date(next.starts_at)) }), onPress: () => run(g, next.id, false) },
        { text: t('events.mine.allDates', { count: g.rows.length }), style: 'destructive', onPress: () => run(g, next.id, true) },
      ]);
    } else {
      Alert.alert(t('events.mine.confirmTitle'), t('events.mine.confirmBody'), [
        { text: t('events.mine.keep'), style: 'cancel' },
        { text: t('events.mine.withdraw'), style: 'destructive', onPress: () => run(g, next.id, false) },
      ]);
    }
  };

  const statusColor = (s: string) => (s === 'approved' ? c.success : s === 'rejected' ? c.danger : c.textMuted);
  const when = (r: MySubmission) => {
    const d = new Date(r.starts_at);
    return `${dayTitle(d)}, ${d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })}`;
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.mineTitle} accessibilityRole="header">
            {t('events.mine.title')}
          </Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" style={styles.doneBtn}>
            <Text style={styles.done}>{t('common.done')}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetBody}>
          {state === 'loading' ? (
            <View style={styles.emptyBox}>
              <ActivityIndicator color={c.primary} />
              <Text style={styles.empty}>{t('events.mine.loading')}</Text>
            </View>
          ) : state === 'error' ? (
            <Pressable style={styles.emptyBox} onPress={() => void load()} accessibilityRole="button">
              <Text style={styles.empty}>{t('events.mine.loadError')}</Text>
            </Pressable>
          ) : groups.length === 0 ? (
            <Text style={styles.empty}>{t('events.mine.empty')}</Text>
          ) : (
            groups.map((g) => (
              <View key={g.key} style={styles.mineCard}>
                <Text style={styles.mineCardTitle} accessibilityRole="header">
                  {g.title}
                </Text>
                {g.status ? (
                  <Text style={[styles.mineStatus, { color: statusColor(g.status) }]}>{t(statusKey(g.status))}</Text>
                ) : null}
                {g.seriesId && g.rows.length > 1 ? (
                  <Text style={styles.infoSub}>{t('events.mine.weekly', { count: g.rows.length })}</Text>
                ) : null}
                {g.rows.map((r) => (
                  <Text key={r.id} style={styles.mineDate}>
                    {when(r)}
                    {g.status ? '' : ` · ${t(statusKey(r.status))}`}
                  </Text>
                ))}
                <Pressable
                  onPress={() => withdraw(g)}
                  disabled={busy === g.key}
                  accessibilityRole="button"
                  accessibilityLabel={t('events.mine.withdrawA11y', { title: g.title })}
                  accessibilityState={{ busy: busy === g.key, disabled: busy === g.key }}
                  style={({ pressed }) => [styles.withdrawBtn, (pressed || busy === g.key) && { opacity: 0.7 }]}>
                  {busy === g.key ? <ActivityIndicator size="small" color={c.danger} /> : null}
                  <Text style={styles.withdrawText}>{t('events.mine.withdraw')}</Text>
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.bg },
  headerBtns: { flexDirection: 'row', alignItems: 'center', marginRight: 6 },
  headerBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  filters: { paddingTop: 10, gap: 8 },
  segmented: {
    flexDirection: 'row', marginHorizontal: 12, padding: 3, borderRadius: 12, backgroundColor: c.surfaceAlt, gap: 3,
  },
  segmentBtn: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, borderRadius: 9 },
  segmentBtnActive: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  segmentBtnText: { fontSize: 14, fontFamily: FONT.bold, color: c.textMuted, textAlign: 'center' },
  segmentBtnTextActive: { color: c.text },
  chips: { paddingHorizontal: 12, paddingBottom: 10, gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 999, backgroundColor: c.surfaceAlt,
  },
  chipActive: { backgroundColor: c.primary },
  chipText: { fontSize: 14, fontFamily: FONT.bold, color: c.textFaint },
  chipTextActive: { color: c.onPrimary },
  chipCue: { position: 'absolute', right: 0, top: 0, bottom: 10, flexDirection: 'row' },
  fadeStrip: { width: 10, backgroundColor: c.bg },
  fadeEnd: { width: 30, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: 14, color: c.textMuted, paddingHorizontal: 16, paddingBottom: 6 },
  dayHeader: {
    fontSize: 15, fontFamily: FONT.black, color: c.text, backgroundColor: c.bg, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
  },
  featuredBlock: { paddingHorizontal: 16, paddingTop: 6, gap: 10 },
  featuredHeader: { fontSize: 15, fontFamily: FONT.black, color: c.text, paddingTop: 8 },
  featuredCard: { borderRadius: 14, overflow: 'hidden', backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  banner: { width: '100%', aspectRatio: 2.4, backgroundColor: c.surfaceAlt },
  featuredBody: { padding: 12, gap: 2 },
  featuredTitle: { fontSize: 17, fontFamily: FONT.bold, color: c.text, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingRight: 16, gap: 8, minHeight: 64 },
  rowLarge: { flexDirection: 'column', alignItems: 'stretch', paddingRight: 0, paddingBottom: 12, gap: 4 },
  rowMainWide: { flex: 1 },
  rowMain: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 8, paddingVertical: 12, gap: 12 },
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
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 10,
    backgroundColor: c.accent,
  },
  rideBtnLarge: { marginHorizontal: 16, minHeight: 52, paddingVertical: 8 },
  rideText: { fontSize: 15, fontFamily: FONT.bold, color: c.onAccent },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 64 },
  empty: { textAlign: 'center', fontSize: 15, color: c.textMuted, padding: 16 },
  emptyBox: { alignItems: 'center', padding: 24, gap: 8 },
  showAll: {
    minHeight: 44, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1.5, borderColor: c.primary, alignItems: 'center',
    justifyContent: 'center',
  },
  showAllText: { fontSize: 15, fontFamily: FONT.bold, color: c.primary },
  addCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, margin: 16, padding: 14, borderRadius: 14, backgroundColor: c.primary,
  },
  addTitle: { fontSize: 16, fontFamily: FONT.bold, color: c.onPrimary },
  addSub: { fontSize: 13, color: c.onPrimary, opacity: 0.85, marginTop: 2 },
  sheet: { flex: 1, backgroundColor: c.bg },
  sheetHeader: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  sheetKicker: { fontSize: 14, fontFamily: FONT.bold, color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  doneBtn: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' },
  done: { fontSize: 16, fontFamily: FONT.bold, color: c.primary },
  sheetBody: { padding: 16, gap: 14, paddingBottom: 40 },
  detailBanner: { width: '100%', aspectRatio: 2, borderRadius: 14, backgroundColor: c.surfaceAlt },
  sheetTitle: { fontSize: 24, fontFamily: FONT.black, color: c.text },
  infoRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  infoText: { flex: 1, fontSize: 16, color: c.text, lineHeight: 22 },
  infoSub: { fontSize: 14, color: c.textMuted },
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
  mineTitle: { flex: 1, fontSize: 20, fontFamily: FONT.black, color: c.text },
  mineCard: { padding: 14, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, gap: 4 },
  mineCardTitle: { fontSize: 17, fontFamily: FONT.bold, color: c.text },
  mineStatus: { fontSize: 14, fontFamily: FONT.bold },
  mineDate: { fontSize: 15, color: c.text },
  withdrawBtn: {
    flexDirection: 'row', gap: 8, alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center', minHeight: 44,
    paddingHorizontal: 16, marginTop: 6, borderRadius: 999, borderWidth: 1.5, borderColor: c.danger,
  },
  withdrawText: { fontSize: 15, fontFamily: FONT.bold, color: c.danger },
}));
