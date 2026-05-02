// Diagnostic: How many cases are there in the DB?
// How many Samsung cases? What brands are in the registry but missing from BRAND_NAME_MAP?
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

(async () => {
  const total = await prisma.lawsuit.count();
  console.log(`TOTAL lawsuits in DB: ${total}`);

  // Search for Samsung-related — both Hebrew & English variants
  const samsung = await prisma.lawsuit.findMany({
    where: {
      OR: [
        { defendantName: { contains: 'סמסונג', mode: 'insensitive' } },
        { defendantName: { contains: 'samsung', mode: 'insensitive' } },
      ],
    },
    take: 10,
    select: { id: true, defendantName: true, status: true, caseNumber: true, filingDate: true, defendantSlug: true },
  });
  console.log(`\nSamsung in DB: ${samsung.length}`);
  samsung.forEach(s => console.log('  -', s.defendantName, '|', s.caseNumber, '|', s.status, '|', s.defendantSlug));

  // What brand slugs are actually in DB?
  const slugs = await prisma.lawsuit.groupBy({
    by: ['defendantSlug'],
    _count: { _all: true },
    orderBy: { _count: { defendantSlug: 'desc' } },
  });
  console.log(`\nUnique brand slugs in DB: ${slugs.length}`);
  console.log('Top 30:');
  slugs.slice(0, 30).forEach(s => console.log(`  ${s.defendantSlug}: ${s._count._all}`));

  // Latest filing date — to know cutoff for incremental scan
  const latest = await prisma.lawsuit.findFirst({
    orderBy: { filingDate: 'desc' },
    select: { filingDate: true, defendantName: true, caseNumber: true },
  });
  console.log(`\nLatest filing date in DB: ${latest?.filingDate?.toISOString()} (${latest?.defendantName} / ${latest?.caseNumber})`);

  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
