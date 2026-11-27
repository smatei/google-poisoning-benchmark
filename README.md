# Google Poisoning Benchmark

Daily benchmark of Google SERP providers against a real browser (natural search): hard poisoning (manual
review), soft poisoning (Nozzle method) and the match of the results with the browser.

- Site: https://smatei.github.io/google-poisoning-benchmark/ (statistics per day, trend, the pages of the
  last 4 days side by side with the browser)
- Downloads: one release per day, https://github.com/smatei/google-poisoning-benchmark/releases, with one
  archive per source: `scraped/<request>/N.html` (page N+1) and `parsed/<request>/serp.json`, plus
  `stats-<date>.json`

## Layout

| Path | What |
|---|---|
| `web/` | the site (Vue 3, no build step); `app.js` reads `data/` |
| `tools/build.mjs` | builds `site/` (web + data) and `release/<date>/` from the samples folder |
| `tools/publish.mjs` | pushes `site/` to the `gh-pages` branch (one commit, no history), uploads the releases and deletes the local `release/<date>/` already on GitHub, except the newest (`--no-cleanup` keeps them) |
| `site/`, `release/` | generated, not committed on `main` |

`site/data/`: `dates.json`, `pages.json` (days with pages), `summary.json` (trend),
`stats/<date>.json`, `pages/<date>/<source>.zip` (pages without scripts, read with HTTP range requests).

Sources are published as: `browser`, `cloro.ai` (cloro), `dataforseo`, `dataforseo-rp` (dataforseo-resolve-poisoned:
dataforseo with `"resolve_poisoned_results": true`), `dat.ai` (dataigoogle), `dat.ai-geo` (dataigoogle-city: dat.ai
with the latitude / longitude in `geo`), `oxylabs` (Web Scraper API realtime, source google with the url), `decodo`,
`pserp` (proserpv2google), `pserp-test` (proserpv2google-test: proserpv2google with `"engine": "test"`), `scraper.com`
(scraper), `scraperapi.com` (scraperapi), `scrape.do` (scrapedogoogle).

## Every day

Requirements: Node 22+, git, and the GitHub CLI (`gh auth login` once) for the releases.

1. Take the samples (GoogleSearchSamples), mark the hard poisoning, run `GoogleSamplesBenchmark <date>`
   (writes `stats\<date>.json` in the samples folder).
2. In this folder:

   ```
   node tools/build.mjs 2026-11-16
   node tools/publish.mjs 2026-11-16
   ```

   `build.mjs` options: `--samples=D:\_webgit\awr\test-google-samples` (default), `--keep=4` (days with pages
   on the site), `--no-release`. Without a date it builds the newest day.
   A retry of a day: run both again with that date (the site pages and the release are replaced).

GitHub Pages: Settings -> Pages -> Deploy from a branch -> `gh-pages` / `(root)`.
