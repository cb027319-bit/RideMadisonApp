// Shared app state: bike paths, places, live BCycle stations, rider location
// and the currently selected map item (so the Nearby tab can focus the map).

import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { fetchBCycle, type BCycleStation } from './bcycle';
import { cached } from './cache';
import { BCYCLE_REFRESH_MS, CACHE_TTL } from './config';
import { fetchFood, fetchPaths, fetchPlaces, type BikePath, type FoodKind, type Place } from './osm';
import { fetchParks, type Park } from './parks';
import { fetchPartners, type Partner } from './partners';
import { groupTrails, type Trail } from './trails';

export type Selection =
  | { type: 'station'; item: BCycleStation }
  | { type: 'place'; item: Place }
  | { type: 'trail'; item: Trail }
  | { type: 'partner'; item: Partner }
  | { type: 'park'; item: Park };

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface DataState {
  paths: BikePath[];
  /** Paths grouped into whole named trails. */
  trails: Trail[];
  trailOfPath: Map<string, string>;
  trailById: Map<string, Trail>;
  pathById: Map<string, BikePath>;
  places: Place[];
  /** Restaurants and bars load on first use (Eat/Drink tabs or map layers). */
  /** Loading state of restaurants ('food') and bars ('drink'), loaded on demand. */
  foodState: Record<FoodKind, LoadState | 'idle'>;
  foodError: Record<FoodKind, string | null>;
  loadFood: (force?: boolean) => void;
  /** Paying local businesses (featured pins, trail sponsors). */
  partners: Partner[];
  /** Wisconsin state parks and recreation areas within a day trip. */
  parks: Park[];
  stations: BCycleStation[];
  pathsState: LoadState;
  placesState: LoadState;
  stationsState: LoadState;
  stationsUpdatedAt?: number;
  /** True when we're showing a saved copy because the network failed. */
  offlineCopy: boolean;
  /** Last data-loading error, shown to help diagnose connection problems. */
  lastError: string | null;
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
  const [bikePlaces, setPlaces] = useState<Place[]>([]);
  const [food, setFood] = useState<Record<FoodKind, Place[]>>({ food: [], drink: [] });
  const [foodState, setFoodState] = useState<Record<FoodKind, LoadState | 'idle'>>({ food: 'idle', drink: 'idle' });
  const [foodError, setFoodError] = useState<Record<FoodKind, string | null>>({ food: null, drink: null });
  const places = useMemo(
    () => (food.food.length || food.drink.length ? [...bikePlaces, ...food.food, ...food.drink] : bikePlaces),
    [bikePlaces, food],
  );
  const [partners, setPartners] = useState<Partner[]>([]);
  const [parks, setParks] = useState<Park[]>([]);
  const [stations, setStations] = useState<BCycleStation[]>([]);
  const [pathsState, setPathsState] = useState<LoadState>('loading');
  const [placesState, setPlacesState] = useState<LoadState>('loading');
  const [stationsState, setStationsState] = useState<LoadState>('loading');
  const [stationsUpdatedAt, setStationsUpdatedAt] = useState<number>();
  const [offlineCopy, setOfflineCopy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
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
      .catch((e: unknown) => {
        setPlacesState('error');
        setLastError(`Places: ${e instanceof Error ? e.message : String(e)}`);
      });
    const pathsP = cached('paths:v1', CACHE_TTL.paths, fetchPaths, { force })
      .then((r) => {
        setPaths(r.value);
        setPathsState('ready');
        if (r.stale) setOfflineCopy(true);
      })
      .catch((e: unknown) => {
        setPathsState('error');
        setLastError(`Paths: ${e instanceof Error ? e.message : String(e)}`);
      });
    const parksP = cached('parks:v1', 30 * 24 * 3600 * 1000, fetchParks, { force })
      .then((r) => setParks(r.value))
      .catch(() => {});
    const partnersP = fetchPartners(force)
      .then(setPartners)
      .catch(() => {});
    await Promise.all([placesP, pathsP, partnersP, parksP]);
  }, []);

  const refreshStations = useCallback(async () => {
    try {
      const data = await fetchBCycle();
      setStations(data);
      setStationsUpdatedAt(Date.now());
      setStationsState('ready');
    } catch (e) {
      setStationsState((s) => (s === 'ready' ? s : 'error'));
      setLastError(`BCycle: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const loadFood = useCallback(
    (force = false) => {
      for (const kind of ['drink', 'food'] as FoodKind[]) {
        if (!force && (foodState[kind] === 'loading' || foodState[kind] === 'ready')) continue;
        setFoodState((s) => ({ ...s, [kind]: 'loading' }));
        setFoodError((s) => ({ ...s, [kind]: null }));
        cached(`${kind}:v2`, CACHE_TTL.places, () => fetchFood(kind), { force })
          .then((r) => {
            setFood((f) => ({ ...f, [kind]: r.value }));
            setFoodState((s) => ({ ...s, [kind]: 'ready' }));
          })
          .catch((e: unknown) => {
            setFoodState((s) => ({ ...s, [kind]: 'error' }));
            setFoodError((s) => ({ ...s, [kind]: e instanceof Error ? e.message : String(e) }));
          });
      }
    },
    [foodState],
  );

  const refreshAll = useCallback(async () => {
    setOfflineCopy(false);
    setLastError(null);
    setPathsState((s) => (s === 'ready' ? s : 'loading'));
    setPlacesState((s) => (s === 'ready' ? s : 'loading'));
    setStationsState((s) => (s === 'ready' ? s : 'loading'));
    if (foodState.food !== 'idle' || foodState.drink !== 'idle') loadFood(true);
    await Promise.all([loadOsm(true), refreshStations()]);
  }, [loadOsm, refreshStations, foodState, loadFood]);

  // Initial load (deferred one tick so it starts after the first render).
  useEffect(() => {
    const t = setTimeout(() => {
      void loadOsm(false);
      void refreshStations();
    }, 0);
    return () => clearTimeout(t);
  }, [loadOsm, refreshStations]);

  // Prefetch Eat and Drink in the background ~5 s after the core map data is in,
  // so those lists are ready by the time a rider opens them.
  const coreReady = pathsState === 'ready' && placesState === 'ready';
  const foodPrefetched = useRef(false);
  useEffect(() => {
    if (!coreReady || foodPrefetched.current) return;
    const t = setTimeout(() => {
      foodPrefetched.current = true;
      loadFood();
    }, 5000);
    return () => clearTimeout(t);
  }, [coreReady, loadFood]);

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

  const { trails, trailOfPath } = useMemo(() => groupTrails(paths), [paths]);
  const trailById = useMemo(() => new Map(trails.map((t) => [t.id, t])), [trails]);
  const pathById = useMemo(() => new Map(paths.map((p) => [p.id, p])), [paths]);

  const value = useMemo<DataState>(
    () => ({
      paths, trails, trailOfPath, trailById, pathById, places, foodState, foodError, loadFood, partners, parks, stations, pathsState, placesState, stationsState, stationsUpdatedAt,
      offlineCopy, lastError, location, locationDenied, selection, select: setSelection,
      focusRequest, focus, refreshAll, refreshStations,
    }),
    [paths, trails, trailOfPath, trailById, pathById, places, foodState, foodError, loadFood, partners, parks, stations, pathsState, placesState, stationsState, stationsUpdatedAt,
      offlineCopy, lastError, location, locationDenied, selection, focusRequest, focus, refreshAll, refreshStations],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DataState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData must be used inside <DataProvider>');
  return v;
}
