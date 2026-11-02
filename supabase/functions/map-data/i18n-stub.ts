// Server stand-in for src/lib/i18n.tsx (no React/AsyncStorage): English strings only.
// Snapshot data stores no translated text that matters; labels are translated in the app.
import { common } from '../../../src/locales/en/common';
import { lib } from '../../../src/locales/en/lib';
import { map } from '../../../src/locales/en/map';

const EN = { ...common, ...lib, ...map };

type Vars = Record<string, string | number | null | undefined>;
export function t(key: string, vars?: Vars): string {
  const dict = EN as Record<string, string>;
  let s = (vars && vars.count === 1 && dict[`${key}_one`]) || dict[key] || key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] == null ? '' : String(vars[k])));
  return s;
}
export const translate = (_l: string, key: string, vars?: Vars) => t(key, vars);
export const lang = () => 'en' as const;
export const locale = () => 'en-US';
