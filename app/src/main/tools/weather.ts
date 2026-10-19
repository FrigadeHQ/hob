import type { Tool } from '../agent/tool'

// WMO weather codes, as used by Open-Meteo (https://open-meteo.com, free and open source, no key)
const WMO: Record<number, string> = {
  0: 'Clear sky', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Violent rain showers',
  85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail',
}

type Daily = { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[]; wind_speed_10m_max: number[] }

export const getWeather: Tool<{ location: string; days?: number }> = {
  spec: {
    name: 'get_weather',
    description: 'Weather forecast for a place (city or town), up to 14 days. Use this instead of searching weather websites.',
    params: { type: 'object', properties: { location: { type: 'string' }, days: { type: 'number', description: 'Days ahead, 1-14; default 7' } }, required: ['location'] },
  },
  title: (a) => `Checked the weather in ${a.location}`,
  action: () => ({ kind: 'web' }),
  async run(a, ctx) {
    const timeout = AbortSignal.any([ctx.signal, AbortSignal.timeout(15_000)])
    const geo = (await (await ctx.fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=${encodeURIComponent(a.location)}`, { signal: timeout })).json()) as { results?: { name: string; country?: string; admin1?: string; latitude: number; longitude: number }[] }
    const place = geo.results?.[0]
    if (!place) return { text: `Couldn't find a place called “${a.location}”. Try a nearby city name.`, failed: true }
    const days = Math.min(14, Math.max(1, Math.round(a.days ?? 7)))
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&timezone=auto&forecast_days=${days}`
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max'
    const f = (await (await ctx.fetch(url, { signal: timeout })).json()) as { daily?: Daily; daily_units?: { wind_speed_10m_max?: string } }
    const d = f.daily
    if (!d?.time?.length) return { text: 'The weather service had no forecast for that place right now.', failed: true }
    const unit = f.daily_units?.wind_speed_10m_max ?? 'km/h'
    const lines = d.time.map((day, i) =>
      `${day}: ${WMO[d.weather_code[i]] ?? 'Mixed'}, ${Math.round(d.temperature_2m_min[i])}–${Math.round(d.temperature_2m_max[i])}°C, ${d.precipitation_probability_max[i] ?? 0}% chance of rain, wind up to ${Math.round(d.wind_speed_10m_max[i])} ${unit}`)
    return { text: `Forecast for ${place.name}${place.country ? `, ${place.country}` : ''} (Open-Meteo):\n${lines.join('\n')}` }
  },
}
