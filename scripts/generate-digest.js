#!/usr/bin/env node

// Build the Chinese weekly digest data contract from the complete source feed.
// DeepSeek access is intentionally left blank; provider=none emits a safe source fallback.

import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');

const SECTION_DEFS = [
  { id: 'company', labelZh: '公司与管线', categories: ['company_official'] },
  { id: 'clinical', labelZh: '临床与监管', categories: ['clinical_registry', 'regulatory'] },
  { id: 'literature', labelZh: '文献与会议', categories: ['literature', 'conference'] },
  { id: 'industry', labelZh: '专利、BD 与行业动态', categories: ['patent', 'industry_news', 'knowledgebase'] }
];

function parseArgs() {
  const args = {
    feedPath: join(REPO_ROOT, 'feed-peptides.json'),
    configPath: join(REPO_ROOT, 'config', 'digest.json'),
    seedPath: null,
    outputPath: join(REPO_ROOT, 'digest-peptides-zh.json'),
    provider: null
  };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--feed=')) args.feedPath = arg.slice('--feed='.length);
    else if (arg.startsWith('--config=')) args.configPath = arg.slice('--config='.length);
    else if (arg.startsWith('--seed=')) args.seedPath = arg.slice('--seed='.length);
    else if (arg.startsWith('--out=')) args.outputPath = arg.slice('--out='.length);
    else if (arg.startsWith('--provider=')) args.provider = arg.slice('--provider='.length);
    else {
      console.error(`Unsupported argument: ${arg}`);
      process.exit(2);
    }
  }

  return args;
}

function parseDate(value, label) {
  const ms = new Date(String(value || '')).getTime();
  if (!Number.isFinite(ms)) throw new Error(`${label} must be a parseable timestamp`);
  return new Date(ms);
}

function issueDate(feed) {
  return parseDate(feed.generatedAt, 'feed.generatedAt').toISOString().slice(0, 10);
}

function stableItemId(item) {
  const identity = String(item.url || item.nctId || item.doi || item.pmid || item.title || '').trim().toLowerCase();
  if (!identity) throw new Error('Cannot create source item id without URL, identifier, or title');
  return createHash('sha256').update(identity).digest('hex').slice(0, 20);
}

function validateInputs(feed, config) {
  if (!Array.isArray(feed.items)) throw new Error('feed.items must be an array');
  issueDate(feed);
  if (config.language !== 'zh-CN') throw new Error('config.language must be zh-CN');
  if (config.editorial?.preserveAllItems !== true) throw new Error('config.editorial.preserveAllItems must be true');
  if (config.editorial?.enableRanking !== false) throw new Error('config.editorial.enableRanking must be false');
  for (const [index, item] of feed.items.entries()) {
    if (!item.title) throw new Error(`feed item ${index} missing title`);
    if (!item.url) throw new Error(`feed item ${index} missing url`);
  }
}

function copySourceItem(item, editorial = null) {
  return {
    sourceItemId: stableItemId(item),
    contentStatus: editorial ? 'editorial_seed' : 'source_fallback',
    titleZh: editorial?.titleZh || null,
    summaryZh: editorial?.summaryZh || null,
    whatItIsZh: editorial?.whatItIsZh || null,
    whyItMattersZh: editorial?.whyItMattersZh || null,
    keyPoints: Array.isArray(editorial?.keyPoints) ? editorial.keyPoints : [],
    originalTitle: item.title,
    originalSummary: item.summary || null,
    sourceUrl: item.url,
    sourceName: item.sourceName || null,
    sourceCategory: item.sourceCategory || null,
    signalType: item.signalType || null,
    publishedAt: item.publishedAt || null,
    retrievedAt: item.retrievedAt || null,
    sourcePriority: item.sourcePriority || null,
    retrievalMethod: item.retrievalMethod || null,
    company: item.company || null,
    assetName: item.assetName || null,
    sponsor: item.sponsor || null,
    indication: item.indication || null,
    target: item.target || null,
    trialPhase: item.trialPhase || null,
    trialStatus: item.trialStatus || null,
    nctId: item.nctId || null,
    doi: item.doi || null,
    pmid: item.pmid || null,
    evidenceLevel: item.evidenceLevel || null
  };
}

function categoryCounts(items) {
  const counts = {};
  for (const item of items) {
    const key = item.sourceCategory || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function sourceFallbackDigest(feed, config, seed) {
  const activeSeed = seed?.issueDate === issueDate(feed) ? seed : null;
  const items = feed.items.map(item => copySourceItem(item, activeSeed?.items?.[item.url] || null));
  const editorialItems = items.filter(item => item.contentStatus === 'editorial_seed').length;
  const counts = categoryCounts(items);
  const sections = SECTION_DEFS.map(section => {
    const itemCount = items.filter(item => section.categories.includes(item.sourceCategory)).length;
    return {
      ...section,
      itemCount,
      summaryZh: activeSeed?.sectionSummaries?.[section.id] || (itemCount
        ? `本期收录 ${itemCount} 条${section.labelZh}相关记录。`
        : `本期未收录${section.labelZh}相关记录。`)
    };
  });

  return {
    schemaVersion: 1,
    issueDate: issueDate(feed),
    generatedAt: feed.generatedAt,
    sourceGeneratedAt: feed.generatedAt,
    language: config.language,
    digestMode: 'complete',
    itemOrder: 'published_at_desc_within_fixed_sections',
    itemCount: items.length,
    model: {
      provider: config.provider,
      model: config.model,
      status: editorialItems ? 'editorial_seed' : 'not_configured',
      apiBaseUrlConfigured: Boolean(config.api?.baseUrl),
      aiGeneratedItems: 0,
      editorialItems,
      fallbackItems: items.length - editorialItems
    },
    overview: activeSeed?.overview || {
      titleZh: '本周多肽药物研发情报',
      summaryZh: `本期共收录 ${items.length} 条有效记录，按固定栏目完整呈现。DeepSeek API 尚未配置，当前版本保留来源标题与摘要作为发布兜底。`,
      themes: []
    },
    categoryCounts: counts,
    sections,
    items,
    sourceStats: feed.stats || {},
    sourceHealthcheck: feed.healthcheck || {},
    sourceSignalTaxonomy: feed.signalTaxonomy || null
  };
}

async function generateWithDeepSeek() {
  // Deliberately left blank. The future adapter must use prompts/generate-digest-zh.md,
  // preserve every sourceItemId, and return the same schema as sourceFallbackDigest().
  throw new Error('DeepSeek API adapter is intentionally not implemented; keep provider=none for now');
}

const args = parseArgs();
const feed = JSON.parse(await readFile(args.feedPath, 'utf-8'));
const config = JSON.parse(await readFile(args.configPath, 'utf-8'));
if (args.provider) config.provider = args.provider;
validateInputs(feed, config);
const seedPath = args.seedPath || join(REPO_ROOT, config.editorialSeed || 'config/editorial-seed-zh.json');
const seed = existsSync(seedPath) ? JSON.parse(await readFile(seedPath, 'utf-8')) : null;

const digest = config.provider === 'none'
  ? sourceFallbackDigest(feed, config, seed)
  : await generateWithDeepSeek(feed, config);

await writeFile(args.outputPath, `${JSON.stringify(digest, null, 2)}\n`);
console.log(JSON.stringify({
  status: 'ok',
  provider: config.provider,
  issueDate: digest.issueDate,
  itemCount: digest.itemCount,
  output: args.outputPath
}));
