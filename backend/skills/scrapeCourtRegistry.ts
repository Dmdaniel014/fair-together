// ─────────────────────────────────────────────────────────────────────────────
//  skills/scrapeCourtRegistry.ts
//  Scrapes the Israeli Court's Representative Registry (פנקס תובענות ייצוגיות)
//  URL: https://www.court.gov.il/NGCS.Web.Site/SearchCase/RepresentativeRegistry.aspx
//
//  Strategy:
//  - Uses Playwright (system Chrome) to handle ASP.NET postback + ag-Grid
//  - Homepage → dismiss Terms of Use modal → navigate to registry via postback
//  - Searches in 3-month slices (registry caps at 300 results per search)
//  - Extracts ag-Grid rows, paginates through all pages
//  - Returns RawCaseData[] compatible with the existing pipeline
// ─────────────────────────────────────────────────────────────────────────────

import { RawCaseData } from './scanLegalSources';
import { resolveBrandSlug } from './brandMatcher';

const HOMEPAGE_URL = 'https://www.court.gov.il/NGCS.Web.Site/HomePage.aspx';

export interface CourtScrapeOptions {
  dateFrom: Date;
  dateTo: Date;
  brandFilterOnly?: boolean;
  headless?: boolean;
  maxPages?: number;
  pageTimeout?: number;
}

export interface CourtScrapeResult {
  scrapedAt:    string;
  dateFrom:     string;
  dateTo:       string;
  totalFound:   number;
  brandMatches: number;
  cases:        RawCaseData[];
  errors:       string[];
  blocked:      boolean;
}

/**
 * Add `months` to `d` without the JS month-end rollover bug (Jan 31 + 1 → Mar 3).
 * Clamps to the last valid day of the target month instead.
 */
function addMonthsClamped(d: Date, months: number): Date {
  const targetMonth = d.getMonth() + months;
  const targetYear  = d.getFullYear() + Math.floor(targetMonth / 12);
  const normMonth   = ((targetMonth % 12) + 12) % 12;
  const lastDay     = new Date(targetYear, normMonth + 1, 0).getDate();
  return new Date(targetYear, normMonth, Math.min(d.getDate(), lastDay));
}

/**
 * Generate non-overlapping 3-month time slices (registry caps at 300 results).
 * Previously slice[i].to === slice[i+1].from → duplicate hits on the boundary
 * day. Now each slice ends one day before the next begins.
 */
export function generateTimeSlices(from: Date, to: Date): Array<{ from: Date; to: Date }> {
  const slices: Array<{ from: Date; to: Date }> = [];
  let cursor = new Date(from);
  while (cursor < to) {
    const nextFrom = addMonthsClamped(cursor, 3);
    const sliceTo  = nextFrom > to ? new Date(to) : new Date(nextFrom.getTime() - 86_400_000); // -1 day
    slices.push({ from: new Date(cursor), to: sliceTo });
    cursor = nextFrom;
  }
  return slices;
}

