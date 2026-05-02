// ─────────────────────────────────────────────────────────────────────────────
//  db/setup-vector.ts
//  Two-phase pgvector setup (cross-platform, no psql needed).
//
//    Phase 1 (before `prisma db push`): enable the vector extension.
//    Phase 2 (after  `prisma db push`): create the ivfflat index.
//
//  Run:
//    npx tsx db/setup-vector.ts extension   # phase 1
//    npx tsx db/setup-vector.ts index       # phase 2
//    npx tsx db/setup-vector.ts all         # runs both (idempotent, skips
//                                             index if the table doesn't exist)
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaNeon(pool);
const prisma = new PrismaClient({ adapter } as any);

async function enableExtension() {
  console.log('[Vector] Enabling pgvector extension...');
  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector;');
  const ext = await prisma.$queryRawUnsafe<{ extname: string; extversion: string }[]>(
    `SELECT extname::text AS extname, extversion::text AS extversion
       FROM pg_extension WHERE extname = 'vector';`
  );
  console.log('[Vector] pgvector:', ext[0] ?? 'NOT INSTALLED');
}

async function tableExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists;`,
    name
  );
  return rows[0]?.exists === true;
}

async function createIndex() {
  if (!(await tableExists('incubator_cases'))) {
    console.warn('[Vector] Skipping index — table "incubator_cases" does not exist. Run `prisma db push` first.');
    return;
  }
  console.log('[Vector] Creating ivfflat index on incubator_cases.narrativeEmbedding...');
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_case_embedding
      ON incubator_cases
      USING ivfflat ("narrativeEmbedding" vector_cosine_ops)
      WITH (lists = 100);
  `);
  console.log('[Vector] Index ready ✅');
}

async function main() {
  const phase = (process.argv[2] ?? 'all').toLowerCase();
  if (phase === 'extension' || phase === 'all') await enableExtension();
  if (phase === 'index'     || phase === 'all') await createIndex();
  console.log('[Vector] Done.');
}

main()
  .catch(e => { console.error('[Vector] Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
