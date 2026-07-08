#!/usr/bin/env node

// Save the current generated feed as a dated weekly snapshot.
// The archive date is derived from feed.generatedAt in UTC.

import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');

function parseArgs() {
  const args = {
    feedPath: join(REPO_ROOT, 'feed-peptides.json'),
    archiveDir: join(REPO_ROOT, 'archive', 'feeds')
  };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--feed=')) args.feedPath = arg.slice('--feed='.length);
    else if (arg.startsWith('--archive-dir=')) args.archiveDir = arg.slice('--archive-dir='.length);
    else {
      console.error(`Unsupported argument: ${arg}`);
      process.exit(2);
    }
  }

  return args;
}

function feedDate(feed) {
  const ms = new Date(String(feed.generatedAt || '')).getTime();
  if (!Number.isFinite(ms)) {
    throw new Error('feed.generatedAt must be a parseable timestamp');
  }
  return new Date(ms).toISOString().slice(0, 10);
}

const args = parseArgs();
const feed = JSON.parse(await readFile(args.feedPath, 'utf-8'));
const date = feedDate(feed);
const outputPath = join(args.archiveDir, `${date}.json`);
const body = `${JSON.stringify(feed, null, 2)}\n`;

await mkdir(args.archiveDir, { recursive: true });

let status = 'created';
if (existsSync(outputPath)) {
  const current = await readFile(outputPath, 'utf-8');
  if (current === body) status = 'unchanged';
  else status = 'updated';
}

if (status !== 'unchanged') {
  await writeFile(outputPath, body);
}

console.log(JSON.stringify({
  status,
  date,
  path: outputPath,
  itemCount: Array.isArray(feed.items) ? feed.items.length : 0
}));
