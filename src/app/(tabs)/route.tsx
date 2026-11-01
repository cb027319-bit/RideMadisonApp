import Ionicons from '@expo/vector-icons/Ionicons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Keyboard, Linking, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import MapView, { Marker, Polyline, type MapPressEvent } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PathLines } from '@/components/path-lines';
import { SuggestedRidesSheet } from '@/components/suggested-rides';
import { routePoints, type SuggestedRide } from '@/lib/suggested';
import { COLORS, INITIAL_REGION } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { formatDistance, type Region } from '@/lib/geo';
import { useRoute, type SavedRide } from '@/lib/route';
import { useTrip } from '@/lib/trip';
import { router } from 'expo-router';
import {
  buildGpx, formatDuration, googleMapsUrl, metersToFeet, PROFILE_META, searchPlaces, type PlaceResult, type RouteBreakdown,
  type RouteProfile,
} from '@/lib/routing';

const ROUTE_COLOR = '#7c3aed';

export default function RouteScreen() {
  const { paths, location } = useData();
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
  const [showSaved, setShowSaved] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [showIdeas, setShowIdeas] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);

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
      edgePadding: { top: 140, right: 50, bottom: 360, left: 50 },
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

  const onMapPress = (e: MapPressEvent) => {
    if ((e.nativeEvent as { action?: string }).action === 'marker-press') return;
    Keyboard.dismiss();
    if (results.length) {
      setResults([]);
      return;
    }
    route.addStop(e.nativeEvent.coordinate);
    setPanelOpen(true);
  };

  const pickResult = (r: PlaceResult) => {
    route.addStop({ latitude: r.latitude, longitude: r.longitude }, r.title);
    setQuery('');
    setResults([]);
    Keyboard.dismiss();
    setPanelOpen(true);
    mapRef.current?.animateToRegion({ latitude: r.latitude, longitude: r.longitude, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 400);
  };

  // Rows shown in the stops list, including "My location" when used.
  const total = route.stops.length + (route.usingMyLocation ? 1 : 0);
  const roleOf = (overallIndex: number) => {
    if (overallIndex === 0) return 'start';
    if (overallIndex === total - 1 && !route.roundTrip) return 'end';
    return 'stop';
  };
  const offset = route.usingMyLocation ? 1 : 0;

  const shareGpx = async () => {
    if (!route.result) return;
    const name = rideName(route.stops.map((s) => s.label));
    const file = new File(Paths.cache, `${name.replace(/[^\w-]+/g, '_').slice(0, 40) || 'ride'}.gpx`);
    file.create({ overwrite: true });
    file.write(buildGpx(name, route.result));
    await Sharing.shareAsync(file.uri, { mimeType: 'application/gpx+xml', UTI: 'com.topografix.gpx', dialogTitle: 'Share ride' });
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
    setTrip({ title: rideName(route.stops.map((s) => s.label)), result: route.result, points, profile: route.profile });
    router.push(screen);
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={INITIAL_REGION}
        onRegionChangeComplete={setRegion}
        onPress={onMapPress}
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
            placeholder={route.stops.length ? 'Add a stop: search a place' : 'Where to? Search or tap the map'}
            placeholderTextColor={COLORS.muted}
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search for a place"
          />
          {searching ? (
            <ActivityIndicator size="small" color={COLORS.brand} />
          ) : query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
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
                  <Pressable onPress={() => pickResult(item)} style={({ pressed }) => [styles.resultRow, pressed && styles.pressed]}>
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
      <View style={styles.panel}>
        <Pressable onPress={() => setPanelOpen((o) => !o)} style={styles.handleArea} accessibilityLabel={panelOpen ? 'Collapse route panel' : 'Expand route panel'}>
          <View style={styles.handle} />
          {hasRoute ? (
            <>
              <Text style={styles.summary}>
                {formatDistance(route.result!.distanceM)}  ·  {formatDuration(route.result!.timeS)}  ·  {metersToFeet(route.result!.climbM)} ft climb
              </Text>
              {route.result!.breakdown && <Breakdown b={route.result!.breakdown} />}
            </>
          ) : route.status === 'loading' ? (
            <View style={styles.row}><ActivityIndicator size="small" color={ROUTE_COLOR} /><Text style={styles.summaryMuted}>Finding a bike route…</Text></View>
          ) : route.status === 'error' ? (
            <Pressable onPress={route.retry}><Text style={styles.errorText}>{route.error}. Tap to retry.</Text></Pressable>
          ) : (
            <Text style={styles.summaryMuted}>
              {route.stops.length === 0 ? 'Tap the map or search to choose where you’re going' : 'Add one more point to make a route'}
            </Text>
          )}
        </Pressable>

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
                  subtitle={roleLabel(role, overall)}
                  onUp={i > 0 ? () => route.shiftStop(s.id, -1) : undefined}
                  onDown={i < route.stops.length - 1 ? () => route.shiftStop(s.id, 1) : undefined}
                  onRemove={() => route.removeStop(s.id)}
                />
              );
            })}
            {route.roundTrip && total >= 2 && (
              <StopRow color={roleColor('end')} flag title={route.usingMyLocation ? 'Back to my location' : 'Back to start'} subtitle="End" />
            )}

            {/* Options */}
            <View style={styles.segment} accessibilityRole="radiogroup">
              {(Object.keys(PROFILE_META) as RouteProfile[]).map((p) => (
                <Pressable
                  key={p}
                  onPress={() => route.setProfile(p)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: route.profile === p }}
                  style={[styles.segmentItem, route.profile === p && styles.segmentActive]}>
                  <Text style={[styles.segmentText, route.profile === p && styles.segmentTextActive]}>{PROFILE_META[p].label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.hint}>{PROFILE_META[route.profile].hint}</Text>

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Round trip</Text>
              <Switch value={route.roundTrip} onValueChange={route.setRoundTrip} trackColor={{ true: ROUTE_COLOR }} />
            </View>
            {location && (
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Start from my location</Text>
                <Switch value={route.startFromMe} onValueChange={route.setStartFromMe} trackColor={{ true: ROUTE_COLOR }} />
              </View>
            )}

            {/* Actions */}
            <View style={styles.actions}>
              {hasRoute && (
                <>
                  <Action icon="navigate" label="Start" primary onPress={() => openTrip('/navigate')} />
                  <Action icon="play-circle-outline" label="Preview" onPress={() => openTrip('/tour')} />
                  <Action
                    icon="bookmark-outline"
                    label="Save"
                    onPress={() => {
                      if (auth.requireAccount('Create a free account to save this ride and find it on any phone.')) setShowSave(true);
                    }}
                  />
                  <Action icon="share-outline" label="GPX" onPress={() => void shareGpx()} />
                  <Action icon="logo-google" label="Google Maps" onPress={() => void Linking.openURL(googleMapsUrl(route.waypoints))} />
                </>
              )}
              <Action icon="compass-outline" label="Suggested rides" onPress={() => setShowIdeas(true)} />
              <Action icon="folder-open-outline" label={`Saved (${route.savedRides.length})`} onPress={() => setShowSaved(true)} />
              {route.stops.length > 0 && <Action icon="trash-outline" label="Clear" onPress={route.clear} />}
            </View>
            {hasRoute && (
              <Text style={styles.footnote}>
                Drag a pin to adjust. Start gives turn-by-turn directions right here; keep the app open on screen while you ride.
              </Text>
            )}
          </ScrollView>
        )}
      </View>

      <SaveModal
        visible={showSave}
        defaultName={rideName(route.stops.map((s) => s.label))}
        onCancel={() => setShowSave(false)}
        onSave={async (name) => {
          try {
            await route.saveRide(name);
            setShowSave(false);
          } catch (e) {
            Alert.alert('Not saved', e instanceof Error ? e.message : 'Please try again.');
          }
        }}
      />
      <SuggestedRidesSheet
        visible={showIdeas}
        location={location}
        onClose={() => setShowIdeas(false)}
        onPreview={(ride, result) => {
          const pts = routePoints(ride).map((pt, i) => ({ ...pt, label: labelFor(ride, i) }));
          setTrip({ title: ride.name, result, points: pts, profile: ride.profile });
          setShowIdeas(false);
          setTimeout(() => router.push('/tour'), 350); // let the sheet close first
        }}
        onPick={(ride, result) => {
          route.loadPlan({
            stops: ride.points.map(({ label, latitude, longitude }) => ({ label, latitude, longitude })),
            profile: ride.profile,
            roundTrip: true,
            result,
          });
          setShowIdeas(false);
          setPanelOpen(true);
        }}
      />
      <SavedRidesModal
        visible={showSaved}
        rides={route.savedRides}
        signedOut={auth.configured && !auth.session}
        onClose={() => setShowSaved(false)}
        onOpen={(r) => {
          route.loadRide(r);
          setShowSaved(false);
          setPanelOpen(true);
        }}
        onDelete={(id) => void route.deleteRide(id)}
      />
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
  return (
    <View style={styles.mix} accessibilityLabel="Route surface breakdown">
      <View style={styles.mixBar}>
        {parts.map((m) => (
          <View key={m.key} style={{ flex: b[m.key], backgroundColor: m.color }} />
        ))}
      </View>
      <Text style={styles.mixText}>
        {parts.map((m) => `${Math.round(b[m.key] * 100)}% ${m.label}`).join('  ·  ')}
        {`  ·  ${paved}% paved`}
      </Text>
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
      <View style={{ flex: 1 }}>
        <Text style={styles.stopTitle} numberOfLines={1}>{props.title}</Text>
        <Text style={styles.stopSub}>{props.subtitle}</Text>
      </View>
      {props.onUp && <IconBtn icon="arrow-up" label="Move earlier" onPress={props.onUp} />}
      {props.onDown && <IconBtn icon="arrow-down" label="Move later" onPress={props.onDown} />}
      {props.onRemove && <IconBtn icon="close" label={`Remove ${props.title}`} onPress={props.onRemove} />}
    </View>
  );
}

