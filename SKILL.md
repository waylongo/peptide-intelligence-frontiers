---
name: pif
description: /pif is a curated peptide drug development intelligence digest. Use when the user invokes /pif or asks what's new in peptide therapeutics, GLP-1/GIP/amylin assets, PRRT/RDC/PDC, cyclic or macrocyclic peptides, oral peptide delivery, peptide clinical trials, peptide regulatory updates, or peptide drug R&D signals.
---

# /pif

`/pif` stands for Peptide Intelligence Frontiers. It produces an on-demand signal brief from a centrally generated feed.

## Runtime Model

- Use only `items` from `prepare-digest.js`.
- Do not run web search or refetch article URLs during digest generation.
- Default feed path: `remote_feed`, with central RSS/API/Tavily results.
- Fallback feed path: `local_feed`, with local public RSS/API subset.
- Public source catalog: `config/sources.json`.
- User overrides: `~/.pif/config.json`, `~/.pif/sources.json`, `~/.pif/prompts/*.md`.

## First Run

If `~/.pif/config.json` does not exist with `onboardingComplete: true`, ask for:

- `windowDays`: 1 / 7 / 14 / 30; default is 30.
- `language`: `zh` / `en` / `bilingual`; default is `zh`.
- `categories`: any of `company_official`, `clinical_registry`, `regulatory`, `literature`, `conference`, `patent`, `industry_news`, `knowledgebase`.

Save the selected values:

```bash
mkdir -p ~/.pif
cat > ~/.pif/config.json << 'CFGEOF'
{
  "windowDays": 30,
  "language": "zh",
  "categories": ["company_official", "clinical_registry", "regulatory", "literature", "conference", "patent", "industry_news", "knowledgebase"],
  "onboardingComplete": true
}
CFGEOF
```

Then run the digest.

## Digest Workflow

Run the digest in this order:

1. Resolve user configuration and one-time overrides.
2. Run `prepare-digest.js` exactly once.
3. Stop on empty results.
4. Build `Top Signals`.
5. Build the body sections from non-Top-Signal items.
6. Add the fixed `Healthcheck`.
7. Offer optional Markdown save, then optional HTML slides.

Keep the JSON returned by the script in memory for the whole turn. Reuse it for optional Markdown and slides decisions. Do not rerun the script, run web search, or refetch article URLs unless the user explicitly asks for `debug` or a fresh run.

### 1. Resolve Configuration

Use `~/.pif/config.json` defaults unless the user's current request includes a one-time override.

Supported one-time overrides:

- `past N days` -> `--days=N`
- `clinical only` -> `--category=clinical_registry`
- `clinical and regulatory only` -> `--category=clinical_registry,regulatory`
- `literature only` -> `--category=literature`
- `local only` or `skip remote` -> `--no-remote`

Do not persist one-time overrides to `~/.pif/config.json`.

### 2. Run Prepare Digest

Run:

```bash
node "${CLAUDE_SKILL_DIR:-$PWD}/scripts/prepare-digest.js"
```

The script output contains:

- `items` and `groupedByCategory`
- `prompts`
- `healthcheck`
- `signalTaxonomy`
- `stats`
- `config`

If `stats.keptItems == 0`, say:

Reply in `config.language` with one short sentence stating that the past `[windowDays]` days have no peptide drug development signals matching the current filters, and suggest expanding the categories or time window.

Then stop.

### 3. Remix Contract

Follow the prompts returned by the script and treat them as the source-specific instruction set:

- `prompts.digest_intro`: section order, Top Signals, evidence discipline, healthcheck footer
- `prompts.summarize_news`: Company / Pipeline, Regulatory, Industry News, BD leads
- `prompts.summarize_official`: official company, registry, regulator, and patent-like source handling
- `prompts.summarize_papers`: Literature, preprint, and conference items
- `prompts.translate`: language handling rules for `zh`, `en`, and `bilingual`
- `prompts.slides_report`: optional HTML slide report generation after the digest has been produced

Use only fields present in `items`, `stats`, `config`, `healthcheck`, and `signalTaxonomy`. If an item does not support a claim, omit that claim instead of filling the gap with outside knowledge.

### 4. Top Signals

Select 3 to 7 highest-signal items from `items`, preferring:

1. official company, registry, regulatory, and filing-backed items
2. peer-reviewed literature
3. preprint and conference evidence
4. patent, BD, industry media, and websearch leads

For each Top Signal, include:

- what happened
- why it matters
- evidence level
- next watch item
- URL

Track the Top Signal URLs and titles. Do not repeat those same items in the later body sections.

### 5. Body Sections

Use this body order after Top Signals, using only non-Top-Signal items:

1. Company / Pipeline
2. Clinical & Regulatory
3. Literature & Conferences
4. Patents / BD / Industry Leads

Section mapping:

- `company_official` -> Company / Pipeline unless the item is clearly regulatory or BD.
- `clinical_registry` and `regulatory` -> Clinical & Regulatory.
- `literature` and `conference` -> Literature & Conferences.
- `patent`, `industry_news`, and `knowledgebase` -> Patents / BD / Industry Leads.
- Industry media and Tavily/websearch items are leads. State what primary source should be checked next when possible.

