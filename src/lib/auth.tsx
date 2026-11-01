// Accounts: sign in with Apple, Google or an emailed 6-digit code (Supabase
// Auth), the rider's profile (name, email, optional phone + opt-ins), and the
// sign-up sheet that account-only features (saving rides, etc.) open.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { friendlyAuthError, type AuthStep } from './auth-errors';
import { t } from './i18n';
import { accountsConfigured, fetchEnabledProviders, supabase, type Profile } from './supabase';

WebBrowser.maybeCompleteAuthSession();

export type SheetMode = 'welcome' | 'gate' | 'profile';

interface AuthState {
  configured: boolean;
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  appleAvailable: boolean;
  /**
   * Google sign-in is switched on in Supabase. On iOS it's offered only when
   * Sign in with Apple is too (App Store guideline 4.8).
   */
  googleEnabled: boolean;
  /** Sign-up sheet */
  sheet: { mode: SheetMode; reason?: string } | null;
  /** True once the first-open welcome has been shown or answered. */
  welcomeHandled: boolean;
  openSheet: (mode: SheetMode, reason?: string) => void;
  closeSheet: () => void;
  /** Returns true if signed in; otherwise opens the sheet with a reason. */
  requireAccount: (reason: string) => boolean;
  /** Create an account with email + password; signs in right away (no emailed code). */
  signUpWithPassword: (email: string, password: string) => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  /** Forgot password: emails a 6-digit reset code. */
  sendPasswordReset: (email: string) => Promise<void>;
  /** Check the reset code and set the new password (signs the rider in). */
  resetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  signInWithGoogle: () => Promise<boolean>;
  signInWithApple: () => Promise<boolean>;
  updateProfile: (fields: Partial<Omit<Profile, 'id'>>) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const WELCOME_KEY = 'signupWelcomeSeen:v1';
const Ctx = createContext<AuthState | null>(null);

export const authRedirectUrl = () => Linking.createURL('auth/callback');

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(!accountsConfigured);
  const [appleDevice, setAppleDevice] = useState(false);
  const [providers, setProviders] = useState({ google: false, apple: false });
  const appleAvailable = appleDevice && providers.apple;
  const googleEnabled = providers.google && (Platform.OS !== 'ios' || appleAvailable);
  const [sheet, setSheet] = useState<AuthState['sheet']>(null);
  const [welcomeHandled, setWelcomeHandled] = useState(!accountsConfigured);

  // Restore session + listen for changes.
  useEffect(() => {
    if (!supabase) return;
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .finally(() => setReady(true));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync().then(setAppleDevice).catch(() => {});
  }, []);

  // Only offer the sign-in methods that are turned on in Supabase.
  useEffect(() => {
    if (!accountsConfigured) return;
    fetchEnabledProviders()
      .then((p) => setProviders({ google: p.google, apple: p.apple }))
      .catch(() => {});
  }, []);

