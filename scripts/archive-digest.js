#!/usr/bin/env node

// Save the current Chinese digest as a dated weekly snapshot.

import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');

function parseArgs() {
  const args = {
    digestPath: join(REPO_ROOT, 'digest-peptides-zh.json'),
    archiveDir: join(REPO_ROOT, 'archive', 'digests')
  };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--digest=')) args.digestPath = arg.slice('--digest='.length);
    else if (arg.startsWith('--archive-dir=')) args.archiveDir = arg.slice('--archive-dir='.length);
    else {
      console.error(`Unsupported argument: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

const args = parseArgs();
const digest = JSON.parse(await readFile(args.digestPath, 'utf-8'));
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(digest.issueDate || ''))) {
  throw new Error('digest.issueDate must use YYYY-MM-DD');
}
if (!Array.isArray(digest.items)) throw new Error('digest.items must be an array');

const outputPath = join(args.archiveDir, `${digest.issueDate}.json`);
const body = `${JSON.stringify(digest, null, 2)}\n`;
await mkdir(args.archiveDir, { recursive: true });

let status = 'created';
if (existsSync(outputPath)) {
  const current = await readFile(outputPath, 'utf-8');
  status = current === body ? 'unchanged' : 'updated';
}
if (status !== 'unchanged') await writeFile(outputPath, body);

console.log(JSON.stringify({ status, date: digest.issueDate, path: outputPath, itemCount: digest.items.length }));
