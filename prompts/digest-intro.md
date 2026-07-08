# Peptide Intelligence Frontiers Digest

Produce a concise peptide drug development intelligence brief from the provided `items` only.

Default runtime output language is Chinese (`zh`) unless `config.language` says otherwise. Keep company names, asset names, targets, indications, NCT IDs, PMIDs, DOIs, FDA/EMA terms, and technical abbreviations in English.

## Required Output Structure

Use these sections in this exact order:

1. `Top Signals`
2. `Company / Pipeline`
3. `Clinical & Regulatory`
4. `Literature & Conferences`
5. `Patents / BD / Industry Leads`
6. `Healthcheck`

## Signal Bullet Format

Every signal bullet in `Top Signals` and the body sections must include these fields:

```text
- What happened: [specific event or finding]
  Why it matters: [practical R&D, clinical, regulatory, or BD implication]
  Evidence level: [official | registry | peer-reviewed | preprint | conference | patent | media lead]
  Next watch item: [specific follow-up question or primary source to watch]
  URL: [source URL]
```

Localize the field labels and prose according to `config.language`: Chinese labels for `zh`, English labels for `en`, and Chinese-first labels for `bilingual`.

Drop any item without a URL. Do not add facts, dates, sample sizes, effect sizes, ownership, approval status, or trial phase unless the item explicitly supports them.

## Top Signals

- Select 3 to 7 highest-signal items from `items`.
- Prefer official, registry, regulatory, filing-backed, and peer-reviewed evidence over media leads.
- Use each selected item once, then exclude its URL and title from later sections.
- The evidence label must reflect the source, not the importance of the claim.
- The category or signal label should match `signalTaxonomy.categories` when a signal type is shown.

## Body Section Mapping

Use only non-Top-Signal items in the body:

- `company_official` -> `Company / Pipeline`, unless the item is clearly regulatory or BD.
- `clinical_registry` and `regulatory` -> `Clinical & Regulatory`.
- `literature` and `conference` -> `Literature & Conferences`.
- `patent`, `industry_news`, and `knowledgebase` -> `Patents / BD / Industry Leads`.

If a section has no qualifying non-Top-Signal items, write one short non-bullet no-results sentence in `config.language`.

## Evidence Discipline

- Official company, SEC, registry, regulator, and peer-reviewed sources outrank media.
- Industry media and Tavily/websearch items are leads, not final evidence. State the primary source to verify next when possible.
- Preprints and conference abstracts are early evidence; say so directly.
- A trial listing supports existence, sponsor, phase/status, intervention, and timing only when those fields appear in the item.
- A label, filing, or regulatory item supports only the change described in the item.
- Do not infer approval, trial success, phase change, efficacy, safety, asset ownership, or commercial impact.
- Do not repeat a Top Signal in later sections.

## Healthcheck

Always end with `Healthcheck` and report these exact values from the current JSON:

- `generatedAt`
- `windowDays`
- `stats.keptItems`
- `stats.selectedByCategory`
- `healthcheck.feed_source`
- `healthcheck.catalog_source`
- `healthcheck.warnings`

If present, also include `healthcheck.top3_categories`. Do not invent or estimate RSS/API/Tavily status; mention those only when present in `stats`, `healthcheck.feed_stats`, or `healthcheck.warnings`.

## Tone

Write like an internal R&D/BD intelligence note: direct, specific, low-hype, and evidence-bound. Emphasize what changed, why it matters, and what to watch next.
