// ─────────────────────────────────────────────────────────────────────────────
//  scripts/backfill-missing-cases.ts
//
//  One-shot recovery for cases that were silently dropped by the old scanner.
//  Causes of past silent drops:
//    1. Defendant didn't match an entry in BRAND_NAME_MAP (e.g. סמסונג, LG, IKEA)
//    2. Curated short aliases (הוט / בזק / פז / גט) failed the old MIN_ALIAS_LEN
//       gate so even known brands got dropped on long defendant names
//       (e.g. "הוט מערכות תקשורת בע"מ").
//
//  Usage:
//    DATABASE_URL=... npx tsx backend/scripts/backfill-missing-cases.ts
//
//  Behaviour:
//    - Re-runs the public registry scan with the NEW logic (uncurated cases
//      are kept as `x-<defendant-slug>` rows, not dropped).
//    - Compares the result against the current DB and prints a delta report.
//    - Writes new rows via db.upsertRawCase (idempotent, so safe to re-run).
//
//  Note: this disables the incremental cutoff so it sees the entire registry
//  history. Subsequent agent runs continue using the incremental cutoff
//  (latest filing date) — backfill is a one-shot.
// ─────────────────────────────────────────────────────────────────────────────

import { scanLegalSources } from '../skills/scanLegalSources';
import { db } from '../db';
import { BRAND_TO_CATEGORY } from '../types';

async function main() {
  console.log('━━━ FAIR TOGETHER — Missing-cases backfill ━━━\n');

  // Capture pre-state for delta reporting
  const beforeTotal = await db.getReadyLawsuits().then(rs => rs.length).catch(() => 0);
  const beforeAll   = await (db as any).prisma?.lawsuit?.count?.() ?? null;
  console.log(`[before] DB total cases: ${beforeAll ?? '?'} | ready: ${beforeTotal}`);

  // Get the existing case-number set so the scanner can skip rows we already have.
  // We DON'T pass `incrementalSince` — we want a full historical scan.
  const existingCaseNumbers = await db.getExistingCaseNumbers();
  console.log(`[scan] existing case numbers in DB: ${existingCaseNumbers.length}`);

  console.log('[scan] running full scan (no date cutoff, no PDF download)...');
  const scanResult = await scanLegalSources({
    downloadPDFs:        false,
    existingCaseNumbers: new Set(existingCaseNumbers),
    incrementalSince:    null,
    openCaseNumbers:     new Set(),
  });

  console.log(`\n[scan] results:`);
  console.log(`  total in registry:    ${scanResult.totalCasesInCSV}`);
  console.log(`  matched + new in DB:  ${scanResult.cases.length}`);
  console.log(`  errors:               ${scanResult.errors.length}`);

  // Group new cases by slug to surface what we recovered
  const bySlug = new Map<string, number>();
  const byPrefix = { curated: 0, uncurated: 0 };
  for (const c of scanResult.cases) {
    bySlug.set(c.defendantSlug!, (bySlug.get(c.defendantSlug!) ?? 0) + 1);
    if (c.defendantSlug!.startsWith('x-')) byPrefix.uncurated++;
    else byPrefix.curated++;
  }

  console.log(`\n[breakdown]`);
  console.log(`  curated brand matches:     ${byPrefix.curated}`);
  console.log(`  uncurated (x- prefix):     ${byPrefix.uncurated}`);

  console.log(`\n[top 30 new slugs]`);
  const sorted = [...bySlug.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  sorted.forEach(([slug, count]) => {
    const cat = BRAND_TO_CATEGORY[slug] ?? (slug.startsWith('x-') ? 'other' : 'other');
    console.log(`  ${count.toString().padStart(4)}× ${slug.padEnd(40)} (${cat})`);
  });

  // Persist all new cases
  console.log(`\n[persist] writing ${scanResult.cases.length} cases to DB...`);
  let written = 0;
  let failed  = 0;
  for (const rawCase of scanResult.cases) {
    if (!rawCase.defendantSlug) continue;
    try {
      await db.upsertRawCase({
        ...rawCase,
        defendantSlug: rawCase.defendantSlug,
        result:        rawCase.result   ?? '',
        closeDate:     rawCase.closeDate ?? '',
      });
      written++;
      if (written % 100 === 0) console.log(`  ...${written} written`);
    } catch (e: any) {
      failed++;
      if (failed <= 5) console.error(`  FAIL ${rawCase.caseNumber}: ${e?.message}`);
    }
  }

  console.log(`\n[persist] done. written: ${written}, failed: ${failed}`);

  // Spotlight Samsung specifically (the user-reported case)
  const samsungAfter = await (db as any).prisma.lawsuit.findMany({
    where: {
      OR: [
        { defendantName: { contains: 'סמסונג', mode: 'insensitive' } },
        { defendantName: { contains: 'samsung', mode: 'insensitive' } },
        { defendantSlug: { startsWith: 'x-' } },
      ],
    },
    take: 200,
    select: { defendantName: true, defendantSlug: true, caseNumber: true, status: true, filingDate: true },
  });
  const samsungOnly = samsungAfter.filter((s: any) =>
    /סמסונג|samsung/i.test(s.defendantName)
  );
  console.log(`\n[spotlight] Samsung in DB after backfill: ${samsungOnly.length}`);
  samsungOnly.slice(0, 10).forEach((s: any) =>
    console.log(`  ${s.caseNumber} | ${s.status} | ${s.defendantSlug} | ${s.defendantName}`)
  );

  // Final totals
  const afterAll = await (db as any).prisma.lawsuit.count();
  const afterReady = await db.getReadyLawsuits().then(rs => rs.length);
  console.log(`\n[after] DB total cases: ${afterAll} (Δ +${afterAll - (beforeAll ?? 0)}) | ready: ${afterReady} (Δ +${afterReady - beforeTotal})`);

  await (db as any).prisma.$disconnect();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
