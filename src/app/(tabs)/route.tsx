import Ionicons from '@expo/vector-icons/Ionicons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert, Animated, FlatList, Keyboard, LayoutAnimation, Linking, Modal, PanResponder, Platform, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View,
} from 'react-native';
import MapView, { Marker, Polyline, type LongPressEvent, type MapPressEvent } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { DirectionsSheet } from '@/components/directions-sheet';
import { PathLines } from '@/components/path-lines';
import { Snackbar, type SnackbarMessage } from '@/components/snackbar';
import { SuggestedRidesSheet } from '@/components/suggested-rides';
import { routePoints, type SuggestedRide } from '@/lib/suggested';
import { COLORS, COVERAGE_BBOX, FONT, INITIAL_REGION } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { formatDistance, type Region } from '@/lib/geo';
import { locale, t as tr, useT } from '@/lib/i18n';
import { DARK_MAP_STYLE } from '@/lib/map-style';
import { buildLine, buildManeuvers } from '@/lib/navigation';
import { docksNear, movedText, shouldStartFromMe, withBikeTime } from '@/lib/planner';
import { usePrefs, type BikeType } from '@/lib/prefs';
import { isDroppedPin, useRoute, type SavedRide, type Stop } from '@/lib/route';
import { nameAt } from '@/lib/trails';
import { makeStyles, useTheme, type Palette } from '@/lib/theme';
import { useTrip } from '@/lib/trip';
import { router } from 'expo-router';
import {
  appleMapsUrl, buildGpx, formatDuration, googleMapsUrl, metersToFeet, PROFILE_META, searchPlaces, type PlaceResult, type RouteBreakdown,
  type RouteProfile,
} from '@/lib/routing';

let snackSeq = 0;
/** A fresh id for each snackbar message (so repeats show again). */
const nextSnackId = () => ++snackSeq;

