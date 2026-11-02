// In-app turn-by-turn navigation: a bike icon follows your route on a
// tilted, heading-up map, with big turn banners, spoken directions,
// automatic rerouting, and an arrival summary. Directions keep going with the
// phone locked or another app in front (see src/lib/bg-location.ts).

import Ionicons from '@expo/vector-icons/Ionicons';
import { useKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { AnimatedRegion, MarkerAnimated, Polyline } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BikeMarker, ManeuverIcon } from '@/components/maneuver-icon';
import { useAuth } from '@/lib/auth';
import { startNavigationUpdates, stopNavigationUpdates } from '@/lib/bg-location';
import { useRideLog } from '@/lib/ridelog';
import { addFix, MIN_LOG_M, newRecorder, type Badge } from '@/lib/stats';
import { BRAND, FONT } from '@/lib/config';
import { useData } from '@/lib/data';
import { distanceMeters, formatDistance } from '@/lib/geo';
import { locale, useT } from '@/lib/i18n';
import { DARK_MAP_STYLE } from '@/lib/map-style';
import {
  arrivalDock, bearingAt, buildLine, buildManeuvers, instruction, nextManeuver, pointAt, project, reachedStop, shortDistance,
  voicePrompt, type Maneuver, type RouteLine,
} from '@/lib/navigation';
import { usePrefs } from '@/lib/prefs';
import { isDroppedPin, useRoute } from '@/lib/route';
import { fetchRoute, formatDuration, type LatLon, type RouteResult } from '@/lib/routing';
import { nameAt } from '@/lib/trails';
import { useTrip } from '@/lib/trip';
import { setSpeakInBackground, speak, stopSpeaking } from '@/lib/voice';
import { makeStyles, useTheme } from '@/lib/theme';

/** Animated marker typed loosely: react-native-maps' types omit children. */
const AnimatedMarker = MarkerAnimated as unknown as React.ComponentType<{
  coordinate: AnimatedRegion;
  anchor: { x: number; y: number };
  zIndex: number;
  tracksViewChanges: boolean;
  children: React.ReactNode;
}>;
const OFF_ROUTE_M = 35;
/** No "Rerouting" voice while GPS settles at the start of a ride. */
const QUIET_START_MS = 20000;
const QUIET_START_FIXES = 5;
/** Farther than this from the route's start on the first fixes: route to the start first. */
const APPROACH_M = 200;

type NavPoint = LatLon & { label?: string };

interface NavRoute {
  line: RouteLine;
  maneuvers: Maneuver[];
  waypoints: NavPoint[];
  waypointAlong: number[];
  timeS: number;
}

function alongOfWaypoints(line: RouteLine, wps: LatLon[]): number[] {
  let prev = 0;
  return wps.map((w) => {
    const p = project(line, w, prev, 1e9);
    prev = p.along;
    return p.along;
  });
}

