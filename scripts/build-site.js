#!/usr/bin/env node

// Build the public static Peptide Intelligence Frontiers web digest.
// No npm dependencies; intended for GitHub Pages artifacts.

import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');

const CATEGORY_LABELS = {
  company_official: '公司 / 管线',
  clinical_registry: '临床登记',
  regulatory: '监管',
  literature: '文献',
  conference: '会议',
  patent: '专利',
  industry_news: '行业线索',
  knowledgebase: '知识库'
};

const SIGNAL_LABELS = {
  pipeline_update: '管线更新',
  clinical_trial: '临床试验',
  regulatory: '监管信号',
  paper: '论文',
  preprint: '预印本',
  conference_abstract: '会议摘要',
  patent_signal: '专利信号',
  bd_deal: 'BD / 交易',
  company_news: '公司新闻'
};

const SECTION_DEFS = [
  {
    id: 'company',
    label: 'Company / Pipeline',
    zh: '公司 / 管线',
    categories: ['company_official']
  },
  {
    id: 'clinical',
    label: 'Clinical & Regulatory',
    zh: '临床与监管',
    categories: ['clinical_registry', 'regulatory']
  },
  {
    id: 'literature',
    label: 'Literature & Conferences',
    zh: '文献与会议',
    categories: ['literature', 'conference']
  },
  {
    id: 'leads',
    label: 'Patents / BD / Industry Leads',
    zh: '专利 / BD / 行业线索',
    categories: ['patent', 'industry_news', 'knowledgebase']
  }
];

function parseArgs() {
  const args = {
    feedPath: join(REPO_ROOT, 'feed-peptides.json'),
    archiveDir: join(REPO_ROOT, 'archive', 'feeds'),
    outDir: join(REPO_ROOT, '_site'),
    strict: false,
    clean: true
  };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--feed=')) args.feedPath = arg.slice('--feed='.length);
    else if (arg.startsWith('--archive-dir=')) args.archiveDir = arg.slice('--archive-dir='.length);
    else if (arg.startsWith('--out=')) args.outDir = arg.slice('--out='.length);
    else if (arg === '--strict') args.strict = true;
    else if (arg === '--no-clean') args.clean = false;
    else {
      console.error(`Unsupported argument: ${arg}`);
      process.exit(2);
    }
  }

  return args;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf-8'));
}

async function writeText(path, body) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
}

