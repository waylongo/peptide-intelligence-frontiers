#!/usr/bin/env node

// Build the public static Chinese weekly digest.
// The browser never calls a model API; it only renders the materialized digest JSON.

import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');

const CATEGORY_LABELS = {
  company_official: '公司与管线',
  clinical_registry: '临床登记',
  regulatory: '监管动态',
  literature: '研究文献',
  conference: '会议资料',
  patent: '专利动态',
  industry_news: '行业动态',
  knowledgebase: '知识库'
};

const SIGNAL_LABELS = {
  pipeline_update: '管线更新',
  clinical_trial: '临床试验',
  regulatory: '监管信号',
  paper: '研究论文',
  preprint: '预印本',
  conference_abstract: '会议摘要',
  patent_signal: '专利信号',
  bd_deal: 'BD / 交易',
  company_news: '公司新闻'
};

const SECTION_DEFS = [
  {
    id: 'company',
    eyebrow: 'Pipeline',
    labelZh: '公司与管线',
    description: '公司公告、资产进展和研发管线记录',
    categories: ['company_official']
  },
  {
    id: 'clinical',
    eyebrow: 'Clinical & Regulatory',
    labelZh: '临床与监管',
    description: '临床试验登记、状态变化和监管信息',
    categories: ['clinical_registry', 'regulatory']
  },
  {
    id: 'literature',
    eyebrow: 'Research',
    labelZh: '文献与会议',
    description: '同行评议文献、预印本和会议研究记录',
    categories: ['literature', 'conference']
  },
  {
    id: 'industry',
    eyebrow: 'Industry',
    labelZh: '专利、BD 与行业动态',
    description: '专利、交易、合作和行业来源记录',
    categories: ['patent', 'industry_news', 'knowledgebase']
  }
];

function parseArgs() {
  const args = {
    feedPath: join(REPO_ROOT, 'feed-peptides.json'),
    digestPath: join(REPO_ROOT, 'digest-peptides-zh.json'),
    feedArchiveDir: join(REPO_ROOT, 'archive', 'feeds'),
    digestArchiveDir: join(REPO_ROOT, 'archive', 'digests'),
    outDir: join(REPO_ROOT, '_site'),
    strict: false,
    clean: true
  };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--feed=')) args.feedPath = arg.slice('--feed='.length);
    else if (arg.startsWith('--digest=')) args.digestPath = arg.slice('--digest='.length);
    else if (arg.startsWith('--archive-dir=')) args.feedArchiveDir = arg.slice('--archive-dir='.length);
    else if (arg.startsWith('--digest-archive-dir=')) args.digestArchiveDir = arg.slice('--digest-archive-dir='.length);
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

function formatDate(value) {
  const ms = parseDateMs(value);
  if (ms == null) return '日期未知';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(ms));
}

