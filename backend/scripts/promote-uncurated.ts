// ─────────────────────────────────────────────────────────────────────────────
//  scripts/promote-uncurated.ts
//
//  After expanding BRAND_NAME_MAP, existing rows that were already ingested
//  under an `x-` slug stay there until we promote them. This one-shot script
//  re-runs `resolveBrandSlug` against every `x-` row's defendantName; when a
//  curated slug is now found, it migrates the row.
//
//  Idempotent: safe to re-run any time. Only touches `x-`-prefixed rows.
//
//  Usage:
//    node --env-file=.env --import tsx scripts/promote-uncurated.ts
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../db';
import { resolveBrandSlug } from '../skills/brandMatcher';
import { BRAND_TO_CATEGORY } from '../types';

async function main() {
  console.log('━━━ Promote uncurated → curated ━━━\n');

  const uncurated = await prisma.lawsuit.findMany({
    where:  { defendantSlug: { startsWith: 'x-' } },
    select: { id: true, defendantName: true, defendantSlug: true, category: true },
  });

  console.log(`Scanning ${uncurated.length} x-prefixed rows...`);

  const promotions = new Map<string, number>();
  let promoted = 0;

  for (const row of uncurated) {
    const newSlug = resolveBrandSlug(row.defendantName);
    if (!newSlug || newSlug === row.defendantSlug) continue;

    const newCategory = BRAND_TO_CATEGORY[newSlug] ?? row.category ?? 'other';

    await prisma.lawsuit.update({
      where: { id: row.id },
      data:  { defendantSlug: newSlug, category: newCategory },
    });

    promotions.set(newSlug, (promotions.get(newSlug) ?? 0) + 1);
    promoted++;
  }

  console.log(`\n[done] promoted ${promoted} rows`);
  if (promotions.size > 0) {
    console.log('\n[breakdown]');
    [...promotions.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([slug, count]) => console.log(`  ${count.toString().padStart(4)}× → ${slug}`));
  }

  // Sanity counts
  const remainingX = await prisma.lawsuit.count({ where: { defendantSlug: { startsWith: 'x-' } } });
  const totalDb    = await prisma.lawsuit.count();
  console.log(`\n[after] DB total: ${totalDb} | still uncurated (x-): ${remainingX}`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
