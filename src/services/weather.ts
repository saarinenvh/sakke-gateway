const lat = process.env.WEATHER_LAT ?? "60.1583";
const lon = process.env.WEATHER_LON ?? "24.7339";

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
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat);
  url.searchParams.set("longitude", lon);
  url.searchParams.set("current", "temperature_2m,apparent_temperature,precipitation,wind_speed_10m,wind_gusts_10m,weather_code");
  url.searchParams.set("hourly", "temperature_2m,precipitation_probability,wind_speed_10m");
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);

  const data = await res.json() as any;
  const c = data.current;
  const hourly = data.hourly;

  const condition = WMO_CODES[c.weather_code] ?? `code ${c.weather_code}`;
  const next6 = hourly.precipitation_probability?.slice(0, 6) ?? [];
  const maxRainChance = Math.max(...next6);
  const maxWindNext6 = Math.max(...(hourly.wind_speed_10m?.slice(0, 6) ?? [0]));

  return [
    `Conditions: ${condition}`,
    `Temperature: ${c.temperature_2m}°C (feels like ${c.apparent_temperature}°C)`,
    `Wind: ${c.wind_speed_10m} km/h, gusts up to ${c.wind_gusts_10m} km/h`,
    `Current precipitation: ${c.precipitation} mm`,
    `Next 6h: max rain chance ${maxRainChance}%, max wind ${maxWindNext6} km/h`,
  ].join("\n");
}
