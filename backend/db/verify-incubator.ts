// Quick DoD check: every new model/enum is queryable via Prisma client.
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter: new PrismaNeon(pool) } as any);

async function main() {
  const counts = {
    users:            await prisma.user.count(),
    admins:           await prisma.user.count({ where: { role: 'ADMIN'  } }),
    lawyers:          await prisma.user.count({ where: { role: 'LAWYER' } }),
    lawsuits:         await prisma.lawsuit.count(),
    incubatorCases:   await prisma.incubatorCase.count(),
    caseMembers:      await prisma.caseMember.count(),
    caseEvidence:     await prisma.caseEvidence.count(),
    caseChatMessages: await prisma.caseChatMessage.count(),
    referralEvents:   await prisma.referralEvent.count(),
  };
  console.log('[Verify] Table counts:', counts);

  // Confirm a User with LAWYER role exists + relations are loadable
  const lawyer = await prisma.user.findFirst({
    where: { role: 'LAWYER' },
    include: { assignedCases: true, foundedCases: true },
  });
  console.log('[Verify] Lawyer relations load:', {
    id: lawyer?.id,
    assigned: lawyer?.assignedCases.length,
    founded:  lawyer?.foundedCases.length,
  });

  // Confirm the ivfflat vector index exists
  const indexes = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname::text FROM pg_indexes
      WHERE tablename = 'incubator_cases' AND indexname = 'idx_case_embedding';`
  );
  console.log('[Verify] Vector index:', indexes[0] ?? 'MISSING');

  console.log('[Verify] Done ✅');
}

main()
  .catch(e => { console.error('[Verify] Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
