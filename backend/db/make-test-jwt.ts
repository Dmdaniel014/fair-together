// One-off helper: print a JWT for a seeded user so curl can hit /api/admin/*.
// Usage:  npx tsx db/make-test-jwt.ts +972500000001
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;
const prisma = new PrismaClient({
  adapter: new PrismaNeon(new Pool({ connectionString: process.env.DATABASE_URL! })),
} as any);

async function main() {
  const phone = process.argv[2];
  if (!phone) { console.error('phone arg required'); process.exit(1); }
  const u = await prisma.user.findUnique({ where: { phone }, select: { id: true, role: true } });
  if (!u) { console.error('user not found'); process.exit(1); }
  const secret = process.env.JWT_SECRET ?? 'dev-only-jwt-secret-DO-NOT-USE-IN-PRODUCTION';
  const token = jwt.sign({ userId: u.id }, secret, { expiresIn: '1d' });
  console.log(JSON.stringify({ userId: u.id, role: u.role, token }));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
