// ─────────────────────────────────────────────────────────────────────────────
//  scripts/backfill-is-settlement.ts
//  One-time backfill: sets isSettlement=true for all cases whose status is
//  SETTLEMENT or SETTLEMENT_APPROVED, so that autoEnrichWithAI can process them.
//
//  Run: npx tsx --env-file=.env scripts/backfill-is-settlement.ts
//       npx tsx --env-file=.env scripts/backfill-is-settlement.ts --dry-run
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../db/index';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Backfill: isSettlement flag');
  console.log(`  Mode: ${DRY_RUN ? '🔍 DRY RUN' : '✏️ LIVE'}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Count what needs updating
  const toMark = await prisma.lawsuit.count({
    where: {
      status:        { in: ['SETTLEMENT', 'SETTLEMENT_APPROVED'] },
      isSettlement:  false,
    },
  });

  const alreadyMarked = await prisma.lawsuit.count({
    where: { isSettlement: true },
  });

  console.log(`Already marked isSettlement=true: ${alreadyMarked}`);
  console.log(`To mark now:                      ${toMark}`);

  if (toMark === 0) {
    console.log('\nNothing to do — all settlements already marked.');
    await prisma.$disconnect();
    return;
  }

  if (!DRY_RUN) {
    const result = await prisma.lawsuit.updateMany({
      where: {
        status:       { in: ['SETTLEMENT', 'SETTLEMENT_APPROVED'] },
        isSettlement: false,
      },
      data: {
        isSettlement:  true,
        lastUpdatedAt: new Date(),
      },
    });
    console.log(`\n✅ Marked ${result.count} cases as isSettlement=true`);
  } else {
    console.log(`\n🔍 Would mark ${toMark} cases (dry-run, no changes made)`);
  }

  // Also reset isSettlement=false for DISMISSED/CLOSED cases that were
  // previously settlements but should no longer be shown as such.
  const wronglyMarked = await prisma.lawsuit.count({
    where: {
      status:       { in: ['DISMISSED', 'CLOSED'] },
      isSettlement: true,
    },
  });

  if (wronglyMarked > 0) {
    console.log(`\nFound ${wronglyMarked} closed/dismissed cases with isSettlement=true`);
    if (!DRY_RUN) {
      const r2 = await prisma.lawsuit.updateMany({
        where: { status: { in: ['DISMISSED', 'CLOSED'] }, isSettlement: true },
        data:  { isSettlement: false, lastUpdatedAt: new Date() },
      });
      console.log(`✅ Cleared isSettlement on ${r2.count} closed/dismissed cases`);
    }
  }

  await prisma.$disconnect();
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Done!');
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(e => { console.error(e); process.exit(1); });
