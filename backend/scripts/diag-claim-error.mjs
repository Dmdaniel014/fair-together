// Diagnose the "Not found" error when opening a submitted claim.
// Prints every UserClaim and verifies its lawsuit exists.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

(async () => {
  const claims = await prisma.userClaim.findMany({
    include: { lawsuit: { select: { id: true, defendantName: true, isReady: true, isActive: true, isSettlement: true, status: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 30,
  });

  console.log(`Total UserClaims (top 30): ${claims.length}`);
  console.log('');
  for (const c of claims) {
    const ok = c.lawsuit ? 'OK' : 'MISSING';
    console.log(`[${ok}] claim=${c.id.slice(-8)} action=${c.action.padEnd(8)} lawsuitId=${c.lawsuitId.slice(-10)} → ${c.lawsuit ? c.lawsuit.defendantName : '<<<NO LAWSUIT FOUND>>>'}`);
    if (c.lawsuit) {
      console.log(`         status=${c.lawsuit.status} isReady=${c.lawsuit.isReady} isActive=${c.lawsuit.isActive} isSettlement=${c.lawsuit.isSettlement}`);
    }
  }

  // Check for orphan UserClaims (lawsuit deleted)
  const orphans = claims.filter(c => !c.lawsuit);
  if (orphans.length > 0) {
    console.log(`\n⚠️  ${orphans.length} ORPHAN UserClaims found — referenced lawsuit no longer exists.`);
  } else {
    console.log('\n✓ All claims point to existing lawsuits.');
  }

  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