function formatDateTime(value) {
  const ms = parseDateMs(value);
  if (ms == null) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
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

function safeItems(digest) {
  return Array.isArray(digest.items) ? digest.items : [];
}

function categoryLabel(value) {
  return CATEGORY_LABELS[value] || value || '未分类';
}

function signalLabel(value) {
  return SIGNAL_LABELS[value] || value || '信息记录';
}

function sectionFor(item) {
  return SECTION_DEFS.find(section => section.categories.includes(item.sourceCategory)) || SECTION_DEFS[3];
}

function itemsForSection(digest, section) {
  return safeItems(digest)
    .filter(item => section.categories.includes(item.sourceCategory))
    .sort((a, b) => {
      const dateDelta = (parseDateMs(b.publishedAt) || 0) - (parseDateMs(a.publishedAt) || 0);
      if (dateDelta) return dateDelta;
      return String(a.originalTitle || '').localeCompare(String(b.originalTitle || ''), 'en');
    });
}

function digestSection(digest, id) {
  return (Array.isArray(digest.sections) ? digest.sections : []).find(section => section.id === id) || null;
}

function displayTitle(item) {
  return item.titleZh || item.originalTitle || '无标题记录';
}

function displaySummary(item) {
  return item.summaryZh || item.originalSummary || '来源未提供摘要，请打开原始链接核对。';
}

function compactText(value, max = 720) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3).trim()}...`;
}

function renderIdentifiers(item) {
  const identifiers = [
    ['NCT', item.nctId],
    ['DOI', item.doi],
    ['PMID', item.pmid],
    ['阶段', item.trialPhase],
    ['状态', item.trialStatus],
    ['申办方', item.sponsor],
    ['资产', item.assetName],
    ['公司', item.company]
  ].filter(([, value]) => value);
  if (!identifiers.length) return '';
  return `<dl class="fact-grid">${identifiers.map(([label, value]) => `
    <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}
  </dl>`;
}

function renderOriginalTitle(item) {
  if (!item.titleZh || !item.originalTitle || item.titleZh === item.originalTitle) return '';
  return `<details class="original-title">
    <summary>查看来源标题</summary>
    <p lang="en">${escapeHtml(item.originalTitle)}</p>
  </details>`;
}

function renderDigestItem(item, index) {
  const keyPoints = Array.isArray(item.keyPoints) ? item.keyPoints.filter(Boolean) : [];
  const hasChineseExplanation = Boolean(item.whatItIsZh && item.whyItMattersZh);
  const statusLabel = item.contentStatus === 'ai_generated'
    ? '中文整理'
    : item.contentStatus === 'editorial_seed' ? '中文编辑稿' : '来源原文';
  const whatItIs = hasChineseExplanation
    ? item.whatItIsZh
    : '该条目尚未完成中文整理，请结合下方来源摘要和原始链接阅读。';
  const whyItMatters = hasChineseExplanation
    ? item.whyItMattersZh
    : '在缺少中文整理结果时，不对其研发或临床意义做自动推断。';
  return `<article class="digest-item reveal" style="--delay:${Math.min(index, 8) * 45}ms">
    <div class="item-rail" aria-hidden="true">${String(index + 1).padStart(2, '0')}</div>
    <div class="item-body">
      <div class="item-meta">
        <span>${escapeHtml(categoryLabel(item.sourceCategory))}</span>
        <span>${escapeHtml(signalLabel(item.signalType))}</span>
        <span>${escapeHtml(statusLabel)}</span>
        <time datetime="${escapeAttr(item.publishedAt || '')}">${escapeHtml(formatDate(item.publishedAt))}</time>
      </div>
      <h3>${escapeHtml(displayTitle(item))}</h3>
      <div class="explanation-block">
        <div class="explanation-row">
          <span>这是什么</span>
          <p>${escapeHtml(whatItIs)}</p>
        </div>
        <div class="explanation-row why-row">
          <span>为什么重要</span>
          <p>${escapeHtml(whyItMatters)}</p>
        </div>
      </div>
      ${hasChineseExplanation ? '' : `<p class="source-fallback" lang="en">${escapeHtml(compactText(displaySummary(item)))}</p>`}
      ${keyPoints.length ? `<ul class="key-points">${keyPoints.map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul>` : ''}
      ${renderIdentifiers(item)}
      ${renderOriginalTitle(item)}
      <footer class="item-footer">
        <span>${escapeHtml(item.sourceName || '来源未标注')}</span>
        <a href="${escapeAttr(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看原始来源 <span aria-hidden="true">↗</span></a>
      </footer>
    </div>
  </article>`;
}

function renderSection(digest, section, displayIndex) {
  const items = itemsForSection(digest, section);
  const materialized = digestSection(digest, section.id);
  const summary = materialized?.summaryZh || (items.length
    ? `本期收录 ${items.length} 条${section.labelZh}相关记录。`
    : `本期未收录${section.labelZh}相关记录。`);
  return `<section class="digest-section" id="${escapeAttr(section.id)}">
    <header class="section-intro">
      <div class="section-number">${String(displayIndex + 1).padStart(2, '0')}</div>
      <p class="eyebrow">${escapeHtml(section.eyebrow)}</p>
      <h2>${escapeHtml(section.labelZh)}</h2>
      <p>${escapeHtml(summary)}</p>
      <div class="section-count"><strong>${items.length}</strong><span>条记录</span></div>
    </header>
    <div class="section-content">
      ${items.length ? items.map((item, index) => renderDigestItem(item, index)).join('') : '<p class="empty-note">本期暂无相关记录。</p>'}
    </div>
  </section>`;
}

function renderIssueIndex(digest, activeSections) {
  return `<nav class="issue-index" aria-label="本期目录">
    <div class="issue-index-title"><span>Issue index</span><strong>本期目录</strong></div>
    ${activeSections.map((section, index) => {
      const count = itemsForSection(digest, section).length;
      return `<a href="#${escapeAttr(section.id)}">
        <span>${String(index + 1).padStart(2, '0')}</span>
        <strong>${escapeHtml(section.labelZh)}</strong>
        <em>${count}</em>
      </a>`;
    }).join('')}
  </nav>`;
}

function modelStatus(digest) {
  if (digest.model?.status === 'ready') return 'DeepSeek 中文整理';
  if (digest.model?.status === 'editorial_seed') return '中文编辑稿';
  return '来源原文兜底';
}

function renderThemes(digest) {
  const themes = Array.isArray(digest.overview?.themes) ? digest.overview.themes.filter(Boolean) : [];
  if (!themes.length) return '';
  return `<div class="theme-list">${themes.map((theme, index) => `
    <div><span>${String(index + 1).padStart(2, '0')}</span><p>${escapeHtml(theme)}</p></div>`).join('')}
  </div>`;
}

function renderHealthcheck(digest) {
  const stats = digest.sourceStats || {};
  const warnings = Array.isArray(digest.sourceHealthcheck?.warnings) ? digest.sourceHealthcheck.warnings : [];
  const rows = [
    ['生成时间', formatDateTime(digest.sourceGeneratedAt)],
    ['有效条目', digest.itemCount ?? safeItems(digest).length],
    ['原始候选', stats.rawItems ?? '未知'],
    ['RSS 有结果', `${stats.sourcesWithResults ?? 0} / ${stats.sourcesQueried ?? 0}`],
    ['API 有结果', `${stats.apiSourcesWithResults ?? 0} / ${stats.apiSourcesQueried ?? 0}`],
    ['站点搜索有结果', `${stats.tavilySitesWithResults ?? 0} / ${stats.tavilySitesQueried ?? 0}`],
    ['中文整理状态', modelStatus(digest)],
    ['数据提醒', warnings.length ? warnings.join('；') : '无']
  ];
  return `<section class="data-note" id="data-note">
    <div>
      <p class="eyebrow">Data note</p>
      <h2>数据说明</h2>
      <p>页面完整呈现通过数据清洗的记录，不进行重要性排名或用户侧筛选。来源事实、标识符和链接保持不变。</p>
    </div>
    <dl>${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
  </section>`;
}

function renderNav(paths) {
  return `<nav class="top-nav" aria-label="主导航">
    <a class="brand" href="${escapeAttr(paths.home)}"><span class="brand-mark">P</span><span>Peptide Intelligence Frontiers</span></a>
    <div class="nav-links">
      <a href="${escapeAttr(paths.archive)}">历史周报</a>
      <a href="${escapeAttr(paths.digestData)}">周报数据</a>
      <a href="${escapeAttr(paths.rawData)}">原始数据</a>
      <a href="https://github.com/waylongo/peptide-intelligence-frontiers" target="_blank" rel="noopener noreferrer">GitHub</a>
    </div>
  </nav>`;
}

function pageCss() {
  return `
    :root {
      color-scheme: light;
      --paper: #f2efe5;
      --paper-deep: #e6e0d2;
      --panel: #faf8f1;
      --ink: #15231f;
      --muted: #68706a;
      --line: #cbc5b7;
      --forest: #1f5b4c;
      --oxide: #b84d31;
      --gold: #bb9341;
      --serif: "Noto Serif SC", "Songti SC", Georgia, serif;
      --sans: "Noto Sans SC", "PingFang SC", sans-serif;
      --mono: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; background: var(--paper); color: var(--ink); font-family: var(--sans); }
    body {
      margin: 0;
      min-height: 100vh;
      overflow-x: hidden;
      background:
        radial-gradient(circle at 84% 6%, rgba(187, 147, 65, .12), transparent 25rem),
        linear-gradient(rgba(21, 35, 31, .025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(21, 35, 31, .025) 1px, transparent 1px),
        var(--paper);
      background-size: auto, 40px 40px, 40px 40px, auto;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: .28;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 120 120' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.06'/%3E%3C/svg%3E");
    }
    a { color: inherit; text-decoration-color: rgba(184, 77, 49, .55); text-underline-offset: .2em; }
    a:hover { color: var(--oxide); }
    h1, h2, h3, p { margin-top: 0; }
    .page { width: min(1220px, calc(100% - 36px)); margin: 0 auto; padding: 20px 0 72px; }

    .top-nav {
      min-height: 58px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      border-bottom: 1px solid var(--ink);
      font: 600 .72rem/1.2 var(--mono);
    }
    .brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; letter-spacing: .02em; }
    .brand-mark {
      width: 30px; height: 30px; display: grid; place-items: center;
      border: 1px solid var(--ink); color: var(--oxide); background: var(--panel); font: 700 1rem/1 var(--serif);
    }
    .nav-links { display: flex; gap: 18px; flex-wrap: wrap; }
    .nav-links a { color: var(--muted); text-decoration: none; }
    .nav-links a:hover { color: var(--oxide); }

    .masthead {
      position: relative;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 40px;
      align-items: end;
      padding: 54px 0 34px;
      border-bottom: 3px double var(--ink);
    }
    .masthead > *, .overview-grid > *, .digest-section > *, .digest-item > * { min-width: 0; }
    .masthead::after {
      content: "PIF";
      position: absolute;
      right: 0; top: 28px;
      color: rgba(21, 35, 31, .045);
      font: 700 clamp(7rem, 17vw, 13rem)/.8 var(--serif);
      letter-spacing: -.08em;
      pointer-events: none;
    }
    .issue-stamp { position: relative; z-index: 1; }
    .eyebrow { margin-bottom: 10px; color: var(--oxide); font: 600 .7rem/1.3 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
    .masthead h1 {
      position: relative; z-index: 1; margin-bottom: 12px; max-width: 900px;
      font: 700 clamp(2.8rem, 7.4vw, 6.6rem)/.96 var(--serif); letter-spacing: -.055em;
    }
    .masthead h1 span { display: block; margin-top: 10px; color: var(--forest); font-size: .4em; letter-spacing: .02em; }
    .masthead-subtitle { max-width: 700px; margin-bottom: 0; color: var(--muted); font-size: 1rem; line-height: 1.8; }
    .edition {
      position: relative; z-index: 1; min-width: 176px; padding: 18px;
      border: 1px solid var(--ink); background: rgba(250, 248, 241, .85); box-shadow: 8px 8px 0 var(--paper-deep);
    }
    .edition span { display: block; color: var(--muted); font: .65rem/1.3 var(--mono); text-transform: uppercase; }
    .edition strong { display: block; margin: 8px 0 18px; font: 700 1.35rem/1.1 var(--serif); }
    .edition strong:last-child { margin-bottom: 0; color: var(--oxide); }

    .overview-grid { display: grid; grid-template-columns: 1.55fr .75fr; gap: 0; margin-top: 28px; border: 1px solid var(--ink); background: var(--panel); }
    .overview-copy { padding: clamp(28px, 5vw, 58px); border-right: 1px solid var(--line); }
    .overview-copy h2 { max-width: 700px; margin-bottom: 20px; font: 700 clamp(1.8rem, 3.5vw, 3rem)/1.18 var(--serif); }
    .overview-copy > p:not(.eyebrow) { max-width: 760px; margin-bottom: 0; color: #46504b; font-size: 1.05rem; line-height: 1.95; }
    .theme-list { display: grid; gap: 0; margin-top: 28px; border-top: 1px solid var(--line); }
    .theme-list div { display: grid; grid-template-columns: 34px 1fr; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
    .theme-list span { color: var(--oxide); font: .62rem/1.6 var(--mono); }
    .theme-list p { margin: 0; color: #46504b; font-size: .82rem; line-height: 1.6; }
    .issue-facts { display: grid; grid-template-columns: repeat(2, 1fr); }
    .issue-facts div { min-height: 132px; padding: 22px; border-bottom: 1px solid var(--line); }
    .issue-facts div:nth-child(odd) { border-right: 1px solid var(--line); }
    .issue-facts div:nth-last-child(-n+2) { border-bottom: 0; }
    .issue-facts strong { display: block; margin-bottom: 8px; color: var(--oxide); font: 700 2.35rem/1 var(--serif); }
    .issue-facts span { color: var(--muted); font-size: .78rem; line-height: 1.5; }

    .status-note {
      display: flex; gap: 12px; align-items: center; margin: 14px 0 0; padding: 12px 16px;
      border-left: 3px solid var(--gold); background: rgba(187, 147, 65, .1); color: #5e563f; font-size: .82rem; line-height: 1.65;
    }
    .status-note strong { flex: 0 0 auto; color: var(--ink); font-family: var(--mono); font-size: .68rem; text-transform: uppercase; }

    .issue-index { display: grid; grid-template-columns: 1.2fr repeat(4, 1fr); margin-top: 34px; border-top: 1px solid var(--ink); border-bottom: 1px solid var(--ink); }
    .issue-index-title { padding: 18px 18px 18px 0; }
    .issue-index-title span { display: block; margin-bottom: 5px; color: var(--muted); font: .62rem/1 var(--mono); text-transform: uppercase; }
    .issue-index-title strong { font-family: var(--serif); }
    .issue-index a { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; padding: 18px; border-left: 1px solid var(--line); text-decoration: none; }
    .issue-index a:hover { background: var(--panel); color: var(--oxide); }
    .issue-index a span, .issue-index a em { color: var(--muted); font: normal .65rem/1 var(--mono); }
    .issue-index a strong { font-size: .82rem; }

    .digest-section { display: grid; grid-template-columns: 260px 1fr; gap: 44px; padding: 64px 0; border-bottom: 1px solid var(--ink); scroll-margin-top: 16px; }
    .section-intro { align-self: start; position: sticky; top: 22px; }
    .section-number { margin-bottom: 30px; color: rgba(184, 77, 49, .22); font: 700 5rem/.8 var(--serif); }
    .section-intro h2 { margin-bottom: 14px; font: 700 2rem/1.15 var(--serif); }
    .section-intro > p:not(.eyebrow) { color: var(--muted); font-size: .88rem; line-height: 1.75; }
    .section-count { display: flex; align-items: baseline; gap: 8px; margin-top: 24px; padding-top: 14px; border-top: 1px solid var(--line); }
    .section-count strong { color: var(--oxide); font: 700 2rem/1 var(--serif); }
    .section-count span { color: var(--muted); font-size: .75rem; }
    .section-content { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }

    .digest-item { min-width: 0; display: grid; grid-template-columns: 38px 1fr; border: 1px solid var(--line); background: rgba(250, 248, 241, .86); transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease; }
    .digest-item:hover { transform: translateY(-2px); border-color: var(--forest); box-shadow: 0 18px 34px rgba(21, 35, 31, .08); }
    .item-rail { padding-top: 19px; border-right: 1px solid var(--line); color: var(--muted); font: .62rem/1 var(--mono); text-align: center; writing-mode: vertical-rl; }
    .item-body { min-width: 0; display: flex; flex-direction: column; padding: 20px; }
    .item-meta { display: flex; gap: 7px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; color: var(--muted); font: .6rem/1.2 var(--mono); text-transform: uppercase; }
    .item-meta span { padding: 4px 6px; border: 1px solid var(--line); background: var(--paper); }
    .item-meta span:first-child { border-color: rgba(31, 91, 76, .35); color: var(--forest); }
    .item-meta time { margin-left: auto; }
    .digest-item h3 { margin-bottom: 13px; font: 700 1.08rem/1.38 var(--serif); overflow-wrap: anywhere; }
    .explanation-block { margin: 2px 0 18px; border-top: 1px solid var(--line); }
    .explanation-row { display: grid; grid-template-columns: 72px 1fr; gap: 14px; padding: 13px 0; border-bottom: 1px solid var(--line); }
    .explanation-row > span { padding-top: 2px; color: var(--forest); font: 600 .62rem/1.45 var(--mono); }
    .explanation-row p { margin: 0; color: #46504b; font-size: .84rem; line-height: 1.72; }
    .explanation-row.why-row > span { color: var(--oxide); }
    .source-fallback { margin: -4px 0 18px; padding: 12px; background: var(--paper); color: var(--muted); font-size: .76rem; line-height: 1.6; }
    .key-points { margin: 0 0 18px; padding: 0; list-style: none; }
    .key-points li { position: relative; margin-top: 8px; padding-left: 16px; color: #3e4943; font-size: .82rem; line-height: 1.6; }
    .key-points li::before { content: ""; position: absolute; left: 0; top: .65em; width: 7px; height: 1px; background: var(--oxide); }
    .fact-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px 14px; margin: 4px 0 18px; }
    .fact-grid div { min-width: 0; padding-left: 9px; border-left: 2px solid rgba(31, 91, 76, .25); }
    .fact-grid dt { color: var(--muted); font: .58rem/1.2 var(--mono); text-transform: uppercase; }
    .fact-grid dd { margin: 4px 0 0; font-size: .74rem; line-height: 1.4; overflow-wrap: anywhere; }
    .original-title { margin: 0 0 16px; color: var(--muted); font-size: .72rem; }
    .original-title summary { cursor: pointer; font-family: var(--mono); }
    .original-title p { margin: 8px 0 0; line-height: 1.55; }
    .item-footer { display: flex; justify-content: space-between; align-items: flex-end; gap: 14px; margin-top: auto; padding-top: 14px; border-top: 1px solid var(--line); color: var(--muted); font: .64rem/1.4 var(--mono); }
    .item-footer span { overflow-wrap: anywhere; }
    .item-footer a { flex: 0 0 auto; color: var(--oxide); text-decoration: none; }
    .empty-note { grid-column: 1 / -1; padding: 42px; border: 1px dashed var(--line); color: var(--muted); text-align: center; }

    .data-note { display: grid; grid-template-columns: .8fr 1.2fr; gap: 60px; padding: 58px; margin-top: 64px; background: var(--ink); color: var(--paper); }
    .data-note h2 { margin-bottom: 16px; font: 700 2.1rem/1.15 var(--serif); }
    .data-note > div > p:last-child { color: #bbc3be; font-size: .88rem; line-height: 1.8; }
    .data-note dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; margin: 0; border-top: 1px solid #44514b; }
    .data-note dl div { padding: 13px 0; border-bottom: 1px solid #44514b; }
    .data-note dl div:nth-child(odd) { padding-right: 18px; }
    .data-note dt { color: #8fa097; font: .62rem/1.2 var(--mono); }
    .data-note dd { margin: 5px 0 0; font-size: .78rem; line-height: 1.5; overflow-wrap: anywhere; }

    .archive-panel { margin-top: 54px; }
    .archive-heading { display: flex; justify-content: space-between; align-items: end; padding-bottom: 16px; border-bottom: 1px solid var(--ink); }
    .archive-heading h2 { margin: 0; font: 700 2.2rem/1.1 var(--serif); }
    .archive-heading strong { color: var(--oxide); font: 700 2rem/1 var(--serif); }
    .archive-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-top: 18px; }
    .archive-card { min-height: 220px; display: flex; flex-direction: column; padding: 24px; border: 1px solid var(--line); background: var(--panel); text-decoration: none; }
    .archive-card:hover { border-color: var(--oxide); box-shadow: 8px 8px 0 var(--paper-deep); }
    .archive-card time { color: var(--oxide); font: .68rem/1 var(--mono); }
    .archive-card h3 { margin: 32px 0 10px; font: 700 1.5rem/1.2 var(--serif); }
    .archive-card p { color: var(--muted); font-size: .8rem; line-height: 1.6; }
    .archive-card span { margin-top: auto; font: .65rem/1 var(--mono); }

    .site-footer { display: flex; justify-content: space-between; gap: 24px; padding: 28px 0; color: var(--muted); font: .65rem/1.6 var(--mono); }
    .reveal { animation: reveal .55s both; animation-delay: var(--delay, 0ms); }
    @keyframes reveal { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

    @media (max-width: 980px) {
      .issue-index { grid-template-columns: repeat(2, 1fr); }
      .issue-index-title { grid-column: 1 / -1; border-bottom: 1px solid var(--line); }
      .issue-index a { border-left: 0; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
      .digest-section { grid-template-columns: 1fr; gap: 24px; }
      .section-intro { position: static; display: grid; grid-template-columns: auto 1fr auto; gap: 0 18px; align-items: end; }
      .section-number { grid-row: 1 / 4; margin: 0; }
      .section-intro .eyebrow, .section-intro h2, .section-intro > p:not(.eyebrow) { grid-column: 2; }
      .section-count { grid-column: 3; grid-row: 1 / 4; align-self: center; }
    }
    @media (max-width: 740px) {
      .page { width: min(100% - 24px, 1220px); padding-top: 10px; }
      .top-nav { align-items: flex-start; padding: 10px 0 14px; }
      .brand span:last-child { display: none; }
      .nav-links { max-width: calc(100% - 42px); justify-content: flex-end; gap: 13px; font-size: .62rem; }
      .nav-links a:nth-child(2), .nav-links a:nth-child(3) { display: none; }
      .masthead { grid-template-columns: 1fr; gap: 24px; padding-top: 38px; }
      .masthead h1 { font-size: clamp(2.7rem, 16vw, 4.6rem); }
      .edition { min-width: 0; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 18px; }
      .edition strong { margin: 3px 0 0; }
      .overview-grid, .data-note { grid-template-columns: 1fr; }
      .overview-copy { border-right: 0; border-bottom: 1px solid var(--line); }
      .issue-index { grid-template-columns: 1fr; }
      .issue-index a { border-right: 0; }
      .section-content, .archive-list { grid-template-columns: 1fr; }
      .section-intro { display: block; }
      .section-number { margin-bottom: 18px; font-size: 4rem; }
      .section-count { display: inline-flex; }
      .digest-section { padding: 46px 0; }
      .data-note { gap: 28px; padding: 30px 22px; }
      .data-note dl { grid-template-columns: 1fr; }
      .site-footer { flex-direction: column; }
    }
    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
      *, *::before, *::after { animation: none !important; transition: none !important; }
    }
  `;
}

function documentHead(title, description) {
  return `<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeAttr(description)}">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@600;700;900&display=swap" rel="stylesheet">
    <style>${pageCss()}</style>
  </head>`;
}

function renderDigestPage(digest, paths) {
  const stats = digest.sourceStats || {};
  const activeSources = (stats.sourcesWithResults || 0) + (stats.apiSourcesWithResults || 0) + (stats.tavilySitesWithResults || 0);
  const activeSections = SECTION_DEFS.filter(section => itemsForSection(digest, section).length > 0);
  const fallback = digest.model?.status === 'not_configured';
  return `<!doctype html>
<html lang="zh-CN">
${documentHead(`${digest.overview?.titleZh || '多肽药物研发周报'} - ${digest.issueDate}`, '每周自动更新的中文多肽药物研发情报周报。')}
<body>
  <main class="page">
    ${renderNav(paths)}
    <header class="masthead">
      <div class="issue-stamp">
        <p class="eyebrow">Weekly peptide drug development digest</p>
        <h1>多肽药物<span>研发情报周报</span></h1>
        <p class="masthead-subtitle">完整汇集公司管线、临床监管、研究文献、会议、专利与行业动态，并以中文周报形式持续归档。</p>
      </div>
      <aside class="edition" aria-label="期刊信息">
        <span>本期日期</span><strong>${escapeHtml(digest.issueDate)}</strong>
        <span>内容状态</span><strong>${escapeHtml(modelStatus(digest))}</strong>
      </aside>
    </header>

    <section class="overview-grid">
      <div class="overview-copy">
        <p class="eyebrow">This week</p>
        <h2>${escapeHtml(digest.overview?.titleZh || '本周多肽药物研发情报')}</h2>
        <p>${escapeHtml(digest.overview?.summaryZh || '本期内容已完成自动整理。')}</p>
        ${renderThemes(digest)}
      </div>
      <div class="issue-facts">
        <div><strong>${safeItems(digest).length}</strong><span>本期有效记录</span></div>
        <div><strong>${stats.rawItems ?? '—'}</strong><span>采集候选记录</span></div>
        <div><strong>${activeSources}</strong><span>产生结果的来源</span></div>
        <div><strong>${activeSections.length}</strong><span>本期有内容的栏目</span></div>
      </div>
    </section>
    ${fallback ? '<div class="status-note"><strong>当前状态</strong><span>DeepSeek API 接口已预留但尚未配置，本期自动使用来源标题与摘要发布；所有有效条目均已保留。</span></div>' : ''}

    ${renderIssueIndex(digest, activeSections)}
    ${activeSections.map((section, index) => renderSection(digest, section, index)).join('')}
    ${renderHealthcheck(digest)}

    <footer class="site-footer">
      <span>Peptide Intelligence Frontiers · 每周自动更新</span>
      <span><a href="${escapeAttr(paths.digestData)}">中文周报数据</a> · <a href="${escapeAttr(paths.rawData)}">原始 Feed</a></span>
    </footer>
  </main>
</body>
</html>`;
}

function renderArchiveIndex(latestDigest, archives) {
  const cards = archives.map(({ date, digest }) => {
    const counts = SECTION_DEFS
      .map(section => [section, itemsForSection(digest, section).length])
      .filter(([, count]) => count > 0)
      .map(([section, count]) => `${section.labelZh} ${count}`)
      .join(' · ');
    return `<a class="archive-card" href="${escapeAttr(`${date}/`)}">
      <time datetime="${escapeAttr(date)}">${escapeHtml(date)}</time>
      <h3>${escapeHtml(digest.overview?.titleZh || '多肽药物研发周报')}</h3>
      <p>${escapeHtml(counts)}</p>
      <span>${safeItems(digest).length} 条记录 →</span>
    </a>`;
  }).join('');
  return `<!doctype html>
<html lang="zh-CN">
${documentHead('历史周报 - Peptide Intelligence Frontiers', '多肽药物研发中文周报历史归档。')}
<body>
  <main class="page">
    ${renderNav({ home: '../', archive: './', digestData: '../data/digest-latest.json', rawData: '../data/latest.json' })}
    <header class="masthead">
      <div class="issue-stamp">
        <p class="eyebrow">Weekly archive</p>
        <h1>历史周报<span>逐期归档</span></h1>
        <p class="masthead-subtitle">每期页面保留当周全部有效记录、来源链接、栏目结构与数据生成状态。</p>
      </div>
      <aside class="edition"><span>归档期数</span><strong>${archives.length}</strong><span>最新一期</span><strong>${escapeHtml(latestDigest.issueDate)}</strong></aside>
    </header>
    <section class="archive-panel">
      <div class="archive-heading"><div><p class="eyebrow">All issues</p><h2>全部期刊</h2></div><strong>${archives.length}</strong></div>
      <div class="archive-list">${cards || '<p class="empty-note">暂无历史周报。</p>'}</div>
    </section>
    <footer class="site-footer"><span>Peptide Intelligence Frontiers</span><span><a href="../data/digest-latest.json">最新周报数据</a></span></footer>
  </main>
</body>
</html>`;
}

async function readArchives(dir) {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter(file => /^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort().reverse();
  const archives = [];
  for (const file of files) {
    const date = file.replace(/\.json$/, '');
    archives.push({ date, digest: await readJson(join(dir, file)), file });
  }
  return archives;
}

async function readRawArchiveMap(dir) {
  if (!existsSync(dir)) return new Map();
  const files = (await readdir(dir)).filter(file => /^\d{4}-\d{2}-\d{2}\.json$/.test(file));
  const entries = await Promise.all(files.map(async file => [file.replace(/\.json$/, ''), await readJson(join(dir, file))]));
  return new Map(entries);
}

function validateFeed(feed, label) {
  if (feed.schemaVersion == null) throw new Error(`${label} missing schemaVersion`);
  if (!Array.isArray(feed.items)) throw new Error(`${label} items must be an array`);
}

function validateDigest(digest, label) {
  if (digest.schemaVersion == null) throw new Error(`${label} missing schemaVersion`);
  if (digest.language !== 'zh-CN') throw new Error(`${label} language must be zh-CN`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(digest.issueDate || ''))) throw new Error(`${label} issueDate is invalid`);
  if (!Array.isArray(digest.items)) throw new Error(`${label} items must be an array`);
  if (digest.itemCount !== digest.items.length) throw new Error(`${label} itemCount mismatch`);
  for (const [index, item] of digest.items.entries()) {
    if (!item.originalTitle) throw new Error(`${label} item ${index} missing originalTitle`);
    if (!item.sourceUrl) throw new Error(`${label} item ${index} missing sourceUrl`);
  }
}

function validatePair(feed, digest, label) {
  if (feed.items.length !== digest.items.length) throw new Error(`${label} feed/digest item count mismatch`);
  const digestUrls = new Set(digest.items.map(item => item.sourceUrl));
  for (const item of feed.items) {
    if (!digestUrls.has(item.url)) throw new Error(`${label} digest missing feed URL: ${item.url}`);
  }
}

async function validateOutput(outDir, archives, latestDigest) {
  const required = [
    join(outDir, 'index.html'),
    join(outDir, 'archive', 'index.html'),
    join(outDir, 'data', 'latest.json'),
    join(outDir, 'data', 'digest-latest.json')
  ];
  for (const archive of archives) {
    required.push(join(outDir, 'archive', archive.date, 'index.html'));
    required.push(join(outDir, 'data', 'digest-archive', `${archive.date}.json`));
  }
  for (const file of required) {
    if (!existsSync(file)) throw new Error(`Missing generated file: ${file}`);
    if (file.endsWith('.html')) {
      const html = await readFile(file, 'utf-8');
      if (html.includes('{{') || html.includes('}}')) throw new Error(`Unresolved template placeholder in ${file}`);
      if (html.includes('id="q"') || html.includes('applyFilters')) throw new Error(`Unexpected filter UI in ${file}`);
    }
  }

  const renderedIssues = [
    { file: join(outDir, 'index.html'), digest: latestDigest },
    ...archives.map(archive => ({ file: join(outDir, 'archive', archive.date, 'index.html'), digest: archive.digest }))
  ];
  for (const issue of renderedIssues) {
    const html = await readFile(issue.file, 'utf-8');
    for (const section of SECTION_DEFS) {
      const shouldRender = itemsForSection(issue.digest, section).length > 0;
      const isRendered = html.includes(`id="${section.id}"`);
      if (shouldRender !== isRendered) {
        throw new Error(`Section visibility mismatch for ${section.id} in ${issue.file}`);
      }
    }
    const explainedItems = safeItems(issue.digest).filter(item => item.whatItIsZh && item.whyItMattersZh).length;
    if (explainedItems && (!html.includes('这是什么') || !html.includes('为什么重要'))) {
      throw new Error(`Missing Chinese explanation labels in ${issue.file}`);
    }
  }
}

async function main() {
  const args = parseArgs();
  assertSafeOutDir(args.outDir);

  const [latestFeed, latestDigest, archives, rawArchives] = await Promise.all([
    readJson(args.feedPath),
    readJson(args.digestPath),
    readArchives(args.digestArchiveDir),
    readRawArchiveMap(args.feedArchiveDir)
  ]);
  validateFeed(latestFeed, 'latest feed');
  validateDigest(latestDigest, 'latest digest');
  validatePair(latestFeed, latestDigest, 'latest');
  for (const archive of archives) validateDigest(archive.digest, `archive ${archive.date}`);

  if (args.clean) await rm(args.outDir, { recursive: true, force: true });
  await mkdir(args.outDir, { recursive: true });

  await writeText(join(args.outDir, 'index.html'), renderDigestPage(latestDigest, {
    home: './', archive: 'archive/', digestData: 'data/digest-latest.json', rawData: 'data/latest.json'
  }));
  await writeText(join(args.outDir, 'archive', 'index.html'), renderArchiveIndex(latestDigest, archives));
  await writeJson(join(args.outDir, 'data', 'latest.json'), latestFeed);
  await writeJson(join(args.outDir, 'data', 'digest-latest.json'), latestDigest);

  for (const archive of archives) {
    await writeText(join(args.outDir, 'archive', archive.date, 'index.html'), renderDigestPage(archive.digest, {
      home: '../../', archive: '../', digestData: `../../data/digest-archive/${archive.date}.json`, rawData: `../../data/archive/${archive.date}.json`
    }));
    await writeJson(join(args.outDir, 'data', 'digest-archive', `${archive.date}.json`), archive.digest);
    if (rawArchives.has(archive.date)) {
      await writeJson(join(args.outDir, 'data', 'archive', `${archive.date}.json`), rawArchives.get(archive.date));
    }
  }

  if (args.strict) await validateOutput(args.outDir, archives, latestDigest);
  console.log(JSON.stringify({
    status: 'ok', outDir: args.outDir, latestDate: latestDigest.issueDate,
    archivePages: archives.length, latestItems: safeItems(latestDigest).length,
    modelStatus: latestDigest.model?.status || 'unknown'
  }));
}

main().catch(error => {
  console.error(JSON.stringify({ status: 'error', message: error.message }));
  process.exit(1);
});
