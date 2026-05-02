import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('[Seed] Starting...');
  await prisma.match.deleteMany();
  await prisma.aiInsight.deleteMany();
  await prisma.statusChange.deleteMany();
  await prisma.agentEvent.deleteMany();
  await prisma.lawsuit.deleteMany();
  console.log('[Seed] Cleared existing data');

  const lawsuits = [
    { caseNumber:'ת"צ 51304-11-23', court:'בית משפט מחוזי תל אביב', status:'FILED' as const, defendantName:'שופרסל בע"מ', defendantSlug:'shufersal', plaintiffName:'יעל כהן', filingDate:new Date('2023-11-14'), payoutMinILS:800, payoutMaxILS:2400, totalPoolILS:2400000000, eligibilityCriteria:'כל לקוח ששופרסל שקנה בסניפיה בין ינואר 2019 לדצמבר 2023', claimDeadline:new Date('2025-06-30'), affectedPeriodStart:new Date('2019-01-01'), affectedPeriodEnd:new Date('2023-12-31'), classSizeEstimate:4200000, summary:'שופרסל נחשדת בתיאום מחירים עם 14 ספקים מרכזיים.', confidence:'VERIFIED' as const, confidenceScores:{ payout:0.92, deadline:0.95, eligibility:0.88 }, isActive:true, isReady:true },
    { caseNumber:'ת"צ 22089-07-22', court:'בית משפט מחוזי ירושלים', status:'SETTLEMENT' as const, defendantName:'שטראוס גרופ בע"מ', defendantSlug:'strauss', plaintiffName:'דוד לוי', filingDate:new Date('2022-07-22'), payoutMinILS:150, payoutMaxILS:600, totalPoolILS:340000000, eligibilityCriteria:'צרכנים שרכשו מוצרי עלית בין יולי לספטמבר 2022', claimDeadline:new Date('2025-03-31'), affectedPeriodStart:new Date('2022-07-01'), affectedPeriodEnd:new Date('2022-09-15'), classSizeEstimate:800000, summary:'מוצרי שוקולד עלית נמצאו מזוהמים בסלמונלה.', confidence:'VERIFIED' as const, confidenceScores:{ payout:0.95, deadline:0.91, eligibility:0.93 }, isActive:true, isReady:true },
    { caseNumber:'ת"צ 18344-02-24', court:'בית משפט מחוזי חיפה', status:'FILED' as const, defendantName:'ויקטורי סופרמרקטס בע"מ', defendantSlug:'victory', plaintiffName:'מרים אברהם', filingDate:new Date('2024-02-08'), payoutMinILS:120, payoutMaxILS:480, totalPoolILS:180000000, eligibilityCriteria:'חברי מועדון 365 של ויקטורי', claimDeadline:new Date('2025-08-31'), affectedPeriodStart:new Date('2021-01-01'), affectedPeriodEnd:new Date('2023-12-31'), classSizeEstimate:1100000, summary:'ויקטורי נחשדת בניכוי נקודות ללא הודעה.', confidence:'VERIFIED' as const, confidenceScores:{ payout:0.87, deadline:0.94, eligibility:0.89 }, isActive:true, isReady:true },
    { caseNumber:'ת"צ 63201-05-23', court:'בית משפט מחוזי תל אביב', status:'FILED' as const, defendantName:'תנובה מרכז שיתופי', defendantSlug:'tnuva', plaintiffName:'רחל שמעון', filingDate:new Date('2023-05-17'), payoutMinILS:200, payoutMaxILS:900, totalPoolILS:520000000, eligibilityCriteria:'רוכשי מוצרי חלב דלי שומן של תנובה מינואר 2020 ואילך', claimDeadline:new Date('2025-09-01'), affectedPeriodStart:new Date('2020-01-01'), affectedPeriodEnd:null, classSizeEstimate:3800000, summary:'מוצרי החלב הדלים בשומן של תנובה חרגו מהאחוזים המוצהרים.', confidence:'VERIFIED' as const, confidenceScores:{ payout:0.89, deadline:0.96, eligibility:0.91 }, isActive:true, isReady:true },
    { caseNumber:'ת"צ 12445-01-24', court:'בית משפט מחוזי באר שבע', status:'FILED' as const, defendantName:'אסם השקעות בע"מ', defendantSlug:'osem', plaintiffName:'יוסף מזרחי', filingDate:new Date('2024-01-22'), payoutMinILS:100, payoutMaxILS:400, totalPoolILS:210000000, eligibilityCriteria:'רוכשי מוצרי אסם מינואר 2021 ואילך', claimDeadline:new Date('2025-07-15'), affectedPeriodStart:new Date('2021-01-01'), affectedPeriodEnd:null, classSizeEstimate:2100000, summary:'אסם נחשדת בדיווח חסר על כמות הסוכר במוצריה.', confidence:'PENDING_REVIEW' as const, confidenceScores:{ payout:0.78, deadline:0.82, eligibility:0.74 }, isActive:true, isReady:true, requiresReview:true, reviewNotes:'confidence scores below threshold' },
  ];

  for (const lawsuit of lawsuits) {
    await prisma.lawsuit.create({ data: lawsuit });
  }
  console.log(`[Seed] Inserted ${lawsuits.length} lawsuits`);
  console.log('[Seed] ✅ Done!');
}

main()
  .catch(e => { console.error('[Seed] Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
