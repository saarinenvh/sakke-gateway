import { fetchForecast } from "./client.js";
import type { WeatherReading } from "./schema.js";

const FORECAST_HOURS = 6;

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

export async function getWeather(): Promise<string> {
  return formatWeather(await fetchForecast());
}

export function formatWeather(reading: WeatherReading): string {
  const c = reading.current;

  const condition = WMO_CODES[c.weather_code] ?? `code ${c.weather_code}`;
  const maxRainChance = maxOverForecast(reading.hourly.precipitation_probability);
  const maxWindNext6 = maxOverForecast(reading.hourly.wind_speed_10m);

  return [
    `Conditions: ${condition}`,
    `Temperature: ${c.temperature_2m}°C (feels like ${c.apparent_temperature}°C)`,
    `Wind: ${c.wind_speed_10m} km/h, gusts up to ${c.wind_gusts_10m} km/h`,
    `Current precipitation: ${c.precipitation} mm`,
    `Next 6h: max rain chance ${maxRainChance}%, max wind ${maxWindNext6} km/h`,
  ].join("\n");
}

// Math.max() with no arguments is -Infinity, so a missing or all-null series
// once had Sakke reading out "max rain chance minus Infinity percent".
function maxOverForecast(series: (number | null)[] | undefined): number {
  const values = (series ?? []).slice(0, FORECAST_HOURS).filter(value => value !== null);
  return values.length > 0 ? Math.max(...values) : 0;
}
