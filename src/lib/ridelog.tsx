// The rider's ride log: every ride finished with turn-by-turn navigation.
// Signed in: stored in Supabase (ride_logs) so stats follow the rider to a new
// phone. Signed out: kept on this phone and uploaded once they sign in.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useAuth } from './auth';
import { t } from './i18n';
import { localizeBadge, newlyEarned, type Badge, type RideLog } from './stats';
import { accountsConfigured, supabase } from './supabase';

const LOCAL_KEY = 'ridelog:local:v1';

interface RideLogState {
  logs: RideLog[];
  loading: boolean;
  /** Record a finished ride. Returns badges this ride just earned (names in the rider's language). */
  addRide: (log: Omit<RideLog, 'id'>) => Promise<Badge[]>;
}

const Ctx = createContext<RideLogState | null>(null);

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

interface Row {
  id: string;
  started_at: string;
  distance_m: number;
  moving_s: number;
  elapsed_s: number;
  climb_m: number;
  max_speed_mps: number;
  title: string;
  ride_id: string | null;
}

const fromRow = (r: Row): RideLog => ({
  id: r.id,
  startedAt: new Date(r.started_at).getTime(),
  distanceM: r.distance_m,
  movingS: r.moving_s,
  elapsedS: r.elapsed_s,
  climbM: r.climb_m,
  maxSpeedMps: r.max_speed_mps,
  title: r.title,
  rideId: r.ride_id,
});

const toRow = (l: Omit<RideLog, 'id'>) => ({
  started_at: new Date(l.startedAt).toISOString(),
  distance_m: Math.round(l.distanceM),
  moving_s: Math.round(l.movingS),
  elapsed_s: Math.round(l.elapsedS),
  climb_m: Math.round(l.climbM),
  max_speed_mps: Math.min(29, Math.round(l.maxSpeedMps * 10) / 10),
  title: l.title.slice(0, 120),
  ride_id: l.rideId ?? null,
});

async function readLocal(): Promise<RideLog[]> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as RideLog[]) : [];
  } catch {
    return [];
  }
}

const writeLocal = (logs: RideLog[]) => AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(logs)).catch(() => {});

export function RideLogProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const userId = auth.session?.user.id ?? null;
  const [logs, setLogs] = useState<RideLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Load: from Supabase when signed in (uploading any rides logged while signed out), else local.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = await readLocal();
      if (accountsConfigured && supabase && userId) {
        if (local.length) {
          const { error } = await supabase.from('ride_logs').insert(local.map(toRow));
          if (!error) await AsyncStorage.removeItem(LOCAL_KEY).catch(() => {});
        }
        const { data, error } = await supabase
          .from('ride_logs')
          .select('id, started_at, distance_m, moving_s, elapsed_s, climb_m, max_speed_mps, title, ride_id')
          .order('started_at', { ascending: false })
          .limit(2000);
        if (cancelled) return;
        setLogs(error || !data ? local : (data as Row[]).map(fromRow));
      } else if (!cancelled) {
        setLogs(local);
      }
      if (!cancelled) setLoading(false);
    })().catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const addRide = useCallback(
    async (log: Omit<RideLog, 'id'>) => {
      const entry: RideLog = { ...log, id: newId() };
      const before = logs;
      const after = [entry, ...logs];
      setLogs(after);
      if (accountsConfigured && supabase && userId) {
        const { data, error } = await supabase.from('ride_logs').insert(toRow(log)).select('id').single();
        if (error) {
          // Keep it on the phone; it uploads next time the log loads.
          await writeLocal([entry, ...(await readLocal())]);
        } else if (data) {
          setLogs((ls) => ls.map((l) => (l.id === entry.id ? { ...l, id: data.id as string } : l)));
        }
      } else {
        await writeLocal(after);
      }
      return newlyEarned(before, after).map((b) => localizeBadge(b, t));
    },
    [logs, userId],
  );

  const value = useMemo(() => ({ logs, loading, addRide }), [logs, loading, addRide]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRideLog(): RideLogState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRideLog must be used inside <RideLogProvider>');
  return v;
}
