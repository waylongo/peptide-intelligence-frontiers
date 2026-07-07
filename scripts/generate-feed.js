#!/usr/bin/env node

// Peptide Intelligence Frontiers - central feed generator.
// No npm dependencies; intended for Node 22 in GitHub Actions.

import { readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');
const CATALOG_PATH = join(REPO_ROOT, 'config', 'sources.json');
const FEED_PATH = join(REPO_ROOT, 'feed-peptides.json');
const STATE_PATH = join(REPO_ROOT, 'state-feed.json');

const USER_AGENT = 'peptide-intelligence-frontiers/1.0 contact: https://github.com/waylongo/peptide-intelligence-frontiers';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 30;
const SELECTED_MIN_TARGET = 25;
const SELECTED_MAX_TARGET = 60;
const ALLOWED_CATEGORIES = new Set([
  'company_official',
  'clinical_registry',
  'regulatory',
  'literature',
  'conference',
  'patent',
  'industry_news',
  'knowledgebase'
]);
const ALLOWED_SIGNAL_TYPES = new Set([
  'pipeline_update',
  'clinical_trial',
  'regulatory',
  'paper',
  'preprint',
  'conference_abstract',
  'patent_signal',
  'bd_deal',
  'company_news'
]);

function parseArgs() {
  const args = { days: DEFAULT_LOOKBACK_DAYS, rssOnly: false, selfTest: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--rss-only') args.rssOnly = true;
    else if (arg === '--self-test') args.selfTest = true;
    else if (arg.startsWith('--days=')) {
      const n = Number.parseInt(arg.slice(7), 10);
      if (!Number.isFinite(n) || n < 1 || n > 365) {
        console.error(`--days must be an integer in [1, 365], got ${arg.slice(7)}`);
        process.exit(2);
      }
      args.days = n;
    }
  }
  return args;
}

function stripTags(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntitiesOnce(s) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    mdash: '-',
    ndash: '-',
    rsquo: "'",
    lsquo: "'",
    ldquo: '"',
    rdquo: '"',
    hellip: '...',
    micro: 'u',
    mu: 'u',
    alpha: 'alpha',
    beta: 'beta',
    gamma: 'gamma',
    delta: 'delta',
    trade: '(tm)',
    reg: '(r)'
  };
  return String(s || '')
    .replace(/&([a-z][a-z0-9]+);/gi, (m, name) => named[name.toLowerCase()] ?? m)
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number.parseInt(n, 10)));
}

function decodeEntities(s) {
  let out = String(s || '');
  for (let i = 0; i < 3; i++) {
    const next = decodeEntitiesOnce(out);
    if (next === out) break;
    out = next;
  }
  return out.replace(/&[a-z][a-z0-9]+;/gi, ' ');
}

function extractField(block, tag) {
  const cdataRe = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, 'i');
  const cdata = block.match(cdataRe);
  if (cdata) return stripTags(decodeEntities(cdata[1]));
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  if (m) return stripTags(decodeEntities(m[1]));
  const selfRe = new RegExp(`<${tag}[^>]*href=["']([^"']+)["'][^>]*\\/?>`, 'i');
  const self = block.match(selfRe);
  return self ? self[1] : null;
}

function parseFeed(xml) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const items = [];
  for (const b of blocks) {
    const title = extractField(b, 'title');
    const link = extractField(b, 'link') || extractField(b, 'id');
    const pubDate = extractField(b, 'pubDate') || extractField(b, 'published') || extractField(b, 'updated') || extractField(b, 'dc:date');
    const description = extractField(b, 'description') || extractField(b, 'summary') || extractField(b, 'content') || '';
    if (!title || !link) continue;
    items.push({
      title: title.slice(0, 500),
      url: link,
      publishedAt: normalizePublishedAt(pubDate),
      summary: description.slice(0, 2000)
    });
  }
  return items;
}

