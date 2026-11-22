# Cockpit

A clock showing the current time and full date, with the weather beside it: the place, the current temperature and conditions with an icon, today's high and low, and the next three days.

For running locally, deploying and embedding, see the [repository README](../README.md). Opening `index.html` directly in a browser also works.

## Where the data comes from

- **Time** comes from the clock of the device viewing the page, so by default it follows that device's time zone, including daylight saving changes.
- **Weather** comes from the free [Open-Meteo](https://open-meteo.com/) forecast API; no API key is needed.
- **Location** is, by default, the approximate city of the viewer's IP address, looked up with the free [GeoJS](https://www.geojs.io/) API. This is city-level only, and it is wrong behind a VPN or on some mobile networks — set `place` to fix the location instead.

The browser's precise location is not used: Notion does not grant embeds permission to ask for it.

## Size in Notion

In a full-width block the clock, today's weather and the next days sit side by side; around 140–190px tall works well. In a narrow column they stack, and around 280–330px tall fits everything.

When the embed is too short, the widget drops parts rather than scrolling: in a narrow column the next days are hidden below 250px and the weather below 170px; in a wide block the weather is hidden below 100px.

## Customize

**Per embed, with URL parameters** — no code changes needed:

| Parameter | Values | Default |
| --- | --- | --- |
| `place` | A city name, e.g. `Lisbon`, `Sao Paulo` | approximate location from the IP address |
| `units` | `c`, `f` | `c` |
| `weather` | `true`, `false` | `true` |
| `tz` | An IANA time zone, e.g. `Europe/Berlin`, `America/Sao_Paulo` | the viewing device's zone |
| `seconds` | `true`, `false` | `false` |
| `hour12` | `true`, `false` | `false` (24-hour) |
| `locale` | A language tag for weekday and month names, e.g. `pt-BR`, `de-DE` | `en-GB` |
| `theme` | `light` | dark (`#191919`, Notion's dark background) |

Example: `…/cockpit/?place=Lisbon&tz=Europe/Lisbon`

`place` and `tz` are independent: `place` sets where the weather is for, `tz` sets which zone the clock shows. When several places share a name, the best-known one is used. If the place or zone is not recognised, the widget says so instead of guessing.

Condition names (Clear, Cloudy, Rain, …) are in English regardless of `locale`.

**Defaults, in `app.js`** — the `CONFIG` object at the top:

- `timeZone` — a fixed IANA zone, or `''` to follow the device
- `showSeconds` — whether seconds are shown
- `hour12` — 12-hour clock with AM/PM instead of 24-hour
- `locale` — language of the weekday and month names
- `showWeather` — whether the weather is shown
- `place` — a fixed city name, or `''` to use the IP address
- `units` — `'c'` or `'f'`
- `forecastDays` — how many days are shown after today
- `weatherRefreshMinutes` — how often the forecast is re-fetched while the page is open

The condition names and the icon for each weather code are in the `CONDITIONS` and `ICONS` tables just below `CONFIG`.

**Colors, in `styles.css`** — the custom properties at the top (`--bg`, `--text`, `--muted`, …). Dark values are in `:root`; the light values used by `?theme=light` are in the block below it.

## How it works

- The clock is re-rendered exactly on each minute boundary (each second with `seconds=true`), and again whenever the tab becomes visible, so it does not drift or lag after the page has been in the background.
- The location is looked up once per page load. Each refresh after that is a single forecast request, which returns the current conditions and all the days together.
- The large temperature and icon are the conditions right now (with a moon at night); the two numbers after the condition are today's high and low. Forecast days are the place's own calendar days.
- If a refresh fails, the last loaded weather stays on screen with a note giving the time it was loaded; if nothing has loaded, the widget shows "Weather unavailable" rather than any numbers. The clock keeps working either way.
