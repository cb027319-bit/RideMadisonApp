// English and Spanish. The rider picks Automatic (phone language), English or
// Español in More. Components call useT(); library code (voice prompts, trail
// rules, labels) calls t() directly, which always reads the current language.
//
// Strings live in src/locales/<lang>/<namespace>.ts with keys like 'map.whereTo'.
// Variables: t('route.stopsLeft', { count: 2 }) fills {count}. When `count` is
// given and a key + '_one' exists, it is used for count === 1.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { EN, ES, type Key } from '@/locales';

export type Lang = 'en' | 'es';
export type LangPref = 'system' | Lang;
const KEY = 'language:v1';

const DICTS: Record<Lang, Record<string, string>> = { en: EN, es: ES };

function deviceLang(): Lang {
  try {
    // Loaded lazily so plain Node (unit tests) can import this file; there it falls back to English.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getLocales } = require('expo-localization') as typeof import('expo-localization');
    const code = getLocales()[0]?.languageCode ?? 'en';
    return code === 'es' ? 'es' : 'en';
  } catch {
    return 'en';
  }
}

let current: Lang = deviceLang();

function setCurrent(l: Lang) {
  current = l;
}

/** The language in use right now. */
export function lang(): Lang {
  return current;
}

/** BCP-47 tag for dates, numbers and speech: 'en-US' or 'es-US'. */
export function locale(): string {
  return current === 'es' ? 'es-US' : 'en-US';
}

export type Vars = Record<string, string | number | null | undefined>;

export function translate(l: Lang, key: Key | string, vars?: Vars): string {
  const dict = DICTS[l];
  let s: string | undefined;
  if (vars && typeof vars.count === 'number' && vars.count === 1) s = dict[`${key}_one`] ?? EN[`${key}_one` as Key];
  s ??= dict[key] ?? (EN as Record<string, string>)[key] ?? String(key);
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] == null ? '' : String(vars[k])));
  return s;
}

/** Translate in the current language (safe to call outside React). */
export function t(key: Key | string, vars?: Vars): string {
  return translate(current, key, vars);
}

interface LangState {
  lang: Lang;
  pref: LangPref;
  setPref: (p: LangPref) => void;
  t: (key: Key | string, vars?: Vars) => string;
}

const Ctx = createContext<LangState>({ lang: current, pref: 'system', setPref: () => {}, t });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<LangPref>('system');

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (v === 'en' || v === 'es' || v === 'system') setPrefState(v);
      })
      .catch(() => {});
  }, []);

  const value = useMemo<LangState>(() => {
    const l: Lang = pref === 'system' ? deviceLang() : pref;
    // Set before children render so library t() calls match this render.
    setCurrent(l);
    return {
      lang: l,
      pref,
      setPref: (p) => {
        setPrefState(p);
        AsyncStorage.setItem(KEY, p).catch(() => {});
      },
      t: (key, vars) => translate(l, key, vars),
    };
  }, [pref]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Hook: re-renders on language change. `const { t } = useT();` */
export function useT(): LangState {
  return useContext(Ctx);
}
