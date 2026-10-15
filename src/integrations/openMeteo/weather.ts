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
const SNOW_CODES: ReadonlySet<number> = new Set([71, 73, 75, 77, 85, 86]);

type PrecipitationKind = "rain" | "snow";

/** Ordered by upper bound; a value takes the first word whose bound is above it. */
type WordScale = readonly (readonly [upperBound: number, word: string])[];

const PRECIPITATION_CHANCE_WORDS_PCT: WordScale = [
  [20, "unlikely"], [50, "possible"], [80, "likely"], [Infinity, "almost certain"],
];
const DAILY_PRECIPITATION_WORDS_MM: WordScale = [
  [1, "a little"], [5, "some"], [15, "a lot of"], [Infinity, "heavy"],
];
// Open-Meteo's current precipitation is the preceding 15 minutes' sum: these are the usual
// light/heavy rates of 2.5 and 7.6 mm/h over a quarter of an hour.
const CURRENT_PRECIPITATION_WORDS_MM_PER_15_MIN: WordScale = [
  [0.6, "light"], [1.9, "moderate"], [Infinity, "heavy"],
];

const UNLIKELY_PRECIPITATION_PCT = 20;
const NOTICEABLE_FEELS_LIKE_DIFFERENCE_DEGREES = 2;

/** The weather as text for the model; throws when it can't be read, as the tool and the brief expect. */
export async function getWeather(): Promise<string> {
  const forecast = await getForecast();
  if (forecast.kind === "failed") throw new Error(forecast.reason);

  return formatWeather(forecast.reading);
}

/**
 * The weather as lines in everyday words, since it is spoken: whole degrees, wind in whole meters
 * per second spelled out, and rain in words rather than mm and percentages. The current conditions
 * come first (the morning brief's fallback reads the first two), then today's summary for the
 * whole day, then the next hours from now.
 */
export function formatWeather(reading: WeatherReading): string {
  const current = reading.current;
  const currentKind = precipitationKind(current.weather_code);

  return [
    `Conditions: ${describeCode(current.weather_code)}`,
    `Temperature: ${describeTemperature(current.temperature_2m, current.apparent_temperature)}`,
    `Wind: ${describeWind(current.wind_speed_10m, current.wind_gusts_10m)}`,
    `Precipitation now: ${describeCurrentPrecipitation(current.precipitation, currentKind)}`,
    todayLine(reading.daily, currentKind),
    nextHoursLine(reading.hourly, currentKind),
  ].filter(line => line !== null).join("\n");
}

/** Today's summary from the daily values; a missing value is left out, and with none there's no line. */
function todayLine(daily: WeatherReading["daily"], currentKind: PrecipitationKind): string | null {
  const today = (series: (number | null)[] | undefined) => series?.[0] ?? null;

  const code = today(daily?.weather_code);
  const high = today(daily?.temperature_2m_max);
  const low = today(daily?.temperature_2m_min);
  const precipitation = today(daily?.precipitation_sum);
  const precipitationChance = today(daily?.precipitation_probability_max);
  const wind = today(daily?.wind_speed_10m_max);
  const gusts = today(daily?.wind_gusts_10m_max);
  const kind = code !== null ? precipitationKind(code) : currentKind;

  const parts = [
    describeTemperatureRange(low, high),
    code !== null ? describeCode(code) : null,
    describePrecipitation(precipitation, precipitationChance, kind),
    wind !== null ? describeWindUpTo(wind, gusts) : null,
  ].filter(part => part !== null);

  return parts.length > 0 ? `Today: ${parts.join(", ")}` : null;
}

/** The next hours' highest chance of rain and strongest wind; the hourly series has no weather code, so it says what falls now. */
function nextHoursLine(hourly: WeatherReading["hourly"], currentKind: PrecipitationKind): string {
  const maxPrecipitationChance = maxOverForecast(hourly.precipitation_probability);
  const maxWind = maxOverForecast(hourly.wind_speed_10m);

  return `Next ${FORECAST_HOURS} hours: ${describePrecipitationChance(maxPrecipitationChance, currentKind)}, ${describeWindUpTo(maxWind, null)}`;
}

