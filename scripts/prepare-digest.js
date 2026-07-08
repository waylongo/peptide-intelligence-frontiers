#!/usr/bin/env node

// /pif - Prepare Digest
// Outputs one JSON blob for the agent to remix. Do not refetch article URLs in
// the agent after this script returns.

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SKILL_ROOT = join(__dirname, '..');
const LOCAL_CATALOG = join(SKILL_ROOT, 'config', 'sources.json');
const LOCAL_FEED = join(SKILL_ROOT, 'feed-peptides.json');
const LOCAL_PROMPTS_DIR = join(SKILL_ROOT, 'prompts');

const USER_DIR = join(homedir(), '.pif');
const USER_CONFIG = join(USER_DIR, 'config.json');
const USER_CATALOG = join(USER_DIR, 'sources.json');
const USER_PROMPTS_DIR = join(USER_DIR, 'prompts');

const REMOTE_RAW_BASE = 'https://raw.githubusercontent.com/waylongo/peptide-intelligence-frontiers/main';
const REMOTE_FEED = `${REMOTE_RAW_BASE}/feed-peptides.json`;
const REMOTE_CATALOG = `${REMOTE_RAW_BASE}/config/sources.json`;
const REMOTE_PROMPTS = `${REMOTE_RAW_BASE}/prompts`;

const PROMPT_FILES = [
  'digest-intro.md',
  'summarize-papers.md',
  'summarize-official.md',
  'summarize-news.md',
  'translate.md',
  'slides-report.md'
];

const USER_AGENT = 'peptide-intelligence-frontiers-skill/1.0';
const DAY_MS = 24 * 60 * 60 * 1000;
const CANONICAL_CATEGORIES = [
  'company_official',
  'clinical_registry',
  'regulatory',
  'literature',
  'conference',
  'patent',
  'industry_news',
  'knowledgebase'
];
const DEFAULT_CATEGORIES = CANONICAL_CATEGORIES;

function dedupeOrdered(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

function exitConfigError(detail) {
  const payload = typeof detail === 'string'
    ? { status: 'error', message: detail }
    : { status: 'error', ...detail };
  console.error(JSON.stringify(payload));
  process.exit(2);
}

function normalizeCategoryList(value, label) {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : null;
  if (!values) exitConfigError(`${label} must be a comma-separated string or an array`);
  const categories = values.map(s => String(s).trim()).filter(Boolean);
  if (!categories.length) exitConfigError(`${label} must include at least one category`);
  const invalid = categories.filter(c => !CANONICAL_CATEGORIES.includes(c));
  if (invalid.length) {
    exitConfigError({
      message: `${label} contains unsupported category: ${invalid.join(', ')}. Supported categories: ${CANONICAL_CATEGORIES.join(', ')}`,
      unsupported: invalid,
      supported: CANONICAL_CATEGORIES
    });
  }
  return dedupeOrdered(categories);
}

function parseArgs() {
  const args = { days: null, categories: null, noRemote: false };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--days=')) {
      const n = Number.parseInt(arg.slice(7), 10);
      if (!Number.isFinite(n) || n < 1 || n > 365) {
        console.error(JSON.stringify({ status: 'error', message: `--days must be an integer in [1, 365], got: ${arg.slice(7)}` }));
        process.exit(2);
      }
      args.days = n;
    } else if (arg.startsWith('--category=')) {
      args.categories = normalizeCategoryList(arg.slice(11), '--category');
    } else if (arg === '--no-remote') {
      args.noRemote = true;
    }
  }
  return args;
}

async function httpGet(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*'
      }
    });
    if (!res.ok) return { ok: false, status: res.status, text: '' };
    return { ok: true, status: res.status, text: await res.text() };
  } catch (err) {
    return { ok: false, status: 0, text: '', error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonIfExists(path, healthcheck, label) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, 'utf-8'));
  } catch (err) {
    healthcheck.warnings.push(`${label} unreadable: ${err.message}`);
    return null;
  }
}

async function loadUserConfig(healthcheck) {
  return await readJsonIfExists(USER_CONFIG, healthcheck, 'User config') || {};
}

