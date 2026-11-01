import Ionicons from '@expo/vector-icons/Ionicons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert, FlatList, Keyboard, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text,
  TextInput, View,
} from 'react-native';
import MapView, { Marker, Polyline, type LongPressEvent, type MapPressEvent } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DirectionsSheet } from '@/components/directions-sheet';
import { PathLines } from '@/components/path-lines';
import { Snackbar, type SnackbarMessage } from '@/components/snackbar';
import { SuggestedRidesSheet } from '@/components/suggested-rides';
import { routePoints, type SuggestedRide } from '@/lib/suggested';
import { BRAND, COLORS, COVERAGE_BBOX, FONT, INITIAL_REGION } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { formatDistance, type Region } from '@/lib/geo';
import { buildLine, buildManeuvers } from '@/lib/navigation';
import { movedText, shouldStartFromMe } from '@/lib/planner';
import { useRoute, type SavedRide } from '@/lib/route';
import { nameAt } from '@/lib/trails';
import { useTrip } from '@/lib/trip';
import { router } from 'expo-router';
import {
  appleMapsUrl, buildGpx, formatDuration, googleMapsUrl, metersToFeet, PROFILE_META, searchPlaces, type PlaceResult, type RouteBreakdown,
  type RouteProfile,
} from '@/lib/routing';

const ROUTE_COLOR = BRAND.red; // the route line and stop pins
const PRIMARY = BRAND.navy; // main buttons

