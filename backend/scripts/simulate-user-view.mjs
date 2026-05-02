// Simulate the user experience after the fix:
// 1. Profile lets user pick categories (telecom/banks/retail/insurance/food/tech/transport/health)
// 2. Home screen calls /api/settlements?categories=<list>
// 3. We mirror getActiveSettlements with the NEW (relaxed) filter
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const ALL_CATS = ['telecom', 'banks', 'retail', 'insurance', 'food', 'tech', 'transport', 'health', 'other'];

async function activeSettlementsMatching(categories) {
  const now = new Date();
  return prisma.lawsuit.findMany({
    where: {
      isReady:  true,
      isActive: true,
      ...(categories?.length ? { category: { in: categories } } : {}),
      AND: [
        {
          OR: [
            { isSettlement: true },
            { status: { in: ['SETTLEMENT_APPROVED', 'SETTLEMENT', 'RULING'] } },
          ],
        },
        {
          OR: [
            { claimDeadline: null },
            { claimDeadline: { gte: now } },
          ],
        },
      ],
    },
    select: {
      defendantName: true, defendantSlug: true, status: true,
      category: true, claimDeadline: true, filingDate: true,
      isSettlement: true, estimatedPayout: true,
    },
    orderBy: [
      { estimatedPayout: { sort: 'desc', nulls: 'last' } },
      { claimDeadline:   { sort: 'asc',  nulls: 'last' } },
      { filingDate:      'desc' },
    ],
  });
}

(async () => {
  console.log('━━━ Simulation: user picks ALL categories ━━━\n');
  const all = await activeSettlementsMatching(ALL_CATS);
  console.log(`Total visible to user: ${all.length}\n`);

  // Breakdown by category
  const byCat = new Map();
  for (const l of all) byCat.set(l.category, (byCat.get(l.category) ?? 0) + 1);
  console.log('Breakdown by category:');
  for (const [cat, n] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(4)}  ${cat}`);
  }

  // Sample from each category
  console.log('\n━━━ Sample (first 3 per category) ━━━\n');
  for (const cat of ALL_CATS) {
    const sample = all.filter(l => l.category === cat).slice(0, 3);
    if (sample.length === 0) continue;
    console.log(`[${cat}]`);
    for (const s of sample) {
      const dl = s.claimDeadline ? s.claimDeadline.toISOString().slice(0, 10) : 'open';
      console.log(`   · ${s.defendantName.slice(0, 50).padEnd(50)} | ${s.status.padEnd(20)} | deadline=${dl}`);
    }
    console.log('');
  }

  // What would each individual category give?
  console.log('━━━ Simulation: user picks ONE category at a time ━━━\n');
  for (const cat of ALL_CATS) {
    const r = await activeSettlementsMatching([cat]);
    console.log(`  [${cat.padEnd(10)}] visible: ${r.length}`);
  }

  // SAMSUNG spotlight
  console.log('\n━━━ Samsung spotlight ━━━');
  const samsung = await prisma.lawsuit.findMany({
    where: {
      OR: [
        { defendantName: { contains: 'סמסונג' } },
        { defendantName: { contains: 'samsung', mode: 'insensitive' } },
      ],
    },
    select: { defendantName: true, status: true, category: true, isSettlement: true, isReady: true, claimDeadline: true },
  });
  console.log(`  Samsung in DB: ${samsung.length}`);
  samsung.slice(0, 10).forEach(s => {
    const dl = s.claimDeadline ? s.claimDeadline.toISOString().slice(0, 10) : 'open';
    console.log(`   · ${s.defendantName.slice(0, 50).padEnd(50)} | ${s.status.padEnd(20)} | cat=${s.category} | settlement=${s.isSettlement} | ready=${s.isReady} | dl=${dl}`);
  });
  const samsungVisible = samsung.filter(s => s.isReady && s.category && (s.isSettlement || ['SETTLEMENT_APPROVED','SETTLEMENT','RULING'].includes(s.status)));
  console.log(`  Samsung VISIBLE on home: ${samsungVisible.length}`);

  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
