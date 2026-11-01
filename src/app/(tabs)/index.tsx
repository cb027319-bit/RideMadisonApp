import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, type MapPressEvent } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LogoMark } from '@/components/brand';
import { DetailCard, PartnerMark, selectionCenter } from '@/components/detail-card';
import { useLaunchDone } from '@/components/launch-screen';
import { LayersSheet, type LayerOption } from '@/components/layers-sheet';
import { MapKey } from '@/components/map-key';
import { Onboarding } from '@/components/onboarding';
import { PathLines } from '@/components/path-lines';
import { BRAND, COLORS, FONT, INITIAL_REGION, MADISON_CENTER } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { useData, type Selection } from '@/lib/data';
import { pointInBBox, regionToBBox, type Region } from '@/lib/geo';
import { PLACE_META } from '@/lib/labels';
import { MAP_DATA_BUSY, MAP_DATA_ERROR } from '@/lib/osm';
import type { Place, PlaceKind } from '@/lib/osm';
import { cached } from '@/lib/cache';
import { fetchParkTrails, parkBBoxOf, parkTrailStyle, type ParkTrail } from '@/lib/parks';
import { PARTNER_LAYER, partnersOnTrail, sponsorForTrail, trackPartner } from '@/lib/partners';
import { isEbikeRider, usePrefs } from '@/lib/prefs';
import { useRoute } from '@/lib/route';
import { closestPointOnTrail, nearestPath, paidSectionLines } from '@/lib/trails';
import { describe, fetchWeather, type RideWeather } from '@/lib/weather';

type LayerId = 'trails' | 'lanes' | 'parks' | 'bcycle' | PlaceKind;

const LAYERS: LayerOption<LayerId>[] = [
  { id: 'trails', label: 'Trails', color: COLORS.pathPaved, icon: 'trail-sign', group: 'map', hint: 'Car-free paths and unpaved trails' },
  { id: 'lanes', label: 'Bike lanes', color: COLORS.lane, icon: 'remove', group: 'map', hint: 'Painted lanes on streets' },
  { id: 'bcycle', label: 'BCycle', color: COLORS.bcycle, icon: 'bicycle', group: 'map', hint: 'Bike-share stations with live counts' },
  { id: 'parks', label: 'State parks', color: COLORS.park, icon: 'leaf', group: 'map' },
  { id: 'shop', label: 'Bike shops', color: COLORS.shop, icon: 'storefront', group: 'places' },
  { id: 'repair', label: 'Fix-it stations', color: COLORS.repair, icon: 'construct', group: 'places', hint: 'Free pumps and tools' },
  { id: 'water', label: 'Water', color: COLORS.water, icon: 'water', group: 'places', hint: 'Drinking fountains' },
  { id: 'restroom', label: 'Restrooms', color: COLORS.restroom, icon: 'male-female', group: 'places' },
  { id: 'playground', label: 'Playgrounds', color: COLORS.playground, icon: 'happy', group: 'places' },
  { id: 'parking', label: 'Bike parking', color: COLORS.parking, icon: 'lock-closed', group: 'places' },
  { id: 'food', label: 'Eat', color: COLORS.food, icon: 'restaurant', group: 'places', hint: 'Restaurants, cafés and ice cream' },
  { id: 'drink', label: 'Drink', color: COLORS.drink, icon: 'beer', group: 'places', hint: 'Bars, pubs and breweries' },
];

/** The few layers shown as chips on the map; the rest are in the Layers sheet. */
const CHIP_IDS: LayerId[] = ['trails', 'lanes', 'bcycle', 'food'];
const CHIPS = LAYERS.filter((l) => CHIP_IDS.includes(l.id));

const DEFAULT_LAYERS: Record<LayerId, boolean> = {
  trails: true, lanes: true, parks: true, bcycle: true,
  shop: false, repair: false, parking: false, water: false, restroom: false, playground: false, food: false, drink: false,
};

