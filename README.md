# notion-widgets

A collection of small static widgets for embedding in Notion.

Each widget lives in its own folder and is plain HTML, CSS and JavaScript — no build step, no dependencies, no backend. The whole repository is served by GitHub Pages, so every folder is its own embeddable URL.

## Widgets

| Widget | Folder | Description |
| --- | --- | --- |
| EUR / BRL exchange rate | [`eur-brl/`](eur-brl/) | Latest reference rate, daily change, converter and historical sparkline. |
| Finances | [`finances/`](finances/) | Spend and patrimony charts read from a private Google Sheet through an Apps Script. |

Each widget's own README covers its options and customization.

## Run locally

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/<widget-folder>/`, e.g. <http://localhost:8000/eur-brl/>.

## Deploy to GitHub Pages

One-time setup:

1. Push this repository to GitHub.
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*, pick `main` and `/ (root)`, and save.

From then on, every push to `main` redeploys all widgets. Each one is available at:

```
https://<username>.github.io/<repo>/<widget-folder>/
```

The repository must be public for Pages on a free GitHub plan. The empty `.nojekyll` file tells Pages to serve the files as they are, without Jekyll processing.

## Embed in Notion

1. In a Notion page, type `/embed` and press Enter.
2. Paste the widget URL and click **Embed link**.
3. Drag the edges of the block to resize it.

## Add a new widget

1. Create a folder at the repository root with an `index.html` in it.
2. Reference its assets with relative paths (`styles.css`, not `/styles.css`) — an absolute path points outside the repository on GitHub Pages.
3. Add a row to the [Widgets](#widgets) table and a README in the folder.
4. Push to `main`. The widget is live at its folder URL about a minute later.

The technical and design conventions for widgets are in [`AGENTS.md`](AGENTS.md), which coding agents read before working in this repository.
