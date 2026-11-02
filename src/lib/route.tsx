// Route planner state, shared so "Route here" on the Map tab can hand a
// destination to the Route tab. Recalculates automatically (debounced) when
// stops or options change, and keeps saved rides on the phone.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useAuth } from './auth';
import { useData } from './data';
import { profileFor, usePrefs } from './prefs';
import { simplify, type LonLat } from './geo';
import { t, translate } from './i18n';
import { insertIndex, planKey, savedStartsAtMe, thinResult, trimEnds, withBikeTime } from './planner';
import { supabase } from './supabase';
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
  /** Identifies the plan it was saved from (to avoid saving it twice). */
  planKey?: string;
  /** Saved from my location with "Hide my start" on: `stops` has no start; reopen from my location. */
  startHidden?: boolean;
}

export interface PlanInput {
  stops: Omit<Stop, 'id'>[];
  profile: RouteProfile;
  roundTrip: boolean;
  result?: RouteResult;
  /** Shown as the ride's name (saving, GPX). */
  name?: string;
  /** Start from the rider's location (the ride's own result is then re-routed). */
  fromMe?: boolean;
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
  /** Set when saved rides couldn't be loaded (e.g. offline). */
  savedError: string | null;
  reloadSaved: () => void;
  /** Id of the saved ride matching the current plan, if it's already saved. */
  savedId: string | null;
  /** Name of the loaded saved or suggested ride, while it's unchanged. */
  planName: string | null;
  /** True while the route style is the one picked during onboarding. */
  profileFromPrefs: boolean;
  /** Hide the first ~200 m (and the last ~200 m of loops) when saving or sharing a ride that starts at my location. */
  hideStart: boolean;
  /** The plan has no start yet: ask "Starting from?" and don't offer Start. */
  needsStart: boolean;
  /** Set when "Ride there" replaced a plan; `undoReplace` brings it back. */
  replaced: { id: number } | null;
  undoReplace: () => void;
  /** Puts a removed stop back where it was (Undo). */
  restoreStop: (stop: Stop, index: number) => void;
  setHideStart: (v: boolean) => void;
  /** Bumped whenever a stop is added from outside the Route tab. */
  focusRequest: number;
  /** Bumped when another screen's "Where to?" bar wants the search box focused. */
  searchRequest: number;
  requestSearch: () => void;
  /** Adds a stop (before the destination once there is one); returns its id. */
  addStop: (p: LatLon, label?: string) => string;
  /** Sets where the ride starts (when not starting from my location). */
  setStart: (p: LatLon, label: string) => void;
  routeTo: (p: LatLon, label: string) => void;
  moveStop: (id: string, p: LatLon) => void;
  removeStop: (id: string) => void;
  shiftStop: (id: string, delta: -1 | 1) => void;
  setStartFromMe: (v: boolean) => void;
  setProfile: (p: RouteProfile) => void;
  setRoundTrip: (v: boolean) => void;
  clear: () => void;
  retry: () => void;
  /** Saves the current plan; resolves to the saved ride (the existing one if already saved). */
  saveRide: (name: string) => Promise<SavedRide | null>;
  loadRide: (ride: SavedRide) => void;
  /** Load a suggested ride (or any plan) into the planner. */
  loadPlan: (plan: PlanInput) => void;
  /** The current plan's start (for GPX), with "hide my start" applied. */
  shareable: () => { result: RouteResult; points: (LatLon & { label: string })[] } | null;
  deleteRide: (id: string) => Promise<void>;
}

/** Everything "Undo" needs to bring back a replaced plan. */
interface Snapshot {
  stops: Stop[];
  startFromMe: boolean;
  profileChoice: RouteProfile | null;
  roundTrip: boolean;
  pinned: { key: string; result: RouteResult } | null;
  loadedFrom: { id: string | null; name: string; key: string } | null;
  pendingMe: boolean;
  fallback: { key: string; result: RouteResult } | null;
}

const Ctx = createContext<RouteState | null>(null);
const SAVED_KEY = 'savedRides:v1';
let nextId = 1;
const newId = () => `s${Date.now().toString(36)}${nextId++}`;

/** Router input key; my location is rounded (~100 m) so small GPS moves don't re-route. */
const waypointKey = (pts: LatLon[], me: boolean) =>
  pts.map((p) => `${p.latitude.toFixed(me ? 3 : 5)},${p.longitude.toFixed(me ? 3 : 5)}`).join('|');

