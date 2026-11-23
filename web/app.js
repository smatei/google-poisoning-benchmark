// Google Poisoning Benchmark: the daily statistics, the trend, and the saved pages of a keyword side by side
// (the browser and one provider), read from the zips in data/pages/<date>/<source>.zip with HTTP range requests.
import { unzip } from 'https://cdn.jsdelivr.net/npm/unzipit@1.4.3/dist/unzipit.module.js';

const kRepo = 'smatei/google-poisoning-benchmark';
const kPages = [1, 2, 3, 4, 5];
// sources removed from the benchmark, hidden also in the days published before (none now: pserp-test shown again
// from 2026-11-23, no day published before has it)
const kHiddenSources = [];
const IsShown = (aSource) => aSource !== 'browser' && !kHiddenSources.includes(aSource);

const VIEWS = [
  { key: 'overview', label: 'Overview' },
  { key: 'trend', label: 'Trend' },
  { key: 'keywords', label: 'Keywords' },
  { key: 'downloads', label: 'Downloads' },
  { key: 'about', label: 'Method' },
];

const TREND_METRICS = [
  { key: 'hardPct', label: 'Hard poisoning % (pages)' },
  { key: 'softPct', label: 'Soft poisoning % (pages)' },
  { key: 'title10', label: 'Title match top 10 %' },
  { key: 'title50', label: 'Title match top 50 %' },
  { key: 'domain50', label: 'Domain match top 50 %' },
];

const GetJson = async (url) => {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(r.status + ' ' + url);
  return r.json();
};

/** unzipit reader: HTTP range requests, or the whole file when the server does not do ranges. */
class RangeReader {
  constructor(url) { this.url = url; this.whole = null; this.length = undefined; }

  async LoadWhole() {
    const r = await fetch(this.url);
    if (!r.ok) throw new Error(r.status + ' ' + this.url);
    this.whole = new Uint8Array(await r.arrayBuffer());
    this.length = this.whole.length;
  }

  async getLength() {
    if (this.length === undefined) {
      const r = await fetch(this.url, { method: 'HEAD' });
      const n = Number(r.headers.get('content-length'));
      if (r.ok && n > 0 && !r.headers.get('content-encoding')) this.length = n;
      else await this.LoadWhole();
    }
    return this.length;
  }

