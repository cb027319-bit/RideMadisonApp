// Supabase client (accounts, profiles, saved rides).
// Configure in .env.local (not committed):
//   EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
//   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key>
// The anon key is designed to ship in apps; row-level security protects data.

import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Which sign-in methods are switched on in the Supabase dashboard. */
export async function fetchEnabledProviders(): Promise<{ google: boolean; apple: boolean; email: boolean }> {
  const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } });
  if (!res.ok) throw new Error(`Auth settings ${res.status}`);
  const j = (await res.json()) as { external?: Record<string, boolean> };
  return { google: !!j.external?.google, apple: !!j.external?.apple, email: j.external?.email !== false };
}

export const accountsConfigured = /^https:\/\/.+/.test(url) && anonKey.length > 20;

export const supabase: SupabaseClient | null = accountsConfigured
  ? createClient(url, anonKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    })
  : null;

// Refresh tokens only while the app is in the foreground.
if (supabase) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  });
}

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  sms_opt_in: boolean;
  email_opt_in: boolean;
  bike_type: string | null;
  comfort: string | null;
  signup_method: string | null;
  /** Set once the welcome email has gone out (migration 0006). Undefined before 0006 is run. */
  welcomed_at?: string | null;
  language?: 'en' | 'es' | null;
}
