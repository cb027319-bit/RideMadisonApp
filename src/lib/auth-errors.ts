// Plain-language sign-in messages and the resend-code cooldown (pure; unit-tested
// in tests/auth-errors.test.ts). Raw server text never reaches the rider.
// Messages are translated with the `t` the caller passes (English by default).

import type { Key } from '../locales';
import { englishT, type Tr } from './rider';

export type AuthStep = 'email' | 'code' | 'oauth' | 'profile' | 'delete';

/** Seconds a rider waits before asking for another emailed code. */
export const RESEND_COOLDOWN_S = 30;

const GENERIC: Record<AuthStep, Key> = {
  email: 'more.err.emailGeneric',
  code: 'more.err.codeGeneric',
  oauth: 'more.err.oauthGeneric',
  profile: 'more.err.profileGeneric',
  delete: 'more.err.deleteGeneric',
};

export function friendlyAuthError(raw: string | null | undefined, step: AuthStep, t: Tr = englishT): string {
  const m = (raw ?? '').toLowerCase();
  if (/network|fetch|timed? ?out|offline|connection/.test(m)) return t('more.err.offline');
  if (/after \d+ seconds?|security purposes/.test(m)) return t('more.err.waitCode');
  if (m.includes('rate limit') || m.includes('too many')) {
    return step === 'code' ? t('more.err.tooMany') : t('more.err.waitCode');
  }
  if (m.includes('provider is not enabled') || m.includes('unsupported provider')) return t('more.err.providerOff');
  if (step === 'code' && (m.includes('expired') || m.includes('invalid') || m.includes('token'))) {
    return t('more.err.badCode');
  }
  if (step === 'email' && (m.includes('invalid') || m.includes('email address'))) {
    return t('more.err.badEmail');
  }
  if (step === 'delete' && m.includes('not signed in')) return t('more.err.signInAgain');
  return t(GENERIC[step]);
}

/** Whole seconds left before "Send a new code" works again (0 when ready). */
export function resendSecondsLeft(sentAt: number | null, now: number, cooldownS = RESEND_COOLDOWN_S): number {
  if (sentAt == null) return 0;
  return Math.max(0, Math.ceil(cooldownS - (now - sentAt) / 1000));
}
