import { z } from "zod";

// Open-Meteo → gateway, GET /v1/forecast with the current and hourly
// variables client.ts asks for, one forecast day and timezone=auto.

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
    time: "2026-10-03T08:00", // ignored
    interval: 900, // ignored
    temperature_2m: 9.4,
    apparent_temperature: 6.8,
    precipitation: 0,
    wind_speed_10m: 14.2,
    wind_gusts_10m: 27.4,
    weather_code: 3,
  },
  hourly_units: { // ignored
    time: "iso8601",
    temperature_2m: "°C",
    precipitation_probability: "%",
    wind_speed_10m: "km/h",
  },
  hourly: {
    time: [ // ignored
      "2026-10-03T00:00", "2026-10-03T01:00", "2026-10-03T02:00", "2026-10-03T03:00",
      "2026-10-03T04:00", "2026-10-03T05:00", "2026-10-03T06:00", "2026-10-03T07:00",
      "2026-10-03T08:00", "2026-10-03T09:00", "2026-10-03T10:00", "2026-10-03T11:00",
      "2026-10-03T12:00", "2026-10-03T13:00", "2026-10-03T14:00", "2026-10-03T15:00",
      "2026-10-03T16:00", "2026-10-03T17:00", "2026-10-03T18:00", "2026-10-03T19:00",
      "2026-10-03T20:00", "2026-10-03T21:00", "2026-10-03T22:00", "2026-10-03T23:00",
    ],
    temperature_2m: [ // ignored
      7.1, 6.9, 6.6, 6.4, 6.3, 6.5, 7.2, 8.3, 9.4, 10.5, 11.6, 12.4,
      12.9, 13.1, 12.8, 12.1, 11.2, 10.3, 9.6, 9.1, 8.7, 8.4, 8.1, 7.9,
    ],
    precipitation_probability: [
      5, 5, 3, 3, 0, 0, 2, 8, 12, 20, 35, 41,
      38, 30, 22, 15, 10, 8, 5, 5, 3, 3, 0, 0,
    ],
    wind_speed_10m: [
      9.7, 9.4, 9.0, 8.6, 8.9, 10.1, 11.8, 13.0, 14.2, 15.5, 16.3, 16.9,
      17.2, 16.8, 15.9, 14.4, 12.7, 11.5, 10.6, 10.0, 9.6, 9.2, null, null,
    ],
  },
};

// Open-Meteo leaves gaps in hourly series as null rather than dropping them.
const hourlySeriesSchema = z.array(z.number().nullable()).optional();

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
    precipitation_probability: hourlySeriesSchema,
    wind_speed_10m: hourlySeriesSchema,
  }),
});

export type WeatherReading = z.output<typeof weatherReadingSchema>;
