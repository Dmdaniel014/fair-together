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
    let currentPage = 1;
    const seenCaseNumbers = new Set<string>();

    while (currentPage <= maxPages) {
      // Extract visible ag-Grid rows
      const rows = await extractGridRows(page);
      if (rows.length === 0) break;

      for (const row of rows) {
        if (!row.caseNumber || seenCaseNumbers.has(row.caseNumber)) continue;
        seenCaseNumbers.add(row.caseNumber);

        const defendantName = extractDefendant(row.caseTitle);
        const slug = resolveBrandSlug(defendantName);
        if (brandFilterOnly && !slug) continue;

        const rawCase: RawCaseData = {
          caseNumber:      row.caseNumber,
          defendantName,
          defendantSlug:   slug,
          court:           row.court,
          status:          'FILED', // Registry lists all open cases
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

      console.log(`[CourtScraper]   Page ${currentPage}: ${rows.length} rows, ${result.cases.length} total cases`);

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
        await page.waitForTimeout(2000);
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

/** Extract all visible ag-Grid rows from the current page */
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
  return page.evaluate(() => {
    const rows: any[] = [];
    // ag-Grid renders .ag-row elements across multiple .ag-root-wrapper containers
    // on this page (search-filter grids + the main results grid). The last wrapper
    // is the main data grid — scoping to it avoids pulling phantom rows from
    // auxiliary grids that may appear above.
    const grids = document.querySelectorAll('div.ag-root-wrapper');
    const mainGrid = grids.length ? grids[grids.length - 1] : document;
    const agRows = mainGrid.querySelectorAll('.ag-row');

    for (const row of agRows) {
      const cells = row.querySelectorAll('.ag-cell');
      if (cells.length < 5) continue;

      const cellTexts = Array.from(cells).map(c => (c.textContent || '').trim());
      // Skip empty/header rows
      if (!cellTexts[0] || cellTexts[0].length < 3) continue;

      // Column order from the registry:
      // 0: מספר תיק, 1: שם התיק, 2: תאריך פתיחה, 3: בית משפט,
      // 4: קבוצה, 5: שאלה משפטית, 6: סעד מבוקש, 7: סכום תביעה
      rows.push({
        caseNumber:    cellTexts[0] || '',
        caseTitle:     cellTexts[1] || '',
        openDate:      cellTexts[2] || '',
        court:         cellTexts[3] || '',
        group:         cellTexts[4] || '',
        legalQuestion: cellTexts[5] || '',
        reliefType:    cellTexts[6] || '',
        amount:        cellTexts[7] || '',
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
