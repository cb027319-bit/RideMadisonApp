// Shared app state: bike paths, places, live BCycle stations, rider location
// and the currently selected map item (so the Nearby tab can focus the map).

import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { fetchBCycle, type BCycleStation } from './bcycle';
import { cached } from './cache';
import { BCYCLE_REFRESH_MS, CACHE_TTL } from './config';
import { fetchPaths, fetchPlaces, type BikePath, type Place } from './osm';

export type Selection =
  | { type: 'station'; item: BCycleStation }
  | { type: 'place'; item: Place }
  | { type: 'path'; item: BikePath };

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface DataState {
  paths: BikePath[];
  places: Place[];
  stations: BCycleStation[];
  pathsState: LoadState;
  placesState: LoadState;
  stationsState: LoadState;
  stationsUpdatedAt?: number;
  /** True when we're showing a saved copy because the network failed. */
  offlineCopy: boolean;
  location: { latitude: number; longitude: number } | null;
  locationDenied: boolean;
  selection: Selection | null;
  select: (s: Selection | null) => void;
  /** Bumped when another screen asks the map to fly to the selection. */
  focusRequest: number;
  focus: (s: Selection) => void;
  refreshAll: () => Promise<void>;
  refreshStations: () => Promise<void>;
}

const Ctx = createContext<DataState | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [paths, setPaths] = useState<BikePath[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [stations, setStations] = useState<BCycleStation[]>([]);
  const [pathsState, setPathsState] = useState<LoadState>('loading');
  const [placesState, setPlacesState] = useState<LoadState>('loading');
  const [stationsState, setStationsState] = useState<LoadState>('loading');
  const [stationsUpdatedAt, setStationsUpdatedAt] = useState<number>();
  const [offlineCopy, setOfflineCopy] = useState(false);
  const [location, setLocation] = useState<DataState['location']>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [rawSelection, setSelection] = useState<Selection | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);

  const loadOsm = useCallback(async (force: boolean) => {
    // Places first: small and quick, so pins appear before the path network.
    const placesP = cached('places:v1', CACHE_TTL.places, fetchPlaces, { force })
      .then((r) => {
        setPlaces(r.value);
        setPlacesState('ready');
        if (r.stale) setOfflineCopy(true);
      })
      .catch(() => setPlacesState('error'));
    const pathsP = cached('paths:v1', CACHE_TTL.paths, fetchPaths, { force })
      .then((r) => {
        setPaths(r.value);
        setPathsState('ready');
        if (r.stale) setOfflineCopy(true);
      })
      .catch(() => setPathsState('error'));
    await Promise.all([placesP, pathsP]);
  }, []);

  const refreshStations = useCallback(async () => {
    try {
      const data = await fetchBCycle();
      setStations(data);
      setStationsUpdatedAt(Date.now());
      setStationsState('ready');
    } catch {
      setStationsState((s) => (s === 'ready' ? s : 'error'));
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setOfflineCopy(false);
    setPathsState((s) => (s === 'ready' ? s : 'loading'));
    setPlacesState((s) => (s === 'ready' ? s : 'loading'));
    setStationsState((s) => (s === 'ready' ? s : 'loading'));
    await Promise.all([loadOsm(true), refreshStations()]);
  }, [loadOsm, refreshStations]);

  // Initial load (deferred one tick so it starts after the first render).
  useEffect(() => {
    const t = setTimeout(() => {
      void loadOsm(false);
      void refreshStations();
    }, 0);
    return () => clearTimeout(t);
  }, [loadOsm, refreshStations]);

  // Live BCycle counts while the app is in the foreground.
  const appActive = useRef(true);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      if (active && !appActive.current) void refreshStations();
      appActive.current = active;
    });
    const timer = setInterval(() => {
      if (appActive.current) void refreshStations();
    }, BCYCLE_REFRESH_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [refreshStations]);

  // Rider location (foreground only).
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        setLocationDenied(true);
        return;
      }
      const last = await Location.getLastKnownPositionAsync();
      if (last && !cancelled) setLocation({ latitude: last.coords.latitude, longitude: last.coords.longitude });
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 50 },
        (pos) => setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      );
      if (cancelled) sub.remove();
    })().catch(() => setLocationDenied(true));
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  const focus = useCallback((s: Selection) => {
    setSelection(s);
    setFocusRequest((n) => n + 1);
  }, []);

  // Show the selected station with its latest live counts.
  const selection = useMemo<Selection | null>(() => {
    if (rawSelection?.type !== 'station') return rawSelection;
    const live = stations.find((s) => s.id === rawSelection.item.id);
    return live ? { type: 'station', item: live } : rawSelection;
  }, [rawSelection, stations]);

  const value = useMemo<DataState>(
    () => ({
      paths, places, stations, pathsState, placesState, stationsState, stationsUpdatedAt,
      offlineCopy, location, locationDenied, selection, select: setSelection,
      focusRequest, focus, refreshAll, refreshStations,
    }),
    [paths, places, stations, pathsState, placesState, stationsState, stationsUpdatedAt,
      offlineCopy, location, locationDenied, selection, focusRequest, focus, refreshAll, refreshStations],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DataState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData must be used inside <DataProvider>');
  return v;
}
