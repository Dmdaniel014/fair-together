// Quick debug script: inspect the ag-Grid structure on the court registry page
import { chromium } from 'playwright';

const HOMEPAGE_URL = 'https://www.court.gov.il/NGCS.Web.Site/HomePage.aspx';

async function main() {
  const browser = await chromium.launch({
    headless: true, channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    locale: 'he-IL', ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1280, height: 8000 },
  });
  const page = await context.newPage();

  try {
    await page.goto(HOMEPAGE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    // Dismiss modal
    await page.evaluate(() => {
      document.getElementById('lean_overlay')?.remove();
      document.getElementById('MessageMainMessage')?.remove();
    });
    // Click registry link
    await page.locator('#OperationMenuUC1_btnNotePad').click({ timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    await page.waitForTimeout(2000);

    // Set date range and search
    for (const [sel, val] of [
      ['#CaseSearchViewGeneral1_startDate',  '01/01/2026'],
      ['#CaseSearchViewGeneral1_finishDate', '31/03/2026'],
    ] as const) {
      await page.locator(sel).fill('');
      await page.locator(sel).type(val, { delay: 50 });
      await page.locator(sel).evaluate((el: any) => {
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur',   { bubbles: true }));
      });
    }
    await page.locator('#CaseSearchViewGeneral1_buttonsGroup_searchButton').click();
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    await page.waitForTimeout(3000);

    // Probe the grid structure
    const debug = await page.evaluate(() => {
      const grids = document.querySelectorAll('.ag-root-wrapper');
      const g = grids.length ? grids[grids.length - 1] : null;
      if (!g) return { error: 'no ag-root-wrapper found' };

      const gAny = g as any;
      // Look for ag-Grid API on the element
      const keys = Object.keys(gAny).filter(k =>
        k.includes('agGrid') || k.includes('Grid') || k.includes('api') || k.includes('Api')
      );
      // Count visible .ag-row elements
      const visibleRows = g.querySelectorAll('.ag-row').length;
      const allRows = document.querySelectorAll('.ag-row').length;

      // Check row heights
      const firstRow = g.querySelector('.ag-row') as HTMLElement | null;
      const rowStyle = firstRow ? { height: firstRow.style.height, top: firstRow.style.top, transform: firstRow.style.transform } : null;

      // Check if there's a grid API anywhere on window
      const windowKeys = Object.keys(window).filter(k =>
        k.toLowerCase().includes('grid') || k.toLowerCase().includes('ag') ||
        k.toLowerCase().includes('angularg')
      ).slice(0, 10);

      // Total count from paging
      const pagingText = document.querySelector('.ag-paging-row-summary-panel')?.textContent ?? '';

      return { keys, visibleRows, allRows, rowStyle, windowKeys, pagingText, wrapperCount: grids.length };
    });

    console.log('Debug info:', JSON.stringify(debug, null, 2));

    // Also check network requests for data
    page.on('response', async resp => {
      if (resp.url().includes('court.gov.il') && resp.headers()['content-type']?.includes('json')) {
        try {
          const body = await resp.json();
          console.log('JSON response from:', resp.url().slice(0, 100));
          console.log('Keys:', Object.keys(body).slice(0, 5));
        } catch {}
      }
    });

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
