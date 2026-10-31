import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, type MapPressEvent } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailCard, selectionCenter } from '@/components/detail-card';
import { COLORS, INITIAL_REGION } from '@/lib/config';
import { useData } from '@/lib/data';
import { bboxIntersects, pointInBBox, regionToBBox, type Region } from '@/lib/geo';
import { PATH_META, PLACE_META } from '@/lib/labels';
import type { Place, PlaceKind } from '@/lib/osm';

type LayerId = 'paths' | 'bcycle' | PlaceKind;

const LAYERS: { id: LayerId; label: string; color: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'paths', label: 'Bike paths', color: COLORS.pathPaved, icon: 'git-branch' },
  { id: 'bcycle', label: 'BCycle', color: COLORS.bcycle, icon: 'flash' },
  { id: 'shop', label: 'Shops', color: COLORS.shop, icon: 'storefront' },
  { id: 'repair', label: 'Fix-it', color: COLORS.repair, icon: 'construct' },
  { id: 'parking', label: 'Parking', color: COLORS.parking, icon: 'lock-closed' },
  { id: 'water', label: 'Water', color: COLORS.water, icon: 'water' },
];

/** Dense layers only appear once zoomed in, to keep the map fast and legible. */
const DENSE_MAX_LAT_DELTA = 0.04;
const LANES_MAX_LAT_DELTA = 0.25;
const MAX_POLYLINES = 1500;
const MAX_DENSE_MARKERS = 250;

