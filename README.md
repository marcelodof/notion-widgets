# notion-widgets

Small static widgets for embedding in Notion.

## EUR / BRL exchange rate (`eur-brl/`)

A compact card showing the latest EUR ↔ BRL reference rate, the change since the previous trading day, a converter, and a 7D / 30D / 90D / 1Y sparkline.

Plain HTML, CSS and JavaScript — no build step, no dependencies, no API key. Data comes from the free [Frankfurter API](https://frankfurter.dev/).

> Rates are **daily reference rates**, published once per working day. They are not real-time market rates, and there are no observations on weekends or holidays.

### Run locally

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000/eur-brl/>. Opening `eur-brl/index.html` directly in a browser also works.

### Deploy to GitHub Pages

1. Push this repository to GitHub.
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*, pick `main` and `/ (root)`, and save.
4. After a minute the widget is live at `https://<username>.github.io/<repo>/eur-brl/`.

The repository must be public for Pages on a free GitHub plan. The empty `.nojekyll` file tells Pages to serve the files as they are.

### Embed in Notion

1. In a Notion page, type `/embed` and press Enter.
2. Paste the widget URL and click **Embed link**.
3. Drag the edges of the block to resize it. Around 190px tall works for a full-width block; around 330px for a narrow column, where the layout stacks.

### Customize

**Per embed, with URL parameters** — no code changes needed:

| Parameter | Values | Default |
| --- | --- | --- |
| `from` | `EUR`, `BRL` | `EUR` |
| `period` | `7`, `30`, `90`, `365` | `30` |
| `theme` | `light` | dark (`#191919`, Notion's dark background) |

Example: `…/eur-brl/?from=BRL&period=90`

The widget is always dark, to match Notion's dark theme, regardless of the system setting. Add `?theme=light` for a white version.

**Defaults, in `eur-brl/app.js`** — the `CONFIG` object at the top:

- `defaultFrom` — starting direction (`'EUR'` or `'BRL'`)
- `defaultPeriod` — starting chart period in days
- `refreshMinutes` — how often the rate is re-fetched while the page is open
- `rateDecimals` — decimals shown in the headline rate
- `locale` — number and date formatting, e.g. `'pt-BR'` or `'de-DE'`

**Colors, in `eur-brl/styles.css`** — the custom properties at the top (`--bg`, `--text`, `--line`, `--up`, `--down`, `--radius`, …). Dark values are in `:root`; the light values used by `?theme=light` are in the block below it.

### How it works

- On load, the widget requests the latest rate and one year of history. Shorter periods are sliced from that history in memory, so switching periods or direction makes no further requests.
- Each refresh requests only the latest rate. History is reloaded only when a new trading day appears.
- The change percentage compares the two most recent observations returned by the API, so it is correct across weekends and holidays.
- BRL → EUR is the inverse of the EUR → BRL rate.
- If a request fails, the last successfully loaded rate stays on screen with a note; if nothing has loaded, the widget shows an empty state rather than a number.
