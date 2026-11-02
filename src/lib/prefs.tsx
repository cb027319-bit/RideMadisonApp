// Rider preferences from the short onboarding ("What do you ride?" and
// "How comfortable are you in traffic?"). Route defaults follow from them.
// Options and pure helpers live in ./rider.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { Prefs } from './rider';

export {
  BIKE_OPTIONS, COMFORT_OPTIONS, EBIKE_CLASS_OPTIONS, isEbikeRider, prefsSummary, profileFor,
  type BikeType, type Comfort, type EbikeClass, type Prefs, type Tr,
} from './rider';

interface PrefsState {
  prefs: Prefs | null;
  /** False until saved prefs (and the skip flag) have been read from the phone. */
  loaded: boolean;
  /** The rider chose "Skip for now" on the first-run questions; don't ask again. */
  skipped: boolean;
  setPrefs: (p: Prefs) => void;
  skipPrefs: () => void;
  /** "Share anonymous usage stats" (More tab). On unless the rider turned it off. */
  shareUsage: boolean;
  setShareUsage: (on: boolean) => void;
}

const KEY = 'prefs:v1';
const SKIP_KEY = 'prefsSkipped:v1';
const USAGE_KEY = 'shareUsage:v1';
const Ctx = createContext<PrefsState | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<Prefs | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [shareUsage, setShareUsageState] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.multiGet([KEY, SKIP_KEY, USAGE_KEY])
      .then((pairs) => {
        const raw = pairs[0]?.[1];
        if (raw) setPrefsState(JSON.parse(raw) as Prefs);
        if (pairs[1]?.[1]) setSkipped(true);
        if (pairs[2]?.[1] === '0') setShareUsageState(false);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const setPrefs = useCallback((p: Prefs) => {
    setPrefsState(p);
    AsyncStorage.setItem(KEY, JSON.stringify(p)).catch(() => {});
  }, []);

  const skipPrefs = useCallback(() => {
    setSkipped(true);
    AsyncStorage.setItem(SKIP_KEY, '1').catch(() => {});
  }, []);

  const setShareUsage = useCallback((on: boolean) => {
    setShareUsageState(on);
    AsyncStorage.setItem(USAGE_KEY, on ? '1' : '0').catch(() => {});
  }, []);

  const value = useMemo(
    () => ({ prefs, loaded, skipped, setPrefs, skipPrefs, shareUsage, setShareUsage }),
    [prefs, loaded, skipped, setPrefs, skipPrefs, shareUsage, setShareUsage],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs(): PrefsState {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePrefs must be used inside <PrefsProvider>');
  return v;
}