export default function MapScreen() {
  const {
    paths, places, stations, pathsState, placesState, stationsState, stationsUpdatedAt, offlineCopy,
    location, selection, select, focusRequest, refreshAll,
  } = useData();
  const mapRef = useRef<MapView>(null);
  const [region, setRegion] = useState<Region>(INITIAL_REGION);
  const [layers, setLayers] = useState<Record<LayerId, boolean>>({
    paths: true, bcycle: true, shop: true, repair: true, parking: false, water: false,
  });

  // Fly to an item chosen on the Nearby tab.
  useEffect(() => {
    if (!focusRequest || !selection) return;
    const c = selectionCenter(selection);
    mapRef.current?.animateToRegion({ ...c, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 500);
  }, [focusRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // Convert path geometry once, not on every pan.
  const pathLines = useMemo(
    () => paths.map((p) => ({ path: p, coords: p.coords.map(([lon, lat]) => ({ latitude: lat, longitude: lon })) })),
    [paths],
  );

  const view = useMemo(() => regionToBBox(region, 0.3), [region]);
  const zoomedOut = region.latitudeDelta > LANES_MAX_LAT_DELTA;
  const showDense = region.latitudeDelta <= DENSE_MAX_LAT_DELTA;

  const visibleLines = useMemo(() => {
    if (!layers.paths) return [];
    const out = [];
    for (const l of pathLines) {
      if (zoomedOut && l.path.kind === 'lane') continue;
      if (!bboxIntersects(l.path.bbox, view)) continue;
      out.push(l);
      if (out.length >= MAX_POLYLINES) break;
    }
    return out;
  }, [pathLines, view, zoomedOut, layers.paths]);

  const visiblePlaces = useMemo(() => {
    const out: Place[] = [];
    let dense = 0;
    for (const p of places) {
      if (!layers[p.kind]) continue;
      const isDense = p.kind === 'parking' || p.kind === 'water';
      if (isDense && (!showDense || dense >= MAX_DENSE_MARKERS)) continue;
      if (!pointInBBox(p.lat, p.lon, view)) continue;
      if (isDense) dense += 1;
      out.push(p);
    }
    return out;
  }, [places, layers, showDense, view]);

  const visibleStations = layers.bcycle ? stations.filter((s) => pointInBBox(s.lat, s.lon, view)) : [];

  // Let custom pins draw (icon font + layout) before freezing them as images;
  // freezing too early leaves blank pins on some Android devices.
  const pinsKey = `${visiblePlaces.length}:${stationsUpdatedAt ?? 0}`;
  const [settledPinsKey, setSettledPinsKey] = useState('');
  const trackPins = settledPinsKey !== pinsKey;
  useEffect(() => {
    const t = setTimeout(() => setSettledPinsKey(pinsKey), 1000);
    return () => clearTimeout(t);
  }, [pinsKey]);

  const onMapPress = (e: MapPressEvent) => {
    // iOS also reports marker taps here; only clear on taps on empty map.
    if ((e.nativeEvent as { action?: string }).action === 'marker-press') return;
    select(null);
  };

  const recenter = () => {
    const target = location ?? INITIAL_REGION;
    mapRef.current?.animateToRegion(
      { latitude: target.latitude, longitude: target.longitude, latitudeDelta: 0.03, longitudeDelta: 0.03 },
      500,
    );
  };

  const toggle = (id: LayerId) => setLayers((l) => ({ ...l, [id]: !l[id] }));

  const status = statusMessage({ pathsState, placesState, stationsState, offlineCopy });
  const hiddenDense = !showDense && (layers.parking || layers.water);

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
        {visibleLines.map(({ path, coords }) => (
          <Polyline
            key={path.id}
            coordinates={coords}
            strokeColor={PATH_META[path.kind].color}
            strokeWidth={path.kind === 'lane' ? 2.5 : 3.5}
            lineDashPattern={path.kind === 'path_unpaved' ? [6, 4] : undefined}
            tappable
            onPress={() => select({ type: 'path', item: path })}
          />
        ))}

        {visiblePlaces.map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lon }}
            onPress={() => select({ type: 'place', item: p })}
            tracksViewChanges={trackPins}
            accessibilityLabel={`${PLACE_META[p.kind].label}${p.name ? `: ${p.name}` : ''}`}>
            <View style={[styles.pin, { backgroundColor: PLACE_META[p.kind].color }]}>
              <Ionicons name={PLACE_META[p.kind].icon as keyof typeof Ionicons.glyphMap} size={14} color="#fff" />
            </View>
          </Marker>
        ))}

        {visibleStations.map((s) => (
          <Marker
            // Re-mount when counts change so the static marker image updates.
            key={`${s.id}:${s.bikes}:${s.renting}`}
            coordinate={{ latitude: s.lat, longitude: s.lon }}
            onPress={() => select({ type: 'station', item: s })}
            tracksViewChanges={trackPins}
            accessibilityLabel={`BCycle ${s.name}: ${s.bikes} bikes, ${s.docks} docks`}>
            <View style={[styles.station, (!s.renting || s.bikes === 0) && styles.stationEmpty]}>
              <Ionicons name="flash" size={11} color="#fff" />
              <Text style={styles.stationText}>{s.renting ? s.bikes : '–'}</Text>
            </View>
          </Marker>
        ))}
      </MapView>

      <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {LAYERS.map((l) => {
            const on = layers[l.id];
            return (
              <Pressable
                key={l.id}
                onPress={() => toggle(l.id)}
                accessibilityRole="switch"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${l.label} layer`}
                style={[styles.chip, on && { backgroundColor: l.color, borderColor: l.color }]}>
                <Ionicons name={l.icon} size={14} color={on ? '#fff' : l.color} />
                <Text style={[styles.chipText, on && { color: '#fff' }]}>{l.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {status && (
          <Pressable
            style={styles.banner}
            onPress={status.retry ? () => void refreshAll() : undefined}
            accessibilityRole={status.retry ? 'button' : 'text'}>
            {status.loading && <ActivityIndicator size="small" color={COLORS.brand} />}
            <Text style={styles.bannerText}>{status.text}</Text>
          </Pressable>
        )}
        {hiddenDense && !status && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>Zoom in to see parking and water</Text>
          </View>
        )}
      </SafeAreaView>

      <View style={styles.bottom} pointerEvents="box-none">
        <Pressable style={styles.locate} onPress={recenter} accessibilityLabel="Center on my location">
          <Ionicons name="locate" size={22} color={COLORS.brand} />
        </Pressable>
        {selection && <DetailCard selection={selection} location={location} onClose={() => select(null)} />}
      </View>
    </View>
  );
}

function statusMessage(s: {
  pathsState: string; placesState: string; stationsState: string; offlineCopy: boolean;
}): { text: string; loading?: boolean; retry?: boolean } | null {
  if (s.pathsState === 'error' || s.placesState === 'error') {
    return { text: "Couldn't load map data. Tap to retry.", retry: true };
  }
  if (s.pathsState === 'loading' || s.placesState === 'loading') {
    return { text: 'Loading bike paths and places…', loading: true };
  }
  if (s.stationsState === 'error') return { text: 'BCycle is unavailable right now. Tap to retry.', retry: true };
  if (s.offlineCopy) return { text: 'Offline: showing saved map data. Tap to refresh.', retry: true };
  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  chips: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  chipText: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  banner: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    elevation: 2,
  },
  bannerText: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  bottom: { position: 'absolute', left: 12, right: 12, bottom: 16, gap: 12 },
  locate: {
    alignSelf: 'flex-end',
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  pin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  station: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: COLORS.bcycle,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#fff',
  },
  stationEmpty: { backgroundColor: '#9ca3af' },
  stationText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
