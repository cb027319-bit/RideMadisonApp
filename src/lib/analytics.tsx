// Product analytics (PostHog). Set EXPO_PUBLIC_POSTHOG_KEY (and optionally
// EXPO_PUBLIC_POSTHOG_HOST) to turn it on; with no key every call is a silent
// no-op. Privacy rules and helpers live in ./analytics-core; the event list is
// in docs/analytics-events.md.
//
// What is never sent: GPS points, addresses, route lines, search text, the
// rider's name or email. No session replay, no touch autocapture.

import { usePathname } from 'expo-router';
import PostHog, { PostHogProvider } from 'posthog-react-native';
import { useEffect, useRef, type ReactNode } from 'react';

import { createAnalytics, type EventMap, type EventName, type RouteSource } from './analytics-core';
import { useAuth } from './auth';
import { usePrefs } from './prefs';

export { pctBucket, roundMiles, roundMinutes, shareBucket, type RouteSource } from './analytics-core';

const KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '';
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

function makeClient(): PostHog | null {
  if (!KEY) return null;
  try {
    return new PostHog(KEY, {
      host: HOST,
      // Privacy: no replay, no IP-based city/coordinates lookup, no automatic
      // lifecycle or crash events (our own app_opened is sent after the opt-out is known).
      enableSessionReplay: false,
      disableGeoip: true,
      captureAppLifecycleEvents: false,
      errorTracking: { autocapture: false },
      personProfiles: 'identified_only',
      preloadFeatureFlags: false,
    });
  } catch {
    return null;
  }
}

const client = makeClient();
const analytics = createAnalytics(client);

/** True when a PostHog key is set for this build. */
export const analyticsConfigured = analytics.configured;

/** Send an event (typed; properties are sanitized). No-op without a key or when the rider opted out. */
export function track<E extends EventName>(event: E, props?: EventMap[E]): void {
  analytics.track(event, props);
}

// Where the next planned route came from, read when the route is ready (see RouteProvider).
let pendingRouteSource: RouteSource | null = null;
export function markRouteSource(source: RouteSource): void {
  pendingRouteSource = source;
}
export function takeRouteSource(): RouteSource | null {
  const s = pendingRouteSource;
  pendingRouteSource = null;
  return s;
}

/**
 * Sets up PostHog under the prefs and account providers: applies the rider's
 * opt-out, sends app_opened once, tracks screens from the Expo Router
 * pathname (never params), and links signed-in riders by account id only.
 */
export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const { loaded, shareUsage } = usePrefs();
  const { ready, session } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    if (loaded) analytics.setEnabled(shareUsage);
  }, [loaded, shareUsage]);

  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    analytics.track('app_opened', {});
  }, []);

  useEffect(() => {
    analytics.screen(pathname);
  }, [pathname]);

  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!ready) return;
    if (userId) analytics.identify(userId);
    else analytics.reset();
  }, [ready, userId]);

  if (!client) return <>{children}</>;
  return (
    <PostHogProvider client={client} autocapture={{ captureScreens: false, captureTouches: false }}>
      {children}
    </PostHogProvider>
  );
}