export default function RouteScreen() {
  const { paths, location, locationDenied } = useData();
  const route = useRoute();
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
  const [snack, setSnack] = useState<SnackbarMessage | null>(null);
  const toast = (text: string, actionLabel?: string, onAction?: () => void) =>
    setSnack({ id: Date.now(), text, actionLabel, onAction });

  // Debounced place search.
  useEffect(() => {
    const q = query.trim();
    const controller = new AbortController();
    const t = setTimeout(async () => {
      if (q.length < 3) {
        setResults([]);
        setSearchError(null);
        return;
      }
      setSearching(true);
      try {
        const r = await searchPlaces(q, location, controller.signal);
        setResults(r);
        setSearchError(r.length ? null : 'No matches nearby');
      } catch {
        if (!controller.signal.aborted) setSearchError("Search isn't available right now");
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query, location]);

  // Fit the map to the route when it changes or a saved ride is loaded.
  const fitKey = `${route.result?.coords.length ?? 0}:${route.result?.distanceM ?? 0}`;
  useEffect(() => {
    const coords = route.result?.coords;
    if (!coords || coords.length < 2) return;
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 140, right: 50, bottom: 420, left: 50 },
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
    const t = setTimeout(() => searchRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [route.searchRequest]);

  // Save tapped while signed out: carry on with the save once signed in.
  useEffect(() => {
    if (!pendingSave || auth.sheet) return;
    const t = setTimeout(() => {
      setPendingSave(false);
      if (auth.session && route.result) setShowSave(true);
    }, 0);
    return () => clearTimeout(t);
  }, [pendingSave, auth.sheet, auth.session, route.result]);

  // Map taps only close the keyboard and results; press and hold adds a stop.
  const onMapPress = (e: MapPressEvent) => {
    if ((e.nativeEvent as { action?: string }).action === 'marker-press') return;
    Keyboard.dismiss();
    if (results.length) setResults([]);
  };

  const onMapLongPress = (e: LongPressEvent) => {
    Keyboard.dismiss();
    setResults([]);
    const id = route.addStop(e.nativeEvent.coordinate);
    setPanelOpen(true);
    toast('Stop added', 'Undo', () => route.removeStop(id));
  };

  const pickResult = (r: PlaceResult) => {
    const p = { latitude: r.latitude, longitude: r.longitude };
    if (searchMode === 'start') {
      route.setStart(p, r.title);
      setSearchMode('stop');
      AccessibilityInfo.announceForAccessibility(`Starting from ${r.title}`);
    } else {
      route.addStop(p, r.title);
      AccessibilityInfo.announceForAccessibility(`Added ${r.title}`);
    }
    setQuery('');
    setResults([]);
    Keyboard.dismiss();
    setPanelOpen(true);
    mapRef.current?.animateToRegion({ ...p, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 400);
  };

  const askStart = () => {
    setSearchMode('start');
    searchRef.current?.focus();
  };

  // Rows shown in the stops list, including "My location" when used.
  const total = route.stops.length + (route.usingMyLocation ? 1 : 0);
  /** With no start chosen yet, a lone point is the destination. */
  const needsStart = !route.usingMyLocation && route.stops.length === 1;
  const roleOf = (overallIndex: number): Role => {
    if (needsStart) return 'end';
    if (overallIndex === 0) return 'start';
    if (overallIndex === total - 1 && !route.roundTrip) return 'end';
    return 'stop';
  };
  const offset = route.usingMyLocation ? 1 : 0;
  const title = route.planName ?? rideName(route.stops.map((s) => s.label));

  const shareGpx = async () => {
    const data = route.shareable();
    if (!data) return;
    try {
      const file = new File(Paths.cache, `${title.replace(/[^\w-]+/g, '_').slice(0, 40) || 'ride'}.gpx`);
      file.create({ overwrite: true });
      file.write(buildGpx(title, data.result, data.points));
      await Sharing.shareAsync(file.uri, { mimeType: 'application/gpx+xml', UTI: 'com.topografix.gpx', dialogTitle: 'Share ride' });
    } catch {
      Alert.alert('Couldn’t export the file', 'Please try again.');
    }
  };

  const hasRoute = route.status === 'ready' && route.result;

  /** Hand the planned route to the Navigate or Tour screen. */
  const openTrip = (screen: '/navigate' | '/tour') => {
    if (!route.result) return;
    const labels = [
      ...(route.usingMyLocation ? ['My location'] : []),
      ...route.stops.map((s) => s.label),
    ];
    const points = route.waypoints.map((w, i) => ({ ...w, label: labels[i] ?? labels[0] ?? 'Start' }));
    setTrip({ title, result: route.result, points, profile: route.profile });
    router.push(screen);
  };

  /** Start a saved ride straight from the list (works offline). */
  const startSaved = (r: SavedRide) => {
    route.loadRide(r);
    const points = r.stops.map(({ latitude, longitude, label }) => ({ latitude, longitude, label }));
    if (r.roundTrip && points.length >= 2) points.push({ ...points[0], label: `Back to ${points[0].label}` });
    setTrip({ title: r.name, result: r.result, points, profile: r.profile });
    setShowSaved(false);
    setTimeout(() => router.push('/navigate'), 350); // let the sheet close first
  };

  const onSavePress = () => {
    if (route.savedId) {
      toast('Already in your rides');
      return;
    }
    if (auth.requireAccount('Create a free account to save this ride and find it on any phone.')) setShowSave(true);
    else setPendingSave(true);
  };

  const confirmClear = () => {
    Alert.alert('Clear this route?', 'Your stops will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: route.clear },
    ]);
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

  const summaryText = hasRoute
    ? `${formatDistance(route.result!.distanceM)}  ·  ${formatDuration(route.result!.timeS)}  ·  ${metersToFeet(route.result!.climbM)} ft climb`
    : '';

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={INITIAL_REGION}
        onRegionChangeComplete={setRegion}
        onPress={onMapPress}
        onLongPress={onMapLongPress}
        showsUserLocation
        showsMyLocationButton={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}>
        <PathLines paths={paths} region={region} faded={!!route.result} max={900} />
        {route.result && (
          <>
            <Polyline coordinates={route.result.coords} strokeColor="#ffffff" strokeWidth={8} zIndex={5} />
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
              <View style={[styles.stopPin, { backgroundColor: roleColor(role) }]}>
                <Text style={styles.stopPinText}>{role === 'start' ? 'S' : role === 'end' ? '' : i + offset}</Text>
                {role === 'end' && <Ionicons name="flag" size={13} color="#fff" />}
              </View>
            </Marker>
          );
        })}
      </MapView>

      {/* Search */}
      <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={COLORS.muted} />
          <TextInput
            ref={searchRef}
            value={query}
            onChangeText={setQuery}
            onBlur={() => {
              if (!query) setSearchMode('stop');
            }}
            placeholder={
              searchMode === 'start'
                ? 'Starting from? Search a place'
                : route.stops.length
                  ? 'Add a stop: search a place'
                  : 'Where to? Search or press and hold the map'
            }
            placeholderTextColor={COLORS.muted}
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel={searchMode === 'start' ? 'Search for where you’re starting from' : 'Search for a place'}
          />
          {searching ? (
            <ActivityIndicator size="small" color={COLORS.brand} />
          ) : query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={13} accessibilityRole="button" accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={COLORS.muted} />
            </Pressable>
          ) : null}
        </View>
        {(results.length > 0 || (searchError && query.trim().length >= 3)) && (
          <View style={styles.results}>
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
                    accessibilityHint={searchMode === 'start' ? 'Sets where the ride starts' : 'Adds it to your route'}
                    style={({ pressed }) => [styles.resultRow, pressed && styles.pressed]}>
                    <Ionicons name="location-outline" size={18} color={COLORS.brand} />
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

      {/* Planner panel */}
      <View style={styles.panel} onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)}>
        <Pressable
          onPress={() => setPanelOpen((o) => !o)}
          style={styles.handleArea}
          hitSlop={{ top: 8, bottom: 8, left: 60, right: 60 }}
          accessibilityRole="button"
          accessibilityLabel={panelOpen ? 'Collapse route panel' : 'Expand route panel'}>
          <View style={styles.handle} />
        </Pressable>

        <View style={styles.summaryArea}>
          {hasRoute ? (
            <>
              <Text style={styles.summary} accessibilityLabel={summaryText.replace(/ {2}· {2}/g, ', ').replace(' mi', ' miles')}>
                {summaryText}
              </Text>
              {route.result!.breakdown && <Breakdown b={route.result!.breakdown} />}
            </>
          ) : route.status === 'loading' ? (
            <View style={styles.row} accessibilityLiveRegion="polite">
              <ActivityIndicator size="small" color={ROUTE_COLOR} />
              <Text style={styles.summaryMuted}>Finding a bike route…</Text>
            </View>
          ) : route.status === 'error' ? (
            <View style={styles.errorRow}>
              <Text style={styles.errorText} accessibilityLiveRegion="polite">{route.error}.</Text>
              <Pressable onPress={route.retry} style={styles.retryBtn} accessibilityRole="button">
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.summaryMuted}>
              {route.stops.length === 0
                ? 'Search above or press and hold the map'
                : needsStart
                  ? 'Where are you starting from?'
                  : 'Add one more point to make a route'}
            </Text>
          )}
        </View>

        {route.stops.length > 0 && panelOpen && (
          <View style={styles.styleBox}>
            <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="Route style">
              {(Object.keys(PROFILE_META) as RouteProfile[]).map((p) => {
                const on = route.profile === p;
                const yours = on && route.profileFromPrefs;
                return (
                  <Pressable
                    key={p}
                    onPress={() => route.setProfile(p)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${PROFILE_META[p].label}${yours ? ', your pick' : ''}`}
                    accessibilityHint={PROFILE_META[p].hint}
                    style={[styles.segmentItem, on && styles.segmentActive]}>
                    <Text style={[styles.segmentText, on && styles.segmentTextActive]}>{PROFILE_META[p].label}</Text>
                    <Text style={[styles.segmentHint, on && styles.segmentHintActive]}>
                      {PROFILE_META[p].hint}{yours ? ' (your pick)' : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.hint}>{PROFILE_META[route.profile].surface}</Text>
          </View>
        )}

        {hasRoute && (
          <View style={styles.startRow}>
            <Pressable
              style={({ pressed }) => [styles.startBtn, pressed && { transform: [{ scale: 0.98 }], opacity: 0.92 }]}
              onPress={() => openTrip('/navigate')}
              accessibilityRole="button"
              accessibilityLabel="Start ride"
              accessibilityHint="Turn-by-turn directions with voice">
              <Ionicons name="navigate" size={24} color="#fff" />
              <Text style={styles.startText}>Start ride</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.previewBtn, pressed && { opacity: 0.8 }]}
              onPress={() => openTrip('/tour')}
              accessibilityRole="button"
              accessibilityLabel="Preview"
              accessibilityHint="Plays a virtual flyover of this ride">
              <Ionicons name="play-circle" size={22} color={BRAND.navy} />
              <Text style={styles.previewText}>Preview</Text>
            </Pressable>
          </View>
        )}

        {route.stops.length === 0 && (
          <Pressable style={styles.ideas} onPress={() => setShowIdeas(true)} accessibilityRole="button">
            <Ionicons name="compass" size={22} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={styles.ideasTitle}>Browse suggested rides</Text>
              <Text style={styles.ideasSub}>Filter by length, paved trail, gravel or road, and distance from you</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#fff" />
          </Pressable>
        )}

        {panelOpen && (
          <ScrollView style={{ maxHeight: 300 }} keyboardShouldPersistTaps="handled">
            {/* Stops */}
            {route.usingMyLocation && (
              <StopRow color={roleColor('start')} badge="S" title="My location" subtitle="Start" />
            )}
            {needsStart && (
              <Pressable onPress={askStart} style={styles.askStart} accessibilityRole="button" accessibilityHint="Search for a place to start from">
                <View style={[styles.stopBadge, { backgroundColor: roleColor('start') }]}>
                  <Text style={styles.stopBadgeText}>S</Text>
                </View>
                <Text style={styles.askStartText}>Starting from?</Text>
                <Ionicons name="search" size={18} color={PRIMARY} />
              </Pressable>
            )}
            {route.stops.map((s, i) => {
              const overall = i + offset;
              const role = roleOf(overall);
              return (
                <StopRow
                  key={s.id}
                  color={roleColor(role)}
                  badge={role === 'start' ? 'S' : role === 'end' ? undefined : String(overall)}
                  flag={role === 'end'}
                  title={s.label}
                  subtitle={needsStart ? 'Destination' : roleLabel(role, overall)}
                  onUp={i > 0 ? () => shift(s.id, s.label, -1) : undefined}
                  onDown={i < route.stops.length - 1 ? () => shift(s.id, s.label, 1) : undefined}
                  onRemove={() => route.removeStop(s.id)}
                />
              );
            })}
            {route.roundTrip && total >= 2 && (
              <StopRow color={roleColor('end')} flag title={route.usingMyLocation ? 'Back to my location' : 'Back to start'} subtitle="End" />
            )}
            {locationDenied && !route.usingMyLocation && (
              <View style={styles.locationOff}>
                <Text style={styles.locationOffText}>Location is off. Turn it on to start from where you are.</Text>
                <Pressable onPress={() => void Linking.openSettings()} style={styles.locationBtn} accessibilityRole="button">
                  <Ionicons name="location" size={16} color={PRIMARY} />
                  <Text style={styles.locationBtnText}>Turn on location</Text>
                </Pressable>
              </View>
            )}

            {/* Options */}
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Round trip</Text>
              <Switch
                value={route.roundTrip}
                onValueChange={route.setRoundTrip}
                trackColor={{ true: PRIMARY }}
                accessibilityLabel="Round trip"
              />
            </View>
            {location && (
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Start from my location</Text>
                <Switch
                  value={route.startFromMe}
                  onValueChange={route.setStartFromMe}
                  trackColor={{ true: PRIMARY }}
                  accessibilityLabel="Start from my location"
                />
              </View>
            )}

            {/* Actions */}
            <View style={styles.actions}>
              {hasRoute && (
                <>
                  <Action
                    icon={route.savedId ? 'bookmark' : 'bookmark-outline'}
                    label={saving ? 'Saving…' : route.savedId ? 'Saved' : 'Save'}
                    disabled={saving}
                    onPress={onSavePress}
                  />
                  <Action icon="list" label="Directions" onPress={() => setShowDirections(true)} />
                  <Action icon="share-outline" label="Export file (GPX)" onPress={() => void shareGpx()} />
                  {Platform.OS === 'ios' && (
                    <Action icon="logo-apple" label="Apple Maps" onPress={() => void Linking.openURL(appleMapsUrl(route.waypoints))} />
                  )}
                  <Action icon="logo-google" label="Google Maps" onPress={() => void Linking.openURL(googleMapsUrl(route.waypoints))} />
                </>
              )}
              <Action icon="compass-outline" label="Suggested rides" onPress={() => setShowIdeas(true)} />
              <Action icon="folder-open-outline" label={`Saved (${route.savedRides.length})`} onPress={() => setShowSaved(true)} />
              {route.stops.length > 0 && <Action icon="trash-outline" label="Clear" onPress={confirmClear} />}
            </View>
            {hasRoute && (
              <Text style={styles.footnote}>
                Drag a pin to adjust. Start ride gives turn-by-turn directions right here; keep the app open on screen while you ride.
                GPX is a route file for bike computers and apps like Ride with GPS.
              </Text>
            )}
          </ScrollView>
        )}
      </View>

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
            toast('Saved to your rides');
          } catch (e) {
            Alert.alert('Not saved', e instanceof Error ? e.message : 'Please try again.');
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
          setTrip({ title: ride.name, result, points: pts, profile: ride.profile, rideId: ride.id });
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
          toast(fromMe ? `${ride.name} loaded, starting from your location. Tap Start ride when ready.` : `${ride.name} loaded. Tap Start ride when ready.`);
        }}
      />
      <SavedRidesModal
        visible={showSaved}
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
          Alert.alert(`Delete “${r.name}”?`, 'This can’t be undone.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                route
                  .deleteRide(r.id)
                  .then(() => AccessibilityInfo.announceForAccessibility(`Deleted ${r.name}`))
                  .catch((e: unknown) => Alert.alert('Not deleted', e instanceof Error ? e.message : 'Please try again.'));
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

const MIX = [
  { key: 'path', label: 'trails & paths', color: '#15803d' },
  { key: 'lane', label: 'bike lanes', color: '#2563eb' },
  { key: 'quiet', label: 'quiet streets', color: '#86efac' },
  { key: 'road', label: 'busier roads', color: '#f97316' },
] as const;

function Breakdown({ b }: { b: RouteBreakdown }) {
  const parts = MIX.filter((m) => b[m.key] >= 0.01);
  const paved = Math.round((1 - b.unpaved) * 100);
  const text = `${parts.map((m) => `${Math.round(b[m.key] * 100)}% ${m.label}`).join('  ·  ')}  ·  ${paved}% paved`;
  return (
    <View style={styles.mix} accessible accessibilityLabel={`Route mix: ${text.replace(/ {2}· {2}/g, ', ')}`}>
      <View style={styles.mixBar}>
        {parts.map((m) => (
          <View key={m.key} style={{ flex: b[m.key], backgroundColor: m.color }} />
        ))}
      </View>
      <Text style={styles.mixText}>{text}</Text>
    </View>
  );
}

type Role = 'start' | 'stop' | 'end';

function roleColor(role: Role) {
  return role === 'start' ? '#16a34a' : role === 'end' ? '#dc2626' : ROUTE_COLOR;
}

function roleLabel(role: Role, overall: number) {
  return role === 'start' ? 'Start' : role === 'end' ? 'End' : `Stop ${overall}`;
}

/** Label for the i-th routed point of a suggested ride (loops/out-and-backs return to start). */
function labelFor(ride: SuggestedRide, i: number): string {
  const n = ride.points.length;
  if (i < n) return ride.points[i].label;
  if (ride.shape === 'loop') return `Back to ${ride.points[0].label}`;
  return ride.points[n - 1 - (i - n + 1)]?.label ?? ride.points[0].label;
}

function rideName(labels: string[]) {
  const last = labels[labels.length - 1];
  const date = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return last && last !== 'Dropped pin' ? `Ride to ${last}` : `Ride ${date}`;
}

function StopRow(props: {
  color: string; badge?: string; flag?: boolean; title: string; subtitle: string;
  onUp?: () => void; onDown?: () => void; onRemove?: () => void;
}) {
  return (
    <View style={styles.stopRow}>
      <View style={[styles.stopBadge, { backgroundColor: props.color }]}>
        {props.flag ? <Ionicons name="flag" size={12} color="#fff" /> : <Text style={styles.stopBadgeText}>{props.badge}</Text>}
      </View>
      <View style={{ flex: 1 }} accessible accessibilityLabel={`${props.subtitle}: ${props.title}`}>
        <Text style={styles.stopTitle} numberOfLines={2}>{props.title}</Text>
        <Text style={styles.stopSub}>{props.subtitle}</Text>
      </View>
      {props.onUp && <IconBtn icon="arrow-up" label={`Move ${props.title} earlier`} onPress={props.onUp} />}
      {props.onDown && <IconBtn icon="arrow-down" label={`Move ${props.title} later`} onPress={props.onDown} />}
      {props.onRemove && <IconBtn icon="close" label={`Remove ${props.title}`} onPress={props.onRemove} />}
    </View>
  );
}

function IconBtn({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
      accessibilityLabel={label}
      accessibilityRole="button">
      <Ionicons name={icon} size={20} color={COLORS.muted} />
    </Pressable>
  );
}

function Action({ icon, label, onPress, primary, disabled }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; primary?: boolean; disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.action, primary && styles.actionPrimary, (pressed || disabled) && { opacity: 0.6 }]}>
      <Ionicons name={icon} size={16} color={primary ? '#fff' : PRIMARY} />
      <Text style={[styles.actionText, primary && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

function SaveModal({ visible, defaultName, startsAtMe, hideStart, onHideStart, saving, onCancel, onSave }: {
  visible: boolean; defaultName: string; startsAtMe: boolean; hideStart: boolean; onHideStart: (v: boolean) => void; saving: boolean;
  onCancel: () => void; onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(defaultName);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} onShow={() => setName(defaultName)}>
      <View style={styles.modalBackdrop}>
        <View style={styles.dialog}>
          <Text style={styles.dialogTitle} accessibilityRole="header">Save this ride</Text>
          <TextInput value={name} onChangeText={setName} style={styles.dialogInput} autoFocus selectTextOnFocus accessibilityLabel="Ride name" />
          {startsAtMe && (
            <View style={styles.privacyBox}>
              <Text style={styles.privacyText}>This ride starts at your current location.</Text>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleLabel}>Hide my start</Text>
                  <Text style={styles.privacySub}>Leaves out the first 600 ft or so, here and in exported files.</Text>
                </View>
                <Switch value={hideStart} onValueChange={onHideStart} trackColor={{ true: PRIMARY }} accessibilityLabel="Hide my start" />
              </View>
            </View>
          )}
          <View style={styles.dialogActions}>
            <Pressable onPress={onCancel} style={styles.dialogBtn} accessibilityRole="button" disabled={saving}>
              <Text style={styles.dialogBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => void onSave(name)}
              disabled={saving}
              accessibilityRole="button"
              accessibilityState={{ disabled: saving, busy: saving }}
              style={[styles.dialogBtn, styles.dialogBtnPrimary, saving && { opacity: 0.7 }]}>
              {saving && <ActivityIndicator size="small" color="#fff" />}
              <Text style={[styles.dialogBtnText, { color: '#fff' }]}>{saving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SavedRidesModal({ visible, rides, error, onRetry, signedOut, onClose, onOpen, onStart, onDelete }: {
  visible: boolean; rides: SavedRide[]; error: string | null; onRetry: () => void; signedOut: boolean; onClose: () => void;
  onOpen: (r: SavedRide) => void; onStart: (r: SavedRide) => void; onDelete: (r: SavedRide) => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle} accessibilityRole="header">Saved rides</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" style={styles.sheetDoneBtn}>
            <Text style={styles.sheetDone}>Done</Text>
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
                  <Ionicons name="refresh" size={16} color={PRIMARY} />
                  <Text style={styles.locationBtnText}>Try again</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={styles.resultEmpty}>
                {signedOut ? 'Sign in to see rides saved to your account.' : 'No saved rides yet. Plan a route and tap Save.'}
              </Text>
            )
          }
          renderItem={({ item }) => {
            const date = new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            const sub = `${formatDistance(item.result.distanceM)} · ${metersToFeet(item.result.climbM)} ft climb · ${formatDuration(item.result.timeS)}`;
            const meta = `${PROFILE_META[item.profile].label}${item.roundTrip ? ' · round trip' : ''} · saved ${date}`;
            return (
              <View style={styles.savedRow}>
                <Pressable
                  style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}
                  onPress={() => onOpen(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}, ${sub}, ${meta}`}
                  accessibilityHint="Opens it in the planner">
                  <Text style={styles.resultTitle} numberOfLines={2}>{item.name}</Text>
                  <Text style={styles.resultSub}>{sub}</Text>
                  <Text style={styles.resultSub}>{meta}</Text>
                </Pressable>
                <Pressable
                  onPress={() => onStart(item)}
                  style={styles.savedStart}
                  accessibilityRole="button"
                  accessibilityLabel={`Start ride: ${item.name}`}>
                  <Ionicons name="navigate" size={16} color="#fff" />
                  <Text style={styles.savedStartText}>Start</Text>
                </Pressable>
                <IconBtn icon="trash-outline" label={`Delete ${item.name}`} onPress={() => onDelete(item)} />
              </View>
            );
          }}
        />
      </View>
    </Modal>
  );
}

const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.15,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 6,
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12 },
  searchBox: {
    marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.bg,
    borderRadius: 14, paddingHorizontal: 14, height: 48, ...shadow,
  },
  searchInput: { flex: 1, fontSize: 16, color: COLORS.text },
  results: { marginTop: 6, backgroundColor: COLORS.bg, borderRadius: 14, maxHeight: 320, overflow: 'hidden', ...shadow },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  resultTitle: { fontSize: 16, fontFamily: FONT.bold, color: COLORS.text },
  resultSub: { fontSize: 14, color: COLORS.muted, marginTop: 2 },
  resultEmpty: { padding: 16, color: COLORS.muted, textAlign: 'center', fontSize: 15 },
  pressed: { backgroundColor: '#f3f4f6' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border, marginLeft: 14 },
  panel: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: COLORS.bg,
    borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 16, paddingBottom: 12, ...shadow,
  },
  handleArea: { alignSelf: 'center', minHeight: 28, minWidth: 88, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#9ca3af' },
  summaryArea: { alignItems: 'center', gap: 8, paddingBottom: 10 },
  summary: { fontSize: 19, fontFamily: FONT.black, color: COLORS.text, textAlign: 'center' },
  startRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  startBtn: {
    flex: 1, height: 58, borderRadius: 16, backgroundColor: BRAND.red, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 10,
    shadowColor: BRAND.red, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  startText: { color: '#fff', fontSize: 20, fontFamily: FONT.black, letterSpacing: 0.3 },
  previewBtn: {
    height: 58, paddingHorizontal: 16, borderRadius: 16, borderWidth: 2, borderColor: BRAND.navy, flexDirection: 'row',
    alignItems: 'center', gap: 6, backgroundColor: '#fff',
  },
  previewText: { color: BRAND.navy, fontSize: 16, fontFamily: FONT.black },
  ideas: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: PRIMARY, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8,
  },
  ideasTitle: { color: '#fff', fontSize: 16, fontFamily: FONT.black },
  ideasSub: { color: BRAND.limestone, fontSize: 14, marginTop: 2 },
  mix: { alignSelf: 'stretch', gap: 4 },
  mixBar: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: '#e5e7eb' },
  mixText: { fontSize: 13, color: COLORS.muted, textAlign: 'center' },
  summaryMuted: { fontSize: 15, color: COLORS.muted, textAlign: 'center' },
  errorRow: { alignItems: 'center', gap: 8 },
  errorText: { fontSize: 15, color: '#b91c1c', fontWeight: '600', textAlign: 'center' },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: PRIMARY, borderRadius: 999, paddingHorizontal: 16, minHeight: 44,
  },
  retryText: { color: '#fff', fontSize: 15, fontFamily: FONT.bold },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  stopBadge: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  stopBadgeText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  stopTitle: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  stopSub: { fontSize: 13, color: COLORS.muted },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  stopPin: {
    minWidth: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff', paddingHorizontal: 4, flexDirection: 'row',
  },
  stopPinText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  styleBox: { marginBottom: 10 },
  segment: { flexDirection: 'row', backgroundColor: '#f3f4f6', borderRadius: 10, padding: 3 },
  segmentItem: { flex: 1, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 8, alignItems: 'center', minHeight: 44 },
  segmentActive: { backgroundColor: COLORS.bg, elevation: 1, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 2 },
  segmentText: { fontSize: 14, fontWeight: '600', color: COLORS.muted },
  segmentTextActive: { color: PRIMARY, fontFamily: FONT.black },
  segmentHint: { fontSize: 13, color: COLORS.muted, textAlign: 'center', marginTop: 2 },
  segmentHintActive: { color: PRIMARY },
  hint: { fontSize: 13, color: COLORS.muted, marginTop: 6, textAlign: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 6, minHeight: 44 },
  toggleLabel: { fontSize: 15, color: COLORS.text },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  action: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, minHeight: 44,
    borderRadius: 999, borderWidth: 1, borderColor: PRIMARY,
  },
  actionPrimary: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  actionText: { fontSize: 14, fontFamily: FONT.bold, color: PRIMARY },
  footnote: { fontSize: 13, color: COLORS.muted, marginTop: 8 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: COLORS.bg, borderRadius: 16, padding: 20, gap: 14 },
  dialogTitle: { fontSize: 19, fontFamily: FONT.black, color: COLORS.text },
  dialogInput: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  dialogBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, minHeight: 44, borderRadius: 10 },
  privacyBox: { backgroundColor: BRAND.cream, borderRadius: 12, padding: 12, gap: 4 },
  privacyText: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.text },
  privacySub: { fontSize: 13, color: COLORS.muted, marginTop: 2 },
  dialogBtnPrimary: { backgroundColor: PRIMARY },
  dialogBtnText: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  sheet: { flex: 1, backgroundColor: COLORS.bg },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  sheetTitle: { fontSize: 22, fontFamily: FONT.black, color: COLORS.text },
  sheetDone: { fontSize: 16, fontFamily: FONT.bold, color: PRIMARY },
  sheetDoneBtn: { minHeight: 44, justifyContent: 'center' },
  savedRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  savedStart: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: BRAND.red, borderRadius: 12, paddingHorizontal: 12, minHeight: 44,
  },
  savedStartText: { color: '#fff', fontSize: 15, fontFamily: FONT.black },
  savedWarn: { fontSize: 14, color: '#b91c1c', paddingHorizontal: 16, paddingBottom: 8 },
  savedEmpty: { alignItems: 'center', gap: 8, padding: 16 },
  askStart: {
    flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  askStartText: { flex: 1, fontSize: 15, fontFamily: FONT.bold, color: PRIMARY },
  locationOff: { backgroundColor: BRAND.cream, borderRadius: 12, padding: 12, gap: 8, marginTop: 6 },
  locationOffText: { fontSize: 14, color: COLORS.text },
  locationBtn: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, borderWidth: 1, borderColor: PRIMARY, borderRadius: 999,
    paddingHorizontal: 14, minHeight: 44,
  },
  locationBtnText: { fontSize: 15, fontFamily: FONT.bold, color: PRIMARY },
});
