// Probe both endpoints (settlements/:id and lawsuits/:id) for every UserClaim
// to find which exact id is failing.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const BASE = process.env.PROBE_BASE ?? 'http://localhost:3001';

(async () => {
  const claims = await prisma.userClaim.findMany({
    include: { lawsuit: { select: { id: true, defendantName: true, isSettlement: true, isReady: true, isActive: true } } },
    orderBy: { updatedAt: 'desc' },
  });

  for (const c of claims) {
    const id = c.lawsuitId;
    const r1 = await fetch(`${BASE}/api/settlements/${id}`).then(r => ({ status: r.status, body: r.ok ? '<<ok>>' : (r.text ? r.text() : '') }));
    const body1 = typeof r1.body === 'object' ? await r1.body : r1.body;
    const r2 = await fetch(`${BASE}/api/lawsuits/${id}`).then(r => ({ status: r.status, body: r.ok ? '<<ok>>' : (r.text ? r.text() : '') }));
    const body2 = typeof r2.body === 'object' ? await r2.body : r2.body;

    console.log(`lawsuit=${id} (${c.lawsuit?.defendantName ?? '?'}, isSettlement=${c.lawsuit?.isSettlement}, isReady=${c.lawsuit?.isReady}, isActive=${c.lawsuit?.isActive})`);
    console.log(`  /api/settlements/${id} → ${r1.status} ${body1}`);
    console.log(`  /api/lawsuits/${id}    → ${r2.status} ${body2}`);
    console.log('');
  }

  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
