import { prisma } from '../db/index';

async function main() {
  const seedCaseNumbers = [
    'ת"צ 51304-11-23','ת"צ 22089-07-22','ת"צ 18344-02-24','ת"צ 63201-05-23','ת"צ 12445-01-24'
  ];
  const found = await prisma.lawsuit.findMany({
    where: { caseNumber: { in: seedCaseNumbers } },
    select: { id: true, caseNumber: true, defendantName: true, isActive: true }
  });
  console.log('Seed cases in DB:', JSON.stringify(found, null, 2));

  const total       = await prisma.lawsuit.count();
  const active      = await prisma.lawsuit.count({ where: { isActive: true } });
  const ready       = await prisma.lawsuit.count({ where: { isReady: true, isActive: true } });
  const withSummary = await prisma.lawsuit.count({ where: { summary: { not: null }, isActive: true } });
  const withElig    = await prisma.lawsuit.count({ where: { eligibilityCriteria: { not: null }, isActive: true } });
  const withPayout  = await prisma.lawsuit.count({ where: { totalPoolILS: { not: null }, isActive: true } });
  const noData      = await prisma.lawsuit.count({
    where: { isActive: true, summary: null, eligibilityCriteria: null, totalPoolILS: null }
  });

  console.log('DB Stats:', JSON.stringify({ total, active, ready, withSummary, withElig, withPayout, noData }, null, 2));

  // Sample 5 random active cases to see data quality
  const sample = await prisma.lawsuit.findMany({
    where: { isActive: true },
    select: {
      caseNumber: true, defendantName: true, status: true,
      summary: true, eligibilityCriteria: true, totalPoolILS: true, isReady: true
    },
    take: 5,
    skip: Math.floor(Math.random() * 100),
  });
  console.log('Random sample:', JSON.stringify(sample, null, 2));

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
