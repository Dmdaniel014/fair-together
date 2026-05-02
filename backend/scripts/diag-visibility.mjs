// Audit what's visible on the home screen vs what's in the DB.
// Walks each filter that getActiveSettlements applies, in sequence,
// so we can see exactly where the funnel narrows from 5,948 → N.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const STEPS = [
  { name: 'TOTAL in DB',                      where: {} },
  { name: 'isActive=true',                    where: { isActive: true } },
  { name: '+ isReady=true',                   where: { isActive: true, isReady: true } },
  { name: '+ isSettlement=true',              where: { isActive: true, isReady: true, isSettlement: true } },
  { name: '+ deadline OK (null or future)',   where: {
      isActive: true, isReady: true, isSettlement: true,
      OR: [{ claimDeadline: null }, { claimDeadline: { gte: new Date() } }],
  }},
  { name: '+ status quality gate (final)',    where: {
      isActive: true, isReady: true, isSettlement: true,
      OR: [{ claimDeadline: null }, { claimDeadline: { gte: new Date() } }],
      AND: [{
        OR: [
          { estimatedPayout: { not: null } },
          { status: 'SETTLEMENT_APPROVED', filingDate: { gte: new Date('2021-01-01') } },
          { status: 'SETTLEMENT',          filingDate: { gte: new Date('2023-01-01') } },
        ],
      }],
  }},
];

(async () => {
  console.log('━━━ Settlements visibility funnel ━━━\n');
  for (const s of STEPS) {
    const c = await prisma.lawsuit.count({ where: s.where });
    console.log(`  ${c.toString().padStart(5)}  ${s.name}`);
  }

  // Diagnostic dimensions
  console.log('\n━━━ Why are most rows filtered out? ━━━\n');

  const isActiveCount    = await prisma.lawsuit.count({ where: { isActive: true } });
  const isReadyCount     = await prisma.lawsuit.count({ where: { isReady: true } });
  const isSettlementCnt  = await prisma.lawsuit.count({ where: { isSettlement: true } });
  const hasCategory      = await prisma.lawsuit.count({ where: { category: { not: null } } });
  const hasEstPayout     = await prisma.lawsuit.count({ where: { estimatedPayout: { not: null } } });
  const total            = await prisma.lawsuit.count();

  function bar(n, total) {
    const pct = (n / total * 100).toFixed(1);
    return `${n.toString().padStart(5)} / ${total} (${pct.padStart(5)}%)`;
  }

  console.log(`  isActive=true       : ${bar(isActiveCount, total)}`);
  console.log(`  isReady=true        : ${bar(isReadyCount, total)}`);
  console.log(`  isSettlement=true   : ${bar(isSettlementCnt, total)}     ← this is the killer`);
  console.log(`  category set        : ${bar(hasCategory, total)}`);
  console.log(`  estimatedPayout set : ${bar(hasEstPayout, total)}`);

  // Status distribution
  console.log('\n━━━ Status distribution ━━━\n');
  const statuses = await prisma.lawsuit.groupBy({
    by:      ['status'],
    _count:  { _all: true },
    orderBy: { _count: { status: 'desc' } },
  });
  for (const s of statuses) {
    console.log(`  ${s._count._all.toString().padStart(5)}  ${s.status}`);
  }

  // Category distribution among ready
  console.log('\n━━━ Category distribution (isReady=true) ━━━\n');
  const cats = await prisma.lawsuit.groupBy({
    by:      ['category'],
    where:   { isReady: true },
    _count:  { _all: true },
    orderBy: { _count: { category: 'desc' } },
  });
  for (const c of cats) {
    console.log(`  ${c._count._all.toString().padStart(5)}  ${c.category ?? '(NULL)'}`);
  }

  // What WOULD appear if we relaxed isSettlement requirement?
  const relaxed = await prisma.lawsuit.count({
    where: {
      isActive: true, isReady: true,
      OR: [{ claimDeadline: null }, { claimDeadline: { gte: new Date() } }],
      status: { in: ['SETTLEMENT', 'SETTLEMENT_APPROVED', 'RULING', 'CERTIFIED', 'DISCOVERY'] },
      filingDate: { gte: new Date('2021-01-01') },
    },
  });
  console.log(`\n━━━ "Relaxed" filter (drop isSettlement requirement, status in actionable, filed since 2021) ━━━`);
  console.log(`  Would expose: ${relaxed} lawsuits`);

  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
