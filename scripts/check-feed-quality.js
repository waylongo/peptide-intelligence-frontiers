#!/usr/bin/env node

import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');
const DAY_MS = 24 * 60 * 60 * 1000;

function parseArgs() {
  const args = { feedPath: join(REPO_ROOT, 'feed-peptides.json'), strict: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--strict') args.strict = true;
    else if (arg.startsWith('--feed=')) args.feedPath = arg.slice('--feed='.length);
  }
  return args;
}

function parseDateMs(value) {
  if (!value) return null;
  const ms = new Date(String(value)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function hasDayPrecision(value) {
  if (!value) return false;
  const raw = String(value).trim();
  if (!raw) return false;
  if (/^\d{4}$/.test(raw)) return false;
  if (/^\d{4}[-/]\d{1,2}$/.test(raw)) return false;
  return [
    /^\d{4}\d{2}\d{2}$/,
    /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\b|T|\s)/,
    /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}(?:\b|T|\s)/,
    /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}\b/i,
    /^\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}\b/i,
    /^[A-Za-z]{3,}\s+\d{1,2},?\s+\d{4}\b/i
  ].some(re => re.test(raw));
}

function isNearGeneratedTimestamp(itemMs, generatedAtMs) {
  return Math.abs(itemMs - generatedAtMs) <= 30 * 60 * 1000;
}

function normalizedTitle(item) {
  return `${item.sourceName || ''}|${item.title || ''}`
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addFinding(findings, kind, item, detail) {
  findings.push({
    kind,
    sourceName: item.sourceName || null,
    title: item.title || null,
    url: item.url || null,
    detail
  });
}

function scanFeed(feed) {
  const findings = [];
  const warnings = [];
  const items = Array.isArray(feed.items) ? feed.items : [];
  const candidates = Array.isArray(feed.candidateItems) ? feed.candidateItems : null;
  const htmlRe = /<\/?(?:p|a|img|div|span|br|strong|em|ul|ol|li|script|style)\b/i;
  const entityRe = /&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i;
  const seenUrls = new Set();
  const seenTitles = new Set();
  const generatedAtMs = parseDateMs(feed.generatedAt);
  const lookbackDays = Number(feed.lookbackDays || 30);

  if (generatedAtMs == null) addFinding(findings, 'bad_generated_at', {}, 'generatedAt must be parseable');
  if (!Number.isFinite(lookbackDays) || lookbackDays < 1) addFinding(findings, 'bad_lookback', {}, 'lookbackDays must be positive');
  if (generatedAtMs != null && Number.isFinite(lookbackDays)) {
    const now = Date.now();
    if (generatedAtMs > now + DAY_MS) addFinding(findings, 'future_feed', {}, 'feed generatedAt is in the future');
    if (generatedAtMs < now - lookbackDays * DAY_MS) addFinding(findings, 'stale_feed', {}, 'feed generatedAt is older than lookbackDays');
  }

  for (const item of items) {
    const body = `${item.title || ''} ${item.summary || ''}`;
    if (!item.url) addFinding(findings, 'missing_url', item, 'Feed item must include a URL');
    if (item.url && seenUrls.has(item.url)) addFinding(findings, 'duplicate_url', item, item.url);
    if (item.url) seenUrls.add(item.url);

    const titleKey = normalizedTitle(item);
    if (seenTitles.has(titleKey)) addFinding(findings, 'duplicate_title', item, titleKey);
    if (titleKey) seenTitles.add(titleKey);

    if (htmlRe.test(body)) addFinding(findings, 'html_residue', item, 'Title or summary contains HTML tags');
    if (entityRe.test(body)) addFinding(findings, 'entity_residue', item, 'Title or summary contains HTML entities');

    const itemMs = parseDateMs(item.publishedAt);
    if (!item.publishedAt) {
      addFinding(findings, 'bad_published_at', item, 'publishedAt must be parseable');
    } else if (!hasDayPrecision(item.publishedAt)) {
      addFinding(findings, 'imprecise_published_at', item, 'publishedAt must include at least a calendar day');
    } else if (itemMs == null) {
      addFinding(findings, 'bad_published_at', item, 'publishedAt must be parseable');
    }
    if (itemMs != null) {
      const now = Date.now();
      if (itemMs > now + DAY_MS) addFinding(findings, 'future_item', item, 'Item is dated in the future');
      if (itemMs < now - lookbackDays * DAY_MS) addFinding(findings, 'outside_window', item, 'Item is outside lookback window');
      if (item.retrievalMethod === 'tavily' && generatedAtMs != null && isNearGeneratedTimestamp(itemMs, generatedAtMs)) {
        addFinding(findings, 'suspect_generated_timestamp', item, 'Tavily item timestamp is too close to feed generation time');
      }
    }
  }

  if (candidates) {
    const selectedCandidates = candidates.filter(item => item.selectionStatus === 'selected').length;
    if (selectedCandidates && selectedCandidates !== items.length) {
      addFinding(findings, 'candidate_selected_mismatch', {}, `candidateItems selected=${selectedCandidates}, items=${items.length}`);
    }
    if (feed.candidateStats && feed.candidateStats.selectedItems !== items.length) {
      addFinding(findings, 'candidate_stats_mismatch', {}, `candidateStats.selectedItems=${feed.candidateStats.selectedItems}, items=${items.length}`);
    }
  }

  if (lookbackDays === 30 && items.length > 0 && (items.length < 10 || items.length > 75)) {
    warnings.push(`30-day selected item count is ${items.length}; expected a practical range around 10-75 once feeds are active`);
  }

  return { findings, warnings };
}

const args = parseArgs();
const feed = JSON.parse(await readFile(args.feedPath, 'utf-8'));
const { findings, warnings } = scanFeed(feed);
const blocking = args.strict ? findings : findings.filter(f => ['missing_url', 'duplicate_url', 'duplicate_title', 'bad_generated_at', 'bad_lookback'].includes(f.kind));

for (const warning of warnings) console.error(`warning: ${warning}`);
if (blocking.length) {
  console.error('Feed quality check failed:');
  for (const finding of blocking) {
    console.error(`- ${finding.kind}: ${finding.title || finding.detail}${finding.url ? ` (${finding.url})` : ''}`);
  }
  process.exit(1);
}

console.log(JSON.stringify({
  status: 'ok',
  feedPath: args.feedPath,
  schemaVersion: feed.schemaVersion || null,
  itemCount: Array.isArray(feed.items) ? feed.items.length : 0,
  candidateItems: Array.isArray(feed.candidateItems) ? feed.candidateItems.length : null,
  strict: args.strict,
  warnings: warnings.length
}));