export default function RouteScreen() {
  const styles = useStyles();
  const { c } = useTheme();
  const { t } = useT();
  const ROUTE_COLOR = c.route; // the route line and stop pins
  const PRIMARY = c.primary; // main buttons
  const { paths, location, locationDenied, stations } = useData();
  const route = useRoute();
  const { prefs } = usePrefs();
  const bike = prefs?.bike;
  const { fontScale, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  /** Larger accessibility text sizes: stack side-by-side controls. */
  const bigText = fontScale >= 1.3;
  const auth = useAuth();
  const { setTrip } = useTrip();
  const mapRef = useRef<MapView>(null);
  const searchRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [region, setRegion] = useState<Region>(INITIAL_REGION);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  /** What a picked search result becomes: a stop/destination, or the ride's start. */
  const [searchMode, setSearchMode] = useState<'stop' | 'start'>('stop');
  const [showSaved, setShowSaved] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  const [showIdeas, setShowIdeas] = useState(false);
  const [showDirections, setShowDirections] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelHeight, setPanelHeight] = useState(0);
  const [screenHeight, setScreenHeight] = useState(0);
  /** The panel's state before a search collapsed it (restored when the search ends). */
  const [panelBeforeSearch, setPanelBeforeSearch] = useState<boolean | null>(null);
  // The panel never covers more than ~80% of the space below the status bar, so the
  // grab handle and search box stay on screen at any text size.
  const panelMax = Math.round(((screenHeight || windowHeight) - insets.top) * 0.8);

  // Panel drag: the panel follows the finger, then springs open or closed on release.
  const [dragY] = useState(() => new Animated.Value(0));
  const setPanel = (open: boolean) => {
    LayoutAnimation.configureNext({
      duration: 260,
      update: { type: LayoutAnimation.Types.spring, springDamping: 0.85 },
      create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
      delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    });
    setPanelOpen(open);
  };
  // The responder is created once; it reads the latest open state and setter through this ref.
  const panelState = useRef({ open: panelOpen, setPanel });
  useEffect(() => {
    panelState.current = { open: panelOpen, setPanel };
  });
  // eslint-disable-next-line react-hooks/refs -- panelState is only read inside gesture callbacks, never during render
  const [panelPan] = useState(() => {
    const settle = () => Animated.spring(dragY, { toValue: 0, useNativeDriver: true, speed: 22, bounciness: 3 }).start();
    return PanResponder.create({
      // Only claim clear vertical drags, so taps on the handle and buttons still work.
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => dragY.stopAnimation(),
      onPanResponderMove: (_, g) => {
        const open = panelState.current.open;
        // Follow the finger toward the other state; resist (and cap) the other direction.
        const dy = open ? (g.dy > 0 ? g.dy : Math.max(g.dy * 0.15, -16)) : g.dy < 0 ? Math.max(g.dy * 0.35, -48) : g.dy * 0.15;
        dragY.setValue(dy);
      },
      onPanResponderRelease: (_, g) => {
        const { open, setPanel: set } = panelState.current;
        if (open ? g.dy > 40 || g.vy > 0.35 : g.dy < -20 || g.vy < -0.35) set(!open);
        settle();
      },
      onPanResponderTerminate: settle,
      onPanResponderTerminationRequest: () => false,
    });
  });
  const [snack, setSnack] = useState<SnackbarMessage | null>(null);
  const toast = (text: string, actionLabel?: string, onAction?: () => void) =>
    setSnack({ id: nextSnackId(), text, actionLabel, onAction });

  /** Searching: collapse the panel so the results show; remember how it was. */
  const beginSearch = () => {
    if (panelBeforeSearch != null) return;
    setPanelBeforeSearch(panelOpen);
    if (panelOpen) setPanel(false);
  };
  /** Search done: put the panel back (or open it when something was just added). */
  const endSearch = (open?: boolean) => {
    const next = open ?? panelBeforeSearch;
    setPanelBeforeSearch(null);
    if (next != null && next !== panelOpen) setPanel(next);
  };

  // "Ride there" replaced a plan in progress: offer Undo.
  const replacedId = route.replaced?.id;
  useEffect(() => {
    if (!replacedId || Date.now() - replacedId > 10_000) return;
    const timer = setTimeout(() => {
      setPanelOpen(true);
      setSnack({ id: replacedId, text: tr('route.replaced'), actionLabel: tr('route.undo'), onAction: route.undoReplace });
    }, 0);
    return () => clearTimeout(timer);
  }, [replacedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced place search.
  useEffect(() => {
    const q = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (q.length < 3) {
        setResults([]);
        setSearchError(null);
        return;
      }
      setSearching(true);
      try {
        const r = await searchPlaces(q, location, controller.signal);
        setResults(r);
        setSearchError(r.length ? null : tr('route.search.noMatches'));
      } catch {
        if (!controller.signal.aborted) setSearchError(tr('route.search.unavailable'));
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, location]);

  // Fit the map to the route when it changes or a saved ride is loaded.
  const fitKey = `${route.result?.coords.length ?? 0}:${route.result?.distanceM ?? 0}`;
  useEffect(() => {
    const coords = route.result?.coords;
    if (!coords || coords.length < 2) return;
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 140, right: 50, bottom: Math.min(panelHeight || 420, panelMax) + 24, left: 50 },
      animated: true,
    });
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Destination handed over from the Map tab before a route exists.
  useEffect(() => {
    if (!route.focusRequest) return;
    const last = route.stops[route.stops.length - 1];
    if (last && !route.result) {
      mapRef.current?.animateToRegion({ latitude: last.latitude, longitude: last.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }, 400);
    }
  }, [route.focusRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Where to?" tapped on the Map tab.
  useEffect(() => {
    if (!route.searchRequest) return;
    const timer = setTimeout(() => searchRef.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, [route.searchRequest]);

  // Save tapped while signed out: carry on with the save once signed in.
  useEffect(() => {
    if (!pendingSave || auth.sheet) return;
    const timer = setTimeout(() => {
      setPendingSave(false);
      if (auth.session && route.result) setShowSave(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [pendingSave, auth.sheet, auth.session, route.result]);

  // Map taps only close the keyboard and results; press and hold adds a stop.
  const onMapPress = (e: MapPressEvent) => {
    if ((e.nativeEvent as { action?: string }).action === 'marker-press') return;
    Keyboard.dismiss();
    if (results.length) setResults([]);
    if (panelBeforeSearch != null) endSearch();
  };

  const onMapLongPress = (e: LongPressEvent) => {
    Keyboard.dismiss();
    setResults([]);
    const id = route.addStop(e.nativeEvent.coordinate);
    endSearch(true);
    toast(t('route.stopAdded'), t('route.undo'), () => route.removeStop(id));
  };

  const pickResult = (r: PlaceResult) => {
    const p = { latitude: r.latitude, longitude: r.longitude };
    if (mode === 'start') {
      route.setStart(p, r.title);
      setSearchMode('stop');
      AccessibilityInfo.announceForAccessibility(t('route.startingFromName', { name: r.title }));
    } else {
      route.addStop(p, r.title);
      AccessibilityInfo.announceForAccessibility(t('route.addedName', { name: r.title }));
    }
    setQuery('');
    setResults([]);
    Keyboard.dismiss();
    endSearch(true);
    mapRef.current?.animateToRegion({ ...p, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 400);
  };

  const askStart = () => {
    setSearchMode('start');
    searchRef.current?.focus();
  };

  /** No start chosen yet (the "Starting from?" row stands in for it). */
  const needsStart = route.needsStart;
  // Rows shown in the stops list, including "My location" (or the missing start) first.
  const offset = route.usingMyLocation || needsStart ? 1 : 0;
  const total = route.stops.length + offset;
  const roleOf = (overallIndex: number): Role => {
    if (overallIndex === 0) return 'start';
    if (overallIndex === total - 1 && !route.roundTrip) return 'end';
    return 'stop';
  };
  /** A picked search result sets the start while one is missing. */
  const mode = needsStart ? 'start' : searchMode;
  const title = route.planName ?? rideName(route.stops.map((s) => s.label));

  const shareGpx = async () => {
    const data = route.shareable();
    if (!data) return;
    try {
      const file = new File(Paths.cache, `${title.replace(/[^\w-]+/g, '_').slice(0, 40) || 'ride'}.gpx`);
      file.create({ overwrite: true });
      file.write(buildGpx(title, data.result, data.points));
      await Sharing.shareAsync(file.uri, { mimeType: 'application/gpx+xml', UTI: 'com.topografix.gpx', dialogTitle: t('route.shareRide') });
    } catch {
      Alert.alert(t('route.exportFailed'), t('route.pleaseTryAgain'));
    }
  };

  const hasRoute = route.status === 'ready' && route.result && !needsStart;

  /** Hand the planned route to the Navigate or Tour screen. */
  const openTrip = (screen: '/navigate' | '/tour') => {
    if (!route.result) return;
    const labels = [
      ...(route.usingMyLocation ? [t('route.myLocation')] : []),
      ...route.stops.map((s) => s.label),
    ];
    const points = route.waypoints.map((w, i) => ({ ...w, label: labels[i] ?? labels[0] ?? t('route.start') }));
    setTrip({ title, result: route.result, points, profile: route.profile });
    router.push(screen);
  };

  /** Start a saved ride straight from the list (works offline). */
  const startSaved = (r: SavedRide) => {
    route.loadRide(r);
    const points = r.stops.map(({ latitude, longitude, label }) => ({ latitude, longitude, label }));
    if (r.roundTrip && points.length >= 2) points.push({ ...points[0], label: t('route.backTo', { name: points[0].label }) });
    setTrip({ title: r.name, result: withBikeTime(r.result, bike), points, profile: r.profile });
    setShowSaved(false);
    setTimeout(() => router.push('/navigate'), 350); // let the sheet close first
  };

  const onSavePress = () => {
    if (route.savedId) {
      toast(t('route.alreadySaved'));
      return;
    }
    if (auth.requireAccount(t('route.saveNeedsAccount'))) setShowSave(true);
    else setPendingSave(true);
  };

  const confirmClear = () => {
    Alert.alert(t('route.clearTitle'), t('route.clearMsg'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('route.clear'), style: 'destructive', onPress: route.clear },
    ]);
  };

  /** Remove a stop, with Undo in the snackbar. */
  const removeStop = (s: Stop, index: number) => {
    route.removeStop(s.id);
    toast(t('route.removedName', { name: s.label }), t('route.undo'), () => route.restoreStop(s, index));
  };

  const shift = (id: string, label: string, delta: -1 | 1) => {
    const i = route.stops.findIndex((s) => s.id === id);
    const j = Math.max(0, Math.min(route.stops.length - 1, i + delta));
    route.shiftStop(id, delta);
    AccessibilityInfo.announceForAccessibility(movedText(label, j + 1, route.stops.length));
  };

  const directions = useMemo(
    () => (showDirections && route.result ? buildManeuvers(buildLine(route.result.coords), route.result, (p) => nameAt(paths, p)) : []),
    [showDirections, route.result, paths],
  );

  const summaryParts = hasRoute
    ? [formatDistance(route.result!.distanceM), formatDuration(route.result!.timeS), t('route.climb', { n: metersToFeet(route.result!.climbM) })]
    : [];
  const summaryText = summaryParts.join('  ·  ');
  const summaryA11y = summaryParts.join(', ').replace(' mi,', ` ${t('route.milesWord')},`);

  // BCycle docks near where the ride ends (for BCycle riders, or when one is close by).
  const lastStop = route.stops[route.stops.length - 1];
  const destination = route.roundTrip ? (route.usingMyLocation ? null : route.stops[0] ?? null) : lastStop ?? null;
  const docks = docksNear(stations, destination, bike === 'bcycle');

  return (
    <View style={styles.container} onLayout={(e) => setScreenHeight(e.nativeEvent.layout.height)}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={INITIAL_REGION}
        onRegionChangeComplete={setRegion}
        onPress={onMapPress}
        onLongPress={onMapLongPress}
        userInterfaceStyle={c.dark ? 'dark' : 'light'}
        customMapStyle={c.dark ? DARK_MAP_STYLE : []}
        showsUserLocation
        showsMyLocationButton={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}>
        <PathLines paths={paths} region={region} faded={!!route.result} max={900} />
        {route.result && (
          <>
            <Polyline coordinates={route.result.coords} strokeColor={c.dark ? c.bg : '#FFFFFF'} strokeWidth={8} zIndex={5} />
            <Polyline coordinates={route.result.coords} strokeColor={ROUTE_COLOR} strokeWidth={5} zIndex={6} />
          </>
        )}
        {route.stops.map((s, i) => {
          const role = roleOf(i + offset);
          return (
            <Marker
              key={s.id}
              coordinate={s}
              draggable
              onDragEnd={(e) => route.moveStop(s.id, e.nativeEvent.coordinate)}
              anchor={{ x: 0.5, y: 0.5 }}
              zIndex={10}
              accessibilityLabel={`${roleLabel(role, i + offset)}: ${s.label}`}>
              <View style={[styles.stopPin, { backgroundColor: roleColor(role, c) }]}>
                <Text style={styles.stopPinText}>{role === 'start' ? t('route.startBadge') : role === 'end' ? '' : i + offset}</Text>
                {role === 'end' && <Ionicons name="flag" size={13} color="#FFFFFF" />}
              </View>
            </Marker>
          );
        })}
        {docks.map((d) => (
          <Marker
            key={`dock:${d.id}:${d.docks}`}
            coordinate={{ latitude: d.lat, longitude: d.lon }}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={8}
            tracksViewChanges={false}
            accessibilityLabel={t('route.dockA11y', { name: d.name, docks: t('route.openDocks', { count: d.docks }) })}>
            <View style={styles.dockPin}>
              <Ionicons name="bicycle" size={13} color="#FFFFFF" />
              <Text style={styles.dockPinText}>{d.docks}</Text>
            </View>
          </Marker>
        ))}
      </MapView>

      {/* Planner panel */}
      <Animated.View
        style={[styles.panel, { maxHeight: panelMax, transform: [{ translateY: dragY }] }]}
        onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)}>
        {/* Drag zone: the handle and the summary below it. Always on screen. */}
        <View {...panelPan.panHandlers} style={styles.dragZone}>
        <Pressable
          onPress={() => setPanel(!panelOpen)}
          style={styles.handleArea}
          hitSlop={{ top: 12, bottom: 4 }}
          accessibilityRole="button"
          accessibilityLabel={t('route.panel')}
          accessibilityHint={panelOpen ? t('route.panelCollapse') : t('route.panelExpand')}
          accessibilityState={{ expanded: panelOpen }}
          accessibilityActions={[{ name: panelOpen ? 'close' : 'open', label: panelOpen ? t('route.panelClose') : t('route.panelOpen') }]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'open') setPanel(true);
            else if (e.nativeEvent.actionName === 'close') setPanel(false);
          }}>
          <View style={styles.handle} />
          {!panelOpen && route.stops.length > 0 && <Ionicons name="chevron-up" size={16} color={c.textFaint} style={styles.handleChevron} />}
        </Pressable>

        <View style={styles.summaryArea}>
          {hasRoute ? (
            <>
              <Text style={styles.summary} accessibilityLabel={summaryA11y}>
                {summaryText}
              </Text>
              {route.result!.breakdown && <Breakdown b={route.result!.breakdown} />}
            </>
          ) : route.status === 'loading' ? (
            <View style={styles.row} accessibilityLiveRegion="polite">
              <ActivityIndicator size="small" color={ROUTE_COLOR} />
              <Text style={styles.summaryMuted}>{t('route.finding')}</Text>
            </View>
          ) : route.status === 'error' ? (
            <View style={styles.errorRow}>
              <Text style={styles.errorText} accessibilityLiveRegion="polite">{route.error}.</Text>
              <Pressable onPress={route.retry} style={styles.retryBtn} accessibilityRole="button">
                <Ionicons name="refresh" size={16} color={c.onPrimary} />
                <Text style={styles.retryText}>{t('common.tryAgain')}</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.summaryMuted}>
              {route.stops.length === 0
                ? t('route.emptyHint')
                : needsStart
                  ? t('route.whereStarting')
                  : t('route.addOneMore')}
            </Text>
          )}
        </View>
        </View>

        <ScrollView style={styles.panelScroll} keyboardShouldPersistTaps="handled">
        {route.stops.length > 0 && panelOpen && (
          <View style={styles.styleBox}>
            <View style={[styles.segment, bigText && styles.segmentStacked]} accessibilityRole="radiogroup" accessibilityLabel={t('route.style')}>
              {(Object.keys(PROFILE_META) as RouteProfile[]).map((p) => {
                const on = route.profile === p;
                const yours = on && route.profileFromPrefs;
                return (
                  <Pressable
                    key={p}
                    onPress={() => route.setProfile(p)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${PROFILE_META[p].label}${yours ? `, ${t('route.yourPick')}` : ''}`}
                    accessibilityHint={PROFILE_META[p].hint}
                    style={[styles.segmentItem, bigText && styles.segmentItemStacked, on && styles.segmentActive]}>
                    <Text style={[styles.segmentText, on && styles.segmentTextActive]}>{PROFILE_META[p].label}</Text>
                    <Text style={[styles.segmentHint, on && styles.segmentHintActive]}>
                      {PROFILE_META[p].hint}{yours ? ` (${t('route.yourPick')})` : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.hint}>{PROFILE_META[route.profile].surface}</Text>
          </View>
        )}

        {hasRoute && (
          <View style={[styles.startRow, bigText && styles.startRowStacked]}>
            <Pressable
              style={({ pressed }) => [styles.startBtn, bigText && styles.startBtnStacked, pressed && { transform: [{ scale: 0.98 }], opacity: 0.92 }]}
              onPress={() => openTrip('/navigate')}
              accessibilityRole="button"
              accessibilityLabel={t('route.startRide')}
              accessibilityHint={t('route.startRideHint')}>
              <Ionicons name="navigate" size={24} color={c.onAccent} />
              <Text style={styles.startText}>{t('route.startRide')}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.previewBtn, pressed && { opacity: 0.8 }]}
              onPress={() => openTrip('/tour')}
              accessibilityRole="button"
              accessibilityLabel={t('route.preview')}
              accessibilityHint={t('route.previewHint')}>
              <Ionicons name="play-circle" size={22} color={c.primary} />
              <Text style={styles.previewText}>{t('route.preview')}</Text>
            </Pressable>
          </View>
        )}

        {route.stops.length === 0 && (
          <Pressable style={styles.ideas} onPress={() => setShowIdeas(true)} accessibilityRole="button">
            <Ionicons name="compass" size={22} color={c.onPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.ideasTitle}>{t('route.browse')}</Text>
              <Text style={styles.ideasSub}>{t('route.browseSub')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.onPrimary} />
          </Pressable>
        )}

        {panelOpen && (
          <View>
            {/* Stops */}
            {route.usingMyLocation && (
              <StopRow color={roleColor('start', c)} badge={t('route.startBadge')} title={t('route.myLocation')} subtitle={t('route.start')} />
            )}
            {needsStart && (
              <Pressable onPress={askStart} style={styles.askStart} accessibilityRole="button" accessibilityHint={t('route.askStartHint')}>
                <View style={[styles.stopBadge, { backgroundColor: roleColor('start', c) }]}>
                  <Text style={styles.stopBadgeText}>{t('route.startBadge')}</Text>
                </View>
                <Text style={styles.askStartText}>{t('route.startingFromQ')}</Text>
                <Ionicons name="search" size={18} color={PRIMARY} />
              </Pressable>
            )}
            {route.stops.map((s, i) => {
              const overall = i + offset;
              const role = roleOf(overall);
              return (
                <StopRow
                  key={s.id}
                  color={roleColor(role, c)}
                  badge={role === 'start' ? t('route.startBadge') : role === 'end' ? undefined : String(overall)}
                  flag={role === 'end'}
                  title={s.label}
                  subtitle={needsStart && role === 'end' ? t('route.destination') : roleLabel(role, overall)}
                  onUp={i > 0 ? () => shift(s.id, s.label, -1) : undefined}
                  onDown={i < route.stops.length - 1 ? () => shift(s.id, s.label, 1) : undefined}
                  onRemove={() => removeStop(s, i)}
                />
              );
            })}
            {route.roundTrip && total >= 2 && (
              <StopRow color={roleColor('end', c)} flag title={route.usingMyLocation ? t('route.backToMyLocation') : t('route.backToStart')} subtitle={t('route.end')} />
            )}
            {locationDenied && !route.usingMyLocation && (
              <View style={styles.locationOff}>
                <Text style={styles.locationOffText}>{t('route.locationOff')}</Text>
                <Pressable onPress={() => void Linking.openSettings()} style={styles.locationBtn} accessibilityRole="button">
                  <Ionicons name="location" size={16} color={PRIMARY} />
                  <Text style={styles.locationBtnText}>{t('route.turnOnLocation')}</Text>
                </Pressable>
              </View>
            )}

            {/* Options */}
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>{t('route.roundTrip')}</Text>
              <Switch
                value={route.roundTrip}
                onValueChange={route.setRoundTrip}
                trackColor={{ true: PRIMARY }}
                accessibilityLabel={t('route.roundTrip')}
              />
            </View>
            {location && (
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>{t('route.startFromMe')}</Text>
                <Switch
                  value={route.startFromMe}
                  onValueChange={route.setStartFromMe}
                  trackColor={{ true: PRIMARY }}
                  accessibilityLabel={t('route.startFromMe')}
                />
              </View>
            )}

            {/* Actions */}
            <View style={styles.actions}>
              {hasRoute && (
                <>
                  <Action
                    icon={route.savedId ? 'bookmark' : 'bookmark-outline'}
                    label={saving ? t('route.saving') : route.savedId ? t('route.saved') : t('common.save')}
                    disabled={saving}
                    onPress={onSavePress}
                  />
                  <Action icon="list" label={t('route.directions')} onPress={() => setShowDirections(true)} />
                  <Action icon="share-outline" label={t('route.exportGpx')} onPress={() => void shareGpx()} />
                  {Platform.OS === 'ios' && (
                    <Action icon="logo-apple" label="Apple Maps" onPress={() => void Linking.openURL(appleMapsUrl(route.waypoints))} />
                  )}
                  <Action icon="logo-google" label="Google Maps" onPress={() => void Linking.openURL(googleMapsUrl(route.waypoints))} />
                </>
              )}
              <Action icon="compass-outline" label={t('route.suggested')} onPress={() => setShowIdeas(true)} />
              <Action icon="folder-open-outline" label={t('route.savedCount', { count: route.savedRides.length })} onPress={() => setShowSaved(true)} />
              {route.stops.length > 0 && <Action icon="trash-outline" label={t('route.clear')} onPress={confirmClear} />}
            </View>
            {hasRoute && (
              <Text style={styles.footnote}>{t('route.footnote')}</Text>
            )}
          </View>
        )}
        </ScrollView>
      </Animated.View>

      {/* Search (drawn above the panel so its results are never covered) */}
      <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={c.textMuted} />
          <TextInput
            ref={searchRef}
            value={query}
            onChangeText={setQuery}
            onFocus={beginSearch}
            onBlur={() => {
              if (!query) setSearchMode('stop');
              if (!results.length) endSearch();
            }}
            placeholder={
              mode === 'start'
                ? t('route.search.placeholderStart')
                : route.stops.length
                  ? t('route.search.placeholderStop')
                  : t('route.search.placeholderWhereTo')
            }
            placeholderTextColor={c.textMuted}
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel={mode === 'start' ? t('route.search.a11yStart') : t('route.search.a11y')}
          />
          {searching ? (
            <ActivityIndicator size="small" color={c.primary} />
          ) : query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={13} accessibilityRole="button" accessibilityLabel={t('route.search.clear')}>
              <Ionicons name="close-circle" size={18} color={c.textMuted} />
            </Pressable>
          ) : null}
        </View>
        {(results.length > 0 || (searchError && query.trim().length >= 3)) && (
          <View style={[styles.results, { maxHeight: Math.max(320, Math.min(4 * 64 * fontScale, windowHeight * 0.6)) }]}>
            {results.length ? (
              <FlatList
                data={results}
                keyboardShouldPersistTaps="handled"
                keyExtractor={(r) => r.id}
                ItemSeparatorComponent={() => <View style={styles.sep} />}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => pickResult(item)}
                    accessibilityRole="button"
                    accessibilityHint={mode === 'start' ? t('route.search.hintStart') : t('route.search.hintStop')}
                    style={({ pressed }) => [styles.resultRow, pressed && styles.pressed]}>
                    <Ionicons name="location-outline" size={18} color={c.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.resultTitle} numberOfLines={1}>{item.title}</Text>
                      {item.subtitle ? <Text style={styles.resultSub} numberOfLines={1}>{item.subtitle}</Text> : null}
                    </View>
                  </Pressable>
                )}
              />
            ) : (
              <Text style={styles.resultEmpty}>{searchError}</Text>
            )}
          </View>
        )}
      </SafeAreaView>

      <Snackbar message={snack} onDismiss={() => setSnack(null)} bottom={panelHeight + 12} />

      <SaveModal
        visible={showSave}
        defaultName={title}
        startsAtMe={route.usingMyLocation}
        hideStart={route.hideStart}
        onHideStart={route.setHideStart}
        saving={saving}
        onCancel={() => setShowSave(false)}
        onSave={async (name) => {
          setSaving(true);
          try {
            await route.saveRide(name);
            setShowSave(false);
            toast(t('route.savedToRides'));
          } catch (e) {
            Alert.alert(t('route.notSaved'), e instanceof Error ? e.message : t('route.pleaseTryAgain'));
          } finally {
            setSaving(false);
          }
        }}
      />
      <SuggestedRidesSheet
        visible={showIdeas}
        location={location}
        onClose={() => setShowIdeas(false)}
        onPreview={(ride, result) => {
          const pts = routePoints(ride).map((pt, i) => ({ ...pt, label: labelFor(ride, i) }));
          setTrip({ title: ride.name, result: withBikeTime(result, bike), points: pts, profile: ride.profile, rideId: ride.id });
          setShowIdeas(false);
          setTimeout(() => router.push('/tour'), 350); // let the sheet close first
        }}
        onPick={(ride, result) => {
          const fromMe = shouldStartFromMe(location, ride.points[0], COVERAGE_BBOX);
          route.loadPlan({
            stops: ride.points.map(({ label, latitude, longitude }) => ({ label, latitude, longitude })),
            profile: ride.profile,
            roundTrip: true,
            result,
            name: ride.name,
            fromMe,
          });
          setShowIdeas(false);
          setPanelOpen(true);
          toast(t(fromMe ? 'route.loadedFromMe' : 'route.loaded', { name: ride.name }));
        }}
      />
      <SavedRidesModal
        visible={showSaved}
        bike={bike}
        rides={route.savedRides}
        error={route.savedError}
        onRetry={route.reloadSaved}
        signedOut={auth.configured && !auth.session}
        onClose={() => setShowSaved(false)}
        onOpen={(r) => {
          route.loadRide(r);
          setShowSaved(false);
          setPanelOpen(true);
        }}
        onStart={startSaved}
        onDelete={(r) => {
          Alert.alert(t('route.deleteTitle', { name: r.name }), t('route.cantUndo'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('common.delete'),
              style: 'destructive',
              onPress: () => {
                route
                  .deleteRide(r.id)
                  .then(() => AccessibilityInfo.announceForAccessibility(t('route.deletedName', { name: r.name })))
                  .catch((e: unknown) => Alert.alert(t('route.notDeleted'), e instanceof Error ? e.message : t('route.pleaseTryAgain')));
              },
            },
          ]);
        }}
      />
      {route.result && (
        <DirectionsSheet
          visible={showDirections}
          title={title}
          maneuvers={directions}
          totalM={route.result.distanceM}
          onClose={() => setShowDirections(false)}
        />
      )}
    </View>
  );
}

// ---------- pieces ----------

const MIX_KEYS = ['path', 'lane', 'quiet', 'road'] as const;

/** Ride mix colours (same hues as the map); slightly brighter in dark mode. */
function mixColors(c: Palette): Record<(typeof MIX_KEYS)[number], string> {
  return c.dark
    ? { path: '#22C55E', lane: '#60A5FA', quiet: '#86EFAC', road: '#FB923C' }
    : { path: '#15803d', lane: '#2563eb', quiet: '#86efac', road: '#f97316' };
}

function Breakdown({ b }: { b: RouteBreakdown }) {
  const styles = useStyles();
  const { c } = useTheme();
  const { t } = useT();
  const colors = mixColors(c);
  const parts = MIX_KEYS.filter((k) => b[k] >= 0.01);
  const paved = Math.round((1 - b.unpaved) * 100);
  const items = [
    ...parts.map((k) => t('route.mixPart', { pct: Math.round(b[k] * 100), label: t(`route.mix.${k}`) })),
    t('route.paved', { pct: paved }),
  ];
  const text = items.join('  ·  ');
  return (
    <View style={styles.mix} accessible accessibilityLabel={t('route.mixA11y', { text: items.join(', ') })}>
      <View style={styles.mixBar}>
        {parts.map((k) => (
          <View key={k} style={{ flex: b[k], backgroundColor: colors[k] }} />
        ))}
      </View>
      <Text style={styles.mixText}>{text}</Text>
    </View>
  );
}

type Role = 'start' | 'stop' | 'end';

function roleColor(role: Role, c: Palette) {
  // White text sits on these pins, so they stay mid-dark in both modes.
  return role === 'start' ? '#16a34a' : role === 'end' ? '#dc2626' : c.route;
}

function roleLabel(role: Role, overall: number) {
  return role === 'start' ? tr('route.start') : role === 'end' ? tr('route.end') : tr('route.stopN', { n: overall });
}

/** Label for the i-th routed point of a suggested ride (loops/out-and-backs return to start). */
function labelFor(ride: SuggestedRide, i: number): string {
  const n = ride.points.length;
  if (i < n) return ride.points[i].label;
  if (ride.shape === 'loop') return tr('route.backTo', { name: ride.points[0].label });
  return ride.points[n - 1 - (i - n + 1)]?.label ?? ride.points[0].label;
}

function rideName(labels: string[]) {
  const last = labels[labels.length - 1];
  const date = new Date().toLocaleDateString(locale(), { month: 'short', day: 'numeric' });
  return last && !isDroppedPin(last) ? tr('route.rideTo', { name: last }) : tr('route.rideOn', { date });
}

function StopRow(props: {
  color: string; badge?: string; flag?: boolean; title: string; subtitle: string;
  onUp?: () => void; onDown?: () => void; onRemove?: () => void;
}) {
  const styles = useStyles();
  const { t } = useT();
  return (
    <View style={styles.stopRow}>
      <View style={[styles.stopBadge, { backgroundColor: props.color }]}>
        {props.flag ? <Ionicons name="flag" size={12} color="#FFFFFF" /> : <Text style={styles.stopBadgeText}>{props.badge}</Text>}
      </View>
      <View style={{ flex: 1 }} accessible accessibilityLabel={`${props.subtitle}: ${props.title}`}>
        <Text style={styles.stopTitle} numberOfLines={2}>{props.title}</Text>
        <Text style={styles.stopSub}>{props.subtitle}</Text>
      </View>
      {props.onUp && <IconBtn icon="arrow-up" label={t('route.moveEarlier', { name: props.title })} onPress={props.onUp} />}
      {props.onDown && <IconBtn icon="arrow-down" label={t('route.moveLater', { name: props.title })} onPress={props.onDown} />}
      {props.onRemove && (
        // Kept clear of the arrows so a shaky tap on "down" doesn't remove the stop.
        <View style={(props.onUp || props.onDown) && styles.removeGap}>
          <IconBtn icon="close" label={t('route.remove', { name: props.title })} onPress={props.onRemove} />
        </View>
      )}
    </View>
  );
}

function IconBtn({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const styles = useStyles();
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
      accessibilityLabel={label}
      accessibilityRole="button">
      <Ionicons name={icon} size={20} color={c.textMuted} />
    </Pressable>
  );
}

function Action({ icon, label, onPress, primary, disabled }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; primary?: boolean; disabled?: boolean;
}) {
  const styles = useStyles();
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.action, primary && styles.actionPrimary, (pressed || disabled) && { opacity: 0.6 }]}>
      <Ionicons name={icon} size={16} color={primary ? c.onPrimary : c.primary} />
      <Text style={[styles.actionText, primary && { color: c.onPrimary }]}>{label}</Text>
    </Pressable>
  );
}

function SaveModal({ visible, defaultName, startsAtMe, hideStart, onHideStart, saving, onCancel, onSave }: {
  visible: boolean; defaultName: string; startsAtMe: boolean; hideStart: boolean; onHideStart: (v: boolean) => void; saving: boolean;
  onCancel: () => void; onSave: (name: string) => Promise<void>;
}) {
  const styles = useStyles();
  const { c } = useTheme();
  const { t } = useT();
  const [name, setName] = useState(defaultName);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} onShow={() => setName(defaultName)}>
      <View style={styles.modalBackdrop}>
        <View style={styles.dialog}>
          <Text style={styles.dialogTitle} accessibilityRole="header">{t('route.saveTitle')}</Text>
          <TextInput value={name} onChangeText={setName} style={styles.dialogInput} autoFocus selectTextOnFocus accessibilityLabel={t('route.rideName')} />
          {startsAtMe && (
            <View style={styles.privacyBox}>
              <Text style={styles.privacyText}>{t('route.startsAtMe')}</Text>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleLabel}>{t('route.hideStart')}</Text>
                  <Text style={styles.privacySub}>{t('route.hideStartSub')}</Text>
                </View>
                <Switch value={hideStart} onValueChange={onHideStart} trackColor={{ true: c.primary }} accessibilityLabel={t('route.hideStart')} />
              </View>
            </View>
          )}
          <View style={styles.dialogActions}>
            <Pressable onPress={onCancel} style={styles.dialogBtn} accessibilityRole="button" disabled={saving}>
              <Text style={styles.dialogBtnText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={() => void onSave(name)}
              disabled={saving}
              accessibilityRole="button"
              accessibilityState={{ disabled: saving, busy: saving }}
              style={[styles.dialogBtn, styles.dialogBtnPrimary, saving && { opacity: 0.7 }]}>
              {saving && <ActivityIndicator size="small" color={c.onPrimary} />}
              <Text style={[styles.dialogBtnText, { color: c.onPrimary }]}>{saving ? t('route.saving') : t('common.save')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SavedRidesModal({ visible, bike, rides, error, onRetry, signedOut, onClose, onOpen, onStart, onDelete }: {
  visible: boolean; bike: BikeType | undefined; rides: SavedRide[]; error: string | null; onRetry: () => void; signedOut: boolean; onClose: () => void;
  onOpen: (r: SavedRide) => void; onStart: (r: SavedRide) => void; onDelete: (r: SavedRide) => void;
}) {
  const styles = useStyles();
  const { c } = useTheme();
  const { t } = useT();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle} accessibilityRole="header">{t('route.savedRides')}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" style={styles.sheetDoneBtn}>
            <Text style={styles.sheetDone}>{t('common.done')}</Text>
          </Pressable>
        </View>
        {error && rides.length > 0 && <Text style={styles.savedWarn}>{error}</Text>}
        <FlatList
          data={rides}
          keyExtractor={(r) => r.id}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={
            error ? (
              <View style={styles.savedEmpty}>
                <Text style={styles.resultEmpty}>{error}</Text>
                <Pressable onPress={onRetry} style={styles.locationBtn} accessibilityRole="button">
                  <Ionicons name="refresh" size={16} color={c.primary} />
                  <Text style={styles.locationBtnText}>{t('common.tryAgain')}</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={styles.resultEmpty}>
                {signedOut ? t('route.signInToSee') : t('route.noSaved')}
              </Text>
            )
          }
          renderItem={({ item }) => {
            const date = new Date(item.createdAt).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric' });
            const sub = `${formatDistance(item.result.distanceM)} · ${t('route.climb', { n: metersToFeet(item.result.climbM) })} · ${formatDuration(withBikeTime(item.result, bike).timeS)}`;
            const meta = t(item.roundTrip ? 'route.savedMetaRound' : 'route.savedMeta', { profile: PROFILE_META[item.profile].label, date });
            return (
              <View style={styles.savedRow}>
                <Pressable
                  style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}
                  onPress={() => onOpen(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}, ${sub}, ${meta}`}
                  accessibilityHint={t('route.opensInPlanner')}>
                  <Text style={styles.resultTitle} numberOfLines={2}>{item.name}</Text>
                  <Text style={styles.resultSub}>{sub}</Text>
                  <Text style={styles.resultSub}>{meta}</Text>
                </Pressable>
                <Pressable
                  onPress={() => onStart(item)}
                  style={styles.savedStart}
                  accessibilityRole="button"
                  accessibilityLabel={t('route.startRideNamed', { name: item.name })}>
                  <Ionicons name="navigate" size={16} color={c.onAccent} />
                  <Text style={styles.savedStartText}>{t('route.startShort')}</Text>
                </Pressable>
                <IconBtn icon="trash-outline" label={t('route.deleteNamed', { name: item.name })} onPress={() => onDelete(item)} />
              </View>
            );
          }}
        />
      </View>
    </Modal>
  );
}

const shadow = {
  shadowColor: '#000000',
  shadowOpacity: 0.15,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 6,
};

const useStyles = makeStyles((c) => ({
  container: { flex: 1 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12 },
  searchBox: {
    marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surface,
    borderRadius: 14, paddingHorizontal: 14, minHeight: 48, paddingVertical: 4, ...shadow,
  },
  searchInput: { flex: 1, fontSize: 16, color: c.text, paddingVertical: 8 },
  results: { marginTop: 6, backgroundColor: c.surface, borderRadius: 14, overflow: 'hidden', ...shadow },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  resultTitle: { fontSize: 16, fontFamily: FONT.bold, color: c.text },
  resultSub: { fontSize: 14, color: c.textMuted, marginTop: 2 },
  resultEmpty: { padding: 16, color: c.textMuted, textAlign: 'center', fontSize: 15 },
  pressed: { backgroundColor: c.pressed },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 14 },
  panel: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.surface,
    borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 16, paddingBottom: 12, ...shadow,
  },
  dragZone: { flexShrink: 0 },
  panelScroll: { flexGrow: 0, flexShrink: 1 },
  handleArea: { alignSelf: 'stretch', minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: c.textFaint },
  handleChevron: { marginTop: -2, marginBottom: -6 },
  summaryArea: { alignItems: 'center', gap: 8, paddingBottom: 10 },
  summary: { fontSize: 19, fontFamily: FONT.black, color: c.text, textAlign: 'center' },
  startRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  startRowStacked: { flexDirection: 'column', alignItems: 'stretch' },
  startBtn: {
    flex: 1, minHeight: 58, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16, backgroundColor: c.accent, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 10,
    shadowColor: c.accent, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  startBtnStacked: { flex: 0 },
  startText: { flexShrink: 1, color: c.onAccent, fontSize: 20, fontFamily: FONT.black, letterSpacing: 0.3, textAlign: 'center' },
  previewBtn: {
    minHeight: 58, paddingVertical: 8, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 16, borderWidth: 2, borderColor: c.primary, flexDirection: 'row',
    alignItems: 'center', gap: 6, backgroundColor: c.surface,
  },
  previewText: { flexShrink: 1, color: c.primary, fontSize: 16, fontFamily: FONT.black },
  ideas: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.primary, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8,
  },
  ideasTitle: { color: c.onPrimary, fontSize: 16, fontFamily: FONT.black },
  ideasSub: { color: c.dark ? c.onPrimary : '#E9E4DA', fontSize: 14, marginTop: 2 },
  mix: { alignSelf: 'stretch', gap: 4 },
  mixBar: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: c.surfaceAlt },
  mixText: { fontSize: 13, color: c.textMuted, textAlign: 'center' },
  summaryMuted: { fontSize: 15, color: c.textMuted, textAlign: 'center' },
  errorRow: { alignItems: 'center', gap: 8 },
  errorText: { fontSize: 15, color: c.danger, fontWeight: '600', textAlign: 'center' },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.primary, borderRadius: 999, paddingHorizontal: 16, minHeight: 44,
  },
  retryText: { color: c.onPrimary, fontSize: 15, fontFamily: FONT.bold },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  stopBadge: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  stopBadgeText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  stopTitle: { fontSize: 15, fontWeight: '600', color: c.text },
  stopSub: { fontSize: 13, color: c.textMuted },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  removeGap: { marginLeft: 12 },
  dockPin: {
    flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 28, minHeight: 28, borderRadius: 14, paddingHorizontal: 6,
    backgroundColor: c.dark ? '#3B5BA9' : COLORS.bcycle, borderWidth: 2, borderColor: '#FFFFFF',
  },
  dockPinText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  stopPin: {
    minWidth: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: c.dark ? c.bg : '#FFFFFF', paddingHorizontal: 4, flexDirection: 'row',
  },
  stopPinText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  styleBox: { marginBottom: 10 },
  segment: { flexDirection: 'row', backgroundColor: c.surfaceAlt, borderRadius: 10, padding: 3 },
  segmentItem: { flex: 1, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 8, alignItems: 'center', minHeight: 44 },
  segmentStacked: { flexDirection: 'column' },
  segmentItemStacked: { flex: 0, alignItems: 'flex-start', paddingHorizontal: 10 },
  segmentActive: { backgroundColor: c.dark ? c.pressed : c.surface, elevation: 1, shadowColor: c.shadow, shadowOpacity: 0.08, shadowRadius: 2 },
  segmentText: { fontSize: 14, fontWeight: '600', color: c.textMuted },
  segmentTextActive: { color: c.primary, fontFamily: FONT.black },
  segmentHint: { fontSize: 13, color: c.textMuted, textAlign: 'center', marginTop: 2 },
  segmentHintActive: { color: c.primary },
  hint: { fontSize: 13, color: c.textMuted, marginTop: 6, textAlign: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 6, minHeight: 44 },
  toggleLabel: { fontSize: 15, color: c.text },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  action: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, minHeight: 44,
    borderRadius: 999, borderWidth: 1, borderColor: c.primary,
  },
  actionPrimary: { backgroundColor: c.primary, borderColor: c.primary },
  actionText: { fontSize: 14, fontFamily: FONT.bold, color: c.primary },
  footnote: { fontSize: 13, color: c.textMuted, marginTop: 8 },
  modalBackdrop: { flex: 1, backgroundColor: c.scrim, justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: c.surface, borderRadius: 16, padding: 20, gap: 14 },
  dialogTitle: { fontSize: 19, fontFamily: FONT.black, color: c.text },
  dialogInput: { borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: c.text },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  dialogBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, minHeight: 44, borderRadius: 10 },
  privacyBox: { backgroundColor: c.surfaceAlt, borderRadius: 12, padding: 12, gap: 4 },
  privacyText: { fontSize: 15, fontFamily: FONT.bold, color: c.text },
  privacySub: { fontSize: 13, color: c.textMuted, marginTop: 2 },
  dialogBtnPrimary: { backgroundColor: c.primary },
  dialogBtnText: { fontSize: 15, fontWeight: '600', color: c.text },
  sheet: { flex: 1, backgroundColor: c.bg },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  sheetTitle: { fontSize: 22, fontFamily: FONT.black, color: c.text },
  sheetDone: { fontSize: 16, fontFamily: FONT.bold, color: c.primary },
  sheetDoneBtn: { minHeight: 44, justifyContent: 'center' },
  savedRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  savedStart: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.accent, borderRadius: 12, paddingHorizontal: 12, minHeight: 44,
  },
  savedStartText: { color: c.onAccent, fontSize: 15, fontFamily: FONT.black },
  savedWarn: { fontSize: 14, color: c.danger, paddingHorizontal: 16, paddingBottom: 8 },
  savedEmpty: { alignItems: 'center', gap: 8, padding: 16 },
  askStart: {
    flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  askStartText: { flex: 1, fontSize: 15, fontFamily: FONT.bold, color: c.primary },
  locationOff: { backgroundColor: c.surfaceAlt, borderRadius: 12, padding: 12, gap: 8, marginTop: 6 },
  locationOffText: { fontSize: 14, color: c.text },
  locationBtn: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, borderWidth: 1, borderColor: c.primary, borderRadius: 999,
    paddingHorizontal: 14, minHeight: 44,
  },
  locationBtnText: { fontSize: 15, fontFamily: FONT.bold, color: c.primary },
}));
