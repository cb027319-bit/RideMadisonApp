// Route planner state, shared so "Route here" on the Map tab can hand a
// destination to the Route tab. Recalculates automatically (debounced) when
// stops or options change, and keeps saved rides on the phone.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useData } from './data';
import { profileFor, usePrefs } from './prefs';
import { simplify, type LonLat } from './geo';
import { fetchRoute, reverseLabel, type LatLon, type RouteProfile, type RouteResult } from './routing';

export interface Stop extends LatLon {
  id: string;
  label: string;
}

export interface SavedRide {
  id: string;
  name: string;
  createdAt: number;
  profile: RouteProfile;
  roundTrip: boolean;
  /** All points including the start, as planned. */
  stops: Stop[];
  result: RouteResult;
}

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface RouteState {
  stops: Stop[];
  startFromMe: boolean;
  /** True when the route actually begins at the rider's location. */
  usingMyLocation: boolean;
  profile: RouteProfile;
  roundTrip: boolean;
  result: RouteResult | null;
  status: Status;
  error: string | null;
  /** All points sent to the router, in order. */
  waypoints: LatLon[];
  savedRides: SavedRide[];
  /** Bumped whenever a stop is added from outside the Route tab. */
  focusRequest: number;
  /** Bumped when another screen's "Where to?" bar wants the search box focused. */
  searchRequest: number;
  requestSearch: () => void;
  addStop: (p: LatLon, label?: string) => void;
  routeTo: (p: LatLon, label: string) => void;
  moveStop: (id: string, p: LatLon) => void;
  removeStop: (id: string) => void;
  shiftStop: (id: string, delta: -1 | 1) => void;
  setStartFromMe: (v: boolean) => void;
  setProfile: (p: RouteProfile) => void;
  setRoundTrip: (v: boolean) => void;
  clear: () => void;
  retry: () => void;
  saveRide: (name: string) => Promise<void>;
  loadRide: (ride: SavedRide) => void;
  deleteRide: (id: string) => Promise<void>;
}

const Ctx = createContext<RouteState | null>(null);
const SAVED_KEY = 'savedRides:v1';
let nextId = 1;
const newId = () => `s${Date.now().toString(36)}${nextId++}`;