function IconBtn({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.iconBtn} accessibilityLabel={label} accessibilityRole="button">
      <Ionicons name={icon} size={18} color={COLORS.muted} />
    </Pressable>
  );
}

function Action({ icon, label, onPress, primary }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.action, primary && styles.actionPrimary, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={16} color={primary ? '#fff' : ROUTE_COLOR} />
      <Text style={[styles.actionText, primary && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

function SaveModal({ visible, defaultName, onCancel, onSave }: {
  visible: boolean; defaultName: string; onCancel: () => void; onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(defaultName);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} onShow={() => setName(defaultName)}>
      <View style={styles.modalBackdrop}>
        <View style={styles.dialog}>
          <Text style={styles.dialogTitle}>Save this ride</Text>
          <TextInput value={name} onChangeText={setName} style={styles.dialogInput} autoFocus selectTextOnFocus accessibilityLabel="Ride name" />
          <View style={styles.dialogActions}>
            <Pressable onPress={onCancel} style={styles.dialogBtn}><Text style={styles.dialogBtnText}>Cancel</Text></Pressable>
            <Pressable onPress={() => void onSave(name)} style={[styles.dialogBtn, styles.dialogBtnPrimary]}>
              <Text style={[styles.dialogBtnText, { color: '#fff' }]}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SavedRidesModal({ visible, rides, signedOut, onClose, onOpen, onDelete }: {
  visible: boolean; rides: SavedRide[]; signedOut: boolean; onClose: () => void; onOpen: (r: SavedRide) => void; onDelete: (id: string) => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Saved rides</Text>
          <Pressable onPress={onClose} hitSlop={10}><Text style={styles.sheetDone}>Done</Text></Pressable>
        </View>
        <FlatList
          data={rides}
          keyExtractor={(r) => r.id}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={
            <Text style={styles.resultEmpty}>
              {signedOut ? 'Sign in to see rides saved to your account.' : 'No saved rides yet. Plan a route and tap Save.'}
            </Text>
          }
          renderItem={({ item }) => (
            <View style={styles.savedRow}>
              <Pressable style={{ flex: 1 }} onPress={() => onOpen(item)}>
                <Text style={styles.resultTitle} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.resultSub}>
                  {formatDistance(item.result.distanceM)} · {formatDuration(item.result.timeS)} · {PROFILE_META[item.profile].label}
                  {item.roundTrip ? ' · round trip' : ''}
                </Text>
              </Pressable>
              <IconBtn icon="trash-outline" label={`Delete ${item.name}`} onPress={() => onDelete(item.id)} />
            </View>
          )}
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
  resultTitle: { fontSize: 16, fontWeight: '600', color: COLORS.text },
  resultSub: { fontSize: 13, color: COLORS.muted, marginTop: 2 },
  resultEmpty: { padding: 16, color: COLORS.muted, textAlign: 'center' },
  pressed: { backgroundColor: '#f3f4f6' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border, marginLeft: 14 },
  panel: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: COLORS.bg,
    borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 16, paddingBottom: 12, ...shadow,
  },
  handleArea: { paddingTop: 8, paddingBottom: 10, alignItems: 'center', gap: 8 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#d1d5db' },
  summary: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  ideas: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: ROUTE_COLOR, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8,
  },
  ideasTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  ideasSub: { color: '#ede9fe', fontSize: 12, marginTop: 2 },
  mix: { alignSelf: 'stretch', gap: 4 },
  mixBar: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: '#e5e7eb' },
  mixText: { fontSize: 12, color: COLORS.muted, textAlign: 'center' },
  summaryMuted: { fontSize: 15, color: COLORS.muted, textAlign: 'center' },
  errorText: { fontSize: 14, color: '#b91c1c', fontWeight: '600', textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  stopBadge: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stopBadgeText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  stopTitle: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  stopSub: { fontSize: 12, color: COLORS.muted },
  iconBtn: { padding: 6 },
  stopPin: {
    minWidth: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff', paddingHorizontal: 4, flexDirection: 'row',
  },
  stopPinText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  segment: { flexDirection: 'row', marginTop: 10, backgroundColor: '#f3f4f6', borderRadius: 10, padding: 3 },
  segmentItem: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: COLORS.bg, elevation: 1, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 2 },
  segmentText: { fontSize: 14, fontWeight: '600', color: COLORS.muted },
  segmentTextActive: { color: ROUTE_COLOR },
  hint: { fontSize: 12, color: COLORS.muted, marginTop: 6, textAlign: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  toggleLabel: { fontSize: 15, color: COLORS.text },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  action: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9,
    borderRadius: 999, borderWidth: 1, borderColor: ROUTE_COLOR,
  },
  actionPrimary: { backgroundColor: ROUTE_COLOR },
  actionText: { fontSize: 14, fontWeight: '600', color: ROUTE_COLOR },
  footnote: { fontSize: 12, color: COLORS.muted, marginTop: 8 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: COLORS.bg, borderRadius: 16, padding: 20, gap: 14 },
  dialogTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  dialogInput: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  dialogBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  dialogBtnPrimary: { backgroundColor: ROUTE_COLOR },
  dialogBtnText: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  sheet: { flex: 1, backgroundColor: COLORS.bg },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text },
  sheetDone: { fontSize: 16, fontWeight: '600', color: ROUTE_COLOR },
  savedRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
});
