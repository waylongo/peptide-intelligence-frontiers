#!/usr/bin/env node

// Ensure the digest preserves the complete feed and immutable source facts.

import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');

function parseArgs() {
  const args = {
    feedPath: join(REPO_ROOT, 'feed-peptides.json'),
    digestPath: join(REPO_ROOT, 'digest-peptides-zh.json')
  };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--feed=')) args.feedPath = arg.slice('--feed='.length);
    else if (arg.startsWith('--digest=')) args.digestPath = arg.slice('--digest='.length);
    else {
      console.error(`Unsupported argument: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
}

const args = parseArgs();
const feed = JSON.parse(await readFile(args.feedPath, 'utf-8'));
const digest = JSON.parse(await readFile(args.digestPath, 'utf-8'));

if (!Array.isArray(feed.items)) throw new Error('feed.items must be an array');
if (!Array.isArray(digest.items)) throw new Error('digest.items must be an array');
if (digest.language !== 'zh-CN') throw new Error('digest.language must be zh-CN');
if (digest.digestMode !== 'complete') throw new Error('digest.digestMode must be complete');
if (digest.itemCount !== feed.items.length || digest.items.length !== feed.items.length) {
  throw new Error(`item count mismatch: feed=${feed.items.length}, digest=${digest.items.length}, declared=${digest.itemCount}`);
}

const feedByUrl = new Map(feed.items.map(item => [item.url, item]));
const seenIds = new Set();
const seenUrls = new Set();
for (const [index, item] of digest.items.entries()) {
  requireText(item.sourceItemId, `digest item ${index}.sourceItemId`);
  requireText(item.sourceUrl, `digest item ${index}.sourceUrl`);
  requireText(item.originalTitle, `digest item ${index}.originalTitle`);
  if (seenIds.has(item.sourceItemId)) throw new Error(`duplicate sourceItemId: ${item.sourceItemId}`);
  if (seenUrls.has(item.sourceUrl)) throw new Error(`duplicate sourceUrl: ${item.sourceUrl}`);
  seenIds.add(item.sourceItemId);
  seenUrls.add(item.sourceUrl);

  const source = feedByUrl.get(item.sourceUrl);
  if (!source) throw new Error(`digest item URL is not present in feed: ${item.sourceUrl}`);
  if (item.originalTitle !== source.title) throw new Error(`originalTitle changed for ${item.sourceUrl}`);
  for (const key of ['publishedAt', 'nctId', 'doi', 'pmid']) {
    if ((item[key] || null) !== (source[key] || null)) throw new Error(`${key} changed for ${item.sourceUrl}`);
  }

  if (!['source_fallback', 'editorial_seed', 'ai_generated'].includes(item.contentStatus)) {
    throw new Error(`unsupported contentStatus for ${item.sourceUrl}: ${item.contentStatus}`);
  }
  if (item.contentStatus === 'ai_generated' || item.contentStatus === 'editorial_seed') {
    requireText(item.titleZh, `Chinese item ${index}.titleZh`);
    requireText(item.summaryZh, `Chinese item ${index}.summaryZh`);
    requireText(item.whatItIsZh, `Chinese item ${index}.whatItIsZh`);
    requireText(item.whyItMattersZh, `Chinese item ${index}.whyItMattersZh`);
  }
}

for (const item of feed.items) {
  if (!seenUrls.has(item.url)) throw new Error(`feed item missing from digest: ${item.url}`);
}

const sectionTotal = (digest.sections || []).reduce((sum, section) => sum + Number(section.itemCount || 0), 0);
if (sectionTotal !== digest.items.length) throw new Error(`section count mismatch: sections=${sectionTotal}, items=${digest.items.length}`);
if (digest.model?.status === 'ready') {
  if (digest.model?.provider !== 'deepseek') throw new Error('ready digest must use the deepseek provider');
  const nonAiItems = digest.items.filter(item => item.contentStatus !== 'ai_generated');
  if (nonAiItems.length) throw new Error(`ready digest contains ${nonAiItems.length} non-AI items`);
  if (digest.model.aiGeneratedItems !== digest.items.length) throw new Error('ready digest aiGeneratedItems mismatch');
  if (digest.model.fallbackItems !== 0) throw new Error('ready digest must not contain fallback items');
}

console.log(JSON.stringify({
  status: 'ok',
  issueDate: digest.issueDate,
  itemCount: digest.items.length,
  aiGeneratedItems: digest.items.filter(item => item.contentStatus === 'ai_generated').length,
  editorialItems: digest.items.filter(item => item.contentStatus === 'editorial_seed').length,
  fallbackItems: digest.items.filter(item => item.contentStatus === 'source_fallback').length
}));
