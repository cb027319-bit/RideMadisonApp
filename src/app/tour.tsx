// Virtual ride preview: a flyover that rides the route in about a minute and
// a half on a tilted satellite map, with a bike icon, live mile marker,
// the trail you're on, the next stop, and an elevation profile you can scrub.

import Ionicons from '@expo/vector-icons/Ionicons';
import { useKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DirectionsSheet } from '@/components/directions-sheet';
import { BikeMarker } from '@/components/maneuver-icon';
import { BRAND, FONT } from '@/lib/config';
import { useData } from '@/lib/data';
import { formatDistance } from '@/lib/geo';
import { useT } from '@/lib/i18n';
import { DARK_MAP_STYLE } from '@/lib/map-style';
import { bearingAt, buildLine, buildManeuvers, pointAt, project } from '@/lib/navigation';
import { useRoute } from '@/lib/route';
import { formatDuration, metersToFeet } from '@/lib/routing';
import { nameAt } from '@/lib/trails';
import { useTrip } from '@/lib/trip';
import { makeStyles, useTheme } from '@/lib/theme';

const TOUR_SECONDS = 90;
const TICK_MS = 250;
const BARS = 60;
/** Unplayed elevation bars: visible against the panel (about 3:1) in each mode. */
const UNPLAYED_LIGHT = '#8C877C';
const UNPLAYED_DARK = '#5E6782';

