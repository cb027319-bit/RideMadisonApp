// Spoken turn-by-turn prompts that play nicely with the rider's music.
//
// While a prompt is speaking, Spotify / Apple Music / podcasts are lowered ("ducked") instead of
// paused or talked over, then return to full volume when the prompt ends. Prompts also play when
// the iPhone's ring/silent switch is on silent, which a navigation voice needs.
//
// iOS speech uses the app's audio session, so we set the session to "play, ducking others" and only
// keep it active while speaking: an active ducking session would keep the music quiet all ride.
//
// While navigating, the session is also allowed to play in the background (UIBackgroundModes
// "audio"), so prompts still speak with the screen locked or another app in front.

import { setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';
import * as Speech from 'expo-speech';

/** Short pause before music comes back, so back-to-back prompts don't make it pump up and down. */
const RELEASE_DELAY_MS = 400;

let modeReady: Promise<void> | null = null;
/** True while turn-by-turn navigation is on: prompts may play with the app in the background. */
let background = false;
/** Increments on every speak/stop so callbacks from an older, interrupted prompt are ignored. */
let current = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

function ensureMode(): Promise<void> {
  modeReady ??= setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: 'duckOthers',
    allowsRecording: false,
    shouldPlayInBackground: background,
  }).catch((e) => {
    modeReady = null; // try again next prompt
    throw e;
  });
  return modeReady;
}

function release(id: number) {
  if (id !== current) return;
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (id === current) void setIsAudioActiveAsync(false).catch(() => {});
  }, RELEASE_DELAY_MS);
}

/** Speak a prompt, lowering any music for its duration. Replaces a prompt that is still speaking. */
export function speak(text: string, language: string): void {
  const id = ++current;
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  Speech.stop();
  void (async () => {
    try {
      await ensureMode();
      await setIsAudioActiveAsync(true);
    } catch {
      // Ducking is a nicety: if the audio session can't be set up, still speak.
    }
    if (id !== current) return; // a newer prompt (or stop) arrived meanwhile
    const done = () => release(id);
    Speech.speak(text, { language, rate: 1.0, onDone: done, onStopped: done, onError: done });
  })();
}

/**
 * Turn background speech on when navigation starts and off when it ends. Turning it off also
 * stops any prompt and gives the music its volume back.
 */
export function setSpeakInBackground(on: boolean): void {
  if (background === on) return;
  if (!on) stopSpeaking();
  background = on;
  modeReady = null;
  // Apply now, so the first prompt after locking the phone doesn't have to set the session up.
  void ensureMode().catch(() => {});
}

/** Stop speaking and give the music its volume back right away. */
export function stopSpeaking(): void {
  const id = ++current;
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  Speech.stop();
  if (modeReady && id === current) void setIsAudioActiveAsync(false).catch(() => {});
}
