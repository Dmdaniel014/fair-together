// ─────────────────────────────────────────────────────────────────────────────
//  scripts/run-fresh-scrape.ts
//  Bridges the 2021-2026 data gap using the Playwright court registry scraper.
//  Searches in 3-month slices, stores matching cases to DB, emits enrichment events.
//
//  Usage:
//    npx tsx --env-file=.env scripts/run-fresh-scrape.ts
//    npx tsx --env-file=.env scripts/run-fresh-scrape.ts --from 2024 --to 2026
//    npx tsx --env-file=.env scripts/run-fresh-scrape.ts --brand-only   (known brands only)
//    npx tsx --env-file=.env scripts/run-fresh-scrape.ts --dry-run      (no DB writes)
//    npx tsx --env-file=.env scripts/run-fresh-scrape.ts --visible      (open Chromium window)
// ─────────────────────────────────────────────────────────────────────────────

import { scrapeFullRange } from '../skills/scrapeCourtRegistry';
import { db, prisma } from '../db/index';
import { mapStatus } from '../types';

const FROM_YEAR   = parseInt(process.argv.find(a => a.startsWith('--from='))?.split('=')[1] ?? '2021');
const TO_YEAR     = parseInt(process.argv.find(a => a.startsWith('--to='))?.split('=')[1]   ?? String(new Date().getFullYear()));
const BRAND_ONLY  = process.argv.includes('--brand-only');
const DRY_RUN     = process.argv.includes('--dry-run');
const HEADLESS    = !process.argv.includes('--visible');

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Fresh Court Registry Scrape — 2021-2026 Data Bridge');
  console.log(`  Range:      ${FROM_YEAR}–${TO_YEAR}`);
  console.log(`  Brand-only: ${BRAND_ONLY}`);
  console.log(`  Mode:       ${DRY_RUN ? '🔍 DRY RUN' : '✏️ LIVE'}`);
  console.log(`  Browser:    ${HEADLESS ? 'headless' : 'visible'}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get existing case numbers to avoid duplicates
  const existingSet = new Set(await db.getExistingCaseNumbers());
  console.log(`[Scrape] ${existingSet.size} existing cases in DB\n`);

  // ── Run the scraper ──────────────────────────────────────────────────────
  const scrapeResult = await scrapeFullRange({
    fromYear:    FROM_YEAR,
    toYear:      TO_YEAR,
    headless:    HEADLESS,
    brandFilterOnly: BRAND_ONLY,
  });

  console.log('\n─────────────────────────────────────────────────────────────────');
  console.log(`  Scrape complete:`);
  console.log(`  Total found:    ${scrapeResult.totalCases}`);
  console.log(`  Brand matches:  ${scrapeResult.brandMatches}`);
  console.log(`  Extracted:      ${scrapeResult.cases.length}`);
  console.log(`  Errors:         ${scrapeResult.errors.length}`);
  console.log(`  Blocked:        ${scrapeResult.blocked}`);
  console.log('─────────────────────────────────────────────────────────────────\n');

  if (scrapeResult.errors.length > 0) {
    console.log('Errors:');
    scrapeResult.errors.slice(0, 10).forEach(e => console.log('  -', e));
  }

  if (DRY_RUN) {
    console.log('\n🔍 DRY RUN: not writing to DB');
    console.log('Sample cases:');
    scrapeResult.cases.slice(0, 5).forEach(c => {
      console.log(`  ${c.caseNumber}: ${c.defendantName} (${c.defendantSlug ?? 'unmatched'}) — ${c.filingDate}`);
    });
    await prisma.$disconnect();
    return;
  }

  // ── Write to DB ──────────────────────────────────────────────────────────
  let inserted = 0;
  let updated  = 0;
  let skipped  = 0;

  for (const rawCase of scrapeResult.cases) {
    if (!rawCase.defendantSlug) {
      skipped++;
      continue;
    }

    const isExisting = existingSet.has(rawCase.caseNumber);

    try {
      await db.upsertRawCase({
        caseNumber:   rawCase.caseNumber,
        defendantName: rawCase.defendantName,
        defendantSlug: rawCase.defendantSlug,
        court:         rawCase.court     ?? '',
        status:        rawCase.status    ?? 'FILED',
        result:        rawCase.result    ?? '',
        filingDate:    rawCase.filingDate ?? '',
        closeDate:     rawCase.closeDate ?? '',
        plaintiffName: rawCase.plaintiffName ?? '',
        lawyers:       rawCase.lawyers   ?? '',
        pdfPath:       rawCase.pdfPath,
        pdfUrl:        rawCase.pdfUrl,
        summary:       rawCase.summary,
        affectedGroup: rawCase.affectedGroup,
        legalQuestion: rawCase.legalQuestion,
        reliefType:    rawCase.reliefType,
        reliefDetail:  rawCase.reliefDetail,
        claimAmount:   rawCase.claimAmount,
        individualAmount: rawCase.individualAmount,
        judge:         rawCase.judge,
        permalink:     rawCase.permalink,
      });

      if (isExisting) {
        updated++;
      } else {
        inserted++;
        existingSet.add(rawCase.caseNumber);

        // Emit event so extraction agent can enrich it
        await db.emitEvent({
          type:    'NEW_CASE_SCRAPED',
          payload: { caseNumber: rawCase.caseNumber, source: 'court_registry_2024' },
        });
      }
    } catch (err: any) {
      console.error(`  ❌ Failed ${rawCase.caseNumber}: ${err?.message}`);
      skipped++;
    }
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  DB Results:`);
  console.log(`  ✅ Inserted:  ${inserted}`);
  console.log(`  🔄 Updated:   ${updated}`);
  console.log(`  ⏭ Skipped:   ${skipped} (no matched brand slug)`);
  console.log('═══════════════════════════════════════════════════════════════');

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
