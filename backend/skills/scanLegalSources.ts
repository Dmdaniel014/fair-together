// ─────────────────────────────────────────────────────────────────────────────
//  skills/scanLegalSources.ts
// ─────────────────────────────────────────────────────────────────────────────

import fs   from 'fs/promises';
import path from 'path';
import { SCRAPER_THROTTLE_MS } from '../types';
import { resolveBrandSlug } from './brandMatcher';

export interface RawCaseData {
  caseNumber:     string;
  defendantName:  string;
  defendantSlug:  string | null;
  court:          string;
  status:         string;
  result:         string;
  filingDate:     string;
  closeDate:      string;
  plaintiffName:  string;
  lawyers:        string;
  pdfPath:        string | null;
  pdfUrl:         string | null;
  source:         'CSV_ONLY' | 'CSV_AND_PDF';
  // Enriched fields from CSV (available without PDF)
  summary:        string | null;
  affectedGroup:  string | null;
  legalQuestion:  string | null;
  reliefType:     string | null;
  reliefDetail:   string | null;
  claimAmount:    string | null;
  individualAmount: string | null;
  judge:          string | null;
  permalink:      string | null;
}

export interface ScanResult {
  scannedAt:         string;
  totalCasesInCSV:   number;
  classActionsFound: number;
  brandMatches:      number;
  pdfsDownloaded:    number;
  pdfsFailed:        number;
  cases:             RawCaseData[];
  errors:            string[];
}