export function RouteProvider({ children }: { children: ReactNode }) {
  const { location } = useData();
  const { prefs } = usePrefs();
  const [stops, setStops] = useState<Stop[]>([]);
  const [startFromMe, setStartFromMe] = useState(true);
  // Default comes from onboarding ("how comfortable in traffic"); a choice made
  // in the planner overrides it.
  const [profileChoice, setProfile] = useState<RouteProfile | null>(null);
  const profile: RouteProfile = profileChoice ?? (prefs ? profileFor(prefs.comfort) : 'quiet');
  const [searchRequest, setSearchRequest] = useState(0);
  const [roundTrip, setRoundTrip] = useState(false);
  const [result, setResult] = useState<RouteResult | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [savedRides, setSavedRides] = useState<SavedRide[]>([]);
  const [focusRequest, setFocusRequest] = useState(0);
  const [retryCount, setRetryCount] = useState(0);

  // Load saved rides once.
  useEffect(() => {
    AsyncStorage.getItem(SAVED_KEY)
      .then((raw) => {
        if (raw) setSavedRides(JSON.parse(raw) as SavedRide[]);
      })
      .catch(() => {});
  }, []);

  const usingMyLocation = startFromMe && location != null;

  const waypoints = useMemo<LatLon[]>(() => {
    const pts: LatLon[] = [];
    if (usingMyLocation && location) pts.push(location);
    for (const s of stops) pts.push({ latitude: s.latitude, longitude: s.longitude });
    if (roundTrip && pts.length >= 2) pts.push(pts[0]);
    return pts;
  }, [usingMyLocation, location, stops, roundTrip]);

  // Location updates every ~50 m; only re-route when the start moves ~150 m.
  const key = useMemo(
    () =>
      waypoints.map((p) => `${p.latitude.toFixed(usingMyLocation ? 3 : 5)},${p.longitude.toFixed(usingMyLocation ? 3 : 5)}`).join('|') +
      `:${profile}:${retryCount}`,
    [waypoints, profile, usingMyLocation, retryCount],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (waypoints.length < 2) {
        setResult(null);
        setStatus('idle');
        setError(null);
        return;
      }
      setStatus('loading');
      setError(null);
      try {
        const r = await fetchRoute(waypoints, profile, controller.signal);
        setResult(r);
        setStatus('ready');
      } catch (e) {
        if (controller.signal.aborted) return;
        setStatus('error');
        setError(e instanceof Error ? e.message : 'Routing failed');
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const labelLater = useCallback((id: string, p: LatLon) => {
    void reverseLabel(p).then((label) => {
      if (label) setStops((ss) => ss.map((s) => (s.id === id ? { ...s, label } : s)));
    });
  }, []);

  const addStop = useCallback(
    (p: LatLon, label?: string) => {
      const id = newId();
      setStops((ss) => [...ss, { id, latitude: p.latitude, longitude: p.longitude, label: label ?? 'Dropped pin' }]);
      if (!label) labelLater(id, p);
    },
    [labelLater],
  );

  /** From the Map tab: plan a fresh route from the rider to this place. */
  const routeTo = useCallback((p: LatLon, label: string) => {
    setStops([{ id: newId(), latitude: p.latitude, longitude: p.longitude, label }]);
    setStartFromMe(true);
    setRoundTrip(false);
    setFocusRequest((n) => n + 1);
  }, []);

  const moveStop = useCallback(
    (id: string, p: LatLon) => {
      setStops((ss) => ss.map((s) => (s.id === id ? { ...s, ...p, label: 'Dropped pin' } : s)));
      labelLater(id, p);
    },
    [labelLater],
  );

  const removeStop = useCallback((id: string) => setStops((ss) => ss.filter((s) => s.id !== id)), []);

  const shiftStop = useCallback((id: string, delta: -1 | 1) => {
    setStops((ss) => {
      const i = ss.findIndex((s) => s.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= ss.length) return ss;
      const copy = [...ss];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }, []);

  const clear = useCallback(() => {
    setStops([]);
    setRoundTrip(false);
  }, []);

  const persist = useCallback(async (rides: SavedRide[]) => {
    setSavedRides(rides);
    try {
      await AsyncStorage.setItem(SAVED_KEY, JSON.stringify(rides));
    } catch {
      // Storage full: the ride stays in memory for this session.
    }
  }, []);

  const saveRide = useCallback(
    async (name: string) => {
      if (!result) return;
      // Store a lighter line (~2 m tolerance) to keep many rides on the phone.
      const line: LonLat[] = result.coords.map((c) => [c.longitude, c.latitude]);
      const indexOf = new Map(line.map((c, i) => [c, i] as const));
      const keepIdx = new Set(simplify(line, 0.00002).map((c) => indexOf.get(c)!));
      const coords = result.coords.filter((_, i) => keepIdx.has(i));
      const elevations = result.elevations.filter((_, i) => keepIdx.has(i));
      const allStops: Stop[] = [
        ...(usingMyLocation && location ? [{ id: newId(), ...location, label: 'Start' }] : []),
        ...stops,
      ];
      const ride: SavedRide = {
        id: newId(),
        name: name.trim() || 'My ride',
        createdAt: Date.now(),
        profile,
        roundTrip,
        stops: allStops,
        result: { ...result, coords, elevations },
      };
      await persist([ride, ...savedRides]);
    },
    [result, usingMyLocation, location, stops, profile, roundTrip, savedRides, persist],
  );

  const loadRide = useCallback((ride: SavedRide) => {
    setStartFromMe(false);
    setProfile(ride.profile);
    setRoundTrip(ride.roundTrip);
    setStops(ride.stops.map((s) => ({ ...s, id: newId() })));
    setResult(ride.result);
    setFocusRequest((n) => n + 1);
  }, []);

  const deleteRide = useCallback(
    async (id: string) => persist(savedRides.filter((r) => r.id !== id)),
    [savedRides, persist],
  );

  const retry = useCallback(() => setRetryCount((n) => n + 1), []);
  const requestSearch = useCallback(() => setSearchRequest((n) => n + 1), []);

  const value = useMemo<RouteState>(
    () => ({
      stops, startFromMe, usingMyLocation, profile, roundTrip, result, status, error, waypoints, savedRides,
      focusRequest, searchRequest, requestSearch, addStop, routeTo, moveStop, removeStop, shiftStop, setStartFromMe, setProfile, setRoundTrip,
      clear, retry, saveRide, loadRide, deleteRide,
    }),
    [stops, startFromMe, usingMyLocation, profile, roundTrip, result, status, error, waypoints, savedRides,
      focusRequest, searchRequest, requestSearch, addStop, routeTo, moveStop, removeStop, shiftStop, clear, retry, saveRide, loadRide, deleteRide],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRoute(): RouteState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRoute must be used inside <RouteProvider>');
  return v;
}