  // First open: show the sign-up welcome once (if not already signed in).
  useEffect(() => {
    if (!ready || !accountsConfigured) return;
    AsyncStorage.getItem(WELCOME_KEY)
      .then((seen) => {
        if (!seen && !session) setSheet({ mode: 'welcome' });
        else setWelcomeHandled(true);
      })
      .catch(() => setWelcomeHandled(true));
    // Only on first readiness.
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the profile whenever the signed-in user changes.
  const userId = session?.user.id;
  useEffect(() => {
    if (!supabase || !userId) {
      const timer = setTimeout(() => setProfile(null), 0);
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setProfile((data as Profile | null) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const markWelcome = useCallback(() => {
    setWelcomeHandled(true);
    AsyncStorage.setItem(WELCOME_KEY, '1').catch(() => {});
  }, []);

  const openSheet = useCallback((mode: SheetMode, reason?: string) => setSheet({ mode, reason }), []);
  const closeSheet = useCallback(() => {
    setSheet(null);
    markWelcome();
  }, [markWelcome]);

  const requireAccount = useCallback(
    (reason: string) => {
      if (session) return true;
      if (!accountsConfigured) return true; // accounts not set up yet: don't block
      setSheet({ mode: 'gate', reason });
      return false;
    },
    [session],
  );

  const client = () => {
    if (!supabase) throw new Error(t('more.err.notSetUp'));
    return supabase;
  };

  const signUpWithPassword = useCallback(async (email: string, password: string) => {
    const { data, error } = await client().auth.signUp({ email: email.trim().toLowerCase(), password });
    if (error) throw authError(error.message, 'signup');
    // With "Confirm email" off in Supabase, sign-up returns a session immediately.
    // If it's still on, there is no session yet: say so plainly instead of failing silently.
    if (!data.session) throw new Error(t('more.err.confirmOn'));
  }, []);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const { error } = await client().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw authError(error.message, 'signin');
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    const { error } = await client().auth.resetPasswordForEmail(email.trim().toLowerCase());
    if (error) throw authError(error.message, 'email');
  }, []);

  const resetPassword = useCallback(async (email: string, code: string, newPassword: string) => {
    const { error } = await client().auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'recovery' });
    if (error) throw authError(error.message, 'code');
    const { error: e2 } = await client().auth.updateUser({ password: newPassword });
    if (e2) throw authError(e2.message, 'signup');
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const redirectTo = authRedirectUrl();
    const { data, error } = await client().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
    });
    if (error || !data.url) throw authError(error?.message ?? 'Google sign-in is not available', 'oauth');
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') return false;
    const { queryParams } = Linking.parse(result.url);
    const err = queryParams?.error_description ?? queryParams?.error;
    if (err) throw authError(String(err), 'oauth');
    const code = queryParams?.code;
    if (typeof code !== 'string') throw new Error(t('more.err.googleUnfinished'));
    const { error: exErr } = await client().auth.exchangeCodeForSession(code);
    if (exErr) throw authError(exErr.message, 'oauth');
    return true;
  }, []);

  const signInWithApple = useCallback(async () => {
    let credential: AppleAuthentication.AppleAuthenticationCredential;
    try {
      credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return false;
      throw new Error(t('more.err.appleUnfinished'));
    }
    if (!credential.identityToken) throw new Error(t('more.err.appleNoToken'));
    const { data, error } = await client().auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken });
    if (error) throw authError(error.message, 'oauth');
    // Apple shares the name only on the very first sign-in, so save it now.
    const name = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ');
    if (name && data.user) {
      await client().from('profiles').update({ full_name: name }).eq('id', data.user.id);
      setProfile((p) => (p ? { ...p, full_name: name } : p));
    }
    return true;
  }, []);

  const updateProfile = useCallback(
    async (fields: Partial<Omit<Profile, 'id'>>) => {
      if (!userId) return;
      const { data, error } = await client()
        .from('profiles')
        .upsert({ id: userId, email: session?.user.email ?? null, ...fields })
        .select('*')
        .single();
      if (error) throw authError(error.message, 'profile');
      setProfile(data as Profile);
    },
    [userId, session?.user.email],
  );

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, []);

  const deleteAccount = useCallback(async () => {
    let error: { message: string } | null = null;
    try {
      ({ error } = await client().rpc('delete_my_account'));
    } catch (e) {
      throw authError(e instanceof Error ? e.message : String(e), 'delete');
    }
    if (error) throw authError(error.message, 'delete');
    // The account is gone; clear the local session even if this call fails.
    await supabase?.auth.signOut({ scope: 'local' }).catch(() => {});
    setProfile(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      configured: accountsConfigured, ready, session, profile, appleAvailable, googleEnabled, sheet, welcomeHandled,
      openSheet, closeSheet, requireAccount, signUpWithPassword, signInWithPassword, sendPasswordReset, resetPassword, signInWithGoogle, signInWithApple,
      updateProfile, signOut, deleteAccount,
    }),
    [ready, session, profile, appleAvailable, googleEnabled, sheet, welcomeHandled, openSheet, closeSheet, requireAccount,
      signUpWithPassword, signInWithPassword, sendPasswordReset, resetPassword, signInWithGoogle, signInWithApple, updateProfile, signOut, deleteAccount],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

/** Plain-language error for the rider (current language); the raw text goes to the dev console only. */
function authError(raw: string, step: AuthStep): Error {
  if (__DEV__) console.warn(`[auth:${step}]`, raw);
  return new Error(friendlyAuthError(raw, step, t));
}