export async function scanLegalSources(options: {
  downloadPDFs?:        boolean;
  brandsToScan?:        string[];
  outputDir?:           string;
  existingCaseNumbers?: Set<string>;
  // Incremental scan: only discover cases filed after this date
  incrementalSince?:    Date | null;
  // Re-check these case numbers for status changes regardless of date
  openCaseNumbers?:     Set<string>;
}): Promise<ScanResult> {

  const {
    downloadPDFs        = true,
    brandsToScan,
    outputDir           = '/tmp/fair-together-pdfs',
    existingCaseNumbers = new Set(),
    incrementalSince    = null,
    openCaseNumbers     = new Set(),
  } = options;

  const result: ScanResult = {
    scannedAt:         new Date().toISOString(),
    totalCasesInCSV:   0,
    classActionsFound: 0,
    brandMatches:      0,
    pdfsDownloaded:    0,
    pdfsFailed:        0,
    cases:             [],
    errors:            [],
  };

  let partiesRows:  Record<string, string>[] = [];
  let lawsuitsRows: Record<string, string>[] = [];

  // Primary source: odata.org.il (Tolaat HaMishpat data, reliable from Israel)
  // Fallback: api.tl8.me direct API (may fail DNS from some networks)
  const CASES_URLS = [
    'https://www.odata.org.il/datastore/dump/12ff06bf-e672-4fd9-ae63-b94dd8b71d69?bom=True',
    'https://api.tl8.me/datasets/1.0/latest/cases.csv',
  ];
  const PARTIES_URLS = [
    'https://www.odata.org.il/datastore/dump/02a3642f-5285-4bfa-bb00-afdd62887e06?bom=True',
    'https://api.tl8.me/datasets/1.0/latest/parties.csv',
  ];

  try {
    partiesRows  = await fetchCSVWithFallback(PARTIES_URLS);
    lawsuitsRows = await fetchCSVWithFallback(CASES_URLS);
    result.totalCasesInCSV = lawsuitsRows.length;
  } catch (err) {
    result.errors.push(`CSV fetch failed: ${err}`);
    return result;
  }

  // The entire dataset IS the class action registry (פנקס תובענות ייצוגיות)
  result.classActionsFound = lawsuitsRows.length;

  // ── Incremental filtering ──────────────────────────────────────────────
  // 1. NEW DISCOVERY: only cases filed after incrementalSince (skip old ones we already have)
  // 2. STATUS RE-CHECK: always include cases in openCaseNumbers (may be old but still active)
  const DEAD_STATUSES = new Set(['סגור']);
  const DEAD_RESULTS  = new Set(['נדחה', 'נמחק']);

  const classActions = lawsuitsRows.filter(row => {
    const caseNum  = row.case_number;
    const csvStatus = (row.status ?? '').trim();
    const csvResult = (row.result ?? '').trim();
    const openDate  = row.open_date ? new Date(row.open_date) : null;

    // Always re-check cases we're tracking as open (for status updates)
    if (openCaseNumbers.has(caseNum)) return true;

    // For new discovery: skip if we already have it
    if (existingCaseNumbers.has(caseNum)) return false;

    // Skip dead cases from new discovery (closed + dismissed/expunged)
    if (csvStatus === 'סגור' && (DEAD_RESULTS.has(csvResult) || !csvResult)) return false;

    // Incremental: only discover cases filed after the cutoff date
    if (incrementalSince && openDate && openDate <= incrementalSince) return false;

    return true;
  });

  console.log(`[ScanLegal] Filtered: ${classActions.length} cases to process (${lawsuitsRows.length} total, incremental since: ${incrementalSince?.toISOString() ?? 'FULL'}, re-checking ${openCaseNumbers.size} open cases)`);


  // Build lookup: caseNumber → parties
  const partiesByCaseNum: Record<string, typeof partiesRows> = {};
  for (const p of partiesRows) {
    if (!partiesByCaseNum[p.case_number]) partiesByCaseNum[p.case_number] = [];
    partiesByCaseNum[p.case_number].push(p);
  }

  for (const lawsuit of classActions) {
    const caseNum   = lawsuit.case_number;
    const parties   = partiesByCaseNum[caseNum] ?? [];
    const defendant = parties.find(p => p.role === 'נתבע' || p.role === 'משיב');
    const plaintiff = parties.find(p => p.role === 'תובע' || p.role === 'מבקש');

    // Try parties CSV first, fallback to extracting from casename
    const defendantName = defendant?.name ?? extractDefendant(lawsuit.casename ?? '');
    if (!defendantName) continue;   // truly unattributable — no name at all

    // Resolve to a curated brand slug. If unmatched, fall back to a stable
    // per-defendant key prefixed with `x-` so future curation can easily
    // promote it (e.g. all `x-samsung-*` rows → `samsung` once added to map).
    const matchedSlug = resolveBrandSlug(defendantName, brandsToScan);

    // brandsToScan is set when monitoring specific brands — in that mode we
    // intentionally restrict to known brands. Outside that mode, we keep
    // unknowns under an `x-` slug so nothing is silently lost.
    let defendantSlug: string;
    if (matchedSlug) {
      defendantSlug = matchedSlug;
    } else if (brandsToScan && brandsToScan.length > 0) {
      // Targeted mode (status monitor) — skip unrelated brands
      continue;
    } else {
      defendantSlug = uncuratedSlug(defendantName);
    }

    // Skip existing cases UNLESS they're open cases being re-checked for status updates
    const isRecheck = openCaseNumbers.has(caseNum);
    if (existingCaseNumbers.has(caseNum) && !isRecheck) continue;

    result.brandMatches++;

    // Fallback: extract filing date from case number (NNNNN-MM-YY format)
    let filingDate = lawsuit.open_date ?? '';
    if (!filingDate) {
      const dateMatch = caseNum.match(/\d+-(\d{2})-(\d{2})$/);
      if (dateMatch) {
        const month = parseInt(dateMatch[1]);
        const yearShort = parseInt(dateMatch[2]);
        const year = yearShort >= 50 ? 1900 + yearShort : 2000 + yearShort;
        if (month >= 1 && month <= 12 && year >= 2000) {
          filingDate = `${year}-${String(month).padStart(2, '0')}-01`;
        }
      }
    }

    const rawCase: RawCaseData = {
      caseNumber:    caseNum,
      defendantName,
      defendantSlug,
      court:         lawsuit.court      ?? '',
      status:        lawsuit.status     ?? '',
      result:        lawsuit.result     ?? '',
      filingDate,
      closeDate:     lawsuit.close_date ?? '',
      plaintiffName: plaintiff?.name    ?? '',
      lawyers:       parties.filter(p => p.role === 'עורך דין').map(p => p.name).join(', '),
      pdfPath:       null,
      pdfUrl:        null,
      source:        'CSV_ONLY',
      // CSV columns: issue, group, question, aid_type, aid_essence, amount, amount_individual, judge, permalink
      summary:         lawsuit.issue            || null,
      affectedGroup:   lawsuit.group            || null,
      legalQuestion:   lawsuit.question         || null,
      reliefType:      lawsuit.aid_type         || null,
      reliefDetail:    lawsuit.aid_esence        || null,  // typo in source CSV
      claimAmount:     lawsuit.amount           || null,
      individualAmount: lawsuit.amount_individual || null,
      judge:           lawsuit.judge            || null,
      permalink:       lawsuit.permalink        || null,
    };

    if (downloadPDFs) {
      await sleep(SCRAPER_THROTTLE_MS);
      const pdfResult = await downloadCourtPDF(caseNum, outputDir, lawsuit.permalink);
      if (pdfResult.success) {
        rawCase.pdfPath = pdfResult.localPath!;
        rawCase.pdfUrl  = pdfResult.url!;
        rawCase.source  = 'CSV_AND_PDF';
        result.pdfsDownloaded++;
      } else {
        result.pdfsFailed++;
        result.errors.push(`PDF download failed for ${caseNum}: ${pdfResult.error}`);
      }
    }

    result.cases.push(rawCase);
  }

  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractDefendant(casename: string): string {
  const match = casename.match(/נ['']\s*(.+)$/);
  return match?.[1]?.trim() ?? '';
}

// Stable, deterministic slug for defendants we have no curated map entry for.
// Prefix `x-` makes it trivial to identify and bulk-promote later
// (`UPDATE Lawsuit SET defendantSlug='samsung' WHERE defendantSlug LIKE 'x-samsung%'`).
//
// Goals:
//  - Same defendant name → same slug (so aggregations / brand pages still group)
//  - Truncated to a sane length (DB column / URL hygiene)
//  - Lowercase Hebrew/Latin only — strip punctuation and legal suffixes
function uncuratedSlug(defendantName: string): string {
  const cleaned = defendantName
    .replace(/["'׳״]/g, '')          // quotes, gershayim
    .replace(/\s*בע["״]?מ\.?$/i, '')      // בע"מ
    .replace(/\s*\b(?:ltd|inc|llc|corp|gmbh|plc|s\.?a\.?)\.?$/i, '')
    .replace(/\s*\(\d{4}\)$/, '')              // (1968)
    .replace(/[.,()[\]]/g, ' ')
    .replace(/[\-–—]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 40);
  return cleaned ? `x-${cleaned}` : 'x-unknown';
}

// Deleted local resolveDefendantSlug — now delegated to skills/brandMatcher.ts.
// Prior behavior (raw name.includes(alias)) was both duplicated and wrong:
// 3-char aliases like 'גט' / 'פז' produced cross-brand collisions.

async function fetchCSVWithFallback(urls: string[]): Promise<Record<string, string>[]> {
  const errors: string[] = [];
  for (const url of urls) {
    try {
      console.log(`[ScanLegal] Fetching CSV: ${url.substring(0, 80)}...`);
      const rows = await fetchCSV(url);
      console.log(`[ScanLegal] Got ${rows.length} rows from ${url.substring(0, 60)}`);
      if (rows.length > 0) return rows;
      errors.push(`${url}: 0 rows returned`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ScanLegal] CSV fetch error for ${url.substring(0, 60)}: ${msg}`);
      errors.push(`${url}: ${msg}`);
    }
  }
  throw new Error(`All CSV sources failed: ${errors.join(' | ')}`);
}

async function fetchCSV(url: string): Promise<Record<string, string>[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000); // 60s timeout
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'FairTogether-LegalAgent/1.0 (contact@fairtogether.co.il)' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    const text = await res.text();
    return parseCSV(text);
  } finally {
    clearTimeout(timeout);
  }
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = splitCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (values[i] ?? '').trim().replace(/^"|"$/g, ''); });
    return row;
  });
}

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '', inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { result.push(current); current = ''; continue; }
    current += ch;
  }
  result.push(current);
  return result;
}

async function downloadCourtPDF(
  caseNumber: string,
  outputDir:  string,
  permalink?: string
): Promise<{ success: boolean; localPath?: string; url?: string; error?: string }> {

  // ── Court document access notes ──
  // The Israeli court system (court.gov.il/NGCS.Web.Site) stores documents on S3
  // (ngcs-prod-idc-cleared.s3.il-central-1.amazonaws.com) behind session-based access.
  // Documents are viewed via NGCSViewerPage.aspx?DocumentNumber=<GUID>.
  // Direct HTTP download is NOT possible — requires ASP.NET postback with active session.
  //
  // The CSV permalink (tl8.me/<case_number>) redirects to a third-party case page,
  // NOT to the court document itself.
  //
  // For now, this function attempts basic URL patterns. Full PDF download will require
  // Puppeteer/Playwright for headless browser automation (Phase 2).

  const urls: string[] = [];

  // 1. Permalink from CSV — tl8.me short URLs (usually redirects to case info, not PDF)
  if (permalink) urls.push(permalink);

  // 2. Legacy elyon1 (Supreme Court verdicts — works for some older cases)
  const encoded = encodeURIComponent(caseNumber);
  urls.push(`https://elyon1.court.gov.il/verdict/GetVerdictByCase?caseNumber=${encoded}`);

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'FairTogether-LegalAgent/1.0 (contact@fairtogether.co.il)',
          'Accept':     'application/pdf,text/html,*/*',
        },
        redirect: 'follow',
      });

      if (!res.ok) continue;

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('pdf') && !contentType.includes('octet-stream')) continue;

      await fs.mkdir(outputDir, { recursive: true });
      const fileName  = `${caseNumber.replace(/[^a-zA-Z0-9-]/g, '_')}.pdf`;
      const localPath = path.join(outputDir, fileName);
      const buffer    = await res.arrayBuffer();

      // Verify it's actually a PDF (check magic bytes)
      const header = Buffer.from(buffer.slice(0, 5)).toString();
      if (!header.startsWith('%PDF')) continue;

      await fs.writeFile(localPath, Buffer.from(buffer));
      return { success: true, localPath, url };

    } catch {
      continue;
    }
  }

  return { success: false, error: `PDF unavailable for ${caseNumber} — court.gov.il requires browser session (Phase 2).` };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}