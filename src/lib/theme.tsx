// Light and dark appearance. The rider picks Automatic (follow the phone),
// Light or Dark in More; components read semantic colours from useTheme()
// and build their styles with makeStyles() so they re-theme instantly.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

import { BRAND, COLORS } from './config';

export type AppearancePref = 'system' | 'light' | 'dark';
const KEY = 'appearance:v1';

/** Semantic colours. Use these instead of hex values in components. */
export interface Palette {
  dark: boolean;
  /** Screen background. */
  bg: string;
  /** Cards, sheets, list rows. */
  surface: string;
  /** Raised or tinted panels inside a surface (chips, stat tiles). */
  surfaceAlt: string;
  /** Pressed state for rows. */
  pressed: string;
  border: string;
  text: string;
  textMuted: string;
  /** Tertiary text / inactive tab labels (passes 4.5:1 on bg). */
  textFaint: string;
  /** Primary action colour (navy in light, limestone in dark). */
  primary: string;
  /** Text/icon on top of `primary`. */
  onPrimary: string;
  /** Signal Red for routes and the main Start button (same in both modes). */
  accent: string;
  onAccent: string;
  gold: string;
  onGold: string;
  danger: string;
  success: string;
  /** Translucent scrim behind modals. */
  scrim: string;
  /** Map overlay controls (search bar, chips) background. */
  overlay: string;
  shadow: string;
}

export const LIGHT: Palette = {
  dark: false,
  bg: BRAND.cream,
  surface: '#FFFFFF',
  surfaceAlt: '#F1EEE6',
  pressed: '#ECE8DE',
  border: COLORS.border,
  text: BRAND.navy,
  textMuted: BRAND.slate,
  textFaint: COLORS.inactive,
  primary: BRAND.navy,
  onPrimary: '#FFFFFF',
  accent: BRAND.red,
  onAccent: '#FFFFFF',
  gold: BRAND.gold,
  onGold: BRAND.navy,
  danger: '#B91C1C',
  success: '#15803D',
  scrim: 'rgba(0,0,0,0.45)',
  overlay: '#FFFFFF',
  shadow: '#000000',
};

export const DARK: Palette = {
  dark: true,
  bg: '#0B1220',
  surface: '#141D30',
  surfaceAlt: '#1D2740',
  pressed: '#24304D',
  border: '#2A3654',
  text: '#F4F1EA',
  textMuted: '#C2C7D3',
  textFaint: '#9AA1B2',
  primary: BRAND.limestone,
  onPrimary: BRAND.navy,
  accent: '#F0505C',
  onAccent: '#FFFFFF',
  gold: BRAND.gold,
  onGold: BRAND.navy,
  danger: '#F87171',
  success: '#4ADE80',
  scrim: 'rgba(0,0,0,0.65)',
  overlay: '#141D30',
  shadow: '#000000',
};

interface ThemeState {
  c: Palette;
  pref: AppearancePref;
  setPref: (p: AppearancePref) => void;
}

const Ctx = createContext<ThemeState>({ c: LIGHT, pref: 'system', setPref: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const [pref, setPrefState] = useState<AppearancePref>('system');

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (v === 'light' || v === 'dark' || v === 'system') setPrefState(v);
      })
      .catch(() => {});
  }, []);

  const value = useMemo<ThemeState>(() => {
    const dark = pref === 'dark' || (pref === 'system' && scheme === 'dark');
    return {
      c: dark ? DARK : LIGHT,
      pref,
      setPref: (p) => {
        setPrefState(p);
        AsyncStorage.setItem(KEY, p).catch(() => {});
      },
    };
  }, [pref, scheme]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeState {
  return useContext(Ctx);
}

/**
 * Build a themed StyleSheet hook:
 *   const useStyles = makeStyles((c) => ({ box: { backgroundColor: c.surface } }));
 *   const styles = useStyles();
 */
type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

export function makeStyles<T extends NamedStyles<T>>(build: (c: Palette) => T) {
  const cache = new Map<Palette, T>();
  return function useStyles(): T {
    const { c } = useTheme();
    let s = cache.get(c);
    if (!s) {
      s = StyleSheet.create(build(c));
      cache.set(c, s);
    }
    return s;
  };
}