  async read(offset, length) {
    if (this.whole) return this.whole.slice(offset, offset + length);
    const r = await fetch(this.url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
    if (r.status === 206) return new Uint8Array(await r.arrayBuffer());
    if (!r.ok) throw new Error(r.status + ' ' + this.url);
    this.whole = new Uint8Array(await r.arrayBuffer());
    this.length = this.whole.length;
    return this.whole.slice(offset, offset + length);
  }
}

const zips = new Map();
const OpenZip = (date, source) => {
  const key = date + '/' + source;
  if (!zips.has(key)) {
    const p = unzip(new RangeReader(`data/pages/${date}/${source}.zip`)).then((z) => z.entries);
    p.catch(() => zips.delete(key));
    zips.set(key, p);
  }
  return zips.get(key);
};

const pct = (a, b) => (b ? Math.round((a * 1000) / b) / 10 : 0);

const Summarize = (s) => {
  if (!s) return null;
  const m = s.match || {};
  return {
    samples: s.samples, pages: s.pages, hard: s.hard, hardPct: pct(s.hard, s.pages), hardByPage: s.hardByPage || [],
    partial: s.partial, samplesHard: s.samplesHardPoisoned, softPct: pct(s.soft, s.softCounted),
    softByPage: s.softByPage || [], title10: m.title10 || 0, title50: m.title50 || 0, url10: m.url10 || 0,
    domain50: m.domain50 || 0, rankDiff: m.rankDiff || 0,
  };
};

const Count = (src, verdict) => (src ? src.pages.filter((p) => p.poisoning === verdict).length : 0);
const SoftCount = (src) => (src ? src.pages.filter((p) => p.soft).length : 0);

const App = {
  data() {
    return {
      VIEWS, TREND_METRICS, repo: kRepo,
      dates: [], pageDates: [], summaries: [], date: null, stats: null, loading: false, error: null,
      view: 'overview', trendMetric: 'hardPct', filter: '', onlyHard: false,
      sample: null, provider: null, sampleQuery: '', frameHeight: 900, pages: {},
    };
  },
  computed: {
    providers() { return this.stats ? this.stats.sources.filter(IsShown) : []; },
    overviewRows() {
      return this.providers.map((p) => ({ source: p, ...Summarize(this.stats.summary[p]) }))
        .filter((r) => r.pages !== undefined).sort((a, b) => b.title10 - a.title10);
    },
    trendProviders() {
      const set = new Set();
      this.summaries.forEach((t) => Object.keys(t.summary).forEach((s) => IsShown(s) && set.add(s)));
      return [...set].sort();
    },
    samples() {
      if (!this.stats) return [];
      const f = this.filter.trim().toLowerCase();
      return this.stats.samples.filter((s) => (!f || s.keyword.toLowerCase().includes(f)
          || s.searchEngine.toLowerCase().includes(f))
        && (!this.onlyHard || this.providers.some((p) => Count(s.sources[p], 'hard') > 0)));
    },
    sampleIndex() { return this.stats && this.sample ? this.stats.samples.indexOf(this.sample) : -1; },
    hasPages() { return this.pageDates.includes(this.date); },
    compareRows() {
      if (!this.sample || !this.provider) return [];
      const browser = this.sample.sources.browser || { pages: [] };
      const serp = this.sample.sources[this.provider] || { pages: [] };
      return kPages.map((page) => ({
        page,
        browser: browser.pages.find((p) => p.page === page),
        serp: serp.pages.find((p) => p.page === page),
      })).filter((r) => r.browser || r.serp);
    },
  },
  watch: {
    async date(d) {
      this.sample = null;
      if (this.view === 'compare') this.view = 'keywords';
      if (!d) return;
      this.loading = true;
      try { this.stats = await GetJson(`data/stats/${d}.json`); this.error = null; }
      catch (e) { this.error = 'Cannot load the statistics of ' + d + ': ' + e.message; this.stats = null; }
      this.loading = false;
      this.SaveHash();
    },
    view() { this.SaveHash(); },
    sample(s) { this.sampleQuery = s ? s.keyword : ''; if (s) this.LoadPages(); this.SaveHash(); },
    provider() { if (this.sample) this.LoadPages(); this.SaveHash(); },
  },
  async mounted() {
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--head-h', this.$refs.head.offsetHeight + 'px');
    }).observe(this.$refs.head);
    try {
      [this.dates, this.pageDates, this.summaries] = await Promise.all([
        GetJson('data/dates.json'), GetJson('data/pages.json'), GetJson('data/summary.json')]);
    } catch (e) {
      this.error = 'Cannot load the benchmark: ' + e.message;
      return;
    }
    const hash = new URLSearchParams(location.hash.slice(1));
    this.date = this.dates.includes(hash.get('date')) ? hash.get('date') : this.dates[0];
    if (VIEWS.some((v) => v.key === hash.get('view'))) this.view = hash.get('view');
    if (hash.get('keyword')) {
      await new Promise((r) => { const stop = this.$watch('stats', () => { stop(); r(); }); });
      const s = this.stats && this.stats.samples.find((x) => x.keyword === hash.get('keyword'));
      if (s) this.OpenCompare(s, hash.get('source') || undefined);
    }
  },
  methods: {
    Summarize, Count, SoftCount,
    SaveHash() {
      const h = new URLSearchParams();
      if (this.date) h.set('date', this.date);
      h.set('view', this.view);
      if (this.view === 'compare' && this.sample) { h.set('keyword', this.sample.keyword); h.set('source', this.provider); }
      history.replaceState(null, '', '#' + h.toString());
    },
    IsView(key) { return this.view === key || (key === 'keywords' && this.view === 'compare'); },
    TrendValue(t, p) { const s = Summarize(t.summary[p]); return s ? s[this.trendMetric] : null; },
    OpenCompare(s, p) {
      this.provider = p && this.providers.includes(p) ? p : this.providers[0];
      this.sample = s;
      this.view = 'compare';
    },
    PickSample() {
      const q = this.sampleQuery.trim().toLowerCase();
      const s = this.stats.samples.find((x) => x.keyword.toLowerCase() === q);
      if (s) this.sample = s;
    },
    StepSample(delta) {
      const s = this.stats.samples[this.sampleIndex + delta];
      if (s) this.sample = s;
    },
    PageKey(source, page) { return `${this.date}/${source}/${this.sample.name}/${page}`; },
    async LoadPages() {
      if (!this.hasPages) return;
      const date = this.date;
      const sample = this.sample;
      for (const source of ['browser', this.provider]) {
        for (const page of kPages) {
          const key = `${date}/${source}/${sample.name}/${page}`;
          if (this.pages[key] !== undefined) continue;
          this.pages[key] = null; // loading
          OpenZip(date, source)
            .then((entries) => {
              const e = entries[`${sample.name}/${page - 1}.html`];
              return e ? e.text() : '';
            })
            .then((html) => { this.pages[key] = html; })
            .catch((e) => { this.pages[key] = ''; this.error = 'Cannot read ' + source + '.zip: ' + e.message; });
        }
      }
    },
    PageHtml(source, page) { return this.pages[this.PageKey(source, page)]; },
    DownloadPage(source, page) {
      const html = this.PageHtml(source, page);
      if (!html) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      a.download = `${this.date}_${source}_${this.sample.name}_${page - 1}.html`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    ReleaseUrl(date, source) { return `https://github.com/${kRepo}/releases/download/${date}/${source}.zip`; },
    // the two pages of a row scroll together
    FrameLoaded(event, page) {
      const win = event.target.contentWindow;
      if (!win) return;
      win.addEventListener('scroll', () => {
        if (this.syncing) return;
        this.syncing = true;
        document.querySelectorAll(`[data-row="${page}"] iframe`).forEach((f) => {
          if (f.contentWindow && f.contentWindow !== win) f.contentWindow.scrollTo(0, win.scrollY);
        });
        requestAnimationFrame(() => { this.syncing = false; });
      }, { passive: true });
    },
    Level(value, good, bad) {
      if (value === null || value === undefined) return '';
      if (good < bad) return value <= good ? 'good' : value >= bad ? 'bad' : 'mid';
      return value >= good ? 'good' : value <= bad ? 'bad' : 'mid';
    },
  },
  template: `
<header class="head" ref="head">
  <div class="head-row">
    <h1>Google Poisoning Benchmark</h1>
    <select v-model="date" aria-label="Day">
      <option v-for="d in dates" :key="d" :value="d">{{ d }}</option>
    </select>
    <div class="tabs">
      <button v-for="v in VIEWS" :key="v.key" :class="{ on: IsView(v.key) }" @click="view = v.key">{{ v.label }}</button>
    </div>
    <span v-if="loading" class="muted small">loading…</span>
    <span v-if="error" class="err small">{{ error }}</span>
  </div>
  <div v-if="view === 'keywords' && stats" class="head-row">
    <input type="search" v-model="filter" placeholder="Filter keyword / search engine">
    <label><input type="checkbox" v-model="onlyHard"> only with hard poisoning</label>
    <span class="muted small">{{ samples.length }} samples ·
      {{ hasPages ? 'click a cell to compare the pages' : 'pages viewable for the last ' + pageDates.length + ' days, older days in Downloads' }}</span>
  </div>
  <div v-if="view === 'compare' && sample" class="head-row">
    <button class="btn" @click="view = 'keywords'">← Keywords</button>
    <button class="btn" :disabled="sampleIndex <= 0" @click="StepSample(-1)" title="Previous keyword">‹</button>
    <input class="keyword" type="text" list="samples" v-model="sampleQuery" @focus="$event.target.select()"
      @change="PickSample" @keydown.enter="PickSample" aria-label="Keyword">
    <datalist id="samples"><option v-for="s in stats.samples" :key="s.name" :value="s.keyword">{{ s.searchEngine }}</option></datalist>
    <button class="btn" :disabled="sampleIndex >= stats.samples.length - 1" @click="StepSample(1)" title="Next keyword">›</button>
    <span class="muted small">{{ sample.searchEngine }}</span>
    <select v-model="provider" aria-label="Provider"><option v-for="p in providers" :key="p" :value="p">{{ p }}</option></select>
    <label class="small">Height <input type="range" min="500" max="2000" step="100" v-model.number="frameHeight"></label>
    <span v-if="sample.sources[provider]" class="muted small">
      title top 10 {{ sample.sources[provider].match.title10 }}/10 · url top 10 {{ sample.sources[provider].match.url10 }}/10 ·
      rank diff {{ sample.sources[provider].match.rankDiff }}</span>
  </div>
</header>

<main>
  <template v-if="view === 'overview' && stats">
    <p class="intro">{{ stats.samples.length }} requests on {{ date }}, each compared with the same search in a real
      browser (natural search). <b>Hard</b>: manual review, the results match only part of the keyword (partial: a
      qualifier or the location was dropped). <b>Soft</b> (Nozzle): less than half of the browser page domains are
      anywhere in the provider SERP. <b>Match</b>: results shared with the browser. Details in Method.</p>
    <div class="scroll-x"><table class="t">
      <thead><tr>
        <th>Provider</th><th>Samples</th><th>Pages</th><th>Hard %</th><th>Hard by page</th><th>Samples with hard</th>
        <th>Partial</th><th>Soft %</th><th>Soft by page</th><th>Title top 10</th><th>Title top 50</th>
        <th>URL top 10</th><th>Domain top 50</th><th>Rank diff</th>
      </tr></thead>
      <tbody><tr v-for="r in overviewRows" :key="r.source">
        <td class="src">{{ r.source }}</td><td>{{ r.samples }}</td><td>{{ r.pages }}</td>
        <td :class="Level(r.hardPct, 1, 10)">{{ r.hardPct }}% <span class="muted small">({{ r.hard }})</span></td>
        <td class="muted">{{ r.hardByPage.join(' · ') }}</td><td>{{ r.samplesHard }}</td><td>{{ r.partial }}</td>
        <td :class="Level(r.softPct, 15, 50)">{{ r.softPct }}%</td><td class="muted">{{ r.softByPage.join(' · ') }}</td>
        <td :class="Level(r.title10, 50, 20)">{{ r.title10 }}%</td><td>{{ r.title50 }}%</td><td>{{ r.url10 }}%</td>
        <td>{{ r.domain50 }}%</td><td>{{ r.rankDiff }}</td>
      </tr></tbody>
    </table></div>
  </template>

  <template v-if="view === 'trend'">
    <p><select v-model="trendMetric"><option v-for="m in TREND_METRICS" :key="m.key" :value="m.key">{{ m.label }}</option></select></p>
    <div class="scroll-x"><table class="t">
      <thead><tr><th>Provider</th><th v-for="t in summaries" :key="t.date">{{ t.date.slice(5) }}</th></tr></thead>
      <tbody><tr v-for="p in trendProviders" :key="p">
        <td class="src">{{ p }}</td>
        <td v-for="t in summaries" :key="t.date">
          <template v-if="TrendValue(t, p) !== null">
            <span class="bar" :style="{ width: Math.min(100, TrendValue(t, p)) * 0.6 + 'px' }"></span>{{ TrendValue(t, p) }}
          </template>
          <span v-else class="muted">–</span>
        </td>
      </tr></tbody>
    </table></div>
  </template>

  <template v-if="view === 'keywords' && stats">
    <div class="legend">
      <b>How to read a cell:</b> <code><b class="hardn">1</b> / <span class="softn">3</span> / 6</code> =
      <b class="hardn">1</b> hard poisoned page (of the 5 pages, manual review) /
      <span class="softn">3</span> soft poisoned pages (of the 5, less than half of the browser page domains) /
      6 of the top 10 titles also in the browser top 10.
      Lower is better for the first two, higher for the third. <span class="muted">– = the provider has no pages for
      the request.</span> <span v-if="hasPages">Click a cell to see the pages side by side with the browser.</span>
    </div>
    <table class="t">
      <thead><tr><th>Keyword</th><th class="left">Search engine</th><th v-for="p in providers" :key="p">{{ p }}</th></tr></thead>
      <tbody><tr v-for="s in samples" :key="s.name">
        <td>{{ s.keyword }}</td><td class="left muted small">{{ s.searchEngine }}</td>
        <td v-for="p in providers" :key="p" :class="{ cell: hasPages }" @click="hasPages && OpenCompare(s, p)"
          :title="s.sources[p] ? p + ': ' + Count(s.sources[p], 'hard') + ' hard poisoned pages, ' + SoftCount(s.sources[p])
            + ' soft poisoned pages, ' + s.sources[p].match.title10 + ' of the top 10 titles also in the browser' : ''">
          <template v-if="s.sources[p]">
            <b :class="{ hardn: Count(s.sources[p], 'hard') > 0 }">{{ Count(s.sources[p], 'hard') }}</b> /
            <span :class="{ softn: SoftCount(s.sources[p]) > 0 }">{{ SoftCount(s.sources[p]) }}</span> /
            {{ s.sources[p].match.title10 }}
          </template>
          <span v-else class="muted">–</span>
        </td>
      </tr></tbody>
    </table>
  </template>

  <template v-if="view === 'compare' && sample">
    <div v-if="!hasPages" class="notice">The pages of {{ date }} are no longer on this site (only the last
      {{ pageDates.length }} days are): <a :href="ReleaseUrl(date, provider)">{{ provider }}.zip</a>,
      <a :href="ReleaseUrl(date, 'browser')">browser.zip</a>.</div>
    <div v-for="r in compareRows" :key="r.page" class="row" :data-row="r.page">
      <div class="col">
        <div class="cap"><span class="grow">browser · page {{ r.page }}</span>
          <a v-if="PageHtml('browser', r.page)" href="#" @click.prevent="DownloadPage('browser', r.page)">download</a></div>
        <template v-if="r.browser">
          <iframe v-if="PageHtml('browser', r.page)" :srcdoc="PageHtml('browser', r.page)" sandbox="allow-same-origin"
            :style="{ height: frameHeight + 'px' }" @load="FrameLoaded($event, r.page)"></iframe>
          <div v-else class="none">{{ PageHtml('browser', r.page) === null ? 'loading…' : 'no page' }}</div>
        </template>
        <div v-else class="none">no page</div>
      </div>
      <div class="col">
        <div class="cap" :class="r.serp && r.serp.poisoning">
          <span class="grow">{{ provider }} · page {{ r.page }}
            <template v-if="r.serp">
              <b v-if="r.serp.poisoning === 'hard'"> HARD POISONED</b>
              <b v-else-if="r.serp.poisoning === 'partial'"> PARTIAL</b>
              <span v-if="r.serp.browserDomainsKept !== undefined"> · {{ r.serp.soft ? 'soft poisoned, ' : '' }}{{ Math.round(r.serp.browserDomainsKept * 100) }}% of the browser domains</span>
              <span v-if="r.serp.realPage"> · saved as page {{ r.page }}, real page {{ r.serp.realPage }}</span>
            </template>
          </span>
          <a v-if="PageHtml(provider, r.page)" href="#" @click.prevent="DownloadPage(provider, r.page)">download</a>
        </div>
        <template v-if="r.serp">
          <iframe v-if="PageHtml(provider, r.page)" :srcdoc="PageHtml(provider, r.page)" sandbox="allow-same-origin"
            :style="{ height: frameHeight + 'px' }" @load="FrameLoaded($event, r.page)"></iframe>
          <div v-else class="none">{{ PageHtml(provider, r.page) === null ? 'loading…' : 'no page' }}</div>
        </template>
        <div v-else class="none">no page</div>
      </div>
    </div>
  </template>

  <template v-if="view === 'downloads'">
    <p class="intro">One archive per day and source, in the GitHub release of the day:
      <code>scraped/&lt;request&gt;/N.html</code> (page N+1, as saved; hard and partial poisoning marked in the page)
      and <code>parsed/&lt;request&gt;/serp.json</code>. The statistics of a day: <code>stats-&lt;date&gt;.json</code>
      in the release, or the json link below. All releases:
      <a :href="'https://github.com/' + repo + '/releases'">github.com/{{ repo }}/releases</a>.</p>
    <div class="scroll-x"><table class="t">
      <thead><tr><th>Day</th><th class="left">Statistics</th><th class="left">Archives</th></tr></thead>
      <tbody><tr v-for="t in summaries.slice().reverse()" :key="t.date">
        <td>{{ t.date }}</td>
        <td class="left"><a :href="'data/stats/' + t.date + '.json'" :download="'stats-' + t.date + '.json'">stats-{{ t.date }}.json</a></td>
        <td class="left"><template v-for="(s, i) in ['browser', ...Object.keys(t.summary).filter(IsShown).sort()]" :key="s">
          <span v-if="i"> · </span><a :href="ReleaseUrl(t.date, s)">{{ s }}.zip</a></template></td>
      </tr></tbody>
    </table></div>
  </template>

  <template v-if="view === 'about'">
    <dl class="about">
      <dt>Requests</dt>
      <dd>Every day the same requests (keyword, Google domain, location, language, 5 pages of 10 results) are taken
        by each provider and by a real browser with a persistent profile per location (the natural search, the
        reference).</dd>
      <dt>Hard poisoning</dt>
      <dd>Manual review of the provider pages: a page is <b>hard</b> poisoned when its results match only part of
        the keyword (e.g. "erp software for construction" answered with ERP or software in general), <b>partial</b>
        when only a qualifier or the location was dropped (e.g. "bougies design" answered with candles in general,
        "listed building repair in henley" with other towns). The verdict is written in the page itself
        (a red / orange banner and <code>&lt;meta name="awr-benchmark-poisoning"&gt;</code>).</dd>
      <dt>Soft poisoning (Nozzle method)</dt>
      <dd>A provider page is soft poisoned when less than 50% of the domains of the same browser page appear anywhere
        in the provider SERP (browser pages with at least 3 domains).</dd>
      <dt>Match</dt>
      <dd>Title / URL / domain of the organic results shared with the browser, in the top 10 and top 50 (titles:
        first 30 characters, normalized). Rank diff: the average position difference of the shared results. The
        browser itself changes from day to day (about 80% of the top 10 titles stay the same), so 100% is not
        expected.</dd>
      <dt>Pages on this site</dt>
      <dd>The last {{ pageDates.length }} days, shown without scripts. The full pages of every day are in the
        releases (Downloads).</dd>
    </dl>
  </template>
</main>`,
};

Vue.createApp(App).mount('#app');
