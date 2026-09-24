// Blank is not the same as unset.
//
// docker-compose substitutes an unset variable as an empty string, and a .env
// routinely carries blank entries ("OLLAMA_THINK="), so `process.env.X` arrives
// as "" rather than undefined - and `"" ?? fallback` evaluates to "", not the
// fallback. That broke get_weather in production: WEATHER_LAT/WEATHER_LON are
// not in the server's .env, so once docker-compose started passing them
// explicitly they became "", Open-Meteo was called with `latitude=&longitude=`,
// answered 200 with a zero-byte body, and res.json() threw "Unexpected end of
// JSON input" - a default that had been correct for months, silently skipped.
//
// Every module reading configuration goes through this, so the whole class is
// closed rather than the two files that happened to be noticed first.
export function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value;
}
