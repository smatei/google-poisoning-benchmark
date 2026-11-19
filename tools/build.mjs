// Builds the GitHub Pages site (site/) and the release archives (release/) of the google poisoning benchmark
// from the samples folder of GoogleSearchSamples / GoogleSamplesBenchmark (serpservice).
//
//   node tools/build.mjs [date ...] [--samples=D:\_webgit\awr\test-google-samples] [--keep=3] [--no-release]
//
// - date: the days to (re)build the release archives for; default: the newest day with statistics
// - site/data/stats/<date>.json: the statistics of every day (stats\<date>.json, written by GoogleSamplesBenchmark)
// - site/data/pages/<date>/<source>.zip: the pages of the last --keep days, without scripts, for the viewer
// - release/<date>/<source>.zip: the full pages (scraped/<name>/N.html) and parsed/<name>/serp.json, for the
//   GitHub release of the day
//
// Sources are published with these names: scrapedogoogle -> scrape.do, dataigoogle -> dat.ai, proserpv2google -> pserp,
// proserpv2google-test -> pserp-test.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipWriter } from './zip.mjs';

const kRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kSite = path.join(kRoot, 'site');
const kRelease = path.join(kRoot, 'release');

// the sources of GoogleSearchSamples.kSources; the other folders (e.g. the organic sources, scraperapi-organic) are
// not published
const kSources = ['browser', 'cloro', 'dataforseo', 'dataforseo-resolve-poisoned', 'dataigoogle', 'proserpv2google',
  'proserpv2google-test', 'scrapedogoogle', 'scraper', 'scraperapi'];
const kRename = { scrapedogoogle: 'scrape.do', dataigoogle: 'dat.ai', proserpv2google: 'pserp',
  'proserpv2google-test': 'pserp-test', 'dataforseo-resolve-poisoned': 'dataforseo-rp' };
const PublicName = (aSource) => kRename[aSource] || aSource;

const kDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function ParseArgs() {
  const options = { samples: 'D:\\_webgit\\awr\\test-google-samples', keep: 3, release: true, dates: [],
    maxSamples: 0 };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--samples=')) options.samples = arg.slice(10);
    else if (arg.startsWith('--keep=')) options.keep = Number(arg.slice(7));
    else if (arg === '--no-release') options.release = false;
    else if (arg.startsWith('--max-samples=')) options.maxSamples = Number(arg.slice(14)); // for tests
    else if (kDatePattern.test(arg)) options.dates.push(arg);
    else throw new Error('unknown argument: ' + arg);
  }
  return options;
}

