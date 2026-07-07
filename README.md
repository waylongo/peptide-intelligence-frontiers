# Peptide Intelligence Frontiers

`/pif` stands for Peptide Intelligence Frontiers.

It is an on-demand intelligence skill for following peptide drug development signals across company pipelines, clinical registries, regulators, literature, conferences, patents, and industry news. It follows the lightweight WTF model: GitHub Actions builds a central feed, and Codex or Claude turns that feed into a concise Chinese R&D / investment-research brief.

## Information Sources

The source catalog is `config/sources.json`.

- **Company Official** (`company_official`): official pipeline pages, investor relations, press releases, and SEC filings.
- **Clinical Registry** (`clinical_registry`): ClinicalTrials.gov and related public registry sources.
- **Regulatory** (`regulatory`): openFDA and public regulator pages.
- **Literature** (`literature`): PubMed, Europe PMC, Crossref, bioRxiv, medRxiv, and journal feeds.
- **Conference** (`conference`): meeting abstract pages and society feeds.
- **Patent** (`patent`): public patent lead sources; key-required APIs are listed but inactive by default.
- **Industry News** (`industry_news`): biotech and pharma media RSS/websearch leads.
- **Knowledgebase** (`knowledgebase`): public enrichment databases, listed mostly as inactive/manual in V1.

V1 prioritizes public/free sources. Key-required, paid, or fragile sources are documented under `inactive_sources` and are not fetched by default.

## Data Flow

```text
1. Source catalog
   config/sources.json

2. Central feed generation
   GitHub Actions -> scripts/generate-feed.js
   schedule: every Monday 07:30 Beijing time
   lookback: 30 days

3. Published feed
   feed-peptides.json
   state-feed.json

4. Digest preparation
   scripts/prepare-digest.js
   default display window: 30 days
   applies local language/category/source overrides

5. Agent output
   prompts/*.md
   Codex / Claude digest

6. Optional slide report
   templates/slides.html -> pif-YYYY-MM-slides.html
   scripts/export-slides-pdf.sh -> pif-YYYY-MM-slides.pdf
```

By default, `/pif` reads the central feed through the GitHub raw CDN. Use `--no-remote` for local fallback.

## Install

Codex:

```bash
git clone https://github.com/waylongo/peptide-intelligence-frontiers.git ~/.codex/skills/peptide-intelligence-frontiers
```

Claude Code:

```bash
git clone https://github.com/waylongo/peptide-intelligence-frontiers.git ~/.claude/skills/peptide-intelligence-frontiers
```

Requires Node 22+. There are no npm dependencies.

## Use

Use `/pif` directly in Codex or Claude Code.

Examples:

- `/pif`
- `/pif latest peptide intelligence frontiers`
- `/pif past 14 days`
- `/pif clinical and regulatory only`
- `/pif literature only`
- `/pif switch output to English`

After a digest, `/pif` can save the brief as Markdown and optionally generate a 16:9 HTML slide report:

```text
pif-YYYY-MM-digest.md
pif-YYYY-MM-slides.html
pif-YYYY-MM-slides.pdf
```

Markdown, HTML, and PDF files are written to the current directory; existing names get `-2`, `-3`, and so on. PDF export requires Chrome/Chromium and uses print-safe slide CSS.

## Local Development

```bash
node --check scripts/generate-feed.js
node --check scripts/prepare-digest.js
node --check scripts/check-feed-quality.js
node scripts/generate-feed.js --self-test
node scripts/prepare-digest.js --no-remote --days=30
node scripts/check-feed-quality.js --feed=feed-peptides.json
```
