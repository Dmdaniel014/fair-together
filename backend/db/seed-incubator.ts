// ─────────────────────────────────────────────────────────────────────────────
//  db/seed-incubator.ts
//  Minimal bootstrap seed for Incubator feature — 1 admin, 1 lawyer, 2 users.
//
//  Idempotent: upserts by phone. Safe to re-run.
//
//  Run:  npx tsx db/seed-incubator.ts
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaNeon(pool);
const prisma = new PrismaClient({ adapter } as any);

const SEED_USERS = [
  { phone: '+972500000001', email: 'admin@fairtogether.local',  role: 'ADMIN'  as const, displayName: 'Admin — פאנל ניהול' },
  { phone: '+972500000002', email: 'lawyer@fairtogether.local', role: 'LAWYER' as const, displayName: 'עו"ד ראשי' },
  { phone: '+972500000003', email: null,                         role: 'USER'   as const, displayName: 'משתמש 1' },
  { phone: '+972500000004', email: null,                         role: 'USER'   as const, displayName: 'משתמש 2' },
];

async function main() {
  console.log('[Seed/Incubator] Starting...');

  for (const u of SEED_USERS) {
    const user = await prisma.user.upsert({
      where: { phone: u.phone },
      update: { role: u.role, email: u.email ?? undefined },
      create: { phone: u.phone, email: u.email ?? undefined, role: u.role },
    });

    await prisma.userProfile.upsert({
      where: { userId: user.id },
      update: { displayName: u.displayName },
      create: {
        userId: user.id,
        displayName: u.displayName,
        selectedCategories: [],
        onboardingComplete: true,
      },
    });

    console.log(`[Seed/Incubator]   ${u.role.padEnd(7)} ${u.phone}  ${user.id}`);
  }

  // ── Sample Incubator cases so admin has something to approve ──────────────
  const [u1, u2] = await Promise.all([
    prisma.user.findUnique({ where: { phone: '+972500000003' } }),
    prisma.user.findUnique({ where: { phone: '+972500000004' } }),
  ]);
  if (!u1 || !u2) throw new Error('Seed users missing — re-run seed first');

  type SampleCase = {
    id:                string;   // stable ids so seed stays idempotent
    title:             string;
    defendantCompany:  string;
    legalClaimType:    'MISREPRESENTATION' | 'OVERCHARGING' | 'DEFECTIVE_PRODUCT' | 'POOR_SERVICE' | 'DISCRIMINATION' | 'PRIVACY_VIOLATION' | 'OTHER';
    damageEstimateNis: number;
    narrative:         string;
    founderUserId:     string;
    status:            'DRAFT' | 'PENDING_REVIEW';
  };

  const samples: SampleCase[] = [
    {
      id: 'seed_case_pending_1',
      title: 'חיוב כפול על שירות חבילות אינטרנט',
      defendantCompany: 'פרטנר תקשורת',
      legalClaimType: 'OVERCHARGING',
      damageEstimateNis: 450,
      narrative: 'עשרות לקוחות דיווחו על חיוב כפול עבור שדרוג חבילה שלא בוצע בפועל, במשך חודשים ללא התראה.',
      founderUserId: u1.id,
      status: 'PENDING_REVIEW',
    },
    {
      id: 'seed_case_pending_2',
      title: 'תנאי שירות מטעים — ביטול אוטומטי של מנוי',
      defendantCompany: 'סלקום',
      legalClaimType: 'MISREPRESENTATION',
      damageEstimateNis: 1200,
      narrative: 'לקוחות חויבו שנה שלמה לאחר שביקשו לבטל מנוי, כי המערכת לא זיהתה את הבקשה בטלפונית כ"ביטול" אלא כ"פנייה".',
      founderUserId: u2.id,
      status: 'PENDING_REVIEW',
    },
    {
      id: 'seed_case_draft_1',
      title: 'עמלות נסתרות בכרטיס אשראי',
      defendantCompany: 'בנק הפועלים',
      legalClaimType: 'OVERCHARGING',
      damageEstimateNis: 300,
      narrative: 'עמלה קבועה שלא נרשמת בהסכם הופיעה בחשבון 3 חודשים ברציפות.',
      founderUserId: u1.id,
      status: 'DRAFT',
    },
  ];

  for (const c of samples) {
    await prisma.incubatorCase.upsert({
      where:  { id: c.id },
      update: { status: c.status, title: c.title, narrative: c.narrative },
      create: c,
    });
    console.log(`[Seed/Incubator]   ${c.status.padEnd(14)} ${c.id}  ${c.defendantCompany}`);
  }

  const counts = {
    users:       await prisma.user.count(),
    admins:      await prisma.user.count({ where: { role: 'ADMIN'  } }),
    lawyers:     await prisma.user.count({ where: { role: 'LAWYER' } }),
    cases:       await prisma.incubatorCase.count(),
    pending:     await prisma.incubatorCase.count({ where: { status: 'PENDING_REVIEW' } }),
    drafts:      await prisma.incubatorCase.count({ where: { status: 'DRAFT' } }),
  };
  console.log('[Seed/Incubator] Done:', counts);
}

main()
  .catch(e => { console.error('[Seed/Incubator] Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