If a section has no qualifying non-Top-Signal items, write one short no-results sentence in `config.language`. Do not create filler bullets.

Every signal bullet must include:

- what happened
- why it matters
- evidence level
- next watch item
- URL

### 6. Healthcheck

Always end with a `Healthcheck` section that reports these exact fields from the current JSON:

- `generatedAt`
- `windowDays`
- `stats.keptItems`
- `stats.selectedByCategory`
- `healthcheck.feed_source`
- `healthcheck.feed_generatedAt`
- `healthcheck.feed_age_days`
- `healthcheck.feed_stale`
- `healthcheck.feed_fallback_reason`
- `healthcheck.catalog_source`
- `healthcheck.warnings`

If present, also include `healthcheck.top3_categories`. Do not summarize Tavily, RSS, or API failures unless those values are present in `healthcheck.warnings`, `healthcheck.feed_stats`, or `stats`.

Language behavior:

- `zh`: Chinese prose and localized Chinese field labels, while keeping company names, asset names, indications, trial IDs, PMIDs, DOIs, and abbreviations in English.
- `en`: English prose and English field labels only.
- `bilingual`: Chinese-first prose and labels, with English only where it prevents ambiguity for technical terms, asset names, or section headings.

## Optional Markdown Digest

After producing the digest, ask the user:

```text
Save this digest as a Markdown file?
```

If the user says no, do not write a Markdown file and continue to the optional HTML slide report prompt. If the user says yes:

1. Save the already-produced digest text, not the raw `prepare-digest.js` JSON.
2. Write the file to the current working directory as `pif-YYYY-MM-digest.md`, using the digest `generatedAt` month in UTC. If the file exists, append `-2`, `-3`, and so on.
3. Report the path, then continue to the optional HTML slide report prompt.

## Optional HTML Slides

After handling the optional Markdown digest prompt, ask the user:

```text
Generate an HTML slide report for this digest?
```

If the user says no, stop. If the user says yes:

1. Reuse the current `prepare-digest.js` JSON from this digest run. Do not rerun the feed script, refetch article URLs, or run web search.
2. Read `${CLAUDE_SKILL_DIR:-$PWD}/templates/slides.html`, `${CLAUDE_SKILL_DIR:-$PWD}/prompts/slides-design.md`, and `prompts.slides_report`.
3. Generate a 16:9 interactive slide deck with richer editorial analysis than the digest text. Treat each slide as a fixed 16:9 canvas: at most 3 Top Signal cards on the overview slide, at most 4 body cards per slide, and no important content that requires scrolling to read.
4. Write the file to the current working directory as `pif-YYYY-MM-slides.html`, using the digest `generatedAt` month in UTC. If the file exists, append `-2`, `-3`, and so on.
5. Verify the HTML has no remaining `{{...}}` placeholders before reporting the path.

Then ask:

```text
Export the slide report to PDF?
```

If the user says yes, run:

```bash
bash "${CLAUDE_SKILL_DIR:-$PWD}/scripts/export-slides-pdf.sh" <html-file>
```

The PDF should use the same basename, for example `pif-2026-07-slides.pdf`.

## Configuration

Persist user defaults by editing `~/.pif/config.json`. Do not persist one-time requests such as `past 14 days`.

Supported fields:

- `windowDays`: 1 / 7 / 14 / 30
- `language`: `zh`, `en`, `bilingual`
- `categories`: `company_official`, `clinical_registry`, `regulatory`, `literature`, `conference`, `patent`, `industry_news`, `knowledgebase`

For source changes, edit `~/.pif/sources.json`; this forces local fallback.

For prompt changes, copy the relevant repo prompt to `~/.pif/prompts/<name>.md` and edit the user override.

## Debug

If the user says `debug` or `dump JSON`, rerun:

```bash
node "${CLAUDE_SKILL_DIR:-$PWD}/scripts/prepare-digest.js"
```

Output the full JSON, then briefly note these exact diagnostic fields when present:

- `healthcheck.feed_source`
- `healthcheck.feed_generatedAt`
- `healthcheck.feed_age_days`
- `healthcheck.feed_stale`
- `healthcheck.feed_fallback_reason`
- `healthcheck.catalog_source`
- `stats`
- `healthcheck.feed_stats`
- `healthcheck.warnings`
- `healthcheck.filtered_out_by_category`
- `healthcheck.filtered_out_by_window`
- `healthcheck.filtered_out_by_suspect_timestamp`
- `healthcheck.filtered_out_missing_url`

## Absolute Rules

- Every bullet must include a URL; drop items without URLs.
- Do not invent sources, categories, scores, dates, URLs, claims, sample sizes, trial phases, approval status, asset mechanisms, or company relationships.
- Do not repeat a Top Signal in later sections.
- Distinguish evidence levels: official / registry / peer-reviewed / preprint / conference / patent / media lead.
- Industry media and websearch items are leads, not final evidence, unless they link to an official or primary source.
- Do not use hype.
- Top Signals category labels must match `signalTaxonomy.categories`.
- Healthcheck must use the exact JSON values from the current run, not a narrative estimate.
