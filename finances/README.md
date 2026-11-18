# Finances

Charts and headline numbers read from a **private** Google Sheet: spend per month, average spend by category, and patrimony over time. Each chart or number is a separate view, so every one can be its own Notion embed.

The sheet is never shared. A small Google Apps Script attached to it ([`Code.gs`](Code.gs)) returns only the values the widget draws, and the widget reads them from the script's URL.

For running locally, deploying and embedding, see the [repository README](../README.md).

## Set up the sheet (once)

1. **Use a native Google Sheet.** A file showing an `.XLSX` badge next to its title can't run scripts: use **File → Save as Google Sheets** and work in the copy.
2. Open **Extensions → Apps Script**, replace the editor's contents with [`Code.gs`](Code.gs) and save.
3. Check the `RANGES` block at the top of the script against your sheet (see [Sheet layout](#sheet-layout)).
4. **Deploy → New deployment → Web app**, with *Execute as: Me* and *Who has access: Anyone*.
5. Approve the permission prompt. Google warns that the app is unverified, which is expected for your own script: **Advanced → Go to … (unsafe)**.
6. Copy the web app URL ending in `/exec`. Opening it in a browser should show JSON.

Work or school Google accounts often can't deploy with *Anyone* access. If the URL asks you to sign in, the widget can't read it — use a sheet owned by a personal account.

After editing the script, publish the change with **Deploy → Manage deployments → Edit → Version: New version**. The URL stays the same.

## Embed

```
https://<username>.github.io/<repo>/finances/?view=spend&api=<web app URL>
```

| `view` | Shows | Suggested height |
| --- | --- | --- |
| `spend` (default) | Average spend, plus one line per year of monthly spend, with months along the bottom and a scale on the right. Hovering a month compares every year, with the selected one emphasized. | 190px wide, 330px narrow |
| `breakdown` | Average spend by category, as bars | 190px wide, 330px narrow |
| `patrimony` | Total patrimony, average growth, and the patrimony line with years along the bottom | 190px wide, 330px narrow |
| `average-spend` | Average spend, number only | 140px |
| `total-patrimony` | Total patrimony and average growth, numbers only | 140px |
| `patrimony-growth` | Average patrimony growth, number only | 140px |

Other parameters:

| Parameter | Values | Default |
| --- | --- | --- |
| `api` | The Apps Script web app URL | none — required |
| `year` | Year highlighted in the `spend` chart, e.g. `2025` | latest year with data |
| `period` | Range of the `patrimony` chart: `6`, `12`, `all` | `all` |
| `theme` | `light` | dark (`#191919`, Notion's dark background) |

When the embed is too short for a chart, the chart is hidden and the number remains: below 165px for a wide block, or below 280px for a narrow column. When the category bars don't all fit, the smallest categories are summed into one "Other" row.

## Privacy

- The sheet stays private. Anyone who has the `/exec` URL can read what the script returns — the numbers the widget shows — but nothing else in the spreadsheet.
- Keep the URL out of this repository, which is public: pass it with `api=` in the Notion embed rather than setting `apiUrl` in `app.js`.
- Parameters are also read after a `#` (`…/finances/#view=spend&api=…`). That part of a URL is never sent to GitHub's servers.
- To revoke access, archive the deployment under **Deploy → Manage deployments**.

## Sheet layout

`RANGES` in `Code.gs` points at six places. Each value is an A1 address or the name of a named range (**Data → Named ranges**), which keeps working when a table is moved.

| Key | Default | Expected contents |
| --- | --- | --- |
| `spendPerMonth` | `Charts!B4:F16` | Header row, then one row per month. First column is the month label; each other column is a year, with the year in its header (`Spend 2026`). |
| `spendBreakdown` | `Charts!I4:J16` | Header row, then category and amount. |
| `averageSpend` | `Charts!L6` | One number. |
| `patrimony` | `Charts!P4:Q` | Header row, then month (a date or `MM/YYYY`) and amount. Open-ended, so new months are picked up. |
| `averagePatrimonyGrowth` | `Charts!T5` | One number. |
| `totalPatrimony` | `Charts!T16` | One number. |

Adding a year means widening `spendPerMonth` by one column (`B4:G16`) and publishing a new version.

How values are read:

- A spend of `0` is treated as "no data yet", so months that haven't happened don't pull the line to zero.
- Patrimony rows dated after the current month are ignored.
- The `spend` chart draws the most recent four years (`maxYears`).

## Customize

**Defaults, in `app.js`** — the `CONFIG` object at the top:

- `defaultView`, `defaultPeriod` — used when the parameter is absent
- `maxYears` — years drawn in the spend chart
- `refreshMinutes` — how often the sheet is re-read while the page is open
- `currencySymbol`, `locale` — money formatting (`de-DE` gives `€3.138,92`)
- `dateLocale` — month names and times

Titles are in the `VIEWS` object below it.

**Colors, in `styles.css`** — the custom properties at the top. Dark values are in `:root`; the light values used by `?theme=light` are in the block below it.

## How it works

- One request to the script returns everything; every view and chart range is derived from it in memory.
- If a refresh fails, the last loaded values stay on screen with a note. If nothing has loaded, the widget shows an empty state rather than a number.
- If a range in `Code.gs` is wrong, the script returns an error instead of data; hover the footer note to read it.
