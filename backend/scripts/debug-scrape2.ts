// Dumps raw cell content from the first page to understand the column layout
import { chromium } from 'playwright';

const HOMEPAGE_URL = 'https://www.court.gov.il/NGCS.Web.Site/HomePage.aspx';

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({ locale: 'he-IL', ignoreHTTPSErrors: true, viewport: { width: 1280, height: 8000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  await page.goto(HOMEPAGE_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    document.getElementById('lean_overlay')?.remove();
    document.getElementById('MessageMainMessage')?.remove();
    document.querySelectorAll('[id*="lean_overlay"]').forEach((el: any) => el.remove());
  });
  await page.waitForTimeout(500);

  const registryLink = page.locator('#OperationMenuUC1_btnNotePad');
  await registryLink.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Dismiss overlays that appear on registry load
  await page.evaluate(() => {
    document.querySelectorAll('[id*="lean_overlay"], [id*="MessageLS"]').forEach((el: any) => el.remove());
  });

  // Set dates
  for (const [sel, val] of [
    ['#CaseSearchViewGeneral1_startDate',  '01/01/2026'],
    ['#CaseSearchViewGeneral1_finishDate', '31/01/2026'],
  ] as const) {
    await page.locator(sel).fill('');
    await page.locator(sel).type(val, { delay: 40 });
    await page.locator(sel).evaluate((el: any) => {
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    });
    await page.waitForTimeout(200);
  }

  await page.locator('#CaseSearchViewGeneral1_buttonsGroup_searchButton').click({ force: true });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    document.querySelectorAll('[id*="lean_overlay"], [id*="MessageLS"]').forEach((el: any) => el.remove());
  });
  await page.waitForTimeout(1000);

  // Dump full cell content and count
  const debug = await page.evaluate(() => {
    const grids   = document.querySelectorAll('.ag-root-wrapper');
    const mainGrid = grids.length ? grids[grids.length - 1] : document;
    const rows    = mainGrid.querySelectorAll('.ag-row');
    const result: any[] = [];
    for (const row of Array.from(rows).slice(0, 5)) {
      const cells = Array.from(row.querySelectorAll('.ag-cell, [col-id]'));
      result.push({
        cellCount: cells.length,
        colIds:    cells.map((c: any) => c.getAttribute('col-id') || c.getAttribute('aria-colindex') || '?'),
        texts:     cells.map(c => ((c as HTMLElement).innerText || c.textContent || '').trim().slice(0, 60)),
      });
    }
    // Also check if there's a header row
    const headers = mainGrid.querySelectorAll('.ag-header-cell');
    const headerTexts = Array.from(headers).map(h => ((h as HTMLElement).innerText || h.textContent || '').trim().slice(0, 30));
    return { rowCount: rows.length, rows: result, headers: headerTexts };
  });

  console.log(JSON.stringify(debug, null, 2));
  await browser.close();
}
main().catch(console.error).finally(() => process.exit());
