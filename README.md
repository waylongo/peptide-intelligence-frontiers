# Peptide Intelligence Frontiers

`/pif` stands for Peptide Intelligence Frontiers.

It is an on-demand intelligence skill for following peptide drug development signals across company pipelines, clinical registries, regulators, literature, conferences, patents, and industry news. It follows the lightweight WTF model: GitHub Actions builds a central feed, and Codex or Claude turns that feed into a concise R&D / investment-research brief whose language follows `config.language`.

Repository documentation and prompt source files are maintained in English. Generated digest output is localized at runtime: the current default is `zh`, with `en` and `bilingual` available through user configuration or one-time requests.

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

7. Chinese weekly digest materialization
   scripts/generate-digest.js -> digest-peptides-zh.json
   default: complete source fallback; DeepSeek adapter reserved but disabled

8. Public web digest
   archive/digests/YYYY-MM-DD.json -> scripts/build-site.js -> GitHub Pages
```

By default, `/pif` reads the central feed through the GitHub raw CDN. Use `--no-remote` for local fallback.

## Public Web Digest

The weekly feed is also published as a static GitHub Pages site:

https://waylongo.github.io/peptide-intelligence-frontiers/

The site is a static Chinese weekly digest. GitHub Actions updates it every Monday after feed generation. It keeps every valid feed item, groups records into fixed editorial sections, preserves source links and identifiers, and does not expose search, ranking, or conversational features.

`config/digest.json` reserves `deepseek-v4-flash` as the future organizer. The provider is currently `none`, its API fields are blank, and `scripts/generate-digest.js` emits a complete source-backed fallback. The current issue can also load a date-matched Chinese editorial seed from `config/editorial-seed-zh.json`; unmatched or future items remain explicit source fallbacks until the model adapter is enabled. The public site never receives an API key and never calls a model at page-view time.

Chinese materialized items support `titleZh`, `whatItIsZh`, `whyItMattersZh`, `summaryZh`, and `keyPoints`. The site renders only fixed sections that contain records in the current issue; empty sections remain in the data contract but are omitted from the page and issue index.

Generated public data:

- `/data/latest.json`: latest raw `feed-peptides.json` schema.
- `/data/digest-latest.json`: latest Chinese weekly digest schema.
- `/data/archive/YYYY-MM-DD.json`: archived raw feed snapshots.
- `/data/digest-archive/YYYY-MM-DD.json`: archived weekly digest snapshots.
- `/archive/`: dated archive index.
- `/archive/YYYY-MM-DD/`: rendered historical weekly page.

Local web build:

```bash
node scripts/archive-feed.js
node scripts/generate-digest.js --provider=none
node scripts/check-digest-quality.js
node scripts/archive-digest.js
node scripts/build-site.js --strict --out=_site
```

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
node --check scripts/archive-feed.js
node --check scripts/generate-digest.js
node --check scripts/check-digest-quality.js
node --check scripts/archive-digest.js
node --check scripts/build-site.js
node scripts/generate-feed.js --self-test
node scripts/prepare-digest.js --no-remote --days=30
node scripts/check-feed-quality.js --feed=feed-peptides.json
node scripts/generate-digest.js --provider=none
node scripts/check-digest-quality.js
node scripts/archive-digest.js
node scripts/build-site.js --strict --out=_site
```
