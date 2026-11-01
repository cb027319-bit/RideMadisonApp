// Plain-English sign-in messages and the resend-code cooldown (pure; unit-tested
// in tests/auth-errors.test.ts). Raw server text never reaches the rider.

export type AuthStep = 'email' | 'code' | 'oauth' | 'profile' | 'delete';

/** Seconds a rider waits before asking for another emailed code. */
export const RESEND_COOLDOWN_S = 30;

const GENERIC: Record<AuthStep, string> = {
  email: 'We couldn’t send a code right now. Please try again.',
  code: 'We couldn’t check that code. Please try again.',
  oauth: 'Sign-in didn’t finish. Please try again.',
  profile: 'We couldn’t save your profile. Please try again.',
  delete: 'We couldn’t delete your account right now. Check your connection and try again.',
};

export function friendlyAuthError(raw: string | null | undefined, step: AuthStep): string {
  const m = (raw ?? '').toLowerCase();
  if (/network|fetch|timed? ?out|offline|connection/.test(m)) return 'No connection. Check your signal and try again.';
  if (/after \d+ seconds?|security purposes/.test(m)) return 'Please wait a minute before asking for another code.';
  if (m.includes('rate limit') || m.includes('too many')) {
    return step === 'code' ? 'Too many tries. Please wait a few minutes and try again.' : 'Please wait a minute before asking for another code.';
  }
  if (m.includes('provider is not enabled') || m.includes('unsupported provider')) return 'This sign-in option is not turned on yet.';
  if (step === 'code' && (m.includes('expired') || m.includes('invalid') || m.includes('token'))) {
    return 'That code is wrong or expired. Check it, or send a new code.';
  }
  if (step === 'email' && (m.includes('invalid') || m.includes('email address'))) {
    return 'That email address doesn’t look right. Please check it.';
  }
  if (step === 'delete' && m.includes('not signed in')) return 'Please sign in again, then try deleting your account.';
  return GENERIC[step];
}

/** Whole seconds left before "Send a new code" works again (0 when ready). */
export function resendSecondsLeft(sentAt: number | null, now: number, cooldownS = RESEND_COOLDOWN_S): number {
  if (sentAt == null) return 0;
  return Math.max(0, Math.ceil(cooldownS - (now - sentAt) / 1000));
}