function describeCode(code: number): string {
  return WMO_CODES[code] ?? `code ${code}`;
}

/** Whole degrees; the feels-like temperature only when it is noticeably different. */
function describeTemperature(temperature: number, feelsLike: number): string {
  const degrees = Math.round(temperature);
  const feelsLikeDegrees = Math.round(feelsLike);

  const noticeable = Math.abs(degrees - feelsLikeDegrees) >= NOTICEABLE_FEELS_LIKE_DIFFERENCE_DEGREES;
  return noticeable ? `${degrees} degrees, feels like ${feelsLikeDegrees}` : `${degrees} degrees`;
}

function describeTemperatureRange(low: number | null, high: number | null): string | null {
  if (low !== null && high !== null) return `${Math.round(low)} to ${Math.round(high)} degrees`;
  if (high !== null) return `up to ${Math.round(high)} degrees`;
  if (low !== null) return `down to ${Math.round(low)} degrees`;
  return null;
}

/**
 * Whole meters per second, spelled out so the voice doesn't read "m/s" letter by letter; "calm"
 * below half a meter per second, and gusts only when they are stronger than the wind.
 */
function describeWind(speedMs: number, gustsMs: number | null): string {
  const speed = Math.round(speedMs);
  if (speed === 0) return "calm";

  const wind = `${speed} ${speed === 1 ? "meter" : "meters"} per second`;
  const gusts = gustsMs !== null ? Math.round(gustsMs) : null;
  return gusts !== null && gusts > speed ? `${wind}, gusts up to ${gusts}` : wind;
}

function describeWindUpTo(speedMs: number, gustsMs: number | null): string {
  const wind = describeWind(speedMs, gustsMs);
  return wind === "calm" ? wind : `wind up to ${wind}`;
}

function describeCurrentPrecipitation(amountMm: number, kind: PrecipitationKind): string {
  return amountMm > 0 ? `${wordFor(CURRENT_PRECIPITATION_WORDS_MM_PER_15_MIN, amountMm)} ${kind}` : "none";
}

/**
 * How much rain (or snow) to expect today and how likely it is, e.g. "some rain likely"; either value
 * may be missing, and with neither there is nothing to say.
 */
function describePrecipitation(amountMm: number | null, chancePct: number | null, kind: PrecipitationKind): string | null {
  if (amountMm === null) return chancePct !== null ? describePrecipitationChance(chancePct, kind) : null;
  if (amountMm === 0) return `no ${kind} expected`;

  const amount = `${wordFor(DAILY_PRECIPITATION_WORDS_MM, amountMm)} ${kind}`;
  return chancePct !== null ? `${amount} ${wordFor(PRECIPITATION_CHANCE_WORDS_PCT, chancePct)}` : amount;
}

function describePrecipitationChance(chancePct: number, kind: PrecipitationKind): string {
  if (chancePct < UNLIKELY_PRECIPITATION_PCT) return `no ${kind} expected`;
  return `${kind} ${wordFor(PRECIPITATION_CHANCE_WORDS_PCT, chancePct)}`;
}

function precipitationKind(code: number): PrecipitationKind {
  return SNOW_CODES.has(code) ? "snow" : "rain";
}

function wordFor(scale: WordScale, value: number): string {
  const match = scale.find(([upperBound]) => value < upperBound);
  return match?.[1] ?? scale[scale.length - 1][1];
}

/** The series' highest value; 0 for a missing or all-null series, where Math.max() would be -Infinity. */
function maxOverForecast(series: (number | null)[] | undefined): number {
  const values = (series ?? []).slice(0, FORECAST_HOURS).filter(value => value !== null);
  return values.length > 0 ? Math.max(...values) : 0;
}
