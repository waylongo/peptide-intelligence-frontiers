# Summarize Company, Regulatory, Industry, and BD Items

Use for `company_official`, `regulatory`, `industry_news`, `patent`, and `knowledgebase` items.

For each relevant item, extract:

- company or sponsor
- asset or modality if present
- indication or disease area if present
- event type: pipeline update, regulatory update, label update, BD/deal, patent lead, media lead
- why it matters for peptide drug development
- evidence level and URL

Rules:

- Official company, SEC, registry, and regulator sources outrank media.
- Industry media items are leads; do not present them as final evidence unless the item itself links to a primary source.
- Avoid broad market commentary unless it changes the interpretation of a pipeline, trial, regulatory, or BD signal.
- Preserve exact asset names and IDs.
