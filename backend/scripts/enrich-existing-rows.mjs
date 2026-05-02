// Run the two enrichment jobs against the post-backfill state:
//   1. autoDetectSettlements — flips isSettlement=true for status SETTLEMENT/SETTLEMENT_APPROVED
//   2. assignCategories — fills NULL category from BRAND_TO_CATEGORY map (uses 'other' fallback)
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Inline copy of BRAND_TO_CATEGORY (so this script doesn't need TS compilation)
// — must match backend/types.ts. Keep in sync.
const CATEGORY_FALLBACK = 'other';
const BRAND_TO_CATEGORY = {
  // Telecom
  partner: 'telecom', cellcom: 'telecom', pelephone: 'telecom',
  hot: 'telecom', bezeq: 'telecom', yes: 'telecom', golan: 'telecom',
  // Banks
  hapoalim: 'banks', leumi: 'banks', isracard: 'banks', 'leumi-card': 'banks',
  discount: 'banks', mizrahi: 'banks', fibi: 'banks', cal: 'banks', max: 'banks',
  yahav: 'banks', 'jerusalem-bank': 'banks', igud: 'banks', 'otzar-hahayal': 'banks', masad: 'banks',
  // Insurance
  phoenix: 'insurance', migdal: 'insurance', harel: 'insurance',
  clal: 'insurance', menora: 'insurance', ayalon: 'insurance', shirbit: 'insurance',
  'bituach-yashir': 'insurance', hachshara: 'insurance', aig: 'insurance',
  // Retail
  shufersal: 'retail', ramilevi: 'retail', victory: 'retail', mega: 'retail',
  yohananoff: 'retail', osheraad: 'retail', tivtaam: 'retail',
  superpharm: 'retail', fox: 'retail', castro: 'retail', hando: 'retail', golf: 'retail',
  ikea: 'retail', zara: 'retail', hm: 'retail', nike: 'retail', adidas: 'retail',
  mango: 'retail', decathlon: 'retail', renuar: 'retail', 'american-eagle': 'retail',
  terminalx: 'retail', maxstock: 'retail', derbi: 'retail', 'office-depot': 'retail',
  ksp: 'retail', bug: 'retail', zap: 'retail',
  diplomat: 'retail', schestowitz: 'retail', nordiya: 'retail',
  shufra: 'retail', loreal: 'retail', procter: 'retail', kimberly: 'retail',
  henkel: 'retail', sano: 'retail', reckitt: 'retail',
  big: 'retail', azrieli: 'retail', electra: 'retail',
  'yeinot-bitan': 'retail', 'hatzi-hinam': 'retail',
  // Food
  tnuva: 'food', strauss: 'food', elite: 'food', osem: 'food',
  nestle: 'food', unilever: 'food', prigat: 'food', noga: 'food',
  mcdonalds: 'food', burgerking: 'food', kfc: 'food', dominos: 'food',
  pizzahut: 'food', aroma: 'food', cofix: 'food', greg: 'food',
  landwer: 'food', erez: 'food', wissotzky: 'food',
  // Tech
  apple: 'tech', google: 'tech', meta: 'tech', amazon: 'tech', wolt: 'tech',
  samsung: 'tech', lg: 'tech', sony: 'tech', xiaomi: 'tech', huawei: 'tech',
  microsoft: 'tech', netflix: 'tech', spotify: 'tech', paypal: 'tech',
  ebay: 'tech', expedia: 'tech', booking: 'tech', airbnb: 'tech',
  wix: 'tech', monday: 'tech', fiverr: 'tech', aliexpress: 'tech',
  iherb: 'tech', groupon: 'tech', disney: 'tech',
  // Health
  clalit: 'health', maccabi: 'health',
  meuhedet: 'health', 'leumit-health': 'health',
  teva: 'health', neopharm: 'health',
  // Transport
  elal: 'transport', gett: 'transport', yango: 'transport',
  toyota: 'transport', hyundai: 'transport', mazda: 'transport',
  nissan: 'transport', honda: 'transport', kia: 'transport',
  mitsubishi: 'transport', suzuki: 'transport', volkswagen: 'transport',
  skoda: 'transport', seat: 'transport', bmw: 'transport',
  mercedes: 'transport', audi: 'transport',
  'union-motors': 'transport', carasso: 'transport',
  'delek-motors': 'transport', colmobil: 'transport',
  'meir-cars': 'transport', lubinski: 'transport', telcar: 'transport',
  egged: 'transport', 'dan-bus': 'transport', metropolin: 'transport',
  'israel-railways': 'transport', 'nativ-express': 'transport',
  kavim: 'transport', afikim: 'transport',
  delek: 'transport', paz: 'transport', sonol: 'transport', doralon: 'transport',
  'ten-fuel': 'transport', 'alon-fuel': 'transport', gazit: 'transport',
  // Other
  iec: 'other', mekorot: 'other', iriya: 'other', reshet: 'other',
  toto: 'other', 'mifal-hapayis': 'other', medina: 'other', 'israel-post': 'other',
  general: 'other',
};

(async () => {
  console.log('━━━ 1. autoDetectSettlements ━━━');
  const a = await prisma.lawsuit.updateMany({
    where: {
      status: { in: ['SETTLEMENT_APPROVED', 'SETTLEMENT'] },
      isSettlement: false,
      isActive: true,
    },
    data: { isSettlement: true },
  });
  console.log(`  flipped ${a.count} lawsuits to isSettlement=true\n`);

  console.log('━━━ 2. assignCategories ━━━');
  const nulls = await prisma.lawsuit.findMany({
    where: { category: null },
    select: { id: true, defendantSlug: true },
  });
  console.log(`  ${nulls.length} rows have category=NULL — assigning...`);

  let updated = 0;
  let othered = 0;
  for (const l of nulls) {
    let cat = BRAND_TO_CATEGORY[l.defendantSlug];
    if (!cat) {
      // x-prefixed (uncurated) defaults to 'other'
      cat = CATEGORY_FALLBACK;
      othered++;
    }
    await prisma.lawsuit.update({
      where: { id: l.id },
      data:  { category: cat },
    });
    updated++;
    if (updated % 500 === 0) console.log(`  ...${updated} done`);
  }
  console.log(`  total updated: ${updated} (of which ${othered} → 'other')\n`);

  // Final sanity counts
  console.log('━━━ AFTER ━━━');
  const isSet = await prisma.lawsuit.count({ where: { isSettlement: true } });
  const ready = await prisma.lawsuit.count({ where: { isReady: true } });
  const cats  = await prisma.lawsuit.count({ where: { category: { not: null } } });
  console.log(`  isSettlement=true: ${isSet}`);
  console.log(`  isReady=true:      ${ready}`);
  console.log(`  category set:      ${cats}`);

  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
