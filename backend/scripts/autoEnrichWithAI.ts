// ─────────────────────────────────────────────────────────────────────────────
//  scripts/autoEnrichWithAI.ts
//  AI-powered auto-enrichment for unenriched settlements.
//  Uses Claude to extract payout details from available case data.
//
//  Run: npx tsx scripts/autoEnrichWithAI.ts
//       npx tsx scripts/autoEnrichWithAI.ts --dry-run   (preview only)
//       npx tsx scripts/autoEnrichWithAI.ts --limit 5   (process N only)
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../db/index';

const client = new Anthropic();
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT   = (() => {
  const idx = process.argv.indexOf('--limit');
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) : 999;
})();

const ENRICH_PROMPT = `אתה מומחה לתביעות ייצוגיות בישראל. בהינתן נתוני תביעה גולמיים, חלץ מידע רלוונטי לצרכן.

עליך להחזיר JSON בלבד (ללא markdown) בפורמט הבא:
{
  "estimatedPayout": "טקסט קצר עם הסכום המשוער לצרכן, לדוגמה: '50-200 ₪' או 'שובר 30 ₪' או null אם לא ניתן לחלץ",
  "payoutMethod": "אחד מ: automatic | credit | bank_transfer | check | voucher | mixed | unknown",
  "distributionStatus": "אחד מ: open | distributing | pending_approval | closed | unknown",
  "claimGuideSteps": ["שלב 1 בעברית", "שלב 2 בעברית", "שלב 3 בעברית"],
  "claimGuideHe": "פסקה קצרה בעברית שמסבירה לצרכן מה עליו לעשות",
  "confidence": 0-100
}

כללים חשובים:
- אל תמציא מידע. אם אין מספיק נתונים, החזר null עבור estimatedPayout
- אם יש סכום כולל (totalPool) וגודל קבוצה, חשב פיצוי משוער לאדם
- אם הסטטוס "פשרה אושרה" (SETTLEMENT_APPROVED), סביר שכבר ניתן לתבוע
- אם הסטטוס "פשרה" (SETTLEMENT), ייתכן שעוד בתהליך אישור
- לשלבי המדריך (claimGuideSteps): כתוב 3-5 שלבים פשוטים בעברית מדוברת
- confidence צריך לשקף כמה אתה בטוח בנתונים שחילצת (0 = ניחוש, 100 = ודאי)`;

interface AIEnrichResult {
  estimatedPayout:    string | null;
  payoutMethod:       string;
  distributionStatus: string;
  claimGuideSteps:    string[];
  claimGuideHe:       string;
  confidence:         number;
}

async function enrichWithAI(lawsuit: any): Promise<AIEnrichResult | null> {
  const caseData = [
    `מספר תיק: ${lawsuit.caseNumber}`,
    `נתבע: ${lawsuit.defendantName} (${lawsuit.defendantSlug})`,
    `סטטוס: ${lawsuit.status}`,
    `בית משפט: ${lawsuit.court ?? 'לא ידוע'}`,
    lawsuit.filingDate   ? `תאריך הגשה: ${lawsuit.filingDate.toISOString().split('T')[0]}` : '',
    lawsuit.result       ? `תוצאה: ${lawsuit.result}` : '',
    lawsuit.summary      ? `תקציר: ${lawsuit.summary}` : '',
    lawsuit.eligibilityCriteria ? `קריטריוני זכאות: ${lawsuit.eligibilityCriteria}` : '',
    lawsuit.totalPoolILS ? `סכום כולל: ${lawsuit.totalPoolILS} ₪` : '',
    lawsuit.classSizeEstimate ? `גודל קבוצה משוער: ${lawsuit.classSizeEstimate}` : '',
    lawsuit.claimDeadline ? `מועד אחרון: ${lawsuit.claimDeadline.toISOString().split('T')[0]}` : '',
    lawsuit.rawExtraction ? `טקסט גולמי (חלקי): ${lawsuit.rawExtraction.slice(0, 500)}` : '',
  ].filter(Boolean).join('\n');

  try {
    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system:     ENRICH_PROMPT,
      messages:   [{ role: 'user', content: caseData }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';
    const json = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    const result = JSON.parse(json) as AIEnrichResult;

    // Validate
    result.confidence = Math.max(0, Math.min(100, Math.round(result.confidence ?? 0)));
    if (!result.claimGuideSteps || !Array.isArray(result.claimGuideSteps)) {
      result.claimGuideSteps = [];
    }

    return result;
  } catch (err) {
    console.error(`  [AI] Failed for ${lawsuit.caseNumber}:`, (err as any)?.message ?? err);
    return null;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  AI Auto-Enrichment for Unenriched Settlements');
  console.log(`  Mode: ${DRY_RUN ? '🔍 DRY RUN (no DB writes)' : '✏️ LIVE (will update DB)'}`);
  console.log(`  Limit: ${LIMIT}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Find unenriched settlements
  const unenriched = await prisma.lawsuit.findMany({
    where: {
      isSettlement: true,
      isActive:     true,
      estimatedPayout: null,
    },
    orderBy: { filingDate: 'desc' },
    take: LIMIT,
  });

  console.log(`Found ${unenriched.length} unenriched settlements.\n`);
  if (unenriched.length === 0) {
    console.log('Nothing to do.');
    await prisma.$disconnect();
    return;
  }

  let enriched = 0;
  let skipped  = 0;
  let failed   = 0;

  for (const lawsuit of unenriched) {
    process.stdout.write(`[${enriched + skipped + failed + 1}/${unenriched.length}] ${lawsuit.defendantName} (${lawsuit.caseNumber})... `);

    const result = await enrichWithAI(lawsuit);

    if (!result || !result.estimatedPayout) {
      console.log('⏭ SKIP (no payout extracted)');
      skipped++;
      continue;
    }

    if (result.confidence < 30) {
      console.log(`⏭ SKIP (low confidence: ${result.confidence})`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`🔍 WOULD ENRICH:`);
      console.log(`   Payout: ${result.estimatedPayout}`);
      console.log(`   Method: ${result.payoutMethod}`);
      console.log(`   Status: ${result.distributionStatus}`);
      console.log(`   Steps:  ${result.claimGuideSteps.length}`);
      console.log(`   Confidence: ${result.confidence}`);
      enriched++;
      continue;
    }

    try {
      await prisma.lawsuit.update({
        where: { id: lawsuit.id },
        data: {
          estimatedPayout:    result.estimatedPayout,
          payoutMethod:       result.payoutMethod !== 'unknown' ? result.payoutMethod : null,
          distributionStatus: result.distributionStatus !== 'unknown' ? result.distributionStatus : null,
          claimGuideSteps:    result.claimGuideSteps,
          claimGuideHe:       result.claimGuideHe || null,
          lastUpdatedAt:      new Date(),
          reviewNotes:        `AI-enriched (confidence: ${result.confidence}%) on ${new Date().toISOString().split('T')[0]}`,
        },
      });

      console.log(`✅ ${result.estimatedPayout} (conf: ${result.confidence}%)`);
      enriched++;
    } catch (err) {
      console.log(`❌ DB error: ${(err as any)?.message ?? err}`);
      failed++;
    }

    // Throttle to avoid API rate limits
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  Results: ${enriched} enriched, ${skipped} skipped, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════');

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
