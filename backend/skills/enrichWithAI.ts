// ─────────────────────────────────────────────────────────────────────────────
//  skills/enrichWithAI.ts
//  AI enrichment: transforms raw Hebrew legal data into user-friendly content
//  Uses Claude Haiku for cost efficiency
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../db/index';

const client = new Anthropic();

export interface EnrichmentResult {
  headline:          string; // 1-line hook (Hebrew)
  summaryClean:      string; // 2-3 sentences, plain Hebrew
  eligibilityBullets: string[]; // 3 clear bullet points
  estimatedPayout:   string; // Human-readable like "₪45 - ₪200 לצרכן"
}

const SYSTEM_PROMPT = `אתה יועץ זכויות צרכנים. התפקיד שלך לקחת מידע משפטי גולמי על תביעה ייצוגית ולהפוך אותו לתוכן ידידותי לאפליקציית מובייל.

כללים:
- כתוב בעברית מדוברת, ברורה ומקצועית. לא "שפה משפטית".
- הכותרת (headline) חייבת להיות שאלה שפונה ישירות לצרכן, לדוגמה: "קנית בשופרסל בין 2019-2023? ייתכן שמגיע לך פיצוי"
- הסיכום (summaryClean) צריך להיות 2-3 משפטים פשוטים שמסבירים על מה התביעה.
- קריטריוני הזכאות (eligibilityBullets) — 3 נקודות ברורות של מי זכאי.
- הפיצוי המוערך (estimatedPayout) — סכום מפורמט, לדוגמה: "₪200 - ₪800 לצרכן" או "עד ₪3,000,000 לקבוצה כולה"

ענה אך ורק ב-JSON תקני (ללא markdown):
{"headline":"...","summaryClean":"...","eligibilityBullets":["...","...","..."],"estimatedPayout":"..."}`;

/**
 * Enrich a single lawsuit with AI-generated user-friendly content
 */
export async function enrichOne(lawsuitId: string): Promise<EnrichmentResult | null> {
  const lawsuit = await prisma.lawsuit.findUnique({ where: { id: lawsuitId } });
  if (!lawsuit) return null;

  const input = [
    `שם הנתבע: ${lawsuit.defendantName}`,
    `סטטוס: ${lawsuit.status}`,
    lawsuit.summary ? `נושא/תיאור: ${lawsuit.summary}` : '',
    lawsuit.eligibilityCriteria ? `קבוצת הזכאים: ${lawsuit.eligibilityCriteria}` : '',
    lawsuit.totalPoolILS ? `סכום כולל: ₪${Number(lawsuit.totalPoolILS).toLocaleString()}` : '',
    lawsuit.payoutMinILS ? `סכום אישי: ₪${Number(lawsuit.payoutMinILS).toLocaleString()}` : '',
    lawsuit.filingDate ? `תאריך הגשה: ${lawsuit.filingDate.toISOString().slice(0, 10)}` : '',
    lawsuit.court ? `בית משפט: ${lawsuit.court}` : '',
  ].filter(Boolean).join('\n');

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: input }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const parsed = JSON.parse(text) as EnrichmentResult;

    // Update the lawsuit with enriched content
    await prisma.lawsuit.update({
      where: { id: lawsuitId },
      data: {
        summary:      parsed.summaryClean,
        rawExtraction: JSON.stringify(parsed),
        confidence:    'VERIFIED',
        lastUpdatedAt: new Date(),
      },
    });

    return parsed;
  } catch (err) {
    console.error(`[Enrich] Failed for ${lawsuitId}:`, err);
    return null;
  }
}

/**
 * Enrich a batch of lawsuits
 */
export async function enrichBatch(lawsuitIds: string[]): Promise<{
  enriched: number;
  failed: number;
  errors: string[];
}> {
  let enriched = 0, failed = 0;
  const errors: string[] = [];

  for (const id of lawsuitIds) {
    const result = await enrichOne(id);
    if (result) {
      enriched++;
    } else {
      failed++;
      errors.push(`Failed: ${id}`);
    }
    // Rate limit: 1s between calls
    await new Promise(r => setTimeout(r, 1000));
  }

  return { enriched, failed, errors };
}

/**
 * Find and enrich all isReady cases that haven't been AI-enriched yet.
 * Processes in batches of 10.
 */
export async function enrichAllPending(batchSize = 10, maxTotal = 100): Promise<{
  total:    number;
  enriched: number;
  failed:   number;
  errors:   string[];
}> {
  // Cases that are ready but haven't been AI-enriched (no rawExtraction)
  const pending = await prisma.lawsuit.findMany({
    where: {
      isReady:       true,
      rawExtraction: null,
      confidence:    { not: 'VERIFIED' },
    },
    select: { id: true },
    take:   maxTotal,
    orderBy: { filingDate: 'desc' },
  });

  console.log(`[Enrich] Found ${pending.length} cases to enrich`);
  let totalEnriched = 0, totalFailed = 0;
  const allErrors: string[] = [];

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    console.log(`[Enrich] Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} cases`);

    const result = await enrichBatch(batch.map(p => p.id));
    totalEnriched += result.enriched;
    totalFailed   += result.failed;
    allErrors.push(...result.errors);

    console.log(`[Enrich] Progress: ${totalEnriched} enriched, ${totalFailed} failed`);
  }

  return {
    total:    pending.length,
    enriched: totalEnriched,
    failed:   totalFailed,
    errors:   allErrors,
  };
}
