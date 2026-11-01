// Ride weather from Open-Meteo (free, no key): temperature, wind, rain, sunset.

import { USER_AGENT } from './config';
import { locale, t } from './i18n';

export interface RideWeather {
  tempF: number;
  windMph: number;
  gustMph?: number;
  windFrom: string; // compass point the wind blows FROM
  precipIn: number;
  code: number;
  /** Sunset, minutes after local midnight; format with formatSunset(). */
  sunsetMin?: number;
  fetchedAt: number;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (deg: number) => POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export type WeatherKind = 'clear' | 'partlyCloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storms' | 'mixed';

/** Stable kind for a WMO weather code (for icons). */
export function weatherKind(code: number): WeatherKind {
  if (code === 0) return 'clear';
  if (code <= 2) return 'partlyCloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storms';
  return 'mixed';
}

/** Short words for WMO weather codes, in the rider's language. */
export function describe(code: number): string {
  return t(`map.weather.${weatherKind(code)}`);
}

/** Compass point in the rider's language ("SW" / "SO"). */
export function compassLabel(point: string): string {
  return t(`map.compass.${point}`);
}

/** "5:47 PM" / "5:47 p. m." */
export function formatSunset(minutes: number): string {
  const d = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  return d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
}

interface OpenMeteo {
  current?: {
    temperature_2m?: number;
    wind_speed_10m?: number;
    wind_gusts_10m?: number;
    wind_direction_10m?: number;
    precipitation?: number;
    weather_code?: number;
  };
  daily?: { sunset?: string[] };
}

export function parseWeather(j: OpenMeteo, now = Date.now()): RideWeather {
  const c = j.current;
  if (!c || c.temperature_2m == null) throw new Error('No weather data');
  const sunsetIso = j.daily?.sunset?.[0];
  let sunsetMin: number | undefined;
  if (sunsetIso) {
    // Local time string like "2026-10-31T17:47" (timezone=America/Chicago)
    const [, hm] = sunsetIso.split('T');
    if (hm) {
      const [h, m] = hm.split(':').map(Number);
      if (Number.isFinite(h) && Number.isFinite(m)) sunsetMin = h * 60 + m;
    }
  }
  return {
    tempF: Math.round(c.temperature_2m),
    windMph: Math.round(c.wind_speed_10m ?? 0),
    gustMph: c.wind_gusts_10m != null ? Math.round(c.wind_gusts_10m) : undefined,
    windFrom: compass(c.wind_direction_10m ?? 0),
    precipIn: c.precipitation ?? 0,
    code: c.weather_code ?? 0,
    sunsetMin,
    fetchedAt: now,
  };
}

export async function fetchWeather(lat: number, lon: number): Promise<RideWeather> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
    '&current=temperature_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,weather_code' +
    '&daily=sunset&forecast_days=1&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch' +
    '&timezone=America%2FChicago';
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Weather ${res.status}`);
  return parseWeather((await res.json()) as OpenMeteo);
}