async function writeJson(path, value) {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function assertSafeOutDir(outDir) {
  const target = resolve(outDir);
  const repo = resolve(REPO_ROOT);
  if (target === repo || target === dirname(repo) || target === '/') {
    throw new Error(`Refusing to clean unsafe output directory: ${target}`);
  }
}

function parseDateMs(value) {
  if (!value) return null;
  const ms = new Date(String(value)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function feedDate(feed) {
  const ms = parseDateMs(feed.generatedAt);
  if (ms == null) throw new Error('feed.generatedAt must be parseable');
  return new Date(ms).toISOString().slice(0, 10);
}

function formatDate(value) {
  const ms = parseDateMs(value);
  if (ms == null) return '日期未知';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(ms));
}

function formatDateTime(value) {
  const ms = parseDateMs(value);
  if (ms == null) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(ms));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function escapeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function safeItems(feed) {
  return Array.isArray(feed.items) ? feed.items : [];
}

function score(item) {
  const n = Number(item.score);
  return Number.isFinite(n) ? n : 0;
}

function sortSignals(items) {
  return [...items].sort((a, b) => {
    const scoreDelta = score(b) - score(a);
    if (scoreDelta) return scoreDelta;
    const dateDelta = (parseDateMs(b.publishedAt) || 0) - (parseDateMs(a.publishedAt) || 0);
    if (dateDelta) return dateDelta;
    return String(a.title || '').localeCompare(String(b.title || ''), 'en');
  });
}

function categoryLabel(value) {
  return CATEGORY_LABELS[value] || value || '未分类';
}

function signalLabel(value) {
  return SIGNAL_LABELS[value] || value || '信号';
}

function topCategories(feed) {
  const counts = new Map();
  for (const item of safeItems(feed)) {
    const key = item.sourceCategory || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([category, count]) => `${categoryLabel(category)} ${count}`);
}

function uniqueSorted(items, key) {
  return [...new Set(items.map(item => item[key]).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b)));
}

function sectionFor(item) {
  return SECTION_DEFS.find(section => section.categories.includes(item.sourceCategory)) || SECTION_DEFS[3];
}

function itemSearchText(item) {
  return [
    item.title,
    item.summary,
    item.sourceName,
    item.sourceCategory,
    item.signalType,
    item.nctId,
    item.doi,
    item.pmid,
    item.sponsor,
    item.company,
    item.assetName,
    ...(Array.isArray(item.scoreReasons) ? item.scoreReasons : [])
  ].filter(Boolean).join(' ').toLowerCase();
}

function itemBadges(item) {
  return [
    categoryLabel(item.sourceCategory),
    signalLabel(item.signalType),
    item.sourcePriority,
    item.retrievalMethod
  ].filter(Boolean);
}

function compactSummary(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '该条目没有提供摘要；请打开来源链接核对原始信息。';
  if (text.length <= 520) return text;
  return `${text.slice(0, 517).trim()}...`;
}

function renderScoreReasons(item) {
  const reasons = Array.isArray(item.scoreReasons) ? item.scoreReasons.slice(0, 6) : [];
  if (!reasons.length) return '';
  return `<div class="reason-row" aria-label="Score reasons">${reasons.map(reason => `<span>${escapeHtml(reason)}</span>`).join('')}</div>`;
}

function renderIdentifiers(item) {
  const ids = [
    ['NCT', item.nctId],
    ['DOI', item.doi],
    ['PMID', item.pmid],
    ['Phase', item.trialPhase],
    ['Sponsor', item.sponsor],
    ['Asset', item.assetName || item.company]
  ].filter(([, value]) => value);

  if (!ids.length) return '';
  return `<dl class="id-grid">${ids.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`;
}

function renderSignalCard(item, options = {}) {
  const top = options.top ? ' top-card' : '';
  const search = itemSearchText(item);
  const scoreValue = score(item);
  const scorePct = Math.max(0, Math.min(100, Math.round((scoreValue / 8) * 100)));
  const badges = itemBadges(item);

  return `
    <article class="signal-card${top}"
      data-card
      data-section="${escapeAttr(sectionFor(item).id)}"
      data-category="${escapeAttr(item.sourceCategory || '')}"
      data-priority="${escapeAttr(item.sourcePriority || '')}"
      data-signal="${escapeAttr(item.signalType || '')}"
      data-search="${escapeAttr(search)}">
      <div class="card-topline">
        <div class="badge-row">${badges.map(badge => `<span>${escapeHtml(badge)}</span>`).join('')}</div>
        <div class="score-pill" title="Signal score">${scoreValue.toFixed(1)}</div>
      </div>
      <h3><a href="${escapeAttr(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h3>
      <p>${escapeHtml(compactSummary(item.summary))}</p>
      ${renderIdentifiers(item)}
      <div class="score-bar" aria-hidden="true"><span style="width: ${scorePct}%"></span></div>
      ${renderScoreReasons(item)}
      <footer>
        <span>${escapeHtml(item.sourceName || 'Unknown source')}</span>
        <span>${escapeHtml(formatDate(item.publishedAt))}</span>
      </footer>
    </article>`;
}

function renderControls(items) {
  const categories = uniqueSorted(items, 'sourceCategory');
  const priorities = uniqueSorted(items, 'sourcePriority');
  const signals = uniqueSorted(items, 'signalType');

  const options = (values, labeler = value => value) => values
    .map(value => `<option value="${escapeAttr(value)}">${escapeHtml(labeler(value))}</option>`)
    .join('');

  return `
    <section class="control-band" aria-label="筛选">
      <label class="search-box">
        <span>Search</span>
        <input id="q" type="search" placeholder="公司、靶点、NCT、DOI、关键词" autocomplete="off">
      </label>
      <label>
        <span>Category</span>
        <select id="category"><option value="">全部</option>${options(categories, categoryLabel)}</select>
      </label>
      <label>
        <span>Priority</span>
        <select id="priority"><option value="">全部</option>${options(priorities)}</select>
      </label>
      <label>
        <span>Signal</span>
        <select id="signal"><option value="">全部</option>${options(signals, signalLabel)}</select>
      </label>
      <button type="button" id="reset">重置</button>
    </section>`;
}

function renderSection(section, items) {
  const sectionItems = sortSignals(items.filter(item => section.categories.includes(item.sourceCategory)));
  const empty = `<p class="empty-note">本期没有匹配的 ${escapeHtml(section.zh)} 条目。</p>`;

  return `
    <section class="signal-section" data-section-wrap="${escapeAttr(section.id)}">
      <div class="section-heading">
        <div>
          <span>${escapeHtml(section.label)}</span>
          <h2>${escapeHtml(section.zh)}</h2>
        </div>
        <strong data-section-count="${escapeAttr(section.id)}">${sectionItems.length}</strong>
      </div>
      <div class="signal-grid">
        ${sectionItems.length ? sectionItems.map(item => renderSignalCard(item)).join('') : empty}
      </div>
    </section>`;
}

function renderHealthcheck(feed) {
  const health = feed.healthcheck || {};
  const stats = feed.stats || {};
  const warnings = Array.isArray(health.warnings) ? health.warnings : [];
  const rows = [
    ['Feed generated', formatDateTime(feed.generatedAt)],
    ['Lookback days', feed.lookbackDays ?? 'unknown'],
    ['Kept items', stats.keptItems ?? safeItems(feed).length],
    ['Raw items', stats.rawItems ?? 'unknown'],
    ['RSS sources', `${stats.sourcesWithResults ?? 0}/${stats.sourcesQueried ?? 0}`],
    ['API sources', `${stats.apiSourcesWithResults ?? 0}/${stats.apiSourcesQueried ?? 0}`],
    ['Tavily sites', `${stats.tavilySitesWithResults ?? 0}/${stats.tavilySitesQueried ?? 0}`],
    ['Warnings', warnings.length ? warnings.join('; ') : 'none']
  ];

  return `
    <section class="healthcheck">
      <div class="section-heading">
        <div>
          <span>Healthcheck</span>
          <h2>数据生成状态</h2>
        </div>
      </div>
      <dl>
        ${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}
      </dl>
    </section>`;
}

function pageCss() {
  return `
    :root {
      color-scheme: light;
      --paper: #f7f4ea;
      --panel: #fffdf7;
      --ink: #171a18;
      --muted: #666c67;
      --faint: #e6e0d2;
      --oxide: #a94f2e;
      --moss: #1f6b5d;
      --steel: #2e6178;
      --amber: #c49a3c;
      --shadow: 0 18px 50px rgba(36, 35, 29, 0.09);
      --serif: "Noto Serif SC", "Songti SC", Georgia, serif;
      --sans: "Noto Sans SC", "PingFang SC", system-ui, sans-serif;
      --mono: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
    }

    * { box-sizing: border-box; }

    html {
      scroll-behavior: smooth;
      background: var(--paper);
      color: var(--ink);
      font-family: var(--sans);
      letter-spacing: 0;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background:
        linear-gradient(90deg, rgba(23, 26, 24, 0.035) 1px, transparent 1px),
        linear-gradient(180deg, rgba(23, 26, 24, 0.026) 1px, transparent 1px),
        var(--paper);
      background-size: 48px 48px;
      color: var(--ink);
    }

    a { color: inherit; text-decoration-thickness: 1px; text-underline-offset: 0.18em; }
    a:hover { color: var(--oxide); }

    .page {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
      padding: 24px 0 72px;
    }

    .top-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 12px 0 28px;
      font-family: var(--mono);
      font-size: 0.78rem;
      color: var(--muted);
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      font-weight: 700;
      color: var(--ink);
    }

    .brand-mark {
      width: 32px;
      height: 32px;
      display: grid;
      place-items: center;
      border: 1px solid var(--ink);
      background: var(--panel);
      color: var(--oxide);
      font-family: var(--serif);
      font-weight: 700;
    }

    .nav-links {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }

    .nav-links a { color: var(--muted); text-decoration: none; }
    .nav-links a:hover { color: var(--ink); }

    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.7fr) minmax(260px, 0.8fr);
      gap: 28px;
      align-items: stretch;
      border-top: 2px solid var(--ink);
      border-bottom: 1px solid var(--ink);
      padding: 28px 0;
    }

    .eyebrow,
    .section-heading span,
    .control-band label span,
    .archive-date,
    .card-topline,
    .healthcheck dt {
      font-family: var(--mono);
      text-transform: uppercase;
      font-size: 0.72rem;
      color: var(--muted);
      letter-spacing: 0;
    }

    h1, h2, h3, p { margin-top: 0; }

    h1 {
      max-width: 950px;
      margin-bottom: 18px;
      font-family: var(--serif);
      font-size: clamp(2.6rem, 7vw, 6.3rem);
      line-height: 0.98;
      font-weight: 700;
      letter-spacing: 0;
    }

    h2 {
      margin-bottom: 0;
      font-family: var(--serif);
      font-size: clamp(1.45rem, 2.6vw, 2.25rem);
      line-height: 1.1;
      letter-spacing: 0;
    }

    h3 {
      margin-bottom: 12px;
      font-family: var(--serif);
      font-size: 1.1rem;
      line-height: 1.28;
      letter-spacing: 0;
      overflow-wrap: anywhere;
    }

    .hero-copy p {
      max-width: 720px;
      color: var(--muted);
      font-size: clamp(1rem, 1.6vw, 1.18rem);
      line-height: 1.78;
    }

    .hero-metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      border: 1px solid var(--ink);
      background: var(--panel);
      box-shadow: var(--shadow);
    }

    .metric {
      min-height: 132px;
      padding: 18px;
      border-bottom: 1px solid var(--faint);
    }

    .metric:nth-child(odd) { border-right: 1px solid var(--faint); }
    .metric:nth-last-child(-n+2) { border-bottom: 0; }

    .metric strong {
      display: block;
      margin-bottom: 8px;
      color: var(--oxide);
      font-family: var(--serif);
      font-size: 2.25rem;
      line-height: 1;
    }

    .metric span {
      color: var(--muted);
      font-size: 0.88rem;
      line-height: 1.45;
    }

    .top-signals,
    .signal-section,
    .healthcheck,
    .archive-panel {
      margin-top: 42px;
    }

    .section-heading {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 18px;
      border-bottom: 1px solid var(--ink);
      padding-bottom: 12px;
    }

    .section-heading strong {
      min-width: 46px;
      min-height: 46px;
      display: grid;
      place-items: center;
      border: 1px solid var(--ink);
      background: var(--panel);
      color: var(--moss);
      font-family: var(--mono);
      font-size: 1rem;
    }

    .top-grid,
    .signal-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }

    .top-grid .signal-card:first-child {
      grid-column: span 2;
      border-color: var(--ink);
    }

    .signal-card,
    .archive-card {
      display: flex;
      flex-direction: column;
      min-height: 100%;
      padding: 18px;
      border: 1px solid var(--faint);
      border-radius: 8px;
      background: rgba(255, 253, 247, 0.94);
      box-shadow: 0 10px 30px rgba(36, 35, 29, 0.055);
      transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
    }

    .signal-card:hover,
    .archive-card:hover {
      transform: translateY(-2px);
      border-color: rgba(169, 79, 46, 0.55);
      box-shadow: 0 18px 44px rgba(36, 35, 29, 0.1);
    }

    .signal-card.is-hidden { display: none; }

    .card-topline {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }

    .badge-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .badge-row span,
    .reason-row span {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      padding: 2px 7px;
      border: 1px solid rgba(31, 107, 93, 0.24);
      border-radius: 999px;
      background: rgba(31, 107, 93, 0.07);
      color: var(--moss);
      font-family: var(--mono);
      font-size: 0.68rem;
      white-space: nowrap;
    }

    .score-pill {
      flex: 0 0 auto;
      color: var(--oxide);
      font-family: var(--mono);
      font-size: 0.78rem;
      font-weight: 700;
    }

    .signal-card p {
      color: var(--muted);
      font-size: 0.92rem;
      line-height: 1.68;
      overflow-wrap: anywhere;
    }

    .id-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin: 2px 0 14px;
    }

    .id-grid div {
      min-width: 0;
      border-left: 2px solid rgba(46, 97, 120, 0.35);
      padding-left: 8px;
    }

    .id-grid dt {
      color: var(--steel);
      font-family: var(--mono);
      font-size: 0.66rem;
    }

    .id-grid dd {
      margin: 2px 0 0;
      overflow-wrap: anywhere;
      color: var(--ink);
      font-size: 0.78rem;
      line-height: 1.35;
    }

    .score-bar {
      height: 6px;
      margin: auto 0 12px;
      overflow: hidden;
      border: 1px solid var(--faint);
      background: #f1eadc;
    }

    .score-bar span {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, var(--moss), var(--amber), var(--oxide));
    }

    .reason-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 14px;
    }

    .reason-row span {
      border-color: rgba(169, 79, 46, 0.22);
      background: rgba(169, 79, 46, 0.075);
      color: var(--oxide);
    }

    .signal-card footer {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      border-top: 1px solid var(--faint);
      padding-top: 12px;
      color: var(--muted);
      font-family: var(--mono);
      font-size: 0.7rem;
      line-height: 1.35;
    }

    .control-band {
      position: sticky;
      top: 0;
      z-index: 10;
      display: grid;
      grid-template-columns: minmax(240px, 1.6fr) repeat(3, minmax(130px, 0.7fr)) auto;
      gap: 10px;
      margin: 28px 0 0;
      padding: 12px;
      border: 1px solid var(--ink);
      background: rgba(247, 244, 234, 0.94);
      backdrop-filter: blur(16px);
      box-shadow: 0 12px 28px rgba(36, 35, 29, 0.08);
    }

    .control-band label {
      display: grid;
      gap: 6px;
      min-width: 0;
    }

    input,
    select,
    button {
      width: 100%;
      min-height: 40px;
      border: 1px solid var(--faint);
      border-radius: 4px;
      background: var(--panel);
      color: var(--ink);
      font: inherit;
    }

    input,
    select {
      padding: 0 10px;
    }

    button {
      align-self: end;
      padding: 0 14px;
      border-color: var(--ink);
      background: var(--ink);
      color: var(--panel);
      cursor: pointer;
    }

    button:hover {
      background: var(--oxide);
      border-color: var(--oxide);
    }

    .empty-note,
    .no-results {
      padding: 18px;
      border: 1px dashed var(--faint);
      background: rgba(255, 253, 247, 0.7);
      color: var(--muted);
    }

    .no-results[hidden] { display: none; }

    .healthcheck dl {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin: 0;
    }

    .healthcheck div {
      min-width: 0;
      padding: 14px;
      border: 1px solid var(--faint);
      border-radius: 8px;
      background: var(--panel);
    }

    .healthcheck dd {
      margin: 6px 0 0;
      overflow-wrap: anywhere;
      color: var(--ink);
      font-size: 0.88rem;
      line-height: 1.5;
    }

    .archive-list {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }

    .archive-card {
      min-height: 190px;
      text-decoration: none;
    }

    .archive-date {
      color: var(--oxide);
      margin-bottom: 12px;
    }

    .archive-card h2 {
      margin-bottom: 16px;
      font-size: 1.6rem;
    }

    .archive-card p {
      color: var(--muted);
      line-height: 1.6;
    }

    .site-footer {
      margin-top: 56px;
      padding-top: 18px;
      border-top: 1px solid var(--ink);
      color: var(--muted);
      font-family: var(--mono);
      font-size: 0.72rem;
      line-height: 1.7;
    }

    @media (max-width: 960px) {
      .hero,
      .top-grid,
      .signal-grid,
      .archive-list {
        grid-template-columns: 1fr;
      }

      .top-grid .signal-card:first-child { grid-column: auto; }

      .control-band {
        position: static;
        grid-template-columns: 1fr 1fr;
      }

      .search-box,
      .control-band button {
        grid-column: 1 / -1;
      }

      .healthcheck dl { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 620px) {
      .page { width: min(100% - 20px, 1180px); padding-top: 12px; }
      .top-nav { align-items: flex-start; flex-direction: column; }
      .hero { padding: 20px 0; }
      .hero-metrics,
      .control-band,
      .healthcheck dl {
        grid-template-columns: 1fr;
      }
      .metric { border-right: 0 !important; }
      .metric:nth-last-child(-n+2) { border-bottom: 1px solid var(--faint); }
      .metric:last-child { border-bottom: 0; }
      .id-grid { grid-template-columns: 1fr; }
      .signal-card footer { flex-direction: column; }
    }
  `;
}

function renderNav(paths) {
  return `
    <nav class="top-nav" aria-label="Primary">
      <a class="brand" href="${escapeAttr(paths.home)}"><span class="brand-mark">P</span><span>Peptide Intelligence Frontiers</span></a>
      <div class="nav-links">
        <a href="${escapeAttr(paths.archive)}">Archive</a>
        <a href="${escapeAttr(paths.data)}">JSON</a>
        <a href="https://github.com/waylongo/peptide-intelligence-frontiers" target="_blank" rel="noopener noreferrer">GitHub</a>
      </div>
    </nav>`;
}

function renderDigestPage(feed, paths) {
  const items = safeItems(feed);
  const date = feedDate(feed);
  const topSignals = sortSignals(items).slice(0, 5);
  const categories = topCategories(feed);
  const stats = feed.stats || {};
  const warnings = Array.isArray(feed.healthcheck?.warnings) ? feed.healthcheck.warnings : [];
  const pageData = { date, items };

  return `<!doctype html>
<html lang="zh-CN" data-feed-page>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Peptide Intelligence Frontiers - ${escapeHtml(date)}</title>
  <meta name="description" content="每周 peptide drug development intelligence digest.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@600;700&display=swap" rel="stylesheet">
  <style>${pageCss()}</style>
</head>
<body>
  <main class="page">
    ${renderNav(paths)}
    <header class="hero">
      <div class="hero-copy">
        <div class="eyebrow">Weekly signal board / ${escapeHtml(date)}</div>
        <h1>Peptide Intelligence Frontiers</h1>
        <p>面向 peptide drug development 工作流的每周公开情报页。内容来自结构化 feed，保留来源、分数、分类、临床或文献标识和健康检查，不在自动化环节生成额外 AI 解读。</p>
      </div>
      <aside class="hero-metrics" aria-label="Feed metrics">
        <div class="metric"><strong>${items.length}</strong><span>selected signals</span></div>
        <div class="metric"><strong>${stats.rawItems ?? 'NA'}</strong><span>raw candidates</span></div>
        <div class="metric"><strong>${topSignals.length}</strong><span>top signals</span></div>
        <div class="metric"><strong>${warnings.length}</strong><span>health warnings</span></div>
      </aside>
    </header>

    ${renderControls(items)}
    <p id="no-results" class="no-results" hidden>没有匹配当前筛选条件的条目。</p>

    <section class="top-signals">
      <div class="section-heading">
        <div>
          <span>Top Signals</span>
          <h2>本期高分信号</h2>
        </div>
        <strong>${topSignals.length}</strong>
      </div>
      <div class="top-grid">
        ${topSignals.map(item => renderSignalCard(item, { top: true })).join('')}
      </div>
    </section>

    ${SECTION_DEFS.map(section => renderSection(section, items)).join('')}

    ${renderHealthcheck(feed)}

    <footer class="site-footer">
      <div>Latest feed: ${escapeHtml(formatDateTime(feed.generatedAt))}. Top categories: ${escapeHtml(categories.join(' / ') || 'none')}.</div>
      <div>Public data: <a href="${escapeAttr(paths.data)}">${escapeHtml(paths.dataLabel)}</a></div>
    </footer>
  </main>
  <script id="feed-data" type="application/json">${escapeJsonForScript(pageData)}</script>
  <script>
    (function () {
      const cards = Array.from(document.querySelectorAll('[data-card]'));
      const q = document.getElementById('q');
      const category = document.getElementById('category');
      const priority = document.getElementById('priority');
      const signal = document.getElementById('signal');
      const reset = document.getElementById('reset');
      const noResults = document.getElementById('no-results');

      function matches(card) {
        const query = q.value.trim().toLowerCase();
        if (query && !card.dataset.search.includes(query)) return false;
        if (category.value && card.dataset.category !== category.value) return false;
        if (priority.value && card.dataset.priority !== priority.value) return false;
        if (signal.value && card.dataset.signal !== signal.value) return false;
        return true;
      }

      function applyFilters() {
        let visible = 0;
        for (const card of cards) {
          const ok = matches(card);
          card.classList.toggle('is-hidden', !ok);
          if (ok) visible++;
        }

        for (const section of document.querySelectorAll('[data-section-wrap]')) {
          const id = section.dataset.sectionWrap;
          const count = section.querySelectorAll('[data-card]:not(.is-hidden)').length;
          const badge = document.querySelector('[data-section-count="' + id + '"]');
          if (badge) badge.textContent = String(count);
        }

        noResults.hidden = visible !== 0;
      }

      for (const el of [q, category, priority, signal]) el.addEventListener('input', applyFilters);
      reset.addEventListener('click', function () {
        q.value = '';
        category.value = '';
        priority.value = '';
        signal.value = '';
        applyFilters();
        q.focus();
      });
    })();
  </script>
</body>
</html>
`;
}

function renderArchiveIndex(latestFeed, archives) {
  const latestDate = feedDate(latestFeed);
  const cards = archives.map(archive => {
    const feed = archive.feed;
    const date = archive.date;
    const items = safeItems(feed);
    const cats = topCategories(feed).join(' / ') || 'none';
    return `<a class="archive-card" href="${escapeAttr(`${date}/`)}">
      <div class="archive-date">${escapeHtml(date)}</div>
      <h2>${items.length} signals</h2>
      <p>${escapeHtml(cats)}</p>
      <p>Generated ${escapeHtml(formatDateTime(feed.generatedAt))}</p>
    </a>`;
  }).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Archive - Peptide Intelligence Frontiers</title>
  <meta name="description" content="Peptide Intelligence Frontiers weekly archive.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@600;700&display=swap" rel="stylesheet">
  <style>${pageCss()}</style>
</head>
<body>
  <main class="page">
    ${renderNav({ home: '../', archive: './', data: '../data/latest.json', dataLabel: 'latest.json' })}
    <header class="hero">
      <div class="hero-copy">
        <div class="eyebrow">Weekly archive</div>
        <h1>Archive</h1>
        <p>每周 feed 的静态快照。最新一期是 ${escapeHtml(latestDate)}，历史页保留当周原始信号、来源和健康检查。</p>
      </div>
      <aside class="hero-metrics" aria-label="Archive metrics">
        <div class="metric"><strong>${archives.length}</strong><span>snapshots</span></div>
        <div class="metric"><strong>${safeItems(latestFeed).length}</strong><span>latest signals</span></div>
        <div class="metric"><strong>${escapeHtml(latestDate.slice(5))}</strong><span>latest date</span></div>
        <div class="metric"><strong>${escapeHtml(topCategories(latestFeed)[0] || 'NA')}</strong><span>top category</span></div>
      </aside>
    </header>
    <section class="archive-panel">
      <div class="section-heading">
        <div>
          <span>Archive</span>
          <h2>历史周报</h2>
        </div>
        <strong>${archives.length}</strong>
      </div>
      <div class="archive-list">
        ${cards || '<p class="empty-note">暂无历史快照。</p>'}
      </div>
    </section>
    <footer class="site-footer">
      <div>Public data: <a href="../data/latest.json">latest.json</a></div>
    </footer>
  </main>
</body>
</html>
`;
}

async function readArchives(archiveDir) {
  if (!existsSync(archiveDir)) return [];
  const files = (await readdir(archiveDir)).filter(file => /^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort().reverse();
  const archives = [];
  for (const file of files) {
    const feed = await readJson(join(archiveDir, file));
    const date = file.replace(/\.json$/, '');
    archives.push({ date, feed, file });
  }
  return archives;
}

function validateFeed(feed, label) {
  if (feed.schemaVersion == null) throw new Error(`${label} missing schemaVersion`);
  if (!Array.isArray(feed.items)) throw new Error(`${label} items must be an array`);
  feedDate(feed);
  for (const [index, item] of feed.items.entries()) {
    if (!item.title) throw new Error(`${label} item ${index} missing title`);
    if (!item.url) throw new Error(`${label} item ${index} missing url`);
  }
}

async function validateOutput(outDir, archives) {
  const required = [
    join(outDir, 'index.html'),
    join(outDir, 'archive', 'index.html'),
    join(outDir, 'data', 'latest.json')
  ];

  for (const archive of archives) {
    required.push(join(outDir, 'archive', archive.date, 'index.html'));
    required.push(join(outDir, 'data', 'archive', `${archive.date}.json`));
  }

  for (const file of required) {
    if (!existsSync(file)) throw new Error(`Missing generated file: ${file}`);
    if (file.endsWith('.html')) {
      const html = await readFile(file, 'utf-8');
      if (html.includes('{{') || html.includes('}}')) throw new Error(`Unresolved template placeholder in ${file}`);
    }
  }
}

async function main() {
  const args = parseArgs();
  assertSafeOutDir(args.outDir);

  const latestFeed = await readJson(args.feedPath);
  validateFeed(latestFeed, 'latest feed');
  const archives = await readArchives(args.archiveDir);
  for (const archive of archives) validateFeed(archive.feed, `archive ${archive.date}`);

  if (args.clean) await rm(args.outDir, { recursive: true, force: true });
  await mkdir(args.outDir, { recursive: true });

  await writeText(join(args.outDir, 'index.html'), renderDigestPage(latestFeed, {
    home: './',
    archive: 'archive/',
    data: 'data/latest.json',
    dataLabel: 'data/latest.json'
  }));
  await writeText(join(args.outDir, 'archive', 'index.html'), renderArchiveIndex(latestFeed, archives));

  await writeJson(join(args.outDir, 'data', 'latest.json'), latestFeed);

  for (const archive of archives) {
    await writeText(join(args.outDir, 'archive', archive.date, 'index.html'), renderDigestPage(archive.feed, {
      home: '../../',
      archive: '../',
      data: `../../data/archive/${archive.date}.json`,
      dataLabel: `data/archive/${archive.date}.json`
    }));
    await writeJson(join(args.outDir, 'data', 'archive', `${archive.date}.json`), archive.feed);
  }

  if (args.strict) await validateOutput(args.outDir, archives);

  console.log(JSON.stringify({
    status: 'ok',
    outDir: args.outDir,
    latestDate: feedDate(latestFeed),
    archivePages: archives.length,
    latestItems: safeItems(latestFeed).length
  }));
}

main().catch(err => {
  console.error(JSON.stringify({ status: 'error', message: err.message }));
  process.exit(1);
});