const stopsKey = (stops: LatLon[], profile: RouteProfile, roundTrip: boolean) => `${planKey(stops, profile)}:${roundTrip ? 'rt' : ''}`;

/** Keep saved lines light (~2 m tolerance) so many rides fit on the phone. */
function lighten(r: RouteResult): RouteResult {
  const line: LonLat[] = r.coords.map((c) => [c.longitude, c.latitude]);
  const indexOf = new Map(line.map((c, i) => [c, i] as const));
  const keep = new Set(simplify(line, 0.00002).map((c) => indexOf.get(c)!));
  return thinResult(r, (i) => keep.has(i));
}

const savedErrorText = () => t('route.err.savedLoad');

/** True for the placeholder label of a pin with no place name yet (in either language). */
export function isDroppedPin(label: string | undefined): boolean {
  return !!label && (label === translate('en', 'route.droppedPin') || label === translate('es', 'route.droppedPin'));
}

export function RouteProvider({ children }: { children: ReactNode }) {
  const { location, locationStatus, requestLocation } = useData();
  const { prefs } = usePrefs();
  const { configured: accounts, session } = useAuth();
  const userId = session?.user.id;
  const [stops, setStops] = useState<Stop[]>([]);
  const [startFromMe, setStartFromMe] = useState(true);
  // Default comes from onboarding ("how comfortable in traffic"); a choice made
  // in the planner overrides it.
  const [profileChoice, setProfile] = useState<RouteProfile | null>(null);
  const profile: RouteProfile = profileChoice ?? (prefs ? profileFor(prefs.comfort) : 'quiet');
  const profileFromPrefs = profileChoice == null && prefs != null;
  const [searchRequest, setSearchRequest] = useState(0);
  const [roundTrip, setRoundTrip] = useState(false);
  const [result, setResult] = useState<RouteResult | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [savedRides, setSavedRides] = useState<SavedRide[]>([]);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [savedReload, setSavedReload] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [hideStart, setHideStart] = useState(true);
  /** A route we already have for a plan (saved or suggested ride): no refetch while unchanged. */
  const [pinned, setPinned] = useState<{ key: string; result: RouteResult } | null>(null);
  /** The saved or suggested ride the plan came from. */
  const [loadedFrom, setLoadedFrom] = useState<{ id: string | null; name: string; key: string } | null>(null);
  /** A saved ride whose start was hidden: it starts from my location once we have it. */
  const [pendingMe, setPendingMe] = useState(false);
  /** The stored line of such a ride, used if re-routing from my location fails (offline). */
  const [fallback, setFallback] = useState<{ key: string; result: RouteResult } | null>(null);
  /** The plan "Ride there" replaced, for Undo. */
  const [replaced, setReplaced] = useState<{ id: number; snapshot: Snapshot } | null>(null);

  // Saved rides: in your account when accounts are on, otherwise on this phone.
  useEffect(() => {
    let cancelled = false;
    if (accounts && supabase) {
      if (!userId) {
        const t = setTimeout(() => setSavedRides([]), 0);
        return () => clearTimeout(t);
      }
      supabase
        .from('saved_rides')
        .select('id, name, ride, created_at')
        .order('created_at', { ascending: false })
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error || !data) {
            setSavedError(savedErrorText());
            return;
          }
          setSavedError(null);
          setSavedRides(
            data.map((row) => ({
              ...(row.ride as Omit<SavedRide, 'id' | 'name' | 'createdAt'>),
              id: row.id as string,
              name: row.name as string,
              createdAt: new Date(row.created_at as string).getTime(),
            })),
          );
        }, () => {
          if (!cancelled) setSavedError(savedErrorText());
        });
      return () => {
        cancelled = true;
      };
    }
    AsyncStorage.getItem(SAVED_KEY)
      .then((raw) => {
        if (cancelled) return;
        setSavedError(null);
        if (raw) setSavedRides(JSON.parse(raw) as SavedRide[]);
      })
      .catch(() => {
        if (!cancelled) setSavedError(savedErrorText());
      });
    return () => {
      cancelled = true;
    };
  }, [accounts, userId, savedReload]);

  const usingMyLocation = startFromMe && location != null;
  /** A reopened ride with a hidden start and no location yet: wait for a start. */
  const awaitingStart = pendingMe && !usingMyLocation && stops.length > 0;
  const needsStart = awaitingStart || (!usingMyLocation && stops.length === 1);

  // First need for location: a ride that starts "from my location" has a stop.
  const needsLocation = startFromMe && stops.length > 0 && locationStatus === 'unknown';
  useEffect(() => {
    if (needsLocation) void requestLocation({ quiet: true });
  }, [needsLocation, requestLocation]);

  const waypoints = useMemo<LatLon[]>(() => {
    const pts: LatLon[] = [];
    if (awaitingStart) return pts;
    if (usingMyLocation && location) pts.push(location);
    for (const s of stops) pts.push({ latitude: s.latitude, longitude: s.longitude });
    if (roundTrip && pts.length >= 2) pts.push(pts[0]);
    return pts;
  }, [awaitingStart, usingMyLocation, location, stops, roundTrip]);

  // Location updates every ~50 m; only re-route when the start moves ~150 m.
  const routerKey = useMemo(() => `${waypointKey(waypoints, usingMyLocation)}:${profile}`, [waypoints, profile, usingMyLocation]);
  const key = `${routerKey}:${retryCount}`;
  const currentStopsKey = stopsKey(stops, profile, roundTrip);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (pinned && pinned.key === routerKey) {
        // A saved or suggested ride we already have: works offline.
        setResult(pinned.result);
        setStatus('ready');
        setError(null);
        return;
      }
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
        if (fallback && fallback.key === currentStopsKey) {
          // Offline: use the ride's stored line (the rider is guided to its start).
          setResult(fallback.result);
          setStatus('ready');
          setError(null);
          return;
        }
        setStatus('error');
        setError(e instanceof Error ? e.message : t('route.err.routingFailed'));
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

  /** A plan built from nothing goes back to the rider's own style and start. */
  const freshPlan = useCallback(() => {
    setProfile(null);
    setPinned(null);
    setLoadedFrom(null);
    setPendingMe(false);
    setFallback(null);
  }, []);

  const addStop = useCallback(
    (p: LatLon, label?: string) => {
      if (stops.length === 0) freshPlan();
      const id = newId();
      const stop = { id, latitude: p.latitude, longitude: p.longitude, label: label ?? t('route.droppedPin') };
      setStops((ss) => {
        const at = insertIndex(ss.length, roundTrip);
        return [...ss.slice(0, at), stop, ...ss.slice(at)];
      });
      if (!label) labelLater(id, p);
      return id;
    },
    [labelLater, roundTrip, stops.length, freshPlan],
  );

  const setStart = useCallback(
    (p: LatLon, label: string) => {
      if (stops.length === 0) freshPlan();
      setPendingMe(false);
      setStartFromMe(false);
      setStops((ss) => [{ id: newId(), latitude: p.latitude, longitude: p.longitude, label }, ...ss]);
    },
    [stops.length, freshPlan],
  );

  /**
   * From the Map or Events tab: plan a fresh route from the rider to this
   * place, in the rider's own style. A plan already in progress is kept for Undo.
   */
  const routeTo = useCallback(
    (p: LatLon, label: string) => {
      const same = stops.length === 1 && startFromMe && !roundTrip && planKey(stops, 'quiet') === planKey([p], 'quiet');
      setReplaced(
        stops.length > 0 && !same
          ? {
            id: Date.now(),
            snapshot: { stops, startFromMe, profileChoice, roundTrip, pinned, loadedFrom, pendingMe, fallback },
          }
          : null,
      );
      freshPlan();
      setStops([{ id: newId(), latitude: p.latitude, longitude: p.longitude, label }]);
      setStartFromMe(true);
      setRoundTrip(false);
      setFocusRequest((n) => n + 1);
    },
    [stops, startFromMe, profileChoice, roundTrip, pinned, loadedFrom, pendingMe, fallback, freshPlan],
  );

  const undoReplace = useCallback(() => {
    if (!replaced) return;
    const s = replaced.snapshot;
    setStops(s.stops);
    setStartFromMe(s.startFromMe);
    setProfile(s.profileChoice);
    setRoundTrip(s.roundTrip);
    setPinned(s.pinned);
    setLoadedFrom(s.loadedFrom);
    setPendingMe(s.pendingMe);
    setFallback(s.fallback);
    setReplaced(null);
    setFocusRequest((n) => n + 1);
  }, [replaced]);

  const restoreStop = useCallback((stop: Stop, index: number) => {
    setStops((ss) => (ss.some((s) => s.id === stop.id) ? ss : [...ss.slice(0, index), stop, ...ss.slice(index)]));
  }, []);

  const moveStop = useCallback(
    (id: string, p: LatLon) => {
      setStops((ss) => ss.map((s) => (s.id === id ? { ...s, ...p, label: t('route.droppedPin') } : s)));
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
    setStartFromMe(true);
    freshPlan();
    setReplaced(null);
  }, [freshPlan]);

  const persist = useCallback(async (rides: SavedRide[]) => {
    setSavedRides(rides);
    try {
      await AsyncStorage.setItem(SAVED_KEY, JSON.stringify(rides));
    } catch {
      // Storage full: the ride stays in memory for this session.
    }
  }, []);

  const hidingStart = usingMyLocation && hideStart;
  const currentPlanKey = planKey(waypoints, profile, hidingStart);
  const fromLoaded = loadedFrom && loadedFrom.key === currentStopsKey ? loadedFrom : null;
  const savedId = fromLoaded?.id ?? savedRides.find((r) => r.planKey === currentPlanKey)?.id ?? null;
  const planName = fromLoaded?.name ?? null;

  /** The current route with "hide my start" applied when it begins at my location (both ends of a loop). */
  const privateResult = useCallback((): RouteResult | null => {
    if (!result) return null;
    return hidingStart ? trimEnds(result) : result;
  }, [result, hidingStart]);

  const shareable = useCallback(() => {
    const r = privateResult();
    if (!r) return null;
    const points = [
      ...(usingMyLocation && location && !hideStart ? [{ ...location, label: t('route.start') }] : []),
      ...stops.map(({ latitude, longitude, label }) => ({ latitude, longitude, label })),
    ];
    return { result: r, points };
  }, [privateResult, usingMyLocation, location, hideStart, stops]);

  const saveRide = useCallback(
    async (name: string): Promise<SavedRide | null> => {
      const r = privateResult();
      if (!r) return null;
      const existing = savedId ? savedRides.find((x) => x.id === savedId) : undefined;
      if (existing) return existing;
      const allStops: Stop[] = [
        ...(usingMyLocation && location && !hideStart ? [{ id: newId(), ...location, label: t('route.start') }] : []),
        ...stops,
      ];
      const ride: SavedRide = {
        id: newId(),
        name: name.trim() || t('route.myRide'),
        createdAt: Date.now(),
        profile,
        roundTrip,
        stops: allStops,
        result: lighten(r),
        planKey: currentPlanKey,
        ...(hidingStart ? { startHidden: true } : {}),
      };
      if (accounts && supabase && userId) {
        const { id: _localId, name: rideName, createdAt: _c, ...rest } = ride;
        const { data, error } = await supabase
          .from('saved_rides')
          .insert({ name: rideName, ride: rest })
          .select('id, created_at')
          .single();
        if (error) throw new Error(t('route.err.save'));
        const saved = { ...ride, id: data.id as string, createdAt: new Date(data.created_at as string).getTime() };
        setSavedRides((rs) => [saved, ...rs]);
        setLoadedFrom({ id: saved.id, name: saved.name, key: currentStopsKey });
        return saved;
      }
      await persist([ride, ...savedRides]);
      setLoadedFrom({ id: ride.id, name: ride.name, key: currentStopsKey });
      return ride;
    },
    [privateResult, savedId, savedRides, usingMyLocation, location, hideStart, hidingStart, stops, profile, roundTrip, currentPlanKey,
      currentStopsKey, persist, accounts, userId],
  );

  const loadRide = useCallback((ride: SavedRide) => {
    const loaded = ride.stops.map((st) => ({ ...st, id: newId() }));
    const loadedKey = stopsKey(loaded, ride.profile, ride.roundTrip);
    // The ride's style applies to this ride only (clear/routeTo/new plans go back to the rider's).
    setProfile(ride.profile);
    setRoundTrip(ride.roundTrip);
    setStops(loaded);
    setReplaced(null);
    if (savedStartsAtMe(ride)) {
      // Saved with "Hide my start": start from where the rider is now. Until we
      // know that, the planner asks for a start and offers no Start button.
      setStartFromMe(true);
      setPendingMe(true);
      setPinned(null);
      setFallback({ key: loadedKey, result: ride.result });
    } else {
      const pts: LatLon[] = loaded.map(({ latitude, longitude }) => ({ latitude, longitude }));
      if (ride.roundTrip && pts.length >= 2) pts.push(pts[0]);
      setStartFromMe(false);
      setPendingMe(false);
      setFallback(null);
      setResult(ride.result);
      setStatus('ready');
      setError(null);
      setPinned({ key: `${waypointKey(pts, false)}:${ride.profile}`, result: ride.result });
    }
    setLoadedFrom({ id: ride.id, name: ride.name, key: loadedKey });
    setFocusRequest((n) => n + 1);
  }, []);

  const loadPlan = useCallback((plan: PlanInput) => {
    const loaded = plan.stops.map((st) => ({ ...st, id: newId() }));
    const fromMe = !!plan.fromMe;
    setStartFromMe(fromMe);
    setPendingMe(false);
    setFallback(null);
    setReplaced(null);
    setProfile(plan.profile);
    setRoundTrip(plan.roundTrip);
    setStops(loaded);
    if (!fromMe && plan.result) {
      const pts: LatLon[] = loaded.map(({ latitude, longitude }) => ({ latitude, longitude }));
      if (plan.roundTrip && pts.length >= 2) pts.push(pts[0]);
      setResult(plan.result);
      setStatus('ready');
      setError(null);
      setPinned({ key: `${waypointKey(pts, false)}:${plan.profile}`, result: plan.result });
    } else {
      setResult(null);
      setPinned(null);
    }
    setLoadedFrom(plan.name ? { id: null, name: plan.name, key: stopsKey(loaded, plan.profile, plan.roundTrip) } : null);
    setFocusRequest((n) => n + 1);
  }, []);

  const deleteRide = useCallback(
    async (id: string) => {
      if (accounts && supabase && userId) {
        const before = savedRides;
        setSavedRides((rs) => rs.filter((r) => r.id !== id));
        const { error } = await supabase.from('saved_rides').delete().eq('id', id);
        if (error) {
          setSavedRides(before);
          throw new Error(t('route.err.delete'));
        }
        return;
      }
      await persist(savedRides.filter((r) => r.id !== id));
    },
    [savedRides, persist, accounts, userId],
  );

  const retry = useCallback(() => setRetryCount((n) => n + 1), []);
  const reloadSaved = useCallback(() => setSavedReload((n) => n + 1), []);
  const requestSearch = useCallback(() => setSearchRequest((n) => n + 1), []);

  // Times shown and handed to Navigate/Preview follow the rider's bike (e-bikes ~15 mph).
  const bike = prefs?.bike;
  const shownResult = useMemo(() => (result ? withBikeTime(result, bike) : null), [result, bike]);
  const replacedInfo = useMemo(() => (replaced ? { id: replaced.id } : null), [replaced]);

  const value = useMemo<RouteState>(
    () => ({
      stops, startFromMe, usingMyLocation, profile, roundTrip, result: shownResult, status, error, waypoints, savedRides, savedError,
      reloadSaved, savedId, planName, profileFromPrefs, hideStart, setHideStart, needsStart, replaced: replacedInfo, undoReplace, restoreStop,
      focusRequest, searchRequest, requestSearch, addStop, setStart, routeTo, moveStop, removeStop, shiftStop, setStartFromMe, setProfile,
      setRoundTrip, clear, retry, saveRide, loadRide, loadPlan, shareable, deleteRide,
    }),
    [stops, startFromMe, usingMyLocation, profile, roundTrip, shownResult, status, error, waypoints, savedRides, savedError, reloadSaved,
      savedId, planName, profileFromPrefs, hideStart, needsStart, replacedInfo, undoReplace, restoreStop,
      focusRequest, searchRequest, requestSearch, addStop, setStart, routeTo, moveStop, removeStop, shiftStop, clear, retry, saveRide,
      loadRide, loadPlan, shareable, deleteRide],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRoute(): RouteState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRoute must be used inside <RouteProvider>');
  return v;
}
