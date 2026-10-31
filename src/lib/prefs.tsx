// Rider preferences from the two-question onboarding ("What do you ride?" and
// "How comfortable are you in traffic?"). Route defaults follow from them.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { RouteProfile } from './routing';

export type BikeType = 'bike' | 'ebike' | 'road' | 'gravel';
export type Comfort = 'paths' | 'some' | 'confident';

export interface Prefs {
  bike: BikeType;
  comfort: Comfort;
}

export const BIKE_OPTIONS: { id: BikeType; label: string; icon: string }[] = [
  { id: 'bike', label: 'Everyday bike', icon: 'bicycle' },
  { id: 'ebike', label: 'E-bike', icon: 'flash' },
  { id: 'road', label: 'Road bike', icon: 'speedometer' },
  { id: 'gravel', label: 'Gravel / mountain', icon: 'trail-sign' },
];

export const COMFORT_OPTIONS: { id: Comfort; label: string; detail: string; profile: RouteProfile }[] = [
  { id: 'paths', label: 'Paths and quiet streets', detail: 'Keep me away from traffic', profile: 'quiet' },
  { id: 'some', label: 'Some traffic is OK', detail: 'Bike lanes on busier streets are fine', profile: 'balanced' },
  { id: 'confident', label: 'Confident in traffic', detail: 'Take the most direct way', profile: 'fast' },
];

export const profileFor = (c: Comfort): RouteProfile => COMFORT_OPTIONS.find((o) => o.id === c)?.profile ?? 'quiet';

interface PrefsState {
  prefs: Prefs | null;
  /** False until saved prefs have been read from the phone. */
  loaded: boolean;
  setPrefs: (p: Prefs) => void;
}

const KEY = 'prefs:v1';
const Ctx = createContext<PrefsState | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<Prefs | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (raw) setPrefsState(JSON.parse(raw) as Prefs);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const setPrefs = useCallback((p: Prefs) => {
    setPrefsState(p);
    AsyncStorage.setItem(KEY, JSON.stringify(p)).catch(() => {});
  }, []);

  const value = useMemo(() => ({ prefs, loaded, setPrefs }), [prefs, loaded, setPrefs]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs(): PrefsState {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePrefs must be used inside <PrefsProvider>');
  return v;
}