async function loadCatalog(noRemote, healthcheck) {
  const userCatalog = await readJsonIfExists(USER_CATALOG, healthcheck, 'User catalog');
  if (userCatalog) {
    healthcheck.catalog_source = 'user_override';
    return userCatalog;
  }
  if (!noRemote) {
    const r = await httpGet(REMOTE_CATALOG, 8000);
    if (r.ok) {
      try {
        const c = JSON.parse(r.text);
        healthcheck.catalog_source = 'remote_catalog';
        healthcheck.remote_catalog_version = c.generatedAt || null;
        return c;
      } catch (err) {
        healthcheck.warnings.push(`Remote catalog unreadable: ${err.message}`);
      }
    } else {
      healthcheck.warnings.push(`Remote catalog unavailable: HTTP ${r.status}${r.error ? ` ${r.error}` : ''}`);
    }
  }
  healthcheck.catalog_source = 'local_repo';
  return JSON.parse(await readFile(LOCAL_CATALOG, 'utf-8'));
}

function feedFreshness(feed, windowDays) {
  const generatedAt = feed?.generatedAt || null;
  const generatedAtMs = parseDateMs(generatedAt);
  if (generatedAtMs == null) {
    return { generatedAt, ageDays: null, stale: true };
  }
  const ageDays = (Date.now() - generatedAtMs) / DAY_MS;
  return {
    generatedAt,
    ageDays: Number(ageDays.toFixed(2)),
    stale: ageDays > windowDays || generatedAtMs > Date.now() + DAY_MS
  };
}

function annotateFeedFreshness(healthcheck, feed, fallbackReason = null) {
  const freshness = feedFreshness(feed, healthcheck.windowDays || 30);
  healthcheck.feed_generatedAt = freshness.generatedAt;
  healthcheck.feed_age_days = freshness.ageDays;
  healthcheck.feed_stale = freshness.stale;
  healthcheck.feed_fallback_reason = fallbackReason;
  if (freshness.stale) {
    const age = freshness.ageDays == null ? 'unknown age' : `${freshness.ageDays} days old`;
    healthcheck.warnings.push(`Selected ${healthcheck.feed_source} is stale: generatedAt ${freshness.generatedAt || 'missing'} (${age}) exceeds the ${healthcheck.windowDays}-day window`);
  }
}

async function loadLocalFeed(healthcheck, fallbackReason = null) {
  healthcheck.feed_source = 'local_feed';
  const feed = JSON.parse(await readFile(LOCAL_FEED, 'utf-8'));
  annotateFeedFreshness(healthcheck, feed, fallbackReason);
  return feed;
}

async function loadFeed(noRemote, healthcheck) {
  if (!noRemote && !existsSync(USER_CATALOG)) {
    const r = await httpGet(REMOTE_FEED, 10000);
    if (r.ok) {
      try {
        const feed = JSON.parse(r.text);
        const freshness = feedFreshness(feed, healthcheck.windowDays || 30);
        if (freshness.stale) {
          const age = freshness.ageDays == null ? 'unknown age' : `${freshness.ageDays} days old`;
          healthcheck.warnings.push(`Remote feed stale: generatedAt ${freshness.generatedAt || 'missing'} (${age}) exceeds the ${healthcheck.windowDays}-day window; falling back to local_feed`);
          return await loadLocalFeed(healthcheck, 'remote_feed_stale');
        }
        healthcheck.feed_source = 'remote_feed';
        annotateFeedFreshness(healthcheck, feed);
        return feed;
      } catch (err) {
        healthcheck.warnings.push(`Remote feed unreadable: ${err.message}`);
        return await loadLocalFeed(healthcheck, 'remote_feed_unreadable');
      }
    } else {
      healthcheck.warnings.push(`Remote feed unavailable: HTTP ${r.status}${r.error ? ` ${r.error}` : ''}`);
      return await loadLocalFeed(healthcheck, 'remote_feed_unavailable');
    }
  }
  return await loadLocalFeed(healthcheck);
}

async function loadPromptFile(filename, noRemote, healthcheck) {
  const userPath = join(USER_PROMPTS_DIR, filename);
  if (existsSync(userPath)) {
    try {
      return await readFile(userPath, 'utf-8');
    } catch (err) {
      healthcheck.warnings.push(`User prompt ${filename} unreadable: ${err.message}`);
    }
  }
  if (!noRemote) {
    const r = await httpGet(`${REMOTE_PROMPTS}/${filename}`, 8000);
    if (r.ok) return r.text;
    healthcheck.warnings.push(`Remote prompt ${filename} unavailable: HTTP ${r.status}`);
  }
  return await readFile(join(LOCAL_PROMPTS_DIR, filename), 'utf-8');
}

