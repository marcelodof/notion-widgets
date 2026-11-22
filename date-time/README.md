# Date and time

A clock showing the current time with the full date underneath.

The time comes from the clock of the device viewing the page, so by default it follows that device's time zone, including daylight saving changes. There is no API and no network request.

For running locally, deploying and embedding, see the [repository README](../README.md). Opening `index.html` directly in a browser also works.

## Size in Notion

The text scales with the block. Around 140–190px tall works for a full-width block; in a narrow column anything from about 100px tall is enough.

## Customize

**Per embed, with URL parameters** — no code changes needed:

| Parameter | Values | Default |
| --- | --- | --- |
| `tz` | An IANA time zone, e.g. `Europe/Berlin`, `America/Sao_Paulo` | the viewing device's zone |
| `seconds` | `true`, `false` | `false` |
| `hour12` | `true`, `false` | `false` (24-hour) |
| `locale` | A language tag for the weekday and month, e.g. `pt-BR`, `de-DE` | `en-GB` |
| `theme` | `light` | dark (`#191919`, Notion's dark background) |

Example: `…/date-time/?tz=America/Sao_Paulo&locale=pt-BR`

Set `tz` to pin the clock to one zone wherever the page is opened — useful when travelling, or for a second clock showing another city. If the zone name is not recognised, the widget shows the device's time with a note saying so.

**Defaults, in `app.js`** — the `CONFIG` object at the top:

- `timeZone` — a fixed IANA zone, or `''` to follow the device
- `showSeconds` — whether seconds are shown
- `hour12` — 12-hour clock with AM/PM instead of 24-hour
- `locale` — language of the weekday and month

**Colors, in `styles.css`** — the custom properties at the top (`--bg`, `--text`, `--muted`, …). Dark values are in `:root`; the light values used by `?theme=light` are in the block below it.

## How it works

- The display is re-rendered exactly on each minute boundary (each second with `seconds=true`), and again whenever the tab becomes visible, so it does not drift or lag after the page has been in the background.
- Formatting and time zone conversion use the browser's built-in `Intl.DateTimeFormat`.
