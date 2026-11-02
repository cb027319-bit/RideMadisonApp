// Location updates for turn-by-turn navigation that keep coming when the phone is locked or
// another app (music, podcasts) is in front.
//
// iOS lets an app that started location updates while on screen keep them in the background,
// with the blue location pill, using only "While Using" permission. Android runs them in a
// foreground service with a notification. Both need the background task below, defined at module
// scope and imported once from src/app/_layout.tsx so it exists even if the app is woken in the
// background. If background updates can't start (Expo Go, web, a build without the native
// config), we fall back to ordinary foreground updates instead of failing.

import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { t } from './i18n';
import { canTryBackgroundUpdates, freshFixes, type NavUpdateMode } from './navigation';

export type { NavUpdateMode } from './navigation';

export const NAV_LOCATION_TASK = 'ride-madison-navigation';

export type FixListener = (loc: Location.LocationObject) => void;

const listeners = new Set<FixListener>();
let lastTimestamp = 0;
let watchSub: Location.LocationSubscription | null = null;
let backgroundStarted = false;
/** Bumped by every start/stop call, so a start that finishes after a newer call undoes itself. */
let session = 0;
/** Start and stop run one at a time (they share one native task). */
let chain: Promise<unknown> = Promise.resolve();

function serial<T>(op: () => Promise<T>): Promise<T> {
  const next = chain.then(op, op);
  chain = next.catch(() => {});
  return next;
}

function deliver(locations: readonly Location.LocationObject[]) {
  for (const loc of freshFixes(locations, lastTimestamp)) {
    lastTimestamp = loc.timestamp;
    for (const fn of listeners) {
      try {
        fn(loc);
      } catch {
        // One bad fix must never stop the stream.
      }
    }
  }
}

try {
  TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(NAV_LOCATION_TASK, async ({ data, error }) => {
    if (error) return;
    if (listeners.size === 0) {
      // Left over from a ride that never cleaned up (e.g. the app was closed mid-ride): stop it.
      await Location.stopLocationUpdatesAsync(NAV_LOCATION_TASK).catch(() => {});
      return;
    }
    deliver(data?.locations ?? []);
  });
} catch {
  // No task manager on this platform: navigation uses foreground updates.
}

async function backgroundAllowed(): Promise<boolean> {
  const taskManagerAvailable = await TaskManager.isAvailableAsync().catch(() => false);
  return canTryBackgroundUpdates({
    os: Platform.OS,
    expoGo: Constants.executionEnvironment === ExecutionEnvironment.StoreClient,
    taskManagerAvailable,
  });
}

/**
 * Start navigation location updates, calling `onFix` for each new fix. Assumes "While Using"
 * permission is already granted (we never ask for "Always"). Resolves with the mode that started:
 * 'foreground' means directions pause while the app is off screen. Rejects only if even
 * foreground updates can't start.
 */
export function startNavigationUpdates(onFix: FixListener): Promise<NavUpdateMode> {
  const id = ++session;
  return serial(async (): Promise<NavUpdateMode> => {
    if (id !== session) return 'foreground'; // already stopped or replaced
    listeners.clear();
    listeners.add(onFix);
    lastTimestamp = 0;

    if (await backgroundAllowed()) {
      try {
        await Location.startLocationUpdatesAsync(NAV_LOCATION_TASK, {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 3,
          timeInterval: 1000,
          showsBackgroundLocationIndicator: true,
          pausesUpdatesAutomatically: false,
          activityType: Location.ActivityType.Fitness,
          foregroundService: {
            notificationTitle: t('nav.serviceTitle'),
            notificationBody: t('nav.serviceBody'),
            killServiceOnDestroy: true,
          },
        });
        backgroundStarted = true;
        if (id !== session) await stopNative();
        return 'background';
      } catch {
        // Fall through to foreground-only updates.
      }
    }

    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 3, timeInterval: 1000 },
      (loc) => deliver([loc]),
    );
    if (id !== session) sub.remove();
    else watchSub = sub;
    return 'foreground';
  });
}

async function stopNative(): Promise<void> {
  watchSub?.remove();
  watchSub = null;
  const wasStarted = backgroundStarted;
  backgroundStarted = false;
  try {
    if (wasStarted || (await Location.hasStartedLocationUpdatesAsync(NAV_LOCATION_TASK))) {
      await Location.stopLocationUpdatesAsync(NAV_LOCATION_TASK);
    }
  } catch {
    // Not started, or not available here.
  }
}

/** Stop navigation location updates (end of ride, arrival, leaving the screen). Safe to call twice. */
export function stopNavigationUpdates(): Promise<void> {
  session++;
  listeners.clear(); // stop delivering right away, before the native side has stopped
  return serial(stopNative);
}
