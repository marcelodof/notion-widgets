# Agent guide

This repository is a collection of small static widgets embedded in a personal Notion dashboard. GitHub Pages serves the repository root from `main`, so each top-level folder is a live URL: `https://<username>.github.io/<repo>/<widget-folder>/`.

`eur-brl/` is the reference implementation. Read it before building a new widget and match its structure and visual style.

## Structure

- One folder per widget at the repository root, containing `index.html`, `styles.css`, `app.js` and a `README.md`.
- Widgets are self-contained. Don't share code between folders unless asked.
- Folder names are lowercase kebab-case and must not start with `_` or `.`.

## Technical rules

- Vanilla HTML, CSS and JavaScript. No frameworks, no build step, no package manager.
- No backend, API keys or paid services. Only free, CORS-enabled public APIs.
- Asset paths are relative (`styles.css`, not `/styles.css`); absolute paths break under the Pages sub-path.
- Widgets must also work when `index.html` is opened directly from disk, so use a plain `<script src>`, not ES modules.
- In `app.js`, keep configuration, API calls, calculations, formatting and rendering in separate sections, with a `CONFIG` object at the top.
- Verify an API's real response shape with `curl` before writing the parsing code, and validate responses at runtime.

## Design rules

- Dark by default: background `#191919`, Notion-like neutral colors, defined as CSS custom properties at the top of `styles.css`. `?theme=light` switches to the light tokens.
- Minimal: system fonts, soft rounded corners, no shadows or gradients. Color is reserved for meaning (e.g. green/red for change).
- Never add a border to a widget: not around the card, and not around charts or other sections inside it. That includes focus rings that frame a whole chart; show focus within the chart instead (e.g. its hover marker).
- The widget fills its iframe. It must look right both as a wide, short block (about 640×190) and in a narrow column (about 300×330, down to 240 wide), without scrolling.
- Semantic HTML, labelled buttons and inputs, visible focus states, and `prefers-reduced-motion` respected.

## Behavior rules

- Never display fabricated or placeholder data. If a request fails, keep the last real value with a note; if nothing has loaded, show an empty state.
- Show a subtle loading state.
- Per-embed options are URL parameters (as in `?from=BRL&period=90`), with defaults in `CONFIG`.
- Keep API calls to a minimum: cache in memory and derive views from data already loaded.

## Verifying a change

Serve the repository with `python3 -m http.server 8000` and check the widget in a browser, or screenshot it with headless Chrome. Check the wide and narrow sizes inside an `<iframe>`, the interactive controls, and the failure state with the API unreachable.

## Documentation

- When adding a widget, add a row to the Widgets table in the root `README.md` and write a `README.md` in the widget folder covering its options and customization.
- The root `README.md` is for people using the repository. Rules for building widgets belong in this file.