export default function TourScreen() {
  useKeepAwake();
  const styles = useStyles();
  const { c } = useTheme();
  const { t } = useT();
  const ACCENT = c.accent;
  const UNPLAYED = c.dark ? UNPLAYED_DARK : UNPLAYED_LIGHT;
  const { trip } = useTrip();
  const { paths } = useData();
  const route = useRoute();
  const mapRef = useRef<MapView>(null);

  const line = useMemo(() => (trip ? buildLine(trip.result.coords) : null), [trip]);
  const [along, setAlong] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [satellite, setSatellite] = useState(true);
  // Let the bike icon finish drawing before the map freezes it as an image.
  const [iconReady, setIconReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setIconReady(true), 1500);
    return () => clearTimeout(t);
  }, []);
  const [profileWidth, setProfileWidth] = useState(1);
  const [showDirections, setShowDirections] = useState(false);
  const maneuvers = useMemo(
    () => (showDirections && trip && line ? buildManeuvers(line, trip.result, (p) => nameAt(paths, p)) : []),
    [showDirections, trip, line, paths],
  );

  // Where each planned point falls along the route (for "Next: …").
  const stops = useMemo(() => {
    if (!trip || !line) return [];
    let prev = 0;
    return trip.points.map((pt) => {
      const p = project(line, pt, prev, 1e9);
      prev = p.along;
      return { label: pt.label, along: p.along };
    });
  }, [trip, line]);

  // Elevation profile bars, sampled evenly by distance.
  const profile = useMemo(() => {
    if (!trip || !line) return null;
    const { elevations } = trip.result;
    const vals: number[] = [];
    for (let b = 0; b < BARS; b++) {
      const target = ((b + 0.5) / BARS) * line.total;
      let i = line.cum.findIndex((c) => c >= target);
      if (i < 0) i = line.cum.length - 1;
      // nearest known elevation
      let e: number | null = null;
      for (let k = 0; k < 40 && e == null; k++) e = elevations[i + k] ?? elevations[i - k] ?? null;
      vals.push(e ?? NaN);
    }
    const known = vals.filter((v) => Number.isFinite(v));
    if (known.length < BARS / 3) return null;
    const min = Math.min(...known);
    const max = Math.max(...known);
    return { vals, min, max };
  }, [trip, line]);

  // Ride the route: the whole tour takes ~90 s at 1x.
  useEffect(() => {
    if (!playing || !line) return;
    const step = (line.total / TOUR_SECONDS) * (TICK_MS / 1000) * speed;
    const timer = setInterval(() => {
      setAlong((a) => {
        const next = Math.min(line.total, a + step);
        if (next >= line.total) setPlaying(false);
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [playing, speed, line]);

  // Camera follows the bike, looking ahead along the route.
  useEffect(() => {
    if (!line) return;
    const center = pointAt(line, along);
    const heading = bearingAt(line, along, 120);
    mapRef.current?.animateCamera({ center, heading, pitch: 62, zoom: 16.4, altitude: 650 }, { duration: TICK_MS + 50 });
  }, [along, line]);

  // Name of the trail under the bike, refreshed about once a second.
  const nameKey = line ? Math.floor(along / Math.max(30, line.total / 300)) : 0;
  const trailName = useMemo(
    () => (line ? nameAt(paths, pointAt(line, along), 20) : undefined),
    [nameKey, paths, line], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!trip || !line) {
    return (
      <SafeAreaView style={styles.empty}>
        <Text style={styles.emptyText}>{t('route.tour.pick')}</Text>
        <Pressable style={styles.primary} onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.primaryText}>{t('common.back')}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const bike = pointAt(line, along);
  const done = along >= line.total;
  const next = stops.find((s) => s.along > along + 30);
  const progress = line.total ? along / line.total : 0;
  const elapsedRideTime = trip.result.timeS * progress;

  const scrub = (x: number) => {
    const p = Math.max(0, Math.min(1, x / profileWidth));
    setAlong(p * line.total);
  };

  /** Start navigating this ride now. A suggested ride is also loaded into the planner. */
  const startRide = () => {
    if (trip.rideId) {
      const loop = trip.points.length > 1 && sameSpot(trip.points[0], trip.points[trip.points.length - 1]);
      route.loadPlan({
        stops: trip.points.slice(0, trip.points.length > 2 && loop ? -1 : undefined),
        profile: trip.profile,
        roundTrip: loop,
        result: trip.result,
        name: trip.title,
      });
    }
    router.replace('/navigate');
  };

  const jump = (fraction: number) => {
    setPlaying(false);
    setAlong(Math.max(0, Math.min(1, fraction)) * line.total);
  };
  const onProgressAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'increment') jump(progress + 0.1);
    if (e.nativeEvent.actionName === 'decrement') jump(progress - 0.1);
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapType={satellite ? 'hybrid' : 'standard'}
        userInterfaceStyle={c.dark ? 'dark' : 'light'}
        customMapStyle={c.dark && !satellite ? DARK_MAP_STYLE : []}
        initialCamera={{ center: line.coords[0], heading: bearingAt(line, 0, 120), pitch: 62, zoom: 16, altitude: 800 }}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}>
        <Polyline coordinates={line.coords} strokeColor={c.dark && !satellite ? c.bg : '#FFFFFF'} strokeWidth={9} lineCap="round" zIndex={1} />
        <Polyline coordinates={line.coords} strokeColor={ACCENT} strokeWidth={5} lineCap="round" zIndex={2} />
        {stops.map((s, i) => (
          <Marker key={`${s.label}:${i}`} coordinate={pointAt(line, s.along)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={5}>
            <View style={styles.stopDot} />
          </Marker>
        ))}
        <Marker coordinate={bike} anchor={{ x: 0.5, y: 0.5 }} zIndex={10} tracksViewChanges={!iconReady}>
          <BikeMarker color={ACCENT} size={40} />
        </Marker>
      </MapView>

      <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.close} accessibilityRole="button" accessibilityLabel={t('route.tour.close')} hitSlop={4}>
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>{t('route.tour.kicker')}</Text>
            <Text style={styles.title} numberOfLines={2} accessibilityRole="header">{trip.title}</Text>
          </View>
          <Pressable
            onPress={() => setSatellite(!satellite)}
            style={styles.close}
            accessibilityRole="button"
            accessibilityLabel={satellite ? t('route.tour.showStreet') : t('route.tour.showSatellite')}
            hitSlop={4}>
            <Ionicons name={satellite ? 'map' : 'earth'} size={20} color="#FFFFFF" />
          </Pressable>
        </View>
        <View style={styles.chips}>
          <View style={styles.chip}>
            <Text style={styles.chipBig}>{formatDistance(along)}</Text>
            <Text style={styles.chipSmall}>{t('route.tour.of', { dist: formatDistance(line.total) })}</Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipBig}>{formatDuration(elapsedRideTime)}</Text>
            <Text style={styles.chipSmall}>{t('route.tour.intoRide')}</Text>
          </View>
          {profile && (
            <View style={styles.chip}>
              <Text style={styles.chipBig}>{t('common.feet', { n: metersToFeet(currentElevation(profile, progress)) })}</Text>
              <Text style={styles.chipSmall}>{t('route.tour.elevation')}</Text>
            </View>
          )}
        </View>
        {trailName && (
          <View style={styles.onTrail}>
            <Ionicons name="trail-sign" size={14} color="#FFFFFF" />
            <Text style={styles.onTrailText} numberOfLines={1}>{t('route.tour.on', { name: trailName })}</Text>
          </View>
        )}
      </SafeAreaView>

      <SafeAreaView edges={['bottom']} style={styles.bottomWrap} pointerEvents="box-none">
        <View style={styles.panel}>
          {next && !done && (
            <Text style={styles.next} numberOfLines={2}>
              {t('route.tour.next')} <Text style={{ fontWeight: '800' }}>{next.label}</Text> · {formatDistance(next.along - along)}
            </Text>
          )}
          {done && <Text style={styles.next}>{t('route.tour.done', { dist: formatDistance(line.total), climb: metersToFeet(trip.result.climbM) })}</Text>}

          <View style={styles.profileRow}>
            {profile && (
              <View style={styles.scale} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <Text style={styles.scaleText}>{t('common.feet', { n: metersToFeet(profile.max) })}</Text>
                <Text style={styles.scaleText}>{t('common.feet', { n: metersToFeet(profile.min) })}</Text>
              </View>
            )}
            <Pressable
              onLayout={(e: LayoutChangeEvent) => setProfileWidth(e.nativeEvent.layout.width)}
              onPress={(e) => scrub(e.nativeEvent.locationX)}
              style={styles.profile}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel={t('route.tour.progress')}
              accessibilityHint={t('route.tour.progressHint')}
              accessibilityValue={{ text: t('route.tour.progressValue', { along: formatDistance(along), total: formatDistance(line.total), pct: Math.round(progress * 100) }) }}
              accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
              onAccessibilityAction={onProgressAction}>
              {profile
                ? profile.vals.map((v, i) => {
                    const h = Number.isFinite(v) ? 8 + ((v - profile.min) / Math.max(1, profile.max - profile.min)) * 44 : 8;
                    const passed = (i + 0.5) / BARS <= progress;
                    return <View key={i} style={[styles.bar, { height: h, backgroundColor: passed ? ACCENT : UNPLAYED }]} />;
                  })
                : Array.from({ length: BARS }, (_, i) => (
                    <View key={i} style={[styles.bar, { height: 14, backgroundColor: (i + 0.5) / BARS <= progress ? ACCENT : UNPLAYED }]} />
                  ))}
              <View style={[styles.playhead, { left: `${progress * 100}%` }]} />
            </Pressable>
          </View>

          <View style={styles.controls}>
            <Pressable
              style={styles.playBtn}
              onPress={() => {
                if (done) setAlong(0);
                setPlaying(done ? true : !playing);
              }}
              accessibilityRole="button"
              accessibilityLabel={done ? t('route.tour.playAgain') : playing ? t('route.tour.pause') : t('route.tour.play')}>
              <Ionicons name={done ? 'refresh' : playing ? 'pause' : 'play'} size={26} color={c.onPrimary} />
            </Pressable>
            <Pressable
              style={styles.speedBtn}
              onPress={() => setSpeed(speed === 1 ? 2 : speed === 2 ? 4 : 1)}
              accessibilityRole="button"
              accessibilityLabel={t('route.tour.speed', { n: speed })}
              accessibilityHint={t('route.tour.speedHint')}>
              <Text style={styles.speedText}>{speed}×</Text>
            </Pressable>
            <Pressable
              style={styles.speedBtn}
              onPress={() => setShowDirections(true)}
              accessibilityRole="button"
              accessibilityLabel={t('route.directions')}>
              <Ionicons name="list" size={22} color={c.primary} />
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable style={styles.rideBtn} onPress={startRide} accessibilityRole="button" accessibilityHint={t('route.startRideHint')}>
              <Ionicons name="navigate" size={18} color={c.onAccent} />
              <Text style={styles.rideText}>{t('route.startRide')}</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
      <DirectionsSheet
        visible={showDirections}
        title={trip.title}
        maneuvers={maneuvers}
        totalM={trip.result.distanceM || line.total}
        onClose={() => setShowDirections(false)}
      />
    </View>
  );
}

function sameSpot(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  return Math.abs(a.latitude - b.latitude) < 1e-5 && Math.abs(a.longitude - b.longitude) < 1e-5;
}

function currentElevation(profile: { vals: number[]; min: number }, progress: number): number {
  const i = Math.min(BARS - 1, Math.floor(progress * BARS));
  const v = profile.vals[i];
  return Number.isFinite(v) ? v : profile.min;
}

const shadow = { shadowColor: '#000000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8 };

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.bg },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  close: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(20,33,61,0.85)', alignItems: 'center', justifyContent: 'center' },
  kicker: { color: c.gold, fontSize: 13, fontFamily: FONT.black, letterSpacing: 1 },
  title: { color: '#FFFFFF', fontSize: 21, fontFamily: FONT.black, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  chips: { flexDirection: 'row', gap: 8, marginTop: 10 },
  chip: { backgroundColor: 'rgba(20,33,61,0.85)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  chipBig: { color: '#FFFFFF', fontSize: 18, fontFamily: FONT.black },
  chipSmall: { color: BRAND.limestone, fontSize: 13 },
  onTrail: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 8,
    backgroundColor: '#15803d', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
  },
  onTrailText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  bottomWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10 },
  panel: { backgroundColor: c.surface, borderRadius: 22, padding: 16, marginBottom: 6, gap: 12, ...shadow },
  next: { fontSize: 15, color: c.text },
  profileRow: { flexDirection: 'row', alignItems: 'stretch', gap: 6 },
  scale: { justifyContent: 'space-between', paddingVertical: 0 },
  scaleText: { fontSize: 13, color: c.textMuted },
  profile: { flex: 1, height: 56, flexDirection: 'row', alignItems: 'flex-end', gap: 1.5 },
  bar: { flex: 1, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: c.text },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  playBtn: { width: 54, height: 54, borderRadius: 27, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  speedBtn: { width: 48, height: 48, borderRadius: 12, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  speedText: { fontSize: 16, fontFamily: FONT.black, color: c.primary },
  rideBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.accent, paddingHorizontal: 18, paddingVertical: 14, borderRadius: 14 },
  rideText: { color: c.onAccent, fontSize: 16, fontFamily: FONT.black },
  stopDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFFFFF', borderWidth: 3, borderColor: c.accent },
  primary: { alignSelf: 'stretch', backgroundColor: c.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: c.onPrimary, fontSize: 17, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, backgroundColor: c.bg },
  emptyText: { fontSize: 17, color: c.text, textAlign: 'center' },
}));
