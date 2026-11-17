# EUR / BRL exchange rate

A compact card showing the latest EUR ↔ BRL reference rate, the change since the previous trading day, a 7D / 30D / 90D / 1Y sparkline, and an optional converter.

Data comes from the free [Frankfurter API](https://frankfurter.dev/); no API key is needed.

> Rates are **daily reference rates**, published once per working day. They are not real-time market rates, and there are no observations on weekends or holidays.

For running locally, deploying and embedding, see the [repository README](../README.md). Opening `index.html` directly in a browser also works.

## Size in Notion

Around 180px tall works for a full-width block; around 280px for a narrow column, where the layout stacks. Add about 50px in a narrow column when the converter is shown.

When the embed is too short to fit the chart, the chart is hidden and only the rate remains: below 165px for a wide block, or below 240px for a narrow column (290px with the converter).

## Customize

**Per embed, with URL parameters** — no code changes needed:

| Parameter | Values | Default |
| --- | --- | --- |
| `from` | `EUR`, `BRL` | `EUR` |
| `period` | `7`, `30`, `90`, `365` | `30` |
| `converter` | `true`, `false` | `false` |
| `theme` | `light` | dark (`#191919`, Notion's dark background) |

Example: `…/eur-brl/?from=BRL&period=90&converter=true`

The widget is always dark, to match Notion's dark theme, regardless of the system setting. Add `?theme=light` for a white version.

**Defaults, in `app.js`** — the `CONFIG` object at the top:

- `defaultFrom` — starting direction (`'EUR'` or `'BRL'`)
- `defaultPeriod` — starting chart period in days
- `showConverter` — whether the amount input and converted value are shown
- `refreshMinutes` — how often the rate is re-fetched while the page is open
- `rateDecimals` — decimals shown in the headline rate
- `locale` — number and date formatting, e.g. `'pt-BR'` or `'de-DE'`

**Colors, in `styles.css`** — the custom properties at the top (`--bg`, `--text`, `--line`, `--up`, `--down`, `--radius`, …). Dark values are in `:root`; the light values used by `?theme=light` are in the block below it.

## How it works

- On load, the widget requests the latest rate and one year of history. Shorter periods are sliced from that history in memory, so switching periods or direction makes no further requests.
- Each refresh requests only the latest rate. History is reloaded only when a new trading day appears.
- The change percentage compares the two most recent observations returned by the API, so it is correct across weekends and holidays.
- BRL → EUR is the inverse of the EUR → BRL rate.
- If a request fails, the last successfully loaded rate stays on screen with a note; if nothing has loaded, the widget shows an empty state rather than a number.
