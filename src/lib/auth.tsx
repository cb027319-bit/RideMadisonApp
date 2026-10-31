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

import { accountsConfigured, supabase, type Profile } from './supabase';

WebBrowser.maybeCompleteAuthSession();

export type SheetMode = 'welcome' | 'gate' | 'profile';

interface AuthState {
  configured: boolean;
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  appleAvailable: boolean;
  /** Sign-up sheet */
  sheet: { mode: SheetMode; reason?: string } | null;
  /** True once the first-open welcome has been shown or answered. */
  welcomeHandled: boolean;
  openSheet: (mode: SheetMode, reason?: string) => void;
  closeSheet: () => void;
  /** Returns true if signed in; otherwise opens the sheet with a reason. */
  requireAccount: (reason: string) => boolean;
  sendEmailCode: (email: string) => Promise<void>;
  verifyEmailCode: (email: string, code: string) => Promise<void>;
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
  const [appleAvailable, setAppleAvailable] = useState(false);
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
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => {});
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
      const t = setTimeout(() => setProfile(null), 0);
      return () => clearTimeout(t);
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
    if (!supabase) throw new Error('Accounts are not set up yet');
    return supabase;
  };

  const sendEmailCode = useCallback(async (email: string) => {
    const { error } = await client().auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true } });
    if (error) throw new Error(friendly(error.message));
  }, []);

  const verifyEmailCode = useCallback(async (email: string, code: string) => {
    const { error } = await client().auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' });
    if (error) throw new Error(friendly(error.message));
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const redirectTo = authRedirectUrl();
    const { data, error } = await client().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
    });
    if (error || !data.url) throw new Error(friendly(error?.message ?? 'Google sign-in is not available'));
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') return false;
    const { queryParams } = Linking.parse(result.url);
    const err = queryParams?.error_description ?? queryParams?.error;
    if (err) throw new Error(friendly(String(err)));
    const code = queryParams?.code;
    if (typeof code !== 'string') throw new Error('Google sign-in did not finish. Please try again.');
    const { error: exErr } = await client().auth.exchangeCodeForSession(code);
    if (exErr) throw new Error(friendly(exErr.message));
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
      throw new Error('Apple sign-in did not finish. Please try again.');
    }
    if (!credential.identityToken) throw new Error('Apple did not return a sign-in token.');
    const { data, error } = await client().auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken });
    if (error) throw new Error(friendly(error.message));
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
      if (error) throw new Error(friendly(error.message));
      setProfile(data as Profile);
    },
    [userId, session?.user.email],
  );

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, []);

  const deleteAccount = useCallback(async () => {
    const { error } = await client().rpc('delete_my_account');
    if (error) throw new Error(friendly(error.message));
    await supabase?.auth.signOut();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      configured: accountsConfigured, ready, session, profile, appleAvailable, sheet, welcomeHandled,
      openSheet, closeSheet, requireAccount, sendEmailCode, verifyEmailCode, signInWithGoogle, signInWithApple,
      updateProfile, signOut, deleteAccount,
    }),
    [ready, session, profile, appleAvailable, sheet, welcomeHandled, openSheet, closeSheet, requireAccount,
      sendEmailCode, verifyEmailCode, signInWithGoogle, signInWithApple, updateProfile, signOut, deleteAccount],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

function friendly(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many tries. Please wait a minute and try again.';
  if (m.includes('expired') || m.includes('invalid')) return 'That code is wrong or expired. Request a new one.';
  if (m.includes('provider is not enabled') || m.includes('unsupported provider')) return 'This sign-in option is not turned on yet.';
  if (m.includes('network')) return 'No connection. Check your signal and try again.';
  return msg;
}
