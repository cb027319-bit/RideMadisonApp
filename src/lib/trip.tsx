// The ride being navigated or previewed. Set by the Route tab or a suggested
// ride, read by the Navigate and Tour screens.

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import type { LatLon, RouteProfile, RouteResult } from './routing';

export interface Trip {
  title: string;
  result: RouteResult;
  /** Points the route was planned through, in order (labels shown in the tour). */
  points: (LatLon & { label: string })[];
  profile: RouteProfile;
}

interface TripState {
  trip: Trip | null;
  setTrip: (t: Trip | null) => void;
}

const Ctx = createContext<TripState | null>(null);

export function TripProvider({ children }: { children: ReactNode }) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const value = useMemo(() => ({ trip, setTrip }), [trip]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTrip(): TripState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTrip must be used inside <TripProvider>');
  return v;
}
