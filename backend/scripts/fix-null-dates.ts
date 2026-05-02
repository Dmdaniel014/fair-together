// ─────────────────────────────────────────────────────────────────────────────
//  scripts/fix-null-dates.ts
//  Fixes lawsuits with null filingDate by extracting from case number pattern.
//  Case number format: NNNNN-MM-YY → filing month/year
//  Run: npx tsx scripts/fix-null-dates.ts
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../db/index.js';

async function main() {
  const nullDates = await prisma.lawsuit.findMany({
    where: { filingDate: null },
    select: { id: true, caseNumber: true, defendantName: true },
  });

  console.log(`Found ${nullDates.length} cases with null filing date`);
  if (nullDates.length === 0) {
    console.log('Nothing to fix.');
    await prisma.$disconnect();
    return;
  }

  let fixed = 0;
  let skipped = 0;

  for (const c of nullDates) {
    // Extract MM-YY from case number (e.g., "14205-06-20" → month=06, year=2020)
    const match = c.caseNumber.match(/\d+-(\d{2})-(\d{2})$/);
    if (!match) {
      console.log(`  SKIP: ${c.caseNumber} — no date pattern found`);
      skipped++;
      continue;
    }

    const month = parseInt(match[1]);
    const yearShort = parseInt(match[2]);
    // Israeli case numbers use 2-digit years: 18=2018, 20=2020, 26=2026
    const year = yearShort >= 50 ? 1900 + yearShort : 2000 + yearShort;

    if (month < 1 || month > 12 || year < 2000 || year > 2030) {
      console.log(`  SKIP: ${c.caseNumber} — invalid date: ${month}/${year}`);
      skipped++;
      continue;
    }

    // Set to first of the month
    const filingDate = new Date(year, month - 1, 1);

    await prisma.lawsuit.update({
      where: { id: c.id },
      data: { filingDate, lastUpdatedAt: new Date() },
    });

    console.log(`  FIXED: ${c.caseNumber} → ${filingDate.toISOString().slice(0, 10)} (${c.defendantName.substring(0, 30)})`);
    fixed++;
  }

  console.log(`\nDone: ${fixed} fixed, ${skipped} skipped`);
  await prisma.$disconnect();
}

main();
