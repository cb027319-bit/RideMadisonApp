// Ride weather from Open-Meteo (free, no key): temperature, wind, rain, sunset.

import { USER_AGENT } from './config';

export interface RideWeather {
  tempF: number;
  windMph: number;
  gustMph?: number;
  windFrom: string; // compass point the wind blows FROM
  precipIn: number;
  code: number;
  sunset?: string; // "5:47 PM"
  fetchedAt: number;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (deg: number) => POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** Short words for WMO weather codes. */
export function describe(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'Rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'Snow';
  if (code >= 95) return 'Storms';
  return 'Mixed';
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
  let sunset: string | undefined;
  if (sunsetIso) {
    // Local time string like "2026-10-31T17:47" (timezone=America/Chicago)
    const [, hm] = sunsetIso.split('T');
    if (hm) {
      const [h, m] = hm.split(':').map(Number);
      sunset = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
    }
  }
  return {
    tempF: Math.round(c.temperature_2m),
    windMph: Math.round(c.wind_speed_10m ?? 0),
    gustMph: c.wind_gusts_10m != null ? Math.round(c.wind_gusts_10m) : undefined,
    windFrom: compass(c.wind_direction_10m ?? 0),
    precipIn: c.precipitation ?? 0,
    code: c.weather_code ?? 0,
    sunset,
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