function formatDateHebrew(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// Brand matching is shared with the CSV scanner — see skills/brandMatcher.ts.
// The old local normalizeName/resolveSlug lived here as a duplicate and diverged
// over time (different suffix lists, no coverage threshold).

/** Extract defendant name from case title like "שרון נ' שופרסל בע"מ" */
function extractDefendant(caseTitle: string): string {
  const match = caseTitle.match(/נ['''\u05F3]\s*(.+)$/);
  return match?.[1]?.trim() ?? caseTitle;
}

/** Parse Hebrew date DD/MM/YYYY → YYYY-MM-DD */
function parseHebrewDate(dateStr: string): string {
  const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return '';
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

/**
 * Scrape the court registry for a single date range.
 */
export async function scrapeCourtRegistry(options: CourtScrapeOptions): Promise<CourtScrapeResult> {
  const {
    dateFrom,
    dateTo,
    brandFilterOnly = false,
    headless = true,
    maxPages = 50,
    pageTimeout = 30000,
  } = options;

  const result: CourtScrapeResult = {
    scrapedAt:    new Date().toISOString(),
    dateFrom:     dateFrom.toISOString(),
    dateTo:       dateTo.toISOString(),
    totalFound:   0,
    brandMatches: 0,
    cases:        [],
    errors:       [],
    blocked:      false,
  };

  let chromium: any;
  try {
    const pw = await import('playwright');
    chromium = pw.chromium;
  } catch {
    result.errors.push('Playwright not installed. Run: npm install playwright && npx playwright install chromium');
    return result;
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless,
      channel: 'chrome',
      args: ['--disable-blink-features=AutomationControlled'],
    });
    const context = await browser.newContext({
      locale: 'he-IL',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true,
      // Use a very tall viewport so ag-Grid renders all rows without virtual scroll.
      // The grid only virtualizes rows that are outside the visible viewport height;
      // with viewportSize.height = 8000px, up to ~300 rows render simultaneously
      // (court.gov.il caps at 300 per search) — no per-row scrolling needed.
      viewport: { width: 1280, height: 8000 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(pageTimeout);

    // ── Step 1: Navigate to homepage (required for session cookie) ─────
    console.log(`[CourtScraper] Loading homepage...`);
    await page.goto(HOMEPAGE_URL, { waitUntil: 'networkidle', timeout: pageTimeout });

    // Detect CAPTCHA / block page before we waste any clicks.
    const homepageHtml = await page.content();
    if (/gov_captcha|captcha|recaptcha|אימות אנושי|Access Denied/i.test(homepageHtml)) {
      result.blocked = true;
      result.errors.push('Blocked by CAPTCHA on homepage');
      return result;
    }

    // ── Step 2: Dismiss Terms of Use modal ─────────────────────────────
    await page.evaluate(() => {
      document.getElementById('lean_overlay')?.remove();
      document.getElementById('MessageMainMessage')?.remove();
    });
    await page.waitForTimeout(300);

    // ── Step 3: Navigate to registry via postback ──────────────────────
    console.log(`[CourtScraper] Navigating to registry...`);
    const registryLink = page.locator('#OperationMenuUC1_btnNotePad');
    if (await registryLink.count() === 0) {
      result.errors.push('Registry link not found on homepage');
      return result;
    }
    await registryLink.click({ timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: pageTimeout });
    await page.waitForTimeout(2000);

    // Check we landed on the registry
    if (!page.url().includes('RepresentativeRegistry')) {
      result.errors.push(`Did not reach registry page. URL: ${page.url()}`);
      return result;
    }

    // Dismiss any "too many results" overlay from the default search
    await dismissOverlays(page);

    // ── Step 4: Set date range and search ──────────────────────────────
    const dateFromStr = formatDateHebrew(dateFrom);
    const dateToStr = formatDateHebrew(dateTo);
    console.log(`[CourtScraper] Searching: ${dateFromStr} – ${dateToStr}`);

    // Clear and fill date fields, then trigger onchange validation
    for (const [sel, val] of [
      ['#CaseSearchViewGeneral1_startDate', dateFromStr],
      ['#CaseSearchViewGeneral1_finishDate', dateToStr],
    ] as const) {
      await page.locator(sel).click();
      await page.locator(sel).fill('');
      await page.locator(sel).type(val, { delay: 50 });
      await page.locator(sel).evaluate((el: HTMLInputElement) => {
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      });
      await page.waitForTimeout(300);
    }

    // Click "אישור" (search)
    await page.locator('#CaseSearchViewGeneral1_buttonsGroup_searchButton').click({ timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: pageTimeout });
    await page.waitForTimeout(3000);

    // Post-search CAPTCHA check — court.gov.il sometimes interstitials a
    // block page after the initial search postback.
    const searchHtml = await page.content();
    if (/gov_captcha|captcha|recaptcha|אימות אנושי|Access Denied/i.test(searchHtml)) {
      result.blocked = true;
      result.errors.push('Blocked by CAPTCHA after search');
      return result;
    }

    // Dismiss "too many results" overlay if it appears
    await dismissOverlays(page);

    // ── Step 5: Get total count from paging ────────────────────────────
    const totalText = await page.locator('.ag-paging-row-summary-panel').last().textContent() ?? '';
    const totalMatch = totalText.match(/מתוך\s+(\d+)/);
    const totalCount = totalMatch ? parseInt(totalMatch[1]) : 0;
    console.log(`[CourtScraper] Total results: ${totalCount}`);
    result.totalFound = totalCount;

    if (totalCount === 0) {
      console.log(`[CourtScraper] No results for this date range`);
      return result;
    }

    // ── Step 6: Extract all pages ──────────────────────────────────────
    // Wait for at least one ag-Grid row to be attached before extracting.
    try {
      await page.waitForSelector('.ag-row', { timeout: 15000, state: 'attached' });
    } catch {
      console.log(`[CourtScraper] Warning: no ag-Grid rows visible within 15s`);
    }
    await page.waitForTimeout(1000);

    let currentPage = 1;
    const seenCaseNumbers = new Set<string>();

    while (currentPage <= maxPages) {
      // extractGridRows scrolls the ag-Grid body-viewport to harvest all rows
      // (Strategy B handles virtual-scroll by collecting rows at each stop).
      const rows = await extractGridRows(page);
      if (rows.length === 0) break;

      for (const row of rows) {
        // Deduplicate: skip rows where we couldn't detect a case number
        // AND fall back to openDate as a last-resort key so we don't lose
        // rows whose number didn't match the regex (e.g. purely numeric IDs).
        const key = row.caseNumber || `date:${row.openDate}:${row.caseTitle}`;
        if (!key || seenCaseNumbers.has(key)) continue;
        seenCaseNumbers.add(key);

        const defendantName = extractDefendant(row.caseTitle);
        const slug = resolveBrandSlug(defendantName);
        if (brandFilterOnly && !slug) continue;

        const rawCase: RawCaseData = {
          caseNumber:      row.caseNumber || key,
          defendantName,
          defendantSlug:   slug,
          court:           row.court,
          status:          'FILED',
          result:          '',
          filingDate:      parseHebrewDate(row.openDate),
          closeDate:       '',
          plaintiffName:   '',
          lawyers:         '',
          pdfPath:         null,
          pdfUrl:          null,
          source:          'CSV_ONLY',
          summary:         null,
          affectedGroup:   row.group || null,
          legalQuestion:   row.legalQuestion || null,
          reliefType:      row.reliefType || null,
          reliefDetail:    null,
          claimAmount:     row.amount || null,
          individualAmount: null,
          judge:           null,
          permalink:       null,
        };

        if (slug) result.brandMatches++;
        result.cases.push(rawCase);
      }

      console.log(`[CourtScraper]   Page ${currentPage}: ${rows.length} rows harvested, ${result.cases.length} total cases`);

      // Navigate to next page
      const nextBtn = page.locator('.ag-paging-button.ngcs-buttonAsLink:has-text("לדף הבא")').last();
      const isDisabled = await nextBtn.evaluate(el =>
        el.classList.contains('ag-disabled') ||
        el.getAttribute('aria-disabled') === 'true' ||
        (el as HTMLElement).style.pointerEvents === 'none'
      ).catch(() => true);

      if (isDisabled) break;

      try {
        await nextBtn.click({ timeout: 10000 });
        // Wait for rows to re-render after pagination
        await page.waitForTimeout(1500);
        await page.waitForSelector('.ag-row', { timeout: 10000, state: 'attached' }).catch(() => {});
        await page.waitForTimeout(500);
        currentPage++;
      } catch {
        break;
      }
    }

    console.log(`[CourtScraper] Done. Total: ${result.totalFound}, Extracted: ${result.cases.length}, Brand matches: ${result.brandMatches}`);

  } catch (err) {
    result.errors.push(`Scraper error: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`[CourtScraper] Error:`, err);
  } finally {
    if (browser) await browser.close();
  }

  return result;
}

/** Dismiss all court site overlays/modals */
async function dismissOverlays(page: any): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('[id*="lean_overlay"], [id*="MessageLS"], [id*="MessageMainMessage"]')
      .forEach((el: Element) => el.remove());
  });
  await page.waitForTimeout(300);
}

/** Extract all ag-Grid rows from the current page.
 *
 *  The court site runs ag-Grid in virtual-scroll mode: only rows that are
 *  in the visible viewport are rendered to the DOM.  We work around this with
 *  three strategies in order of reliability:
 *
 *  A) ag-Grid JS API — reads the in-memory row model directly, no scrolling.
 *     Tries __agGridMetaData__ (ag-Grid v27+) and Angular __ngContext__ (v14+).
 *
 *  B) Scroll-harvest — slowly scrolls the ag-Grid body-viewport and collects
 *     rows at each stop, deduplicating by row-index.  Uses col-id attributes
 *     plus header text for semantic column mapping (not positional), so the
 *     "date in column 0" layout is handled correctly regardless of column order.
 *
 *  C) Plain <table> fallback — last resort if ag-Grid is not present.
 */
async function extractGridRows(page: any): Promise<Array<{
  caseNumber: string;
  caseTitle: string;
  openDate: string;
  court: string;
  group: string;
  legalQuestion: string;
  reliefType: string;
  amount: string;
}>> {

  // ── Strategy A: ag-Grid JS API ──────────────────────────────────────────────
  const apiResult = await page.evaluate(() => {
    try {
      const wrappers = document.querySelectorAll('.ag-root-wrapper');
      if (!wrappers.length) return null;
      const wrapper = wrappers[wrappers.length - 1] as any;

      let api: any = null;

      // Path 1: ag-Grid v27+ __agGridMetaData__
      const meta = wrapper.__agGridMetaData__;
      if (meta) api = meta.gridApi || meta.api;

      // Path 2: Angular 14+ __ngContext__ (LView array) — walk up from wrapper
      if (!api) {
        let el: any = wrapper;
        for (let depth = 0; depth < 12 && el && !api; depth++) {
          const ctx = el.__ngContext__;
          if (ctx) {
            const arr = Array.isArray(ctx) ? ctx : [ctx];
            for (const item of arr) {
              if (item?.gridOptions?.api?.forEachNode) { api = item.gridOptions.api; break; }
              if (item?.api?.forEachNode)              { api = item.api;             break; }
            }
          }
          el = el.parentElement;
        }
      }

      if (!api?.forEachNode) return null;

      const rawRows: any[] = [];
      api.forEachNode((node: any) => {
        if (node.data) rawRows.push(node.data);
      });
      return rawRows.length > 0 ? rawRows : null;
    } catch { return null; }
  });

  if (apiResult) {
    // Semantic mapping: look for known field names in the row object
    const mapField = (d: Record<string, any>, patterns: string[]): string => {
      const key = Object.keys(d).find(k =>
        patterns.some(p => k.toLowerCase().includes(p.toLowerCase()))
      );
      return key ? String(d[key] ?? '').trim() : '';
    };
    return (apiResult as Record<string, any>[])
      .map(d => ({
        caseNumber:    mapField(d, ['casenum','case_num','מספר','number']) || String(Object.values(d)[0] ?? ''),
        caseTitle:     mapField(d, ['title','name','subject','שם','נושא','parties']),
        openDate:      mapField(d, ['date','open','filed','תאריך']),
        court:         mapField(d, ['court','tribunal','בית','מחוז']),
        group:         mapField(d, ['group','קבוצה','category']),
        legalQuestion: mapField(d, ['legal','question','שאלה']),
        reliefType:    mapField(d, ['relief','remedy','סעד']),
        amount:        mapField(d, ['amount','sum','סכום','שווי']),
      }))
      .filter(r => r.caseNumber || r.caseTitle);
  }

  // ── Strategy B: Scroll-harvest with col-id semantic mapping ────────────────
  // ag-Grid virtual scroll only renders rows that are inside the viewport's
  // visible area.  Scrolling the .ag-body-viewport in small increments forces
  // each row into view so it gets rendered and we can read it.
  //
  // We deduplicate by row-index attribute so each row is counted once even if
  // it was visible at multiple scroll positions.
  //
  // Column detection uses col-id + header-cell text (NOT positional index),
  // which is why the "date in column 0" bug is corrected here.
  const scrollRows = await page.evaluate(() => {
    return new Promise<any[]>(resolve => {
      const grids = document.querySelectorAll('div.ag-root-wrapper');
      const main  = (grids.length ? grids[grids.length - 1] : null) as Element | null;
      if (!main) { resolve([]); return; }

      // Build col-id → header-text map
      const headerMap: Record<string, string> = {};
      main.querySelectorAll('.ag-header-cell[col-id]').forEach((h: Element) => {
        const id  = h.getAttribute('col-id') || '';
        const txt = ((h as HTMLElement).innerText || h.textContent || '').trim();
        if (id) headerMap[id] = txt;
      });

      const collected = new Map<string, Record<string, string>>(); // rowIndex → data

      function harvest() {
        main!.querySelectorAll('.ag-row').forEach((rowEl: Element) => {
          const idx = rowEl.getAttribute('row-index') || rowEl.getAttribute('row-id') || '';
          if (!idx || collected.has(idx)) return;
          const data: Record<string, string> = {};
          rowEl.querySelectorAll('.ag-cell[col-id]').forEach((c: Element) => {
            const id = c.getAttribute('col-id') || '';
            if (id) data[id] = ((c as HTMLElement).innerText || c.textContent || '').trim();
          });
          // Also capture cells without col-id by position
          if (Object.keys(data).length === 0) {
            rowEl.querySelectorAll('.ag-cell').forEach((c: Element, i: number) => {
              data[`_pos${i}`] = ((c as HTMLElement).innerText || c.textContent || '').trim();
            });
          }
          if (Object.keys(data).length > 0) collected.set(idx, data);
        });
      }

      const vp = (main.querySelector('.ag-body-viewport') ||
                  main.querySelector('.ag-center-cols-viewport') ||
                  main) as HTMLElement;

      harvest(); // collect rows already in view

      const STEP = 120;
      const MAX  = Math.max(vp.scrollHeight, 5000);
      let   pos  = 0;

      function step() {
        harvest();
        pos += STEP;
        if (pos > MAX + 240) {
          vp.scrollTop = 0;
          resolve(Array.from(collected.entries()).map(([, d]) => ({ headerMap, data: d })));
          return;
        }
        vp.scrollTop = pos;
        setTimeout(step, 60);
      }
      vp.scrollTop = 0;
      setTimeout(step, 120);
    });
  });

  if (scrollRows.length > 0) {
    return scrollRows
      .map((item: any) => {
        const { headerMap, data } = item as {
          headerMap: Record<string, string>;
          data:      Record<string, string>;
        };

        let caseNumber = '', caseTitle = '', openDate = '', court = '',
            group = '', legalQuestion = '', reliefType = '', amount = '';

        for (const [colId, val] of Object.entries(data)) {
          if (!val) continue;
          const h = (headerMap[colId] || colId).toLowerCase();

          // Date: DD/MM/YYYY value OR header contains תאריך/date
          if (!openDate && (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(val) || h.includes('תאריך') || h.includes('date'))) {
            openDate = val; continue;
          }
          // Case title: contains "נ'" separator (plaintiff vs defendant)
          if (!caseTitle && /נ['״׳׳’]/.test(val)) {
            caseTitle = val; continue;
          }
          // Case number: Israeli case number pattern "letters digits-MM-YY" or "digits-MM-YY"
          if (!caseNumber && (/\d{4,}-\d{2}-\d{2,}/.test(val) || h.includes('מספר') || h.includes('תיק'))) {
            caseNumber = val; continue;
          }
          // Court
          if (!court && (h.includes('בית') || h.includes('court') || h.includes('מחוז'))) {
            court = val; continue;
          }
          // Group / category
          if (!group && (h.includes('קבוצה') || h.includes('group') || h.includes('category'))) {
            group = val; continue;
          }
          // Claim amount
          if (!amount && (h.includes('סכום') || h.includes('amount') || /₪/.test(val))) {
            amount = val; continue;
          }
        }

        // Second pass for columns we missed (e.g. positional _pos* keys)
        if (!caseNumber || !caseTitle) {
          for (const val of Object.values(data)) {
            if (!val) continue;
            if (!openDate && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(val))  { openDate   = val; continue; }
            if (!caseTitle && /נ['״׳׳’]/.test(val))         { caseTitle  = val; continue; }
            if (!caseNumber && /\d{4,}-\d{2}-\d{2,}/.test(val))       { caseNumber = val; continue; }
          }
        }

        return { caseNumber, caseTitle, openDate, court, group, legalQuestion, reliefType, amount };
      })
      .filter(r => r.caseNumber || r.caseTitle);
  }

  // ── Strategy C: Plain <table> fallback ──────────────────────────────────────
  return page.evaluate(() => {
    const rows: any[] = [];
    const lastTable = [...document.querySelectorAll('table')].pop();
    if (lastTable) {
      [...lastTable.querySelectorAll('tr')].slice(1).forEach((tr: Element) => {
        const t = [...tr.querySelectorAll('td, th')]
          .map(c => ((c as HTMLElement).innerText || c.textContent || '').trim());
        if (t.length < 2 || !t.some(v => v.length > 3)) return;

        const dateIdx  = t.findIndex(v => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v));
        const titleIdx = t.findIndex(v => /נ['״׳׳’]/.test(v));
        const numIdx   = t.findIndex(v => /\d{4,}-\d{2}-\d{2,}/.test(v));

        rows.push({
          caseNumber:    t[numIdx   >= 0 ? numIdx   : 0] || '',
          caseTitle:     t[titleIdx >= 0 ? titleIdx : 1] || '',
          openDate:      t[dateIdx  >= 0 ? dateIdx  : 2] || '',
          court:         t[3] || '',
          group:         t[4] || '',
          legalQuestion: t[5] || '',
          reliefType:    t[6] || '',
          amount:        t[7] || '',
        });
      });
    }
    return rows;
  });
}

/**
 * Scrape the full 2021–2026 range in 3-month slices.
 * Stops if blocked by CAPTCHA.
 */
export async function scrapeFullRange(options?: {
  fromYear?: number;
  toYear?: number;
  headless?: boolean;
  brandFilterOnly?: boolean;
}): Promise<{
  totalCases:   number;
  brandMatches: number;
  cases:        RawCaseData[];
  errors:       string[];
  blocked:      boolean;
}> {
  const fromYear = options?.fromYear ?? 2021;
  const toYear   = options?.toYear   ?? new Date().getFullYear();
  const headless = options?.headless ?? true;
  const brandFilterOnly = options?.brandFilterOnly ?? false;

  const slices = generateTimeSlices(
    new Date(`${fromYear}-01-01`),
    new Date(`${toYear}-12-31`)
  );

  const allCases: RawCaseData[] = [];
  const allErrors: string[] = [];
  // Cross-slice dedup: the old slice generator allowed boundary overlaps, and
  // even with the new clamped slices, the registry can still list the same
  // case under multiple search windows (e.g. if filing and amendment dates
  // straddle a boundary). Use the caseNumber as the natural key.
  const seen = new Set<string>();
  let totalFound = 0;
  let brandMatches = 0;

  console.log(`[CourtScraper] Scraping ${slices.length} time slices (${fromYear}–${toYear})`);

  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i];
    console.log(`[CourtScraper] Slice ${i + 1}/${slices.length}: ${slice.from.toISOString().slice(0, 10)} – ${slice.to.toISOString().slice(0, 10)}`);

    const result = await scrapeCourtRegistry({
      dateFrom: slice.from,
      dateTo:   slice.to,
      headless,
      brandFilterOnly,
    });

    totalFound   += result.totalFound;
    brandMatches += result.brandMatches;
    for (const c of result.cases) {
      if (c.caseNumber && seen.has(c.caseNumber)) continue;
      if (c.caseNumber) seen.add(c.caseNumber);
      allCases.push(c);
    }
    allErrors.push(...result.errors);

    if (result.blocked) {
      console.log(`[CourtScraper] BLOCKED at slice ${i + 1}. Stopping.`);
      return { totalCases: totalFound, brandMatches, cases: allCases, errors: allErrors, blocked: true };
    }

    // Polite delay between slices
    if (i < slices.length - 1) {
      console.log(`[CourtScraper] Waiting 5s before next slice...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log(`[CourtScraper] Complete. Total: ${totalFound}, Brand matches: ${brandMatches}, Cases: ${allCases.length}`);
  return { totalCases: totalFound, brandMatches, cases: allCases, errors: allErrors, blocked: false };
}