export default function NavigateScreen() {
  useKeepAwake();
  const styles = useStyles();
  const { c } = useTheme();
  const { t } = useT();
  const ACCENT = c.accent;
  const { trip } = useTrip();
  const { paths, stations } = useData();
  const { prefs } = usePrefs();
  const route = useRoute();
  const auth = useAuth();
  const rideLog = useRideLog();
  const mapRef = useRef<MapView>(null);

  const build = (result: RouteResult, waypoints: NavPoint[]): NavRoute => {
    const line = buildLine(result.coords);
    const maneuvers = buildManeuvers(line, result, (p) => nameAt(paths, p));
    return { line, maneuvers, waypoints, waypointAlong: alongOfWaypoints(line, waypoints), timeS: result.timeS };
  };

  const [nav, setNav] = useState<NavRoute | null>(() => (trip ? build(trip.result, trip.points) : null));
  const [along, setAlong] = useState(0);
  const [snapped, setSnapped] = useState<LatLon | null>(null);
  const [hasFix, setHasFix] = useState(false);
  const [following, setFollowing] = useState(true);
  const [muted, setMuted] = useState(false);
  const [rerouting, setRerouting] = useState<false | 'reroute' | 'approach'>(false);
  const [rerouteFailed, setRerouteFailed] = useState(false);
  const [reachedLabel, setReachedLabel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  /** Background updates couldn't start: directions pause while the app is off screen. */
  const [foregroundOnly, setForegroundOnly] = useState(false);
  const [startedAt] = useState(() => Date.now());
  // Clock for ETA and ride time (updated every few seconds).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const [ridden, setRidden] = useState(0);
  // Ride recording for profile stats and badges.
  const recorder = useRef(newRecorder());
  const maxAlong = useRef(0);
  const usedSim = useRef(false);
  const logged = useRef(false);
  const [newBadges, setNewBadges] = useState<Badge[]>([]);
  const [summary, setSummary] = useState<{ distanceM: number; movingS: number } | null>(null);

  const start = trip?.result.coords[0] ?? { latitude: 43.07, longitude: -89.38 };
  // Let the bike icon finish drawing before the map freezes it as an image.
  const [iconReady, setIconReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setIconReady(true), 1500);
    return () => clearTimeout(t);
  }, []);
  const [bikePos] = useState(() => new AnimatedRegion({ ...start, latitudeDelta: 0, longitudeDelta: 0 }));

  // Latest values for the location callback.
  const navRef = useRef(nav);
  const alongRef = useRef(0);
  const offCount = useRef(0);
  const spoken = useRef(new Set<string>());
  const lastPos = useRef<LatLon | null>(null);
  const followingRef = useRef(true);
  const mutedRef = useRef(false);
  const reroutingRef = useRef(false);
  const arrivedRef = useRef(false);
  const fixCount = useRef(0);
  const approached = useRef(false);
  const reached = useRef(new Set<number>());
  useEffect(() => {
    navRef.current = nav;
  }, [nav]);
  useEffect(() => {
    followingRef.current = following;
  }, [following]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const say = (text: string) => {
    if (mutedRef.current) return;
    speak(text, locale());
  };

  /** New route from here. `approach`: the rider is away from the start, so ride to it first. */
  const reroute = async (pos: LatLon, approach = false) => {
    const current = navRef.current;
    if (!current || reroutingRef.current || !trip) return;
    reroutingRef.current = true;
    setRerouting(approach ? 'approach' : 'reroute');
    const settling = Date.now() - startedAt < QUIET_START_MS || fixCount.current <= QUIET_START_FIXES;
    if (!approach && !settling) say(t('route.voice.rerouting'));
    try {
      const remaining = approach
        ? current.waypoints
        : current.waypoints.filter((_, i) => current.waypointAlong[i] > alongRef.current + 25);
      const targets = remaining.length ? remaining : [current.waypoints[current.waypoints.length - 1]];
      const r = await fetchRoute([pos, ...targets], trip.profile);
      const next = build(r, [{ ...pos, label: t('route.myLocation') }, ...targets]);
      spoken.current = new Set();
      reached.current = new Set();
      alongRef.current = 0;
      offCount.current = 0;
      setNav(next);
      setAlong(0);
      setRerouteFailed(false);
    } catch {
      // Keep the old route; try again after a few more off-route fixes.
      offCount.current = 0;
      setRerouteFailed(true);
    } finally {
      reroutingRef.current = false;
      setRerouting(false);
    }
  };

  const onFix = (pos: LatLon, speed: number | null, gpsHeading: number | null) => {
    const current = navRef.current;
    if (!current || arrivedRef.current) return;
    setHasFix(true);
    fixCount.current += 1;

    if (lastPos.current) {
      const d = distanceMeters(lastPos.current.latitude, lastPos.current.longitude, pos.latitude, pos.longitude);
      if (d < 100) setRidden((m) => m + d);
    }
    lastPos.current = pos;
    recorder.current = addFix(recorder.current, pos.latitude, pos.longitude, Date.now(), speed);

    const p = project(current.line, pos, alongRef.current);
    // Starting away from the ride (e.g. a suggested ride across town): head to its start first.
    const start = current.line.coords[0];
    if (
      !approached.current && fixCount.current <= QUIET_START_FIXES && p.offRoute > OFF_ROUTE_M && p.along < 50 &&
      distanceMeters(pos.latitude, pos.longitude, start.latitude, start.longitude) > APPROACH_M
    ) {
      approached.current = true;
      void reroute(pos, true);
    }
    if (fixCount.current > QUIET_START_FIXES) approached.current = true;
    offCount.current = p.offRoute > OFF_ROUTE_M ? offCount.current + 1 : 0;
    if (offCount.current >= 3) void reroute(pos);
    if (p.offRoute <= OFF_ROUTE_M) setRerouteFailed(false);

    alongRef.current = p.along;
    if (p.offRoute <= OFF_ROUTE_M) maxAlong.current = Math.max(maxAlong.current, p.along);
    setAlong(p.along);
    const shown = p.offRoute > OFF_ROUTE_M ? pos : p.snapped;
    setSnapped(shown);

    bikePos
      .timing({ latitude: shown.latitude, longitude: shown.longitude, latitudeDelta: 0, longitudeDelta: 0, duration: 900, useNativeDriver: false } as never)
      .start();

    const heading = speed != null && speed > 1.5 && gpsHeading != null && gpsHeading >= 0 ? gpsHeading : bearingAt(current.line, p.along, 25);
    if (followingRef.current) {
      mapRef.current?.animateCamera({ center: shown, heading, pitch: 55, zoom: 17.5, altitude: 300 }, { duration: 900 });
    }

    const { current: m } = nextManeuver(current.maneuvers, p.along);
    if (p.offRoute <= OFF_ROUTE_M) {
      const stop = reachedStop(current.waypointAlong, p.along, current.line.total, reached.current);
      if (stop != null) {
        const label = current.waypoints[stop]?.label;
        const name = label && !isDroppedPin(label) ? label : t('route.yourStop');
        say(t('route.voice.reached', { name }));
        setReachedLabel(name);
        setTimeout(() => setReachedLabel(null), 6000);
      }
    }
    if (m && p.offRoute <= OFF_ROUTE_M) {
      const prompt = voicePrompt(m, m.at - p.along, spoken.current);
      if (prompt) say(prompt);
    }
    if (current.line.total - p.along < 25 && p.offRoute <= OFF_ROUTE_M) {
      arrivedRef.current = true;
      setArrived(true);
    }
  };
  const onFixRef = useRef(onFix);
  useEffect(() => {
    onFixRef.current = onFix;
  });

  // Real GPS, also with the phone locked or another app in front. Only "While Using" permission
  // is asked for: iOS keeps updates started on screen going in the background (blue pill).
  useEffect(() => {
    if (simulating || arrived) return;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        setPermissionDenied(true);
        return;
      }
      const mode = await startNavigationUpdates((loc) =>
        onFixRef.current(
          { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
          loc.coords.speed,
          loc.coords.heading,
        ),
      );
      if (cancelled) return;
      setForegroundOnly(mode === 'foreground');
      if (mode === 'foreground') AccessibilityInfo.announceForAccessibility(t('nav.keepOpen'));
    })().catch(() => {
      if (!cancelled) setPermissionDenied(true);
    });
    return () => {
      cancelled = true;
      void stopNavigationUpdates();
    };
  }, [simulating, arrived]); // eslint-disable-line react-hooks/exhaustive-deps

  // Simulated ride (testing at home): rides the route at ~15 mph.
  useEffect(() => {
    if (!simulating) return;
    usedSim.current = true;
    let simAlong = alongRef.current;
    const timer = setInterval(() => {
      const current = navRef.current;
      if (!current) return;
      simAlong = Math.min(current.line.total, simAlong + 6.7);
      const pos = pointAt(current.line, simAlong);
      onFixRef.current(pos, 6.7, bearingAt(current.line, simAlong, 25));
    }, 1000);
    return () => clearInterval(timer);
  }, [simulating]);

  // Prompts may speak in the background while navigating; stop talking and un-duck when leaving.
  useEffect(() => {
    setSpeakInBackground(true);
    return () => {
      stopSpeaking();
      setSpeakInBackground(false);
    };
  }, []);

  // Arrival announcement (the only place arrival is spoken).
  useEffect(() => {
    if (!arrived || mutedRef.current) return;
    speak(t('route.voice.arrived'), locale());
  }, [arrived]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save tapped while signed out: carry on once signed in.
  const saveRideNow = () => {
    if (!trip) return;
    setSaving(true);
    route
      .saveRide(trip.title)
      .then((r) => {
        if (r) Alert.alert(t('route.savedToRides'), t('route.savedFindIt'));
        else Alert.alert(t('route.notSaved'), t('route.planToSave'));
      })
      .catch(() => Alert.alert(t('route.notSaved'), t('route.checkConnection')))
      .finally(() => setSaving(false));
  };
  const saveRef = useRef(saveRideNow);
  useEffect(() => {
    saveRef.current = saveRideNow;
  });
  useEffect(() => {
    if (!pendingSave || auth.sheet) return;
    const t = setTimeout(() => {
      setPendingSave(false);
      if (auth.session) saveRef.current();
    }, 0);
    return () => clearTimeout(t);
  }, [pendingSave, auth.sheet, auth.session]);

  const split = useMemo(() => {
    if (!nav) return { done: [], todo: [] };
    const { coords, cum } = nav.line;
    const i = cum.findIndex((c) => c > along);
    const cut = i < 0 ? coords.length : i;
    const here = pointAt(nav.line, along);
    return { done: [...coords.slice(0, cut), here], todo: [here, ...coords.slice(cut)] };
  }, [nav, along]);

  /** Save the ride to the rider's log (once). Simulated rides count only in development. */
  const logRide = async (): Promise<Badge[]> => {
    if (logged.current || !trip || !nav) return [];
    const r = recorder.current;
    if (r.distanceM < MIN_LOG_M || (usedSim.current && !__DEV__)) return [];
    logged.current = true;
    const fraction = Math.min(1, maxAlong.current / Math.max(1, nav.line.total));
    try {
      return await rideLog.addRide({
        startedAt,
        distanceM: r.distanceM,
        movingS: r.movingS,
        elapsedS: (Date.now() - startedAt) / 1000,
        climbM: trip.result.climbM * fraction,
        maxSpeedMps: r.maxSpeedMps,
        title: trip.title,
        rideId: trip.rideId ?? null,
      });
    } catch {
      return [];
    }
  };
  const logRideRef = useRef(logRide);
  useEffect(() => {
    logRideRef.current = logRide;
  });

  // On arrival: log the ride and show its stats plus any badge it earned.
  useEffect(() => {
    if (!arrived) return;
    const r = recorder.current;
    const t = setTimeout(() => {
      setSummary({ distanceM: r.distanceM, movingS: r.movingS });
      void logRideRef.current().then(setNewBadges);
    }, 0);
    return () => clearTimeout(t);
  }, [arrived]);

  if (!trip || !nav) {
    return (
      <SafeAreaView style={styles.empty}>
        <Text style={styles.emptyText}>{t('route.planFirst')}</Text>
        <Pressable style={styles.primary} onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.primaryText}>{t('common.back')}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const { current: m, then } = nextManeuver(nav.maneuvers, along);
  const toTurn = m ? Math.max(0, m.at - along) : 0;
  const remaining = Math.max(0, nav.line.total - along);
  const timeLeft = nav.line.total ? (nav.timeS * remaining) / nav.line.total : 0;
  const eta = new Date(now + timeLeft * 1000).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });

  const overview = () => {
    setFollowing(false);
    mapRef.current?.fitToCoordinates(nav.line.coords, { edgePadding: { top: 200, right: 50, bottom: 220, left: 50 }, animated: true });
  };
  const recenter = () => {
    setFollowing(true);
    const c = snapped ?? nav.line.coords[0];
    mapRef.current?.animateCamera({ center: c, heading: bearingAt(nav.line, along, 25), pitch: 55, zoom: 17.5, altitude: 300 }, { duration: 600 });
  };
  const end = () => {
    stopSpeaking();
    setSpeakInBackground(false);
    void stopNavigationUpdates();
    void logRide().then((earned) => {
      if (earned.length) Alert.alert(t('route.newBadge'), earned.map((b) => b.name).join(', '));
    });
    router.back();
  };
  // Arrival: the BCycle dock to return a bike to, for BCycle riders or when one is close by.
  const dest = nav.waypoints[nav.waypoints.length - 1] ?? nav.line.coords[nav.line.coords.length - 1];
  const dock = arrived && dest ? arrivalDock(stations, dest, prefs?.bike === 'bcycle') : null;
  const dockText = dock
    ? dock.here
      ? t('nav.dockHere', { name: dock.station.name, count: dock.station.docks })
      : t('nav.dock', { name: dock.station.name, dist: formatDistance(dock.distanceM), count: dock.station.docks })
    : '';
  const rideToDock = () => {
    if (!dock) return;
    stopSpeaking();
    setSpeakInBackground(false);
    void stopNavigationUpdates();
    void logRide();
    route.routeTo({ latitude: dock.station.lat, longitude: dock.station.lon }, dock.station.name);
    router.dismissTo('/route');
  };
  const confirmEnd = () => {
    Alert.alert(t('route.endTitle'), t('route.endMsg'), [
      { text: t('route.keepRiding'), style: 'cancel' },
      { text: t('route.endRide'), style: 'destructive', onPress: end },
    ]);
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialCamera={{ center: start, heading: bearingAt(nav.line, 0, 25), pitch: 55, zoom: 17, altitude: 400 }}
        onPanDrag={() => setFollowing(false)}
        userInterfaceStyle={c.dark ? 'dark' : 'light'}
        customMapStyle={c.dark ? DARK_MAP_STYLE : []}
        showsUserLocation={false}
        showsCompass={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        pitchEnabled>
        <Polyline coordinates={split.done} strokeColor={c.dark ? '#7C859B' : '#9ca3af'} strokeWidth={7} lineCap="round" zIndex={1} />
        <Polyline coordinates={split.todo} strokeColor={c.dark ? c.bg : '#FFFFFF'} strokeWidth={11} lineCap="round" zIndex={2} />
        <Polyline coordinates={split.todo} strokeColor={ACCENT} strokeWidth={7} lineCap="round" zIndex={3} />
        <AnimatedMarker coordinate={bikePos} anchor={{ x: 0.5, y: 0.5 }} zIndex={10} tracksViewChanges={!iconReady}>
          <BikeMarker color={ACCENT} />
        </AnimatedMarker>
      </MapView>

      {/* Turn banner */}
      <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
        {permissionDenied ? (
          <View style={[styles.banner, { backgroundColor: '#b91c1c' }]} accessibilityLiveRegion="polite">
            <Text style={styles.bannerMain} accessibilityRole="header">{t('route.locOffTitle')}</Text>
            <Text style={styles.bannerSub}>{t('route.locOffSub')}</Text>
            <Pressable onPress={() => void Linking.openSettings()} style={styles.bannerBtn} accessibilityRole="button">
              <Text style={styles.bannerBtnText}>{t('common.openSettings')}</Text>
            </Pressable>
          </View>
        ) : rerouting ? (
          <View style={[styles.banner, styles.bannerRow, { backgroundColor: rerouting === 'approach' ? (c.dark ? c.surfaceAlt : BRAND.navy) : '#c2410c' }]} accessibilityLiveRegion="polite">
            <ActivityIndicator color="#FFFFFF" />
            <Text style={styles.bannerMain}>{rerouting === 'approach' ? t('route.toStart') : t('route.rerouting')}</Text>
          </View>
        ) : rerouteFailed ? (
          <View style={[styles.banner, { backgroundColor: '#c2410c' }]} accessibilityLiveRegion="polite">
            <Text style={styles.bannerMain}>{t('route.noNewRoute')}</Text>
            <Text style={styles.bannerSub}>{t('route.headBack')}</Text>
          </View>
        ) : !hasFix ? (
          <View style={styles.banner}>
            <Text style={styles.bannerMain}>{t('route.findingLoc')}</Text>
            <Text style={styles.bannerSub}>{t('route.headOutside')}</Text>
          </View>
        ) : m ? (
          <View style={styles.banner} accessibilityLiveRegion="polite">
            <View style={styles.bannerRow}>
              <View style={styles.turnIcon}>
                <ManeuverIcon type={m.type} size={44} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.turnDistance}>{shortDistance(toTurn)}</Text>
                <Text style={styles.turnText} numberOfLines={2}>{instruction(m)}</Text>
              </View>
            </View>
            {then && then.at - m.at < 400 && (
              <View style={styles.thenRow}>
                <Text style={styles.thenText}>{t('route.then')}</Text>
                <ManeuverIcon type={then.type} size={18} color="#FFFFFF" />
                <Text style={styles.thenText} numberOfLines={2}>{instruction(then)}</Text>
              </View>
            )}
          </View>
        ) : null}
        {reachedLabel && (
          <View style={styles.reached} accessibilityLiveRegion="polite">
            <Ionicons name="flag" size={16} color={c.onGold} />
            <Text style={styles.reachedText}>{t('route.voice.reached', { name: reachedLabel })}</Text>
          </View>
        )}
      </SafeAreaView>

      {/* Bottom controls */}
      <SafeAreaView edges={['bottom']} style={styles.bottomWrap} pointerEvents="box-none">
        {!following && (
          <Pressable style={styles.recenter} onPress={recenter} accessibilityRole="button" accessibilityLabel={t('route.recenterA11y')}>
            <Ionicons name="navigate" size={18} color={c.primary} />
            <Text style={styles.recenterText}>{t('route.recenter')}</Text>
          </Pressable>
        )}
        {foregroundOnly && !simulating && !arrived && (
          <View style={styles.note}>
            <Ionicons name="phone-portrait-outline" size={16} color={c.textMuted} />
            <Text style={styles.noteText}>{t('nav.keepOpen')}</Text>
          </View>
        )}
        <View style={styles.bottom}>
          <Pressable style={styles.ctl} onPress={confirmEnd} accessibilityLabel={t('route.endRide')} accessibilityRole="button">
            <View style={styles.endBtn}>
              <Ionicons name="close" size={26} color="#FFFFFF" />
            </View>
            <Text style={styles.ctlText}>{t('route.endShort')}</Text>
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }} accessible accessibilityLabel={t('route.etaA11y', { time: formatDuration(timeLeft), dist: formatDistance(remaining), eta })}>
            <Text style={styles.timeLeft}>{formatDuration(timeLeft)}</Text>
            <Text style={styles.remaining}>{t('route.remaining', { dist: formatDistance(remaining), eta })}</Text>
          </View>
          <Pressable
            style={styles.ctl}
            onPress={() => {
              if (!muted) stopSpeaking();
              setMuted(!muted);
            }}
            accessibilityRole="button"
            accessibilityLabel={muted ? t('route.voiceOn') : t('route.voiceMute')}>
            <View style={styles.iconBtn}>
              <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={22} color={c.text} />
            </View>
            <Text style={styles.ctlText}>{muted ? t('route.muted') : t('route.voice')}</Text>
          </Pressable>
          <Pressable style={styles.ctl} onPress={overview} accessibilityRole="button" accessibilityLabel={t('route.overviewA11y')}>
            <View style={styles.iconBtn}>
              <Ionicons name="map-outline" size={22} color={c.text} />
            </View>
            <Text style={styles.ctlText}>{t('route.overview')}</Text>
          </Pressable>
        </View>
        {__DEV__ && (
          <Pressable onPress={() => setSimulating((s) => !s)} style={styles.simBtn} accessibilityRole="button">
            <Text style={styles.simText}>{simulating ? t('route.simStop') : t('route.simStart')}</Text>
          </Pressable>
        )}
      </SafeAreaView>

      {arrived && (
        <ScrollView style={styles.arrivedWrap} contentContainerStyle={styles.arrivedScroll}>
          <View style={styles.arrivedCard}>
            <Ionicons name="trophy" size={44} color={c.gold} />
            <Text style={styles.arrivedTitle}>{t('route.madeIt')}</Text>
            <Text style={styles.arrivedStats}>
              {formatDistance(Math.max(ridden, nav.line.total * 0.98))}  ·  {formatDuration((now - startedAt) / 1000)}
            </Text>
            {summary && summary.movingS > 30 && (
              <Text style={styles.arrivedSub}>
                {t('route.avgMoving', { mph: ((summary.distanceM / 1609.344) / (summary.movingS / 3600)).toFixed(1) })}
                {auth.session ? `  ·  ${t('route.addedStats')}` : ''}
              </Text>
            )}
            {newBadges.length > 0 && (
              <View style={styles.badgeWon}>
                <Ionicons name="ribbon" size={18} color={c.onGold} />
                <Text style={styles.badgeWonText}>{t('route.newBadgeList', { names: newBadges.map((b) => b.name).join(', ') })}</Text>
              </View>
            )}
            <Text style={styles.arrivedSub}>{trip.title}</Text>
            {dock && (
              <View style={styles.dock}>
                <View style={styles.dockRow} accessible accessibilityLabel={dockText}>
                  <Ionicons name="bicycle" size={22} color={c.text} />
                  <Text style={styles.dockText}>{dockText}</Text>
                </View>
                {!dock.here && (
                  <Pressable
                    style={styles.dockBtn}
                    onPress={rideToDock}
                    accessibilityRole="button"
                    accessibilityLabel={t('nav.dockGoA11y', { name: dock.station.name })}>
                    <Ionicons name="navigate" size={18} color={c.primary} />
                    <Text style={styles.dockBtnText}>{t('nav.dockGo')}</Text>
                  </Pressable>
                )}
              </View>
            )}
            {route.savedId ? (
              <View style={[styles.primary, styles.savedPill]} accessible accessibilityLabel={t('route.inSavedA11y')}>
                <Ionicons name="bookmark" size={18} color={c.text} />
                <Text style={[styles.primaryText, { color: c.text }]}>{t('route.inSaved')}</Text>
              </View>
            ) : (
              <Pressable
                style={[styles.primary, saving && { opacity: 0.7 }]}
                disabled={saving}
                accessibilityRole="button"
                accessibilityState={{ disabled: saving, busy: saving }}
                onPress={() => {
                  if (!auth.requireAccount(t('route.saveNeedsAccountShort'))) {
                    setPendingSave(true);
                    return;
                  }
                  saveRideNow();
                }}>
                <Text style={styles.primaryText}>{saving ? t('route.saving') : t('route.saveRide')}</Text>
              </Pressable>
            )}
            <Pressable onPress={end} style={styles.doneBtn} accessibilityRole="button">
              <Text style={styles.done}>{t('common.done')}</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const shadow = {
  shadowColor: '#000000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8,
};

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.bg },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 10 },
  banner: { marginTop: 6, backgroundColor: c.dark ? c.surfaceAlt : BRAND.navy, borderWidth: c.dark ? 1 : 0, borderColor: c.border, borderRadius: 20, padding: 16, ...shadow },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  turnIcon: { width: 64, height: 64, borderRadius: 16, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
  turnDistance: { color: '#FFFFFF', fontSize: 36, fontFamily: FONT.black },
  turnText: { color: '#FFFFFF', fontSize: 19, fontFamily: FONT.bold, marginTop: 2 },
  bannerMain: { color: '#FFFFFF', fontSize: 22, fontFamily: FONT.black },
  bannerSub: { color: BRAND.limestone, fontSize: 15, marginTop: 4 },
  bannerBtn: { alignSelf: 'flex-start', marginTop: 10, backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' },
  bannerBtnText: { color: BRAND.navy, fontSize: 15, fontFamily: FONT.black },
  reached: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center', marginTop: 8, backgroundColor: c.gold,
    borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, ...shadow,
  },
  reachedText: { color: c.onGold, fontSize: 16, fontFamily: FONT.black },
  thenRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.3)',
  },
  thenText: { color: BRAND.limestone, fontSize: 15, fontFamily: FONT.bold, flexShrink: 1 },
  bottomWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10 },
  bottom: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surface, borderRadius: 22,
    padding: 12, marginBottom: 6, ...shadow,
  },
  ctl: { alignItems: 'center', gap: 2, minWidth: 48 },
  ctlText: { fontSize: 13, fontFamily: FONT.bold, color: c.textMuted },
  endBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' },
  timeLeft: { fontSize: 30, fontFamily: FONT.black, color: c.text },
  remaining: { fontSize: 14, color: c.textMuted, marginTop: 2 },
  iconBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  recenter: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.surface,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, marginBottom: 10, ...shadow,
  },
  recenterText: { color: c.primary, fontFamily: FONT.bold, fontSize: 15 },
  note: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', backgroundColor: c.surface, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 6, marginBottom: 8, ...shadow,
  },
  noteText: { flexShrink: 1, fontSize: 13, fontFamily: FONT.bold, color: c.textMuted },
  simBtn: { alignSelf: 'center', backgroundColor: 'rgba(17,24,39,0.75)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginBottom: 4 },
  simText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  arrivedWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.scrim },
  arrivedScroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  arrivedCard: { backgroundColor: c.surface, borderRadius: 24, padding: 24, alignItems: 'center', gap: 8 },
  arrivedTitle: { fontSize: 30, fontFamily: FONT.black, color: c.text },
  arrivedStats: { fontSize: 18, fontFamily: FONT.bold, color: c.accent },
  badgeWon: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.gold, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 4 },
  badgeWonText: { fontFamily: FONT.bold, fontSize: 15, color: c.onGold },
  arrivedSub: { fontSize: 14, color: c.textMuted, marginBottom: 8, textAlign: 'center' },
  dock: { alignSelf: 'stretch', backgroundColor: c.surfaceAlt, borderRadius: 14, padding: 12, gap: 8, marginBottom: 4 },
  dockRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dockText: { flex: 1, fontSize: 15, fontFamily: FONT.bold, color: c.text },
  dockBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, borderRadius: 12,
    borderWidth: 1.5, borderColor: c.primary, paddingHorizontal: 14,
  },
  dockBtnText: { fontSize: 16, fontFamily: FONT.black, color: c.primary },
  primary: { alignSelf: 'stretch', backgroundColor: c.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', minHeight: 48 },
  savedPill: { flexDirection: 'row', justifyContent: 'center', gap: 8, backgroundColor: c.surfaceAlt },
  doneBtn: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  primaryText: { color: c.onPrimary, fontSize: 17, fontFamily: FONT.black },
  done: { color: c.textMuted, fontSize: 16, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, backgroundColor: c.bg },
  emptyText: { fontSize: 17, color: c.text, textAlign: 'center' },
}));
