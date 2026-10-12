import { config } from "../../config.js";
import { get } from "./client.js";
import { weatherReadingSchema, type WeatherReading } from "./schema.js";

/** How many hours the hourly series covers, from the current hour; it runs past midnight when needed. */
export const FORECAST_HOURS = 6;

export type ForecastResult = { kind: "forecast"; reading: WeatherReading } | { kind: "failed"; reason: string };

/** The current conditions, the next `FORECAST_HOURS` hours, and today's summary (the whole calendar day). */
export async function getForecast(): Promise<ForecastResult> {
  const response = await get("/forecast", {
    latitude: config.weather.lat,
    longitude: config.weather.lon,
    current: "temperature_2m,apparent_temperature,precipitation,wind_speed_10m,wind_gusts_10m,weather_code",
    hourly: "precipitation_probability,wind_speed_10m",
    forecast_hours: String(FORECAST_HOURS),
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max",
    forecast_days: "1",
    timezone: "auto",
  });
  if (response.kind === "failed") return response;

  const reading = weatherReadingSchema.safeParse(response.body);
  if (!reading.success) return { kind: "failed", reason: "Invalid Open-Meteo forecast" };

  return { kind: "forecast", reading: reading.data };
}
