import { FORECAST_HOURS, getForecast } from "./api.js";
import type { WeatherReading } from "./schema.js";

const WMO_CODES: Record<number, string> = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "icy fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
  80: "light showers", 81: "showers", 82: "heavy showers",
  85: "snow showers", 86: "heavy snow showers",
  95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with heavy hail",
};

/** The weather as text for the model; throws when it can't be read, as the tool and the brief expect. */
export async function getWeather(): Promise<string> {
  const forecast = await getForecast();
  if (forecast.kind === "failed") throw new Error(forecast.reason);

  return formatWeather(forecast.reading);
}

/**
 * The weather as lines: the current conditions first (the morning brief's fallback reads the first
 * two), then today's summary for the whole day, then the next hours from now.
 */
export function formatWeather(reading: WeatherReading): string {
  const current = reading.current;

  const maxRainChance = maxOverForecast(reading.hourly.precipitation_probability);
  const maxWindNext = maxOverForecast(reading.hourly.wind_speed_10m);

  return [
    `Conditions: ${describeCode(current.weather_code)}`,
    `Temperature: ${current.temperature_2m}°C (feels like ${current.apparent_temperature}°C)`,
    `Wind: ${current.wind_speed_10m} km/h, gusts up to ${current.wind_gusts_10m} km/h`,
    `Current precipitation: ${current.precipitation} mm`,
    todayLine(reading.daily),
    `Next ${FORECAST_HOURS}h: max rain chance ${maxRainChance}%, max wind ${maxWindNext} km/h`,
  ].filter(line => line !== null).join("\n");
}

/** Today's summary from the daily values; a missing value is left out, and with none there's no line. */
function todayLine(daily: WeatherReading["daily"]): string | null {
  const today = (series: (number | null)[] | undefined) => series?.[0] ?? null;

  const code = today(daily?.weather_code);
  const high = today(daily?.temperature_2m_max);
  const low = today(daily?.temperature_2m_min);
  const precipitation = today(daily?.precipitation_sum);
  const precipitationChance = today(daily?.precipitation_probability_max);
  const wind = today(daily?.wind_speed_10m_max);
  const gusts = today(daily?.wind_gusts_10m_max);

  const parts = [
    high !== null ? `high ${high}°C` : null,
    low !== null ? `low ${low}°C` : null,
    code !== null ? describeCode(code) : null,
    precipitation !== null ? `${precipitation} mm of precipitation` : null,
    precipitationChance !== null ? `max chance of precipitation ${precipitationChance}%` : null,
    wind !== null ? `wind up to ${wind} km/h` : null,
    gusts !== null ? `gusts ${gusts} km/h` : null,
  ].filter(part => part !== null);

  return parts.length > 0 ? `Today: ${parts.join(", ")}` : null;
}

function describeCode(code: number): string {
  return WMO_CODES[code] ?? `code ${code}`;
}

/** The series' highest value; 0 for a missing or all-null series, where Math.max() would be -Infinity. */
function maxOverForecast(series: (number | null)[] | undefined): number {
  const values = (series ?? []).slice(0, FORECAST_HOURS).filter(value => value !== null);
  return values.length > 0 ? Math.max(...values) : 0;
}