function parseDateMs(value) {
  if (!value) return null;
  const ms = new Date(String(value)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function withinWindow(item, days) {
  const itemMs = parseDateMs(item.publishedAt);
  if (itemMs == null) return false;
  const now = Date.now();
  if (itemMs > now + DAY_MS) return false;
  return itemMs >= now - days * DAY_MS;
}

function hasGeneratedTimestampFallback(item, feed) {
  if (item.retrievalMethod !== 'tavily') return false;
  const itemMs = parseDateMs(item.publishedAt);
  const generatedAtMs = parseDateMs(feed.generatedAt);
  if (itemMs == null || generatedAtMs == null) return false;
  return Math.abs(itemMs - generatedAtMs) <= 30 * 60 * 1000;
}

function filterItems(feed, config, healthcheck) {
  const wanted = new Set(config.categories);
  const items = Array.isArray(feed.items) ? feed.items : [];
  if (healthcheck.feed_stale) return [];
  const filtered = [];
  for (const item of items) {
    if (!wanted.has(item.sourceCategory)) {
      healthcheck.filtered_out_by_category++;
      continue;
    }
    if (!withinWindow(item, config.windowDays)) {
      healthcheck.filtered_out_by_window++;
      continue;
    }
    if (hasGeneratedTimestampFallback(item, feed)) {
      healthcheck.filtered_out_by_suspect_timestamp++;
      continue;
    }
    if (!item.url) {
      healthcheck.filtered_out_missing_url++;
      continue;
    }
    filtered.push(item);
  }
  return filtered.sort((a, b) => (b.score || 0) - (a.score || 0));
}

function groupByCategory(items) {
  const out = {};
  for (const item of items) (out[item.sourceCategory] ||= []).push(item);
  return out;
}

function normalizeLanguage(value) {
  if (['zh', 'en', 'bilingual'].includes(value)) return value;
  return 'zh';
}

function buildConfig(args, userConfig) {
  const windowDays = args.days ?? userConfig.windowDays ?? 30;
  const categories = args.categories ?? normalizeCategoryList(userConfig.categories || DEFAULT_CATEGORIES, 'config.categories');
  return {
    windowDays,
    language: normalizeLanguage(userConfig.language || 'zh'),
    categories
  };
}

async function main() {
  const args = parseArgs();
  const healthcheck = {
    warnings: [],
    catalog_source: null,
    feed_source: null,
    windowDays: null,
    feed_generatedAt: null,
    feed_age_days: null,
    feed_stale: false,
    feed_fallback_reason: null,
    filtered_out_by_category: 0,
    filtered_out_by_window: 0,
    filtered_out_by_suspect_timestamp: 0,
    filtered_out_missing_url: 0
  };

  const userConfig = await loadUserConfig(healthcheck);
  const config = buildConfig(args, userConfig);
  healthcheck.windowDays = config.windowDays;
  const catalog = await loadCatalog(args.noRemote, healthcheck);
  const feed = await loadFeed(args.noRemote, healthcheck);
  const prompts = {};
  for (const filename of PROMPT_FILES) {
    const key = filename.replace(/\.md$/, '').replace(/-/g, '_');
    prompts[key] = await loadPromptFile(filename, args.noRemote, healthcheck);
  }

  const items = filterItems(feed, config, healthcheck);
  const groupedByCategory = groupByCategory(items);
  const payload = {
    status: 'ok',
    generatedAt: feed.generatedAt || null,
    windowDays: config.windowDays,
    config,
    items,
    groupedByCategory,
    stats: {
      keptItems: items.length,
      sourceFeedItems: Array.isArray(feed.items) ? feed.items.length : 0,
      candidateItems: Array.isArray(feed.candidateItems) ? feed.candidateItems.length : null,
      selectedByCategory: Object.fromEntries(Object.entries(groupedByCategory).map(([k, v]) => [k, v.length]))
    },
    healthcheck: {
      ...healthcheck,
      feed_stats: feed.stats || null,
      top3_categories: feed.healthcheck?.top3_categories || null,
      top3_scores: feed.healthcheck?.top3_scores || null,
      top3_rejected_candidates: feed.healthcheck?.top3_rejected_candidates || null
    },
    signalTaxonomy: feed.signalTaxonomy || catalog.signal_taxonomy || null,
    prompts
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main().catch(err => {
  console.error(JSON.stringify({ status: 'error', message: err.message }));
  process.exit(1);
});