const DENSE_KINDS = new Set<PlaceKind>(['parking', 'water', 'restroom', 'playground', 'food', 'drink']);

/** Dense layers only appear once zoomed in, to keep the map about the trails. */
const DENSE_MAX_LAT_DELTA = 0.04;
const STATIONS_MAX_LAT_DELTA = 0.12;
/** Zoomed in this far, station pins show their bike count. */
const STATION_COUNT_LAT_DELTA = 0.035;
const MAX_DENSE_MARKERS = 250;
/** How close (in screen points) a tap must be to a trail to select it. */
const TAP_TOLERANCE_PT = 32;
const HIGHLIGHT = '#facc15';

export default function MapScreen() {
  const {
    paths, trailOfPath, trailById, pathById, places, partners, parks, stations, pathsState, placesState, stationsState,
    stationsUpdatedAt, offlineCopy, lastError, location, locationStatus, requestLocation, selection, select, focusRequest, refreshAll, loadFood,
  } = useData();
  const { routeTo, requestSearch } = useRoute();
  const { prefs, loaded: prefsLoaded, skipped: prefsSkipped, setPrefs, skipPrefs } = usePrefs();
  const auth = useAuth();
  const launchDone = useLaunchDone();
  const mapRef = useRef<MapView>(null);
  const [mapHeight, setMapHeight] = useState(700);
  const [region, setRegion] = useState<Region>(INITIAL_REGION);
  const [layers, setLayers] = useState<Record<LayerId, boolean>>(DEFAULT_LAYERS);
  const [layersOpen, setLayersOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const weather = useWeather(location);

  const fitBBox = (b: { minLat: number; minLon: number; maxLat: number; maxLon: number }) => {
    mapRef.current?.fitToCoordinates(
      [
        { latitude: b.minLat, longitude: b.minLon },
        { latitude: b.maxLat, longitude: b.maxLon },
      ],
      { edgePadding: { top: 160, right: 40, bottom: 420, left: 40 }, animated: true },
    );
  };

  // Fly to an item chosen on the Nearby tab (whole trail in view for trails).
  useEffect(() => {
    if (!focusRequest || !selection) return;
    if (selection.type === 'trail') {
      fitBBox(selection.item.bbox);
      return;
    }
    const c = selectionCenter(selection);
    mapRef.current?.animateToRegion({ ...c, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 500);
  }, [focusRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = useMemo(() => regionToBBox(region, 0.3), [region]);
  const showDense = region.latitudeDelta <= DENSE_MAX_LAT_DELTA;
  const showStations = layers.bcycle && region.latitudeDelta <= STATIONS_MAX_LAT_DELTA;

  // State parks: visible across the region (they're spread out), hidden only when very zoomed out.
  const visibleParks = useMemo(
    () => (layers.parks && region.latitudeDelta <= 1.2 ? parks.filter((p) => pointInBBox(p.lat, p.lon, regionToBBox(region, 0.5))) : []),
    [parks, layers.parks, region],
  );


  // Trails inside the selected park, loaded on demand and cached on the phone.
  const parkId = selection?.type === 'park' ? selection.item.id : null;
  const [parkTrails, setParkTrails] = useState<{ parkId: string; state: 'ready' | 'error'; trails: ParkTrail[] } | null>(null);
  const [parkRetry, setParkRetry] = useState(0);
  useEffect(() => {
    if (selection?.type !== 'park') return;
    const park = selection.item;
    let cancelled = false;
    cached(`parktrails:v1:${park.id}`, 30 * 24 * 3600 * 1000, () => fetchParkTrails(park))
      .then((r) => {
        if (cancelled) return;
        setParkTrails({ parkId: park.id, state: 'ready', trails: r.value });
        const b = parkBBoxOf(park, r.value);
        if (b && !park.bbox) fitBBox(b);
      })
      .catch(() => !cancelled && setParkTrails({ parkId: park.id, state: 'error', trails: [] }));
    return () => {
      cancelled = true;
    };
  }, [parkId, parkRetry]); // eslint-disable-line react-hooks/exhaustive-deps
  const currentParkTrails =
    parkId && parkTrails?.parkId === parkId
      ? { state: parkTrails.state, trails: parkTrails.trails }
      : parkId
        ? { state: 'loading' as const, trails: [] }
        : undefined;

  const openPark = (p: (typeof parks)[number]) => {
    select({ type: 'park', item: p });
    if (p.bbox) fitBBox(p.bbox);
  };

  // Paying partners: larger branded pins (unless zoomed far out), following their category's layer.
  const visiblePartners = useMemo(
    () =>
      region.latitudeDelta > 0.3
        ? []
        : partners.filter((p) => {
            const layer = PARTNER_LAYER[p.category];
            if (layer && !layers[layer]) return false;
            return p.latitude != null && p.longitude != null && pointInBBox(p.latitude, p.longitude, view);
          }),
    [partners, region.latitudeDelta, view, layers],
  );
  const partnerPlaceIds = useMemo(
    () => new Set(partners.map((p) => p.osm_place_id).filter((id): id is string => !!id)),
    [partners],
  );

  // Ad reporting: count each partner pin once per app session when it appears on screen.
  const seenPins = useRef(new Set<string>());
  useEffect(() => {
    for (const p of visiblePartners) {
      if (!seenPins.current.has(p.id)) {
        seenPins.current.add(p.id);
        trackPartner(p, 'impression', 'pin');
      }
    }
  }, [visiblePartners]);

  const visiblePlaces = useMemo(() => {
    const out: Place[] = [];
    let dense = 0;
    for (const p of places) {
      if (!layers[p.kind]) continue;
      if (partnerPlaceIds.has(p.id)) continue; // shown as a partner pin instead
      const isDense = DENSE_KINDS.has(p.kind);
      if (isDense && (!showDense || dense >= MAX_DENSE_MARKERS)) continue;
      if (!pointInBBox(p.lat, p.lon, view)) continue;
      if (isDense) dense += 1;
      out.push(p);
    }
    return out;
  }, [places, layers, showDense, view, partnerPlaceIds]);

  const visibleStations = showStations ? stations.filter((s) => pointInBBox(s.lat, s.lon, view)) : [];

  // Segments of the selected trail, for the highlight and "route to trail".
  const selectedTrailPaths = useMemo(() => {
    if (selection?.type !== 'trail') return [];
    return selection.item.pathIds.map((id) => pathById.get(id)).filter((p) => p != null);
  }, [selection, pathById]);
  // Where a state trail pass is needed on the selected trail (e.g. part of the Capital City Trail).
  const paidLines = useMemo(
    () => (selection?.type === 'trail' ? paidSectionLines(selectedTrailPaths, selection.item.rules) : []),
    [selection, selectedTrailPaths],
  );
  // Trail Partners within 0.5 mi of the selected trail.
  const trailPartners = useMemo(
    () => (selection?.type === 'trail' ? partnersOnTrail(partners, selection.item, selectedTrailPaths) : []),
    [selection, partners, selectedTrailPaths],
  );
  const showCounts = region.latitudeDelta <= STATION_COUNT_LAT_DELTA;

  // Let custom pins draw before freezing them as images (blank pins on some Android devices otherwise).
  const pinsKey = `${visiblePlaces.length}:${visibleStations.length}:${visiblePartners.length}:${visibleParks.length}:${stationsUpdatedAt ?? 0}:${showCounts}`;
  const [settledPinsKey, setSettledPinsKey] = useState('');
  const trackPins = settledPinsKey !== pinsKey;
  useEffect(() => {
    const t = setTimeout(() => setSettledPinsKey(pinsKey), 1000);
    return () => clearTimeout(t);
  }, [pinsKey]);

  const onMapPress = (e: MapPressEvent) => {
    // iOS also reports marker taps here.
    if ((e.nativeEvent as { action?: string }).action === 'marker-press') return;
    const tolDeg = (TAP_TOLERANCE_PT * region.latitudeDelta) / mapHeight;
    const lanesOn = layers.lanes && region.latitudeDelta <= 0.2;
    const hit = layers.trails || lanesOn
      ? nearestPath(
          layers.trails ? paths : paths.filter((p) => p.kind === 'lane'),
          e.nativeEvent.coordinate,
          tolDeg,
          lanesOn,
        )
      : null;
    const trailId = hit ? trailOfPath.get(hit.id) : undefined;
    const trail = trailId ? trailById.get(trailId) : undefined;
    select(trail ? { type: 'trail', item: trail } : null);
  };

  // Locate button: asks for location the first time, then centers once a fix arrives.
  const recenterWanted = useRef(false);
  const recenter = async () => {
    if (!location) {
      recenterWanted.current = true;
      if (!(await requestLocation())) {
        recenterWanted.current = false;
        mapRef.current?.animateToRegion({ ...MADISON_CENTER, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 500);
      }
      return;
    }
    mapRef.current?.animateToRegion({ ...location, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 500);
  };
  useEffect(() => {
    if (!location || !recenterWanted.current) return;
    recenterWanted.current = false;
    mapRef.current?.animateToRegion({ ...location, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 500);
  }, [location]);

  const toggle = (id: LayerId) => {
    if ((id === 'food' || id === 'drink') && !layers[id]) loadFood();
    setLayers((l) => ({ ...l, [id]: !l[id] }));
  };
  const extraOn = LAYERS.filter((l) => !CHIP_IDS.includes(l.id) && layers[l.id]).length;

  const targetFor = (s: Selection) => {
    if (s.type === 'trail') {
      return closestPointOnTrail(selectedTrailPaths, location ?? selectionCenter(s)) ?? selectionCenter(s);
    }
    return selectionCenter(s);
  };

  const status = statusMessage({ pathsState, placesState, stationsState, offlineCopy });
  const zoomHint = !status && layers.bcycle && !showStations
    ? 'Zoom in to see BCycle stations'
    : !status && !showDense && [...DENSE_KINDS].some((k) => layers[k])
      ? 'Zoom in to see these places'
      : null;

  return (
    <View style={styles.container} onLayout={(e) => setMapHeight(e.nativeEvent.layout.height)}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={INITIAL_REGION}
        onRegionChangeComplete={setRegion}
        onPress={onMapPress}
        showsUserLocation={locationStatus === 'granted'}
        showsMyLocationButton={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}>
        <PathLines paths={paths} region={region} showTrails={layers.trails} showLanes={layers.lanes} />

        {selectedTrailPaths.map((p) => (
          <Polyline
            key={`hl:${p.id}`}
            coordinates={p.coords.map(([lon, lat]) => ({ latitude: lat, longitude: lon }))}
            strokeColor={HIGHLIGHT}
            strokeWidth={10}
            lineCap="round"
            zIndex={0}
          />
        ))}
        {paidLines.map((line, i) => (
          <Polyline
            key={`paid:${i}`}
            coordinates={line.map(([lon, lat]) => ({ latitude: lat, longitude: lon }))}
            strokeColor={BRAND.red}
            strokeWidth={3}
            lineDashPattern={[8, 6]}
            zIndex={4}
          />
        ))}

        {currentParkTrails?.trails.flatMap((t) =>
          t.lines.map((line, i) => {
            const st = parkTrailStyle(t);
            return (
              <Polyline
                key={`pt:${t.name}:${i}`}
                coordinates={line.map(([lon, lat]) => ({ latitude: lat, longitude: lon }))}
                strokeColor={st.color}
                strokeWidth={st.width}
                lineDashPattern={st.dash}
                zIndex={3}
              />
            );
          }),
        )}

        {visibleParks.map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lon }}
            onPress={() => openPark(p)}
            tracksViewChanges={trackPins}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={15}
            accessibilityLabel={p.name}>
            <View style={styles.parkPin}>
              <Ionicons name="leaf" size={14} color="#fff" />
            </View>
          </Marker>
        ))}

        {visiblePlaces.map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lon }}
            onPress={() => select({ type: 'place', item: p })}
            tracksViewChanges={trackPins}
            anchor={{ x: 0.5, y: 0.5 }}
            accessibilityLabel={`${PLACE_META[p.kind].label}${p.name ? `: ${p.name}` : ''}`}>
            <View style={[styles.pin, { backgroundColor: PLACE_META[p.kind].color }]}>
              <Ionicons name={PLACE_META[p.kind].icon as keyof typeof Ionicons.glyphMap} size={12} color="#fff" />
            </View>
          </Marker>
        ))}

        {visiblePartners.map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.latitude!, longitude: p.longitude! }}
            onPress={() => select({ type: 'partner', item: p })}
            tracksViewChanges={trackPins}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={20}
            accessibilityLabel={`Sponsored: ${p.name}`}>
            <View style={styles.partnerPin}>
              <PartnerMark partner={p} size={30} />
              <View style={styles.partnerStar}>
                <Ionicons name="star" size={9} color={BRAND.navy} />
              </View>
            </View>
          </Marker>
        ))}

        {visibleStations.map((s) => {
          const empty = !s.renting || s.bikes === 0;
          return (
            <Marker
              key={`${s.id}:${empty ? 'e' : 'ok'}:${showCounts ? s.bikes : ''}`}
              coordinate={{ latitude: s.lat, longitude: s.lon }}
              onPress={() => select({ type: 'station', item: s })}
              tracksViewChanges={trackPins}
              anchor={{ x: 0.5, y: 0.5 }}
              accessibilityLabel={`BCycle ${s.name}: ${s.bikes} ${s.bikes === 1 ? 'bike' : 'bikes'}, ${s.docks} open spots to return`}>
              <View style={styles.stationHit}>
                <View style={[styles.station, empty && styles.stationEmpty]}>
                  {showCounts ? (
                    <Text style={styles.stationCount}>{s.renting ? s.bikes : '–'}</Text>
                  ) : (
                    <Ionicons name="bicycle" size={15} color="#fff" />
                  )}
                </View>
              </View>
            </Marker>
          );
        })}
      </MapView>

      <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
        <Pressable
          style={styles.whereTo}
          onPress={() => {
            select(null);
            requestSearch();
            router.navigate('/route');
          }}
          accessibilityRole="search"
          accessibilityLabel="Where to? Plan a bike route">
          <View style={styles.whereToLogo}>
            <LogoMark size={26} color={BRAND.limestone} />
          </View>
          <Text style={styles.whereToText}>Where to?</Text>
          <View style={styles.whereToBadge}>
            <Ionicons name="navigate" size={14} color="#fff" />
            <Text style={styles.whereToBadgeText}>Route</Text>
          </View>
        </Pressable>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {CHIPS.map((l) => {
            const on = layers[l.id];
            return (
              <Pressable
                key={l.id}
                onPress={() => toggle(l.id)}
                accessibilityRole="switch"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${l.label} layer`}
                style={[styles.chip, on && { backgroundColor: l.color, borderColor: l.color }]}>
                <Ionicons name={l.icon} size={15} color={on ? '#fff' : l.color} />
                <Text style={[styles.chipText, on && { color: '#fff' }]}>{l.label}</Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setLayersOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={extraOn ? `Layers, ${extraOn} more on` : 'Layers'}
            accessibilityHint="Shows all map layers: shops, fix-it, water, restrooms, playgrounds and more"
            style={[styles.chip, styles.layersChip]}>
            <Ionicons name="layers" size={15} color="#fff" />
            <Text style={[styles.chipText, { color: '#fff' }]}>Layers{extraOn ? ` · ${extraOn}` : ''}</Text>
          </Pressable>
        </ScrollView>

        {weather && (
          <View style={styles.weather} accessible accessibilityLabel={`Ride weather: ${weather.tempF} degrees, ${describe(weather.code)}, wind ${weather.windMph} miles per hour from the ${weather.windFrom}`}>
            <Ionicons name={weatherIcon(weather.code)} size={14} color={COLORS.text} />
            <Text style={styles.weatherText}>
              {weather.tempF}° {describe(weather.code)}  ·  Wind {weather.windMph} mph {weather.windFrom}
              {weather.sunset ? `  ·  Sunset ${weather.sunset}` : ''}
            </Text>
          </View>
        )}

        {status && (
          <Pressable
            style={styles.banner}
            onPress={status.retry ? () => void refreshAll() : undefined}
            accessibilityRole={status.retry ? 'button' : 'text'}>
            {status.loading && <ActivityIndicator size="small" color={COLORS.brand} />}
            <View style={{ flexShrink: 1 }}>
              <Text style={styles.bannerText}>{status.text}</Text>
              {__DEV__ && status.retry && lastError ? <Text style={styles.errorText}>{lastError}</Text> : null}
            </View>
          </Pressable>
        )}
        {zoomHint && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{zoomHint}</Text>
          </View>
        )}
      </SafeAreaView>

      <View style={styles.bottom} pointerEvents="box-none">
        {!selection && layers.trails && pathsState === 'ready' && (
          <View
            style={styles.tip}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants">
            <Text style={styles.tipText}>Tap a trail on the map, or find it under Nearby &gt; Trails</Text>
          </View>
        )}
        <View style={styles.bottomRow} pointerEvents="box-none">
          <Pressable
            style={styles.keyButton}
            onPress={() => setKeyOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Map key"
            accessibilityHint="Explains the map's lines and pins">
            <Ionicons name="information-circle-outline" size={18} color={COLORS.brand} />
            <Text style={styles.keyText}>Key</Text>
          </Pressable>
          <Pressable style={styles.locate} onPress={() => void recenter()} accessibilityRole="button" accessibilityLabel="Center on my location">
            <Ionicons name="locate" size={22} color={COLORS.brand} />
          </Pressable>
        </View>
        {selection && (
          <DetailCard
            selection={selection}
            location={location}
            target={targetFor(selection)}
            isEbikeRider={isEbikeRider(prefs)}
            ebikeClass={prefs?.ebikeClass ?? null}
            sponsor={selection.type === 'trail' ? sponsorForTrail(partners, selection.item.name) : undefined}
            trailPartners={trailPartners}
            onOpenPartner={(p) => select({ type: 'partner', item: p })}
            parkTrails={currentParkTrails}
            onRetryParkTrails={() => setParkRetry((n) => n + 1)}
            onClose={() => select(null)}
            onRouteHere={(label) => {
              routeTo(targetFor(selection), label);
              select(null);
              router.navigate('/route');
            }}
          />
        )}
      </View>

      <LayersSheet
        visible={layersOpen}
        layers={LAYERS}
        on={layers}
        onToggle={toggle}
        onClose={() => setLayersOpen(false)}
        onShowKey={() => {
          setLayersOpen(false);
          setTimeout(() => setKeyOpen(true), 400);
        }}
      />
      <MapKey visible={keyOpen} onClose={() => setKeyOpen(false)} />

      <Onboarding
        visible={launchDone && prefsLoaded && !prefs && !prefsSkipped && auth.ready && auth.welcomeHandled && !auth.sheet}
        onDone={(p) => {
          setPrefs(p);
          if (auth.session) void auth.updateProfile({ bike_type: p.bike, comfort: p.comfort }).catch(() => {});
        }}
        onSkip={skipPrefs}
      />
    </View>
  );
}

function useWeather(location: { latitude: number; longitude: number } | null): RideWeather | null {
  const [weather, setWeather] = useState<RideWeather | null>(null);
  const lat = (location ?? MADISON_CENTER).latitude.toFixed(1);
  const lon = (location ?? MADISON_CENTER).longitude.toFixed(1);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchWeather(Number(lat), Number(lon))
        .then((w) => !cancelled && setWeather(w))
        .catch(() => {});
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 15 * 60 * 1000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [lat, lon]);
  return weather;
}

function weatherIcon(code: number): keyof typeof Ionicons.glyphMap {
  const d = describe(code);
  if (d === 'Clear') return 'sunny-outline';
  if (d === 'Partly cloudy') return 'partly-sunny-outline';
  if (d === 'Rain' || d === 'Drizzle') return 'rainy-outline';
  if (d === 'Snow') return 'snow-outline';
  if (d === 'Storms') return 'thunderstorm-outline';
  return 'cloud-outline';
}

function statusMessage(s: {
  pathsState: string; placesState: string; stationsState: string; offlineCopy: boolean;
}): { text: string; loading?: boolean; retry?: boolean } | null {
  if (s.pathsState === 'error' || s.placesState === 'error') {
    return { text: `${MAP_DATA_ERROR} Tap to retry.`, retry: true };
  }
  if (s.pathsState === 'loading' || s.placesState === 'loading') {
    return { text: 'Loading trails and places…', loading: true };
  }
  if (s.stationsState === 'error') return { text: "BCycle counts aren't available right now. Tap to retry.", retry: true };
  if (s.offlineCopy) return { text: `${MAP_DATA_BUSY} Tap to try again.`, retry: true };
  return null;
}

const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.12,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 2 },
  elevation: 3,
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  whereTo: {
    marginHorizontal: 12, marginTop: 8, minHeight: 50, borderRadius: 25, backgroundColor: COLORS.bg,
    flexDirection: 'row', alignItems: 'center', paddingLeft: 5, paddingRight: 6, gap: 10, ...shadow,
  },
  whereToLogo: { width: 40, height: 40, borderRadius: 20, backgroundColor: BRAND.navy, alignItems: 'center', justifyContent: 'center' },
  whereToText: { flex: 1, fontSize: 18, fontFamily: FONT.bold, color: COLORS.text },
  whereToBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: BRAND.red,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
  },
  whereToBadgeText: { color: '#fff', fontFamily: FONT.black, fontSize: 16 }, // 16pt bold: white on red needs large text
  chips: { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, minHeight: 44,
    borderRadius: 999, backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, ...shadow,
  },
  layersChip: { backgroundColor: BRAND.navy, borderColor: BRAND.navy },
  chipText: { fontSize: 14, fontFamily: FONT.bold, color: COLORS.text },
  weather: {
    alignSelf: 'flex-start', marginLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.95)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, ...shadow,
  },
  weatherText: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  banner: {
    alignSelf: 'center', maxWidth: '92%', marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.95)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, ...shadow,
  },
  bannerText: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  errorText: { fontSize: 13, color: '#b91c1c', marginTop: 2 },
  bottom: { position: 'absolute', left: 12, right: 12, bottom: 16, gap: 10 },
  tip: {
    alignSelf: 'center', backgroundColor: 'rgba(17,24,39,0.8)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
  },
  tipText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  keyButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: 14, borderRadius: 22,
    backgroundColor: COLORS.bg, ...shadow,
  },
  keyText: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.brand },
  locate: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.bg,
    alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  pin: {
    width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
  },
  parkPin: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.park, borderWidth: 2, borderColor: '#fff',
  },
  partnerPin: {
    padding: 3, borderRadius: 20, backgroundColor: COLORS.partner,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
  },
  partnerStar: {
    position: 'absolute', right: -2, top: -2, width: 15, height: 15, borderRadius: 8, backgroundColor: COLORS.partner,
    borderWidth: 1.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  stationHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  station: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.bcycle, borderWidth: 2, borderColor: '#fff',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  stationEmpty: { backgroundColor: COLORS.bcycleEmpty },
  stationCount: { color: '#fff', fontSize: 13, fontFamily: FONT.black },
});
