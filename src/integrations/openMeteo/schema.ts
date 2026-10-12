import { z } from "zod";

// Open-Meteo → gateway, GET /v1/forecast with the variables client.ts asks for: the current
// conditions, the hourly series for the next six hours from the current hour, and today's daily
// summary, in the location's own time zone (timezone=auto).

export const weatherReadingExample = {
  latitude: 60.17, // ignored
  longitude: 24.94, // ignored
  generationtime_ms: 0.08, // ignored
  utc_offset_seconds: 10800, // ignored
  timezone: "Europe/Helsinki", // ignored
  timezone_abbreviation: "GMT+3", // ignored
  elevation: 12, // ignored
  current_units: { // ignored
    time: "iso8601",
    interval: "seconds",
    temperature_2m: "°C",
    apparent_temperature: "°C",
    precipitation: "mm",
    wind_speed_10m: "km/h",
    wind_gusts_10m: "km/h",
    weather_code: "wmo code",
  },
  current: {
    time: "2026-10-03T14:30", // ignored
    interval: 900, // ignored
    temperature_2m: 12.8,
    apparent_temperature: 10.6,
    precipitation: 0,
    wind_speed_10m: 15.9,
    wind_gusts_10m: 31.2,
    weather_code: 3,
  },
  hourly_units: { // ignored
    time: "iso8601",
    precipitation_probability: "%",
    wind_speed_10m: "km/h",
  },
  hourly: {
    time: [ // ignored
      "2026-10-03T14:00", "2026-10-03T15:00", "2026-10-03T16:00",
      "2026-10-03T17:00", "2026-10-03T18:00", "2026-10-03T19:00",
    ],
    precipitation_probability: [22, 15, 10, 8, 5, 5],
    wind_speed_10m: [15.9, 14.4, 12.7, 11.5, 10.6, null],
  },
  daily_units: { // ignored
    time: "iso8601",
    weather_code: "wmo code",
    temperature_2m_max: "°C",
    temperature_2m_min: "°C",
    precipitation_sum: "mm",
    precipitation_probability_max: "%",
    wind_speed_10m_max: "km/h",
    wind_gusts_10m_max: "km/h",
  },
  daily: {
    time: ["2026-10-03"], // ignored
    weather_code: [61],
    temperature_2m_max: [13.1],
    temperature_2m_min: [6.3],
    precipitation_sum: [2.4],
    precipitation_probability_max: [41],
    wind_speed_10m_max: [17.2],
    wind_gusts_10m_max: [33.8],
  },
};

// Open-Meteo leaves gaps in hourly and daily series as null rather than dropping them.
const seriesSchema = z.array(z.number().nullable()).optional();

export const weatherReadingSchema = z.object({
  current: z.object({
    weather_code: z.number(),
    temperature_2m: z.number(),
    apparent_temperature: z.number(),
    precipitation: z.number(),
    wind_speed_10m: z.number(),
    wind_gusts_10m: z.number(),
  }),
  hourly: z.object({
    precipitation_probability: seriesSchema,
    wind_speed_10m: seriesSchema,
  }),
  /** One entry per day; the request asks for today only. */
  daily: z.object({
    weather_code: seriesSchema,
    temperature_2m_max: seriesSchema,
    temperature_2m_min: seriesSchema,
    precipitation_sum: seriesSchema,
    precipitation_probability_max: seriesSchema,
    wind_speed_10m_max: seriesSchema,
    wind_gusts_10m_max: seriesSchema,
  }).optional(),
});

export type WeatherReading = z.output<typeof weatherReadingSchema>;
