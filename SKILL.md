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

## Digest Run

Run:

```bash
node "${CLAUDE_SKILL_DIR:-$PWD}/scripts/prepare-digest.js"
```

One-time overrides:

- `past N days` -> `--days=N`
- `clinical only` -> `--category=clinical_registry`
- `clinical and regulatory only` -> `--category=clinical_registry,regulatory`
- `literature only` -> `--category=literature`
- `local only` or `skip remote` -> `--no-remote`

The script output contains:

- `items` and `groupedByCategory`
- `prompts`
- `healthcheck`
- `signalTaxonomy`

If `stats.keptItems == 0`, say:

```text
过去 [windowDays] 天没有匹配当前筛选条件的多肽药物研发信号。可以扩大分类或时间窗口。
```

Then stop.

## Remix

Follow the prompts returned by the script:

- `prompts.digest_intro`: section order, Top Signals, evidence discipline, healthcheck footer
- `prompts.summarize_news`: Company / Pipeline, Regulatory, Industry News, BD leads
- `prompts.summarize_official`: official company, registry, regulator, and patent-like source handling
- `prompts.summarize_papers`: Literature, preprint, and conference items
- `prompts.translate`: apply when `config.language` is `en` or `bilingual`
- `prompts.slides_report`: optional HTML slide report generation after the digest has been produced

Use this body order after Top Signals:

1. Company / Pipeline
2. Clinical & Regulatory
3. Literature & Conferences
4. Patents / BD / Industry Leads

Populate:

- `healthcheck.top3_categories`
- `healthcheck.top3_scores`
- `healthcheck.top3_rejected_candidates`

Language behavior:

- `zh`: Chinese only, keeping company names, asset names, indications, trial IDs, PMIDs, DOIs, and abbreviations in English
- `en`: English only
- `bilingual`: Chinese first, paired with English where useful

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

Output the full JSON, then briefly note feed source, failed RSS/API sources, Tavily stats, and filter counts.

## Absolute Rules

- Every bullet must include a URL; drop items without URLs.
- Do not invent sources, categories, scores, dates, URLs, claims, sample sizes, trial phases, approval status, asset mechanisms, or company relationships.
- Do not repeat a Top Signal in later sections.
- Distinguish evidence levels: official / registry / peer-reviewed / preprint / conference / patent / media lead.
- Industry media and websearch items are leads, not final evidence, unless they link to an official or primary source.
- Do not use hype.
- Top Signals category labels must match `signalTaxonomy.categories`.
