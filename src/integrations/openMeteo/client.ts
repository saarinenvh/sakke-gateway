import { config } from "../../config.js";
import { parseJsonResponse } from "../../util/validation.js";
import { weatherReadingSchema, type WeatherReading } from "./schema.js";

const FORECAST_TIMEOUT_MS = 5000;

export async function fetchForecast(): Promise<WeatherReading> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", config.weather.lat);
  url.searchParams.set("longitude", config.weather.lon);
  url.searchParams.set("current", "temperature_2m,apparent_temperature,precipitation,wind_speed_10m,wind_gusts_10m,weather_code");
  url.searchParams.set("hourly", "temperature_2m,precipitation_probability,wind_speed_10m");
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(FORECAST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);

  return parseJsonResponse(res, weatherReadingSchema, "Open-Meteo forecast");
}
