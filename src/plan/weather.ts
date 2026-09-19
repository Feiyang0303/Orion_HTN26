import type { LatLon } from '../types'
import { getJson } from './net'
import { report } from '../telemetry'

/* The weather, from Open-Meteo: no key, CORS-open, and honest about how far
 * ahead anyone can see.
 *
 * The awkward part is that a trip has no date on it. The person asked for
 * three days, not for the 14th to the 16th, so there is nothing to look up a
 * forecast against. Rather than invent a date or go on saying nothing, the
 * book reads the days beginning tomorrow and prints the date it actually read,
 * which is the only thing that makes the line worth anything: "Sat 20 Sep,
 * 12–19°, light rain" can be checked, and "it might rain" cannot.
 *
 * Past the horizon the forecast simply stops, and the memo falls back to
 * saying so. A number invented for day nine would be worse than no number.
 */

export type DayWeather = {
  /** The day this is actually a forecast for, which is not the same as day N of the trip. */
  date: string
  label: string
  minC: number
  maxC: number
  rainMm: number
  rainChance: number
  sky: string
}

/* WMO weather codes, in the words someone would actually use. */
const SKY: [number[], string][] = [
  [[0], 'clear'],
  [[1], 'mostly clear'],
  [[2], 'some cloud'],
  [[3], 'overcast'],
  [[45, 48], 'fog'],
  [[51, 53, 55], 'drizzle'],
  [[56, 57], 'freezing drizzle'],
  [[61], 'light rain'],
  [[63], 'rain'],
  [[65], 'heavy rain'],
  [[66, 67], 'freezing rain'],
  [[71], 'light snow'],
  [[73], 'snow'],
  [[75, 77], 'heavy snow'],
  [[80, 81], 'showers'],
  [[82], 'heavy showers'],
  [[85, 86], 'snow showers'],
  [[95], 'thunderstorms'],
  [[96, 99], 'thunderstorms with hail'],
]
const skyOf = (code: number) => SKY.find(([codes]) => codes.includes(code))?.[1] ?? 'mixed'

type Reply = {
  daily?: {
    time?: string[]
    weather_code?: number[]
    temperature_2m_max?: (number | null)[]
    temperature_2m_min?: (number | null)[]
    precipitation_sum?: (number | null)[]
    precipitation_probability_max?: (number | null)[]
  }
}

/** The forecast for `days` days beginning tomorrow, as far ahead as it goes.
    Returns fewer days than asked for rather than guessing, and [] if the
    service is unreachable — the memo has something honest to say either way. */
export async function forecast(at: LatLon, days: number, signal?: AbortSignal): Promise<DayWeather[]> {
  // +1 because the first day the service returns is today, which no trip starts on.
  const span = Math.min(16, Math.max(2, days + 1))
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${at.lat.toFixed(4)}&longitude=${at.lon.toFixed(4)}`
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max'
    + `&timezone=auto&forecast_days=${span}`
  try {
    const r = await getJson<Reply>(url, signal)
    const d = r.daily
    if (!d?.time?.length) return []
    const out: DayWeather[] = []
    for (let i = 1; i < d.time.length && out.length < days; i++) {
      const max = d.temperature_2m_max?.[i], min = d.temperature_2m_min?.[i]
      if (typeof max !== 'number' || typeof min !== 'number') continue
      const iso = d.time[i]
      out.push({
        date: iso,
        label: new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
        minC: Math.round(min), maxC: Math.round(max),
        rainMm: Math.round((d.precipitation_sum?.[i] ?? 0) * 10) / 10,
        rainChance: Math.round(d.precipitation_probability_max?.[i] ?? 0),
        sky: skyOf(d.weather_code?.[i] ?? -1),
      })
    }
    return out
  } catch (e) {
    if (signal?.aborted) return []
    report(e, 'weather.forecast', { level: 'warning', extra: { lat: at.lat, lon: at.lon } })
    return []
  }
}

/** The memo line: the forecast, and what day it is a forecast for, so nobody
    reads a Tuesday forecast as a promise about their Friday. */
export function weatherLine(w: DayWeather | undefined): string {
  if (!w) return 'no forecast reaches this far ahead; look the night before'
  const wet = w.rainChance >= 40 || w.rainMm >= 1
  // What to do about it belongs to the line below, which is the one that says
  // "take an umbrella". This one only reports.
  return `${w.label}: ${w.minC}–${w.maxC}°C, ${w.sky}`
    + (wet ? `, ${w.rainChance}% chance of rain` : '')
}

/** What to put on, from the same numbers. Temperature decides the layer, the
    swing between day and evening decides whether to carry another, and the
    chance of rain decides the umbrella — which is the one thing a person
    actually wants a forecast to tell them and the one thing a temperature
    range never says out loud. The walking is in here too, because how far you
    are on your feet is as much a clothing decision as the weather is. */
export function wearLine(w: DayWeather | undefined, kmOnFoot: number): string {
  const shoes = kmOnFoot >= 6 ? `shoes you can do ${kmOnFoot.toFixed(0)} km in` : 'comfortable shoes'
  if (!w) return `${shoes}, and check the sky the night before — no forecast reaches this day yet`
  const bits: string[] = [
    w.maxC >= 28 ? 'light clothes and something for the sun'
      : w.maxC >= 22 ? 'a t-shirt is enough'
      : w.maxC >= 16 ? 'a jumper or a light jacket'
      : w.maxC >= 10 ? 'a proper jacket'
      : w.maxC >= 4 ? 'a warm coat'
      : 'a winter coat, hat and gloves',
  ]
  if (w.maxC - w.minC >= 9 && w.minC < 16) bits.push(`it drops to ${w.minC}° by evening, so carry a layer`)
  if (/snow/.test(w.sky)) bits.push('boots — there is snow in it')
  else if (w.rainChance >= 60 || w.rainMm >= 3) bits.push('take an umbrella')
  else if (w.rainChance >= 35) bits.push('an umbrella, just in case')
  bits.push(shoes)
  return bits.join('; ')
}
