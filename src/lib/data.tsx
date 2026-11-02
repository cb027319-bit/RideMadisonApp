// Shared app state: bike paths, places, live BCycle stations, rider location
// and the currently selected map item (so the Nearby tab can focus the map).

import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState, Linking } from 'react-native';

import { fetchBCycle, type BCycleStation } from './bcycle';
import { cached } from './cache';
import { t } from './i18n';
import { BCYCLE_REFRESH_MS, CACHE_TTL } from './config';
import { fetchFood, fetchPaths, fetchPlaces, type BikePath, type FoodKind, type Place } from './osm';
import { fetchParks, type Park } from './parks';
import { snapshotFirst } from './snapshot';
import { fetchPartners, type Partner } from './partners';
import { groupTrails, type Trail } from './trails';

export type Selection =
  | { type: 'station'; item: BCycleStation }
  | { type: 'place'; item: Place }
  | { type: 'trail'; item: Trail }
  | { type: 'partner'; item: Partner }
  | { type: 'park'; item: Park };

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export type LocationStatus = 'unknown' | 'granted' | 'denied';

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
  /** 'unknown' until the rider is asked (we only ask when a feature needs it). */
  locationStatus: LocationStatus;
  /** Same as locationStatus === 'denied'. */
  locationDenied: boolean;
  /**
   * Ask for location when a feature needs it: a one-line explanation first,
   * then the system prompt. Resolves true once location is on. Pass
   * { quiet: true } for automatic asks: they never repeat after "Not now".
   */
  requestLocation: (opts?: { quiet?: boolean }) => Promise<boolean>;
  /** Opens the phone's Settings for Ride Madison (to turn location back on). */
  openLocationSettings: () => void;
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
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('unknown');
  const [rawSelection, setSelection] = useState<Selection | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);

  const loadOsm = useCallback(async (force: boolean) => {
    // Places first: small and quick, so pins appear before the path network.
    const placesP = cached('places:v2', CACHE_TTL.places, snapshotFirst<Place>('places', fetchPlaces), { force })
      .then((r) => {
        setPlaces(r.value);
        setPlacesState('ready');
        if (r.stale) setOfflineCopy(true);
      })
      .catch((e: unknown) => {
        setPlacesState('error');
        setLastError(`Places: ${e instanceof Error ? e.message : String(e)}`);
      });
    const pathsP = cached('paths:v1', CACHE_TTL.paths, snapshotFirst<BikePath>('paths', fetchPaths), { force })
      .then((r) => {
        setPaths(r.value);
        setPathsState('ready');
        if (r.stale) setOfflineCopy(true);
      })
      .catch((e: unknown) => {
        setPathsState('error');
        setLastError(`Paths: ${e instanceof Error ? e.message : String(e)}`);
      });
    const parksP = cached('parks:v1', 30 * 24 * 3600 * 1000, snapshotFirst<Park>('parks', fetchParks), { force })
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
        cached(`${kind}:v2`, CACHE_TTL.places, snapshotFirst<Place>(kind, () => fetchFood(kind)), { force })
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

  // Rider location (foreground only). Never asked at launch: only when a
  // feature needs it. If it was already allowed, start quietly.
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const unmounted = useRef(false);
  const pendingAsk = useRef<Promise<boolean> | null>(null);
  const declinedThisLaunch = useRef(false);

  const startWatching = useCallback(async () => {
    if (watchRef.current || unmounted.current) return;
    setLocationStatus('granted');
    const last = await Location.getLastKnownPositionAsync().catch(() => null);
    if (last && !unmounted.current) setLocation({ latitude: last.coords.latitude, longitude: last.coords.longitude });
    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: 50 },
      (pos) => setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
    );
    if (unmounted.current || watchRef.current) sub.remove();
    else watchRef.current = sub;
  }, []);

  useEffect(() => {
    unmounted.current = false;
    Location.getForegroundPermissionsAsync()
      .then((p) => {
        if (p.granted) return startWatching();
        if (p.status === 'denied' && !p.canAskAgain) setLocationStatus('denied');
      })
      .catch(() => {});
    return () => {
      unmounted.current = true;
      watchRef.current?.remove();
      watchRef.current = null;
    };
  }, [startWatching]);

  // Coming back from Settings: pick up a change either way.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      Location.getForegroundPermissionsAsync()
        .then((p) => {
          if (p.granted) return startWatching();
          if (p.status === 'denied') {
            watchRef.current?.remove();
            watchRef.current = null;
            setLocationStatus((s) => (s === 'granted' || !p.canAskAgain ? 'denied' : s));
          }
        })
        .catch(() => {});
    });
    return () => sub.remove();
  }, [startWatching]);

  const openLocationSettings = useCallback(() => {
    void Linking.openSettings().catch(() => {});
  }, []);

  const requestLocation = useCallback(
    (opts?: { quiet?: boolean }): Promise<boolean> => {
      if (watchRef.current) return Promise.resolve(true);
      if (pendingAsk.current) return pendingAsk.current;
      const ask = (async () => {
        const current = await Location.getForegroundPermissionsAsync();
        if (current.granted) {
          await startWatching();
          return true;
        }
        if (!current.canAskAgain) {
          setLocationStatus('denied');
          if (!opts?.quiet) {
            Alert.alert(t('map.loc.offTitle'), t('map.loc.offBody'), [
              { text: t('common.notNow'), style: 'cancel' },
              { text: t('common.openSettings'), onPress: openLocationSettings },
            ]);
          }
          return false;
        }
        if (opts?.quiet && declinedThisLaunch.current) return false;
        const go = await new Promise<boolean>((resolve) => {
          Alert.alert(
            t('map.loc.askTitle'),
            t('map.loc.askBody'),
            [
              { text: t('common.notNow'), style: 'cancel', onPress: () => resolve(false) },
              { text: t('common.continue'), onPress: () => resolve(true) },
            ],
            { cancelable: true, onDismiss: () => resolve(false) },
          );
        });
        if (!go) {
          declinedThisLaunch.current = true;
          return false;
        }
        const { granted } = await Location.requestForegroundPermissionsAsync();
        if (!granted) {
          setLocationStatus('denied');
          return false;
        }
        await startWatching();
        return true;
      })()
        .catch(() => false)
        .finally(() => {
          pendingAsk.current = null;
        });
      pendingAsk.current = ask;
      return ask;
    },
    [startWatching, openLocationSettings],
  );

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
      offlineCopy, lastError, location, locationStatus, locationDenied: locationStatus === 'denied', requestLocation, openLocationSettings,
      selection, select: setSelection,
      focusRequest, focus, refreshAll, refreshStations,
    }),
    [paths, trails, trailOfPath, trailById, pathById, places, foodState, foodError, loadFood, partners, parks, stations, pathsState, placesState, stationsState, stationsUpdatedAt,
      offlineCopy, lastError, location, locationStatus, requestLocation, openLocationSettings, selection, focusRequest, focus, refreshAll, refreshStations],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DataState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData must be used inside <DataProvider>');
  return v;
}