function CopyDir(aFrom, aTo) {
  fs.mkdirSync(aTo, { recursive: true });
  for (const entry of fs.readdirSync(aFrom, { withFileTypes: true })) {
    const from = path.join(aFrom, entry.name);
    const to = path.join(aTo, entry.name);
    if (entry.isDirectory()) CopyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

/** The statistics with the public source names, only the published sources. */
function PublicStats(aStats) {
  const sources = (list) => list.filter((s) => kSources.includes(s)).map(PublicName);
  const byName = (map) => Object.fromEntries(Object.entries(map)
    .filter(([s]) => kSources.includes(s)).map(([s, v]) => [PublicName(s), v]));

  return {
    ...aStats,
    sources: sources(aStats.sources),
    summary: byName(aStats.summary),
    samples: aStats.samples.map((sample) => ({ ...sample, sources: byName(sample.sources) })),
  };
}

/** A Google page for the viewer: no scripts (the iframe does not run them), relative urls go to Google. */
function ViewerHtml(aBuffer) {
  let html = aBuffer.toString('utf8');
  html = html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
  html = html.replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, '');
  html = html.replace(/<link\b[^>]*\bas=["']?script\b[^>]*>/gi, '');
  // the CSP the browser pages were saved with blocks Google's stylesheets; scripts are removed anyway
  html = html.replace(/<meta\b[^>]*http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
  if (!/<base\b/i.test(html)) {
    html = html.replace(/<head\b[^>]*>/i, (head) => head + '<base href="https://www.google.com/" target="_blank">');
  }
  return Buffer.from(html, 'utf8');
}

function SampleFolders(aDir, aMax) {
  if (!fs.existsSync(aDir)) return [];
  const names = fs.readdirSync(aDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  return aMax > 0 ? names.slice(0, aMax) : names;
}

function PageFiles(aDir) {
  return fs.readdirSync(aDir).filter((f) => /^\d+\.html$/.test(f)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

function BuildPagesZip(aSamples, aSource, aDate, aFile, aMax) {
  const scraped = path.join(aSamples, aSource, 'scraped', aDate);
  const zip = new ZipWriter(aFile);
  let pages = 0;
  for (const name of SampleFolders(scraped, aMax)) {
    for (const page of PageFiles(path.join(scraped, name))) {
      const file = path.join(scraped, name, page);
      zip.Add(name + '/' + page, ViewerHtml(fs.readFileSync(file)), fs.statSync(file).mtime);
      pages++;
    }
  }
  zip.Close();
  return pages;
}

function BuildReleaseZip(aSamples, aSource, aDate, aFile, aMax) {
  const scraped = path.join(aSamples, aSource, 'scraped', aDate);
  const parsed = path.join(aSamples, aSource, 'parsed', aDate);
  const zip = new ZipWriter(aFile);
  let pages = 0;
  for (const name of SampleFolders(scraped, aMax)) {
    for (const page of PageFiles(path.join(scraped, name))) {
      const file = path.join(scraped, name, page);
      zip.Add('scraped/' + name + '/' + page, fs.readFileSync(file), fs.statSync(file).mtime);
      pages++;
    }
    const serp = path.join(parsed, name, 'serp.json');
    if (fs.existsSync(serp)) {
      zip.Add('parsed/' + name + '/serp.json', fs.readFileSync(serp), fs.statSync(serp).mtime);
    }
  }
  zip.Close();
  return pages;
}

function SourcesOn(aSamples, aDate) {
  return kSources.filter((s) => fs.existsSync(path.join(aSamples, s, 'scraped', aDate)));
}

function Main() {
  const options = ParseArgs();
  const statsDir = path.join(options.samples, 'stats');
  const allDates = fs.readdirSync(statsDir).map((f) => f.replace(/\.json$/, '')).filter((d) => kDatePattern.test(d))
    .sort().reverse();
  if (!allDates.length) throw new Error('no statistics in ' + statsDir + ': run GoogleSamplesBenchmark first');

  const releaseDates = options.dates.length ? options.dates : [allDates[0]];
  const pageDates = allDates.slice(0, options.keep);
  for (const d of releaseDates) {
    if (!allDates.includes(d)) throw new Error('no statistics for ' + d + ': run GoogleSamplesBenchmark ' + d);
  }

  // the web app
  CopyDir(path.join(kRoot, 'web'), kSite);

  // the statistics of every day
  const dataDir = path.join(kSite, 'data');
  fs.mkdirSync(path.join(dataDir, 'stats'), { recursive: true });
  for (const d of allDates) {
    const stats = JSON.parse(fs.readFileSync(path.join(statsDir, d + '.json'), 'utf8'));
    fs.writeFileSync(path.join(dataDir, 'stats', d + '.json'), JSON.stringify(PublicStats(stats)));
  }
  fs.writeFileSync(path.join(dataDir, 'dates.json'), JSON.stringify(allDates));
  // the summary of every day (the trend), oldest first
  fs.writeFileSync(path.join(dataDir, 'summary.json'), JSON.stringify(allDates.slice().reverse().map((d) => ({
    date: d, summary: JSON.parse(fs.readFileSync(path.join(dataDir, 'stats', d + '.json'), 'utf8')).summary }))));
  fs.writeFileSync(path.join(dataDir, 'pages.json'), JSON.stringify(pageDates));
  console.log('statistics: ' + allDates.join(', '));

  // the pages of the last days, for the viewer; older days are removed (they stay in the releases)
  const pagesDir = path.join(dataDir, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  for (const d of fs.readdirSync(pagesDir)) {
    if (!pageDates.includes(d)) {
      fs.rmSync(path.join(pagesDir, d), { recursive: true, force: true });
      console.log('pages ' + d + ': removed (older than the last ' + options.keep + ' days)');
    }
  }
  for (const d of pageDates) {
    fs.mkdirSync(path.join(pagesDir, d), { recursive: true });
    // zips of sources no longer published (e.g. a renamed source) are removed
    const expected = SourcesOn(options.samples, d).map((s) => PublicName(s) + '.zip');
    for (const f of fs.readdirSync(path.join(pagesDir, d))) {
      if (!expected.includes(f)) fs.rmSync(path.join(pagesDir, d, f), { force: true });
    }
    for (const source of SourcesOn(options.samples, d)) {
      const file = path.join(pagesDir, d, PublicName(source) + '.zip');
      // a day already built is rebuilt only when asked for (a retry of the day)
      if (fs.existsSync(file) && !releaseDates.includes(d)) continue;
      const pages = BuildPagesZip(options.samples, source, d, file, options.maxSamples);
      console.log('pages ' + d + ' ' + PublicName(source) + ': ' + pages + ' pages, '
        + (fs.statSync(file).size / 1048576).toFixed(1) + ' MB');
    }
  }

  // the full archives for the releases
  if (options.release) {
    for (const d of releaseDates) {
      const dir = path.join(kRelease, d);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      for (const source of SourcesOn(options.samples, d)) {
        const file = path.join(dir, PublicName(source) + '.zip');
        const pages = BuildReleaseZip(options.samples, source, d, file, options.maxSamples);
        console.log('release ' + d + ' ' + PublicName(source) + ': ' + pages + ' pages, '
          + (fs.statSync(file).size / 1048576).toFixed(1) + ' MB');
      }
      fs.copyFileSync(path.join(dataDir, 'stats', d + '.json'), path.join(dir, 'stats-' + d + '.json'));
    }
  }

  console.log('\nnext: node tools/publish.mjs ' + releaseDates.join(' '));
}

Main();