async function httpRequest(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, text };
    return { ok: true, status: res.status, text };
  } catch (err) {
    return { ok: false, status: 0, text: '', error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

function parseDateMs(dateStr) {
  if (!dateStr) return null;
  const raw = String(dateStr).trim();
  if (!raw) return null;
  const candidates = [
    raw,
    raw.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'),
    raw.replace(/\s+/g, ' ')
  ];
  for (const candidate of candidates) {
    const ms = new Date(candidate).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function normalizePublishedAt(dateStr) {
  const ms = parseDateMs(dateStr);
  return ms == null ? null : new Date(ms).toISOString();
}

function isoDateDaysAgo(days) {
  return new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
}

function yyyymmdd(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function withinDays(dateStr, days) {
  const ms = parseDateMs(dateStr);
  if (ms == null) return false;
  const now = Date.now();
  if (ms > now + DAY_MS) return false;
  return ms >= now - days * DAY_MS;
}

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function keywordMatches(hay, keyword) {
  const k = normalizeText(keyword);
  if (!k) return false;
  return hay.includes(k);
}

function itemText(item, scope = 'title_summary') {
  return normalizeText(scope === 'title' ? item.title : `${item.title || ''} ${item.summary || ''}`);
}

function passesAny(item, keywords, scope) {
  if (!keywords?.length) return true;
  const hay = itemText(item, scope);
  return keywords.some(k => keywordMatches(hay, k));
}

function passesRequired(item, keywords, scope) {
  if (!keywords?.length) return true;
  const hay = itemText(item, scope);
  return keywords.some(k => keywordMatches(hay, k));
}

function passesExclude(item, keywords) {
  if (!keywords?.length) return true;
  const hay = itemText(item);
  return !keywords.some(k => keywordMatches(hay, k));
}

function firstMatchingKeyword(item, keywords) {
  const hay = itemText(item);
  return (keywords || []).find(k => keywordMatches(hay, k)) || null;
}

function inferSignalType(item) {
  if (item.signalType && ALLOWED_SIGNAL_TYPES.has(item.signalType)) return item.signalType;
  const hay = itemText(item);
  if (item.sourceCategory === 'clinical_registry' || /\bphase\s*[123]\b|\bnct\d{8}\b|clinical trial/.test(hay)) return 'clinical_trial';
  if (item.sourceCategory === 'regulatory' || /approval|label|fda|ema|chmp|regulatory/.test(hay)) return 'regulatory';
  if (item.sourceCategory === 'conference' || /abstract|congress|conference|meeting|scientific sessions/.test(hay)) return 'conference_abstract';
  if (item.sourceCategory === 'patent' || /patent|pct|wipo|uspto|assignee/.test(hay)) return 'patent_signal';
  if (/deal|acquire|acquisition|license|collaboration|partnership|option agreement/.test(hay)) return 'bd_deal';
  if (item.sourceCategory === 'literature') return item.retrievalMethod === 'api_preprint' ? 'preprint' : 'paper';
  if (item.sourceCategory === 'company_official') return /pipeline|phase|trial|candidate|program/.test(hay) ? 'pipeline_update' : 'company_news';
  return 'company_news';
}

function sourcePriorityScore(priority) {
  if (priority === 'P0') return 2.4;
  if (priority === 'P1') return 1.8;
  if (priority === 'P2') return 1.1;
  return 0.5;
}

function scoreCandidate(item, catalog) {
  const reasons = [];
  let score = sourcePriorityScore(item.sourcePriority);
  reasons.push(`priority:${item.sourcePriority || 'default'}`);

  const categoryScores = {
    company_official: 1.6,
    clinical_registry: 1.8,
    regulatory: 1.8,
    literature: 1.2,
    conference: 1.1,
    patent: 0.9,
    industry_news: 0.6,
    knowledgebase: 0.5
  };
  score += categoryScores[item.sourceCategory] ?? 0.5;
  reasons.push(`category:${item.sourceCategory || 'unknown'}`);

  const hay = itemText(item);
  const global = catalog.global_filters || {};
  const matchedInclusion = firstMatchingKeyword(item, global.inclusion_keywords);
  if (matchedInclusion) {
    score += 1.1;
    reasons.push(`peptide:${matchedInclusion}`);
  }
  const matchedCompany = firstMatchingKeyword(item, global.company_entities);
  if (matchedCompany) {
    score += 0.8;
    reasons.push(`company:${matchedCompany}`);
  }
  if (/\bnct\d{8}\b/.test(hay) || item.nctId) {
    score += 0.7;
    reasons.push('id:nct');
  }
  if (item.doi || /\bdoi\b/.test(hay)) {
    score += 0.4;
    reasons.push('id:doi');
  }
  if (/phase\s*(1|2|3|i|ii|iii)\b|pivotal|approved|approval|label|complete response letter|fast track|breakthrough/.test(hay)) {
    score += 0.8;
    reasons.push('stage_or_regulatory');
  }
  if (/signal peptide|peptide mapping|collagen peptide|food peptide|mass spectrometry|proteomics/.test(hay)) {
    score -= 3.0;
    reasons.push('noise_penalty');
  }
  if (item.sourceCategory === 'industry_news') {
    score -= 0.2;
    reasons.push('lead_source');
  }
  return { score: Number(score.toFixed(2)), scoreReasons: reasons };
}

function normalizedTitleForDedupe(item) {
  return `${item.sourceName || ''}|${item.title || ''}`
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeKey(item) {
  if (item.nctId) return `nct:${item.nctId}`;
  if (item.doi) return `doi:${String(item.doi).toLowerCase()}`;
  if (item.pmid) return `pmid:${item.pmid}`;
  if (item.url) return `url:${item.url.replace(/[#?].*$/, '')}`;
  return `title:${normalizedTitleForDedupe(item)}`;
}

function createCandidate(base, source, retrievalMethod, catalog) {
  const item = {
    title: stripTags(decodeEntities(base.title || '')).slice(0, 500),
    url: base.url || source.homeUrl || source.endpoint || null,
    publishedAt: base.publishedAt || normalizePublishedAt(base.date) || null,
    summary: stripTags(decodeEntities(base.summary || '')).slice(0, 2000),
    sourceName: source.name,
    sourceCategory: source.category,
    sourcePriority: source.priority || 'P3',
    retrievalMethod,
    signalType: source.signalType || base.signalType || null,
    nctId: base.nctId || null,
    doi: base.doi || null,
    pmid: base.pmid || null,
    trialPhase: base.trialPhase || null,
    sponsor: base.sponsor || null,
    company: base.company || null,
    assetName: base.assetName || null
  };
  item.signalType = inferSignalType(item);
  const scored = scoreCandidate(item, catalog);
  item.score = scored.score;
  item.scoreReasons = scored.scoreReasons;
  return item;
}

function recordHardFilter(healthcheck, retrievalMethod, sourceName, reason) {
  const key = `filtered_out_by_${reason}`;
  healthcheck[key] = (healthcheck[key] || 0) + 1;
  const bucket = healthcheck.filtered_by_source_reason;
  bucket[`${retrievalMethod}:${sourceName}:${reason}`] = (bucket[`${retrievalMethod}:${sourceName}:${reason}`] || 0) + 1;
}

function passesCatalogFilters(rawItem, source, catalog) {
  const global = catalog.global_filters || {};
  if (!passesExclude(rawItem, global.exclude_keywords)) return 'global_exclude';
  if (!passesExclude(rawItem, source.excludeKeywordFilter)) return 'source_exclude';
  if (!passesAny(rawItem, source.keywordFilter, source.keywordScope || 'title_summary')) return 'keyword';
  if (!passesRequired(rawItem, source.requiredKeywordFilter, source.requiredKeywordScope || source.keywordScope || 'title_summary')) return 'required_keyword';

  const requiresGlobalContext = ['literature', 'industry_news'].includes(source.category);
  if (requiresGlobalContext && !passesAny(rawItem, global.inclusion_keywords, 'title_summary')) return 'global_keyword';
  return null;
}

async function fetchFeed(source) {
  const r = await httpRequest(source.rssUrl, {}, 15000);
  if (!r.ok) return { source, items: [], error: `HTTP ${r.status}${r.error ? ': ' + r.error : ''}` };
  try {
    return { source, items: parseFeed(r.text), error: null };
  } catch (err) {
    return { source, items: [], error: `parse: ${err.message}` };
  }
}

function clinicalTrialTitle(protocol) {
  return protocol?.identificationModule?.briefTitle
    || protocol?.identificationModule?.officialTitle
    || protocol?.identificationModule?.nctId
    || 'ClinicalTrials.gov study';
}

function clinicalTrialSummary(protocol) {
  const status = protocol?.statusModule || {};
  const sponsor = protocol?.sponsorCollaboratorsModule?.leadSponsor?.name;
  const design = protocol?.designModule || {};
  const arms = protocol?.armsInterventionsModule?.interventions || [];
  const conditions = protocol?.conditionsModule?.conditions || [];
  return [
    sponsor && `Sponsor: ${sponsor}`,
    design.phases?.length && `Phase: ${design.phases.join(', ')}`,
    status.overallStatus && `Status: ${status.overallStatus}`,
    conditions.length && `Condition: ${conditions.slice(0, 4).join('; ')}`,
    arms.length && `Interventions: ${arms.map(x => x.name).filter(Boolean).slice(0, 5).join('; ')}`
  ].filter(Boolean).join(' | ');
}

async function fetchClinicalTrials(source, days) {
  const url = new URL(source.endpoint);
  url.searchParams.set('query.term', source.query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('pageSize', '100');
  url.searchParams.set('sort', '@relevance');
  const r = await httpRequest(url.toString(), {}, 20000);
  if (!r.ok) return { source, items: [], error: `HTTP ${r.status}${r.error ? ': ' + r.error : ''}` };
  try {
    const data = JSON.parse(r.text);
    const items = [];
    for (const study of data.studies || []) {
      const protocol = study.protocolSection || {};
      const id = protocol?.identificationModule?.nctId;
      const updated = protocol?.statusModule?.lastUpdatePostDateStruct?.date
        || protocol?.statusModule?.studyFirstPostDateStruct?.date
        || null;
      if (updated && !withinDays(updated, days)) continue;
      items.push({
        title: clinicalTrialTitle(protocol),
        url: id ? `https://clinicaltrials.gov/study/${id}` : 'https://clinicaltrials.gov/',
        publishedAt: normalizePublishedAt(updated) || new Date().toISOString(),
        summary: clinicalTrialSummary(protocol),
        nctId: id || null,
        trialPhase: protocol?.designModule?.phases?.join(', ') || null,
        sponsor: protocol?.sponsorCollaboratorsModule?.leadSponsor?.name || null
      });
    }
    return { source, items, error: null };
  } catch (err) {
    return { source, items: [], error: `parse: ${err.message}` };
  }
}

async function fetchPubMed(source, days) {
  const search = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi');
  search.searchParams.set('db', 'pubmed');
  search.searchParams.set('retmode', 'json');
  search.searchParams.set('sort', 'pub date');
  search.searchParams.set('retmax', '80');
  search.searchParams.set('term', `${source.query} AND ("${isoDateDaysAgo(days)}"[Date - Publication] : "3000"[Date - Publication])`);
  search.searchParams.set('tool', 'peptide-intelligence-frontiers');
  const s = await httpRequest(search.toString(), {}, 20000);
  if (!s.ok) return { source, items: [], error: `search HTTP ${s.status}${s.error ? ': ' + s.error : ''}` };
  try {
    const ids = JSON.parse(s.text)?.esearchresult?.idlist || [];
    if (!ids.length) return { source, items: [], error: null };
    const summary = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi');
    summary.searchParams.set('db', 'pubmed');
    summary.searchParams.set('retmode', 'json');
    summary.searchParams.set('id', ids.join(','));
    summary.searchParams.set('tool', 'peptide-intelligence-frontiers');
    const r = await httpRequest(summary.toString(), {}, 20000);
    if (!r.ok) return { source, items: [], error: `summary HTTP ${r.status}${r.error ? ': ' + r.error : ''}` };
    const data = JSON.parse(r.text).result || {};
    const items = ids.map(id => {
      const row = data[id] || {};
      return {
        title: row.title || `PubMed ${id}`,
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        publishedAt: normalizePublishedAt(row.pubdate) || null,
        summary: [row.source && `Journal: ${row.source}`, row.authors?.length && `Authors: ${row.authors.slice(0, 5).map(a => a.name).join(', ')}`].filter(Boolean).join(' | '),
        pmid: id,
        doi: row.elocationid?.match(/10\.\S+/)?.[0]?.replace(/[.)]$/, '') || null
      };
    });
    return { source, items, error: null };
  } catch (err) {
    return { source, items: [], error: `parse: ${err.message}` };
  }
}

async function fetchEuropePmc(source, days) {
  const url = new URL(source.endpoint);
  url.searchParams.set('query', `${source.query} AND FIRST_PDATE:[${isoDateDaysAgo(days)} TO 3000-01-01]`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('pageSize', '50');
  url.searchParams.set('sort', 'FIRST_PDATE_D desc');
  const r = await httpRequest(url.toString(), {}, 20000);
  if (!r.ok) return { source, items: [], error: `HTTP ${r.status}${r.error ? ': ' + r.error : ''}` };
  try {
    const rows = JSON.parse(r.text)?.resultList?.result || [];
    return {
      source,
      items: rows.map(row => ({
        title: row.title || `Europe PMC ${row.id}`,
        url: row.doi ? `https://doi.org/${row.doi}` : (row.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${row.pmid}/` : `https://europepmc.org/article/${row.source || 'MED'}/${row.id}`),
        publishedAt: normalizePublishedAt(row.firstPublicationDate || row.firstIndexDate || row.pubYear),
        summary: [row.journalTitle, row.authorString, row.pubType].filter(Boolean).join(' | '),
        pmid: row.pmid || null,
        doi: row.doi || null
      })),
      error: null
    };
  } catch (err) {
    return { source, items: [], error: `parse: ${err.message}` };
  }
}

async function fetchCrossref(source, days) {
  const url = new URL(source.endpoint);
  url.searchParams.set('query.bibliographic', source.query);
  url.searchParams.set('filter', `from-pub-date:${isoDateDaysAgo(days)}`);
  url.searchParams.set('sort', 'published');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('rows', '50');
  url.searchParams.set('mailto', 'noreply@example.com');
  const r = await httpRequest(url.toString(), {}, 20000);
  if (!r.ok) return { source, items: [], error: `HTTP ${r.status}${r.error ? ': ' + r.error : ''}` };
  try {
    const rows = JSON.parse(r.text)?.message?.items || [];
    return {
      source,
      items: rows.map(row => {
        const dateParts = row.published?.['date-parts']?.[0] || row.created?.['date-parts']?.[0] || [];
        return {
          title: Array.isArray(row.title) ? row.title[0] : row.title,
          url: row.URL || (row.DOI ? `https://doi.org/${row.DOI}` : null),
          publishedAt: normalizePublishedAt(dateParts.length ? dateParts.join('-') : null),
          summary: [row['container-title']?.[0], row.publisher, row.type].filter(Boolean).join(' | '),
          doi: row.DOI || null
        };
      }).filter(x => x.title && x.url),
      error: null
    };
  } catch (err) {
    return { source, items: [], error: `parse: ${err.message}` };
  }
}

async function fetchOpenFda(source, days) {
  const start = yyyymmdd(new Date(Date.now() - days * DAY_MS));
  const end = yyyymmdd(new Date());
  const url = `${source.endpoint}?search=${source.dateField}:[${start}+TO+${end}]&sort=${source.dateField}:desc&limit=${source.limit || 100}`;
  const r = await httpRequest(url, {}, 20000);
  if (r.status === 404) return { source, items: [], error: null };
  if (!r.ok) return { source, items: [], error: `HTTP ${r.status}${r.error ? ': ' + r.error : ''}` };
  try {
    const rows = JSON.parse(r.text)?.results || [];
    return {
      source,
      items: rows.map(row => {
        const brand = row.openfda?.brand_name?.[0] || row.openfda?.generic_name?.[0] || row.set_id || 'FDA drug label';
        const text = [row.indications_and_usage?.[0], row.description?.[0], row.recent_major_changes?.[0]].filter(Boolean).join(' | ');
        return {
          title: `FDA label update: ${brand}`,
          url: row.set_id ? `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${row.set_id}` : 'https://api.fda.gov/drug/label.json',
          publishedAt: normalizePublishedAt(row[source.dateField]),
          summary: text.slice(0, 2000),
          assetName: brand
        };
      }),
      error: null
    };
  } catch (err) {
    return { source, items: [], error: `parse: ${err.message}` };
  }
}

async function fetchSec(source, days) {
  const url = new URL(source.endpoint);
  url.searchParams.set('q', source.query);
  url.searchParams.set('dateRange', `${days}d`);
  url.searchParams.set('forms', (source.forms || []).join(','));
  const r = await httpRequest(url.toString(), {}, 20000);
  if (!r.ok) return { source, items: [], error: `HTTP ${r.status}${r.error ? ': ' + r.error : ''}` };
  try {
    const data = JSON.parse(r.text);
    const hits = data.hits?.hits || data.hits || [];
    return {
      source,
      items: hits.slice(0, 50).map(hit => {
        const src = hit._source || hit;
        const cik = src.ciks?.[0] || src.cik || '';
        const accession = src.adsh || src.accessionNo || '';
        const filingUrl = src.linkToFilingDetails || (cik && accession ? `https://www.sec.gov/Archives/edgar/data/${String(cik).replace(/^0+/, '')}/${String(accession).replace(/-/g, '')}/` : 'https://www.sec.gov/search-filings');
        return {
          title: src.display_names?.[0] || src.companyName || src.file_type || 'SEC filing peptide signal',
          url: filingUrl,
          publishedAt: normalizePublishedAt(src.filedAt || src.file_date || src.period_ending || src.form_date) || new Date().toISOString(),
          summary: [src.form, src.file_type, src.biz_states?.join(', ')].filter(Boolean).join(' | '),
          company: src.display_names?.[0] || src.companyName || null
        };
      }).filter(x => x.title && x.url),
      error: null
    };
  } catch (err) {
    return { source, items: [], error: `parse: ${err.message}` };
  }
}

async function fetchPreprintApi(source, days) {
  const from = isoDateDaysAgo(days);
  const to = new Date().toISOString().slice(0, 10);
  const url = `${source.endpoint}/${from}/${to}/0`;
  const r = await httpRequest(url, {}, 20000);
  if (!r.ok) return { source, items: [], error: `HTTP ${r.status}${r.error ? ': ' + r.error : ''}` };
  try {
    const rows = JSON.parse(r.text)?.collection || [];
    return {
      source,
      items: rows.map(row => ({
        title: row.title,
        url: row.doi ? `https://doi.org/${row.doi}` : `https://www.${source.server}.org/`,
        publishedAt: normalizePublishedAt(row.date),
        summary: [row.authors, row.category, row.author_corresponding_institution].filter(Boolean).join(' | '),
        doi: row.doi || null
      })).filter(x => x.title && x.url),
      error: null
    };
  } catch (err) {
    return { source, items: [], error: `parse: ${err.message}` };
  }
}

async function fetchTavilySite(site, apiKey, days) {
  const body = {
    query: site.query,
    search_depth: 'basic',
    max_results: site.maxItems || 5,
    include_answer: false,
    include_raw_content: false,
    days
  };
  const r = await httpRequest('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  }, 30000);
  if (!r.ok) return { site, items: [], error: `HTTP ${r.status}${r.error ? ': ' + r.error : ''}` };
  try {
    const data = JSON.parse(r.text);
    return {
      site,
      items: (data.results || []).map(row => ({
        title: row.title,
        url: row.url,
        publishedAt: row.published_date ? normalizePublishedAt(row.published_date) : new Date().toISOString(),
        summary: row.content || row.snippet || ''
      })).filter(x => x.title && x.url),
      error: null
    };
  } catch (err) {
    return { site, items: [], error: `parse: ${err.message}` };
  }
}

function pushCandidate(candidates, rawItem, source, retrievalMethod, catalog, seen, healthcheck, days) {
  if (!rawItem.title || !rawItem.url) {
    recordHardFilter(healthcheck, retrievalMethod, source.name, 'missing_url');
    return;
  }
  if (!rawItem.publishedAt && retrievalMethod !== 'tavily' && retrievalMethod !== 'manual') {
    recordHardFilter(healthcheck, retrievalMethod, source.name, 'missing_date');
    return;
  }
  if (rawItem.publishedAt && !withinDays(rawItem.publishedAt, days)) {
    recordHardFilter(healthcheck, retrievalMethod, source.name, 'date');
    return;
  }
  const filterReason = passesCatalogFilters(rawItem, source, catalog);
  if (filterReason) {
    recordHardFilter(healthcheck, retrievalMethod, source.name, filterReason);
    return;
  }
  const item = createCandidate(rawItem, source, retrievalMethod, catalog);
  const key = dedupeKey(item);
  const titleKey = normalizedTitleForDedupe(item);
  if (seen.keys.has(key)) {
    recordHardFilter(healthcheck, retrievalMethod, source.name, 'duplicate');
    return;
  }
  if (seen.titles.has(titleKey)) {
    recordHardFilter(healthcheck, retrievalMethod, source.name, 'duplicate_title');
    return;
  }
  seen.keys.add(key);
  seen.titles.add(titleKey);
  candidates.push(item);
}

function selectCandidates(candidates, healthcheck) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score || String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
  const selected = [];
  const perSource = {};
  const perCategory = {};
  for (const item of sorted) {
    const sourceCap = item.retrievalMethod === 'tavily' ? 3 : 8;
    const categoryCap = item.sourceCategory === 'industry_news' ? 12 : 20;
    if ((perSource[item.sourceName] || 0) >= sourceCap) {
      item.selectionStatus = 'source_cap';
      continue;
    }
    if ((perCategory[item.sourceCategory] || 0) >= categoryCap) {
      item.selectionStatus = 'category_cap';
      continue;
    }
    if (item.score < 2.4 && selected.length >= SELECTED_MIN_TARGET) {
      item.selectionStatus = 'low_score';
      continue;
    }
    item.selectionStatus = 'selected';
    selected.push(item);
    perSource[item.sourceName] = (perSource[item.sourceName] || 0) + 1;
    perCategory[item.sourceCategory] = (perCategory[item.sourceCategory] || 0) + 1;
    if (selected.length >= SELECTED_MAX_TARGET) break;
  }
  healthcheck.top3_categories = Object.entries(perCategory).sort((a, b) => b[1] - a[1]).slice(0, 3);
  healthcheck.top3_scores = selected.slice(0, 3).map(x => ({ title: x.title, score: x.score, sourceName: x.sourceName }));
  healthcheck.top3_rejected_candidates = sorted.filter(x => x.selectionStatus !== 'selected').slice(0, 3).map(x => ({
    title: x.title,
    score: x.score,
    status: x.selectionStatus || 'not_selected'
  }));
  return selected;
}

function countBy(items, fn) {
  const out = {};
  for (const item of items) {
    const key = fn(item) || 'unknown';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object') throw new Error('catalog must be an object');
  if (!catalog.primary_rss || typeof catalog.primary_rss !== 'object') throw new Error('missing primary_rss');
  for (const [bucket, sources] of Object.entries(catalog.primary_rss)) {
    if (!ALLOWED_CATEGORIES.has(bucket)) throw new Error(`unsupported primary_rss bucket: ${bucket}`);
    if (!Array.isArray(sources)) throw new Error(`primary_rss.${bucket} must be an array`);
    for (const source of sources) {
      if (!ALLOWED_CATEGORIES.has(source.category)) throw new Error(`unsupported source category: ${source.category}`);
      if (!source.name || !source.rssUrl) throw new Error(`RSS source missing name/rssUrl in ${bucket}`);
    }
  }
}

function runSelfTest() {
  const fakeCatalog = {
    global_filters: {
      inclusion_keywords: ['GLP-1', 'peptide-drug conjugate', 'PRRT', 'peptide'],
      required_context_keywords: ['trial'],
      exclude_keywords: ['signal peptide', 'peptide mapping', 'collagen peptide', 'mass spectrometry'],
      company_entities: ['Novo Nordisk', 'Lilly']
    }
  };
  const src = { name: 'fixture', category: 'literature', priority: 'P0' };
  const keep = [
    { title: 'Phase 2 GLP-1 clinical trial in obesity', url: 'https://example.com/a', summary: 'patients and dose' },
    { title: 'Peptide-drug conjugate paper reports tumor response', url: 'https://example.com/b', summary: 'therapeutic candidate' },
    { title: 'PRRT regulatory approval signal', url: 'https://example.com/c', summary: 'radioligand therapy label' },
    { title: 'Novo Nordisk peptide pipeline update', url: 'https://example.com/d', summary: 'official phase 2 program' }
  ];
  const reject = [
    { title: 'Signal peptide prediction in plants', url: 'https://example.com/e', summary: 'basic biology' },
    { title: 'Peptide mapping mass spectrometry method', url: 'https://example.com/f', summary: 'analytical method' },
    { title: 'Collagen peptide food supplement study', url: 'https://example.com/g', summary: 'nutrition' },
    { title: 'Proteomics peptide identification workflow', url: 'https://example.com/h', summary: 'mass spectrometry' }
  ];
  for (const item of keep) {
    const reason = passesCatalogFilters(item, src, fakeCatalog);
    if (reason) throw new Error(`expected keep fixture to pass: ${item.title} (${reason})`);
    const candidate = createCandidate(item, src, 'fixture', fakeCatalog);
    if (candidate.score < 2.4) throw new Error(`expected keep fixture score >= 2.4: ${item.title}`);
  }
  for (const item of reject) {
    const reason = passesCatalogFilters(item, src, fakeCatalog);
    if (!reason) throw new Error(`expected reject fixture to fail: ${item.title}`);
  }
  console.log(JSON.stringify({ status: 'ok', fixtures: { keep: keep.length, reject: reject.length } }));
}

async function main() {
  const args = parseArgs();
  if (args.selfTest) {
    runSelfTest();
    return;
  }

  const catalog = JSON.parse(await readFile(CATALOG_PATH, 'utf-8'));
  validateCatalog(catalog);
  const generatedAt = new Date().toISOString();
  const healthcheck = {
    catalog_source: 'local_repo',
    warnings: [],
    per_source: {},
    per_api_source: {},
    tavily_per_site: {},
    filtered_by_source_reason: {},
    filtered_out_by_missing_url: 0,
    filtered_out_by_missing_date: 0,
    filtered_out_by_date: 0,
    filtered_out_by_global_exclude: 0,
    filtered_out_by_source_exclude: 0,
    filtered_out_by_keyword: 0,
    filtered_out_by_required_keyword: 0,
    filtered_out_by_global_keyword: 0,
    filtered_out_by_duplicate: 0,
    filtered_out_by_duplicate_title: 0
  };
  const candidates = [];
  const seen = { keys: new Set(), titles: new Set() };

  const rssSources = Object.values(catalog.primary_rss || {}).flat();
  const rssResults = await Promise.all(rssSources.map(fetchFeed));
  for (const { source, items, error } of rssResults) {
    healthcheck.per_source[source.name] = { fetched: items.length, candidates: 0, error };
    for (const item of items) {
      const before = candidates.length;
      pushCandidate(candidates, item, source, 'rss', catalog, seen, healthcheck, args.days);
      if (candidates.length > before) healthcheck.per_source[source.name].candidates++;
    }
  }

  if (!args.rssOnly) {
    const apiJobs = [
      ...(catalog.api_sources?.clinical_trials || []).map(source => ({ source, fetcher: s => fetchClinicalTrials(s, args.days), method: 'api_clinical_trials' })),
      ...(catalog.api_sources?.pubmed || []).map(source => ({ source, fetcher: s => fetchPubMed(s, args.days), method: 'api_pubmed' })),
      ...(catalog.api_sources?.europe_pmc || []).map(source => ({ source, fetcher: s => fetchEuropePmc(s, args.days), method: 'api_europe_pmc' })),
      ...(catalog.api_sources?.crossref || []).map(source => ({ source, fetcher: s => fetchCrossref(s, args.days), method: 'api_crossref' })),
      ...(catalog.api_sources?.openfda || []).map(source => ({ source, fetcher: s => fetchOpenFda(s, args.days), method: 'api_openfda' })),
      ...(catalog.api_sources?.sec || []).map(source => ({ source, fetcher: s => fetchSec(s, args.days), method: 'api_sec' })),
      ...(catalog.api_sources?.preprints || []).map(source => ({ source, fetcher: s => fetchPreprintApi(s, args.days), method: 'api_preprint' }))
    ];
    const apiResults = await Promise.all(apiJobs.map(job => job.fetcher(job.source).then(result => ({ ...result, method: job.method }))));
    for (const { source, items, error, method } of apiResults) {
      healthcheck.per_api_source[source.name] = { fetched: items.length, candidates: 0, error };
      for (const item of items) {
        const before = candidates.length;
        pushCandidate(candidates, item, source, method, catalog, seen, healthcheck, args.days);
        if (candidates.length > before) healthcheck.per_api_source[source.name].candidates++;
      }
    }

    const tavilyKey = process.env.TAVILY_API_KEY;
    if (tavilyKey) {
      const tavilyResults = await Promise.all((catalog.websearch_sites || []).map(site => fetchTavilySite(site, tavilyKey, args.days)));
      for (const { site, items, error } of tavilyResults) {
        const source = {
          name: site.name,
          category: site.sourceCategory || 'industry_news',
          priority: site.priority || 'P2',
          keywordFilter: catalog.global_filters?.inclusion_keywords || []
        };
        healthcheck.tavily_per_site[site.name] = { fetched: items.length, candidates: 0, error };
        for (const item of items) {
          const before = candidates.length;
          pushCandidate(candidates, item, source, 'tavily', catalog, seen, healthcheck, args.days);
          if (candidates.length > before) healthcheck.tavily_per_site[site.name].candidates++;
        }
      }
    } else {
      healthcheck.warnings.push('TAVILY_API_KEY not set; websearch_sites skipped');
    }
  }

  const selected = selectCandidates(candidates, healthcheck);
  const groupedByCategory = {};
  for (const item of selected) (groupedByCategory[item.sourceCategory] ||= []).push(item);
  const feed = {
    schemaVersion: 1,
    generatedAt,
    lookbackDays: args.days,
    items: selected,
    groupedByCategory,
    candidateItems: candidates,
    candidateStats: {
      rawCandidates: candidates.length,
      selectedItems: selected.length,
      byCategory: countBy(candidates, x => x.sourceCategory),
      selectedByCategory: countBy(selected, x => x.sourceCategory),
      bySignalType: countBy(candidates, x => x.signalType)
    },
    stats: {
      keptItems: selected.length,
      rawItems: candidates.length,
      sourcesQueried: rssSources.length,
      sourcesWithResults: Object.values(healthcheck.per_source).filter(x => x.candidates > 0).length,
      sourcesFailed: Object.values(healthcheck.per_source).filter(x => x.error).length,
      apiSourcesQueried: Object.keys(healthcheck.per_api_source).length,
      apiSourcesWithResults: Object.values(healthcheck.per_api_source).filter(x => x.candidates > 0).length,
      apiSourcesFailed: Object.values(healthcheck.per_api_source).filter(x => x.error).length,
      tavilySitesQueried: Object.keys(healthcheck.tavily_per_site).length,
      tavilySitesWithResults: Object.values(healthcheck.tavily_per_site).filter(x => x.candidates > 0).length,
      tavilySitesFailed: Object.values(healthcheck.tavily_per_site).filter(x => x.error).length
    },
    healthcheck,
    signalTaxonomy: catalog.signal_taxonomy || null
  };

  await writeFile(FEED_PATH, `${JSON.stringify(feed, null, 2)}\n`);
  await writeFile(STATE_PATH, `${JSON.stringify({ generatedAt, lookbackDays: args.days, lastItemCount: selected.length }, null, 2)}\n`);
  console.error(`feed-peptides.json: ${selected.length} items (${feed.stats.sourcesFailed} RSS failures, ${feed.stats.apiSourcesFailed} API failures)`);
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
