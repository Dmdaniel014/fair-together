// ─────────────────────────────────────────────────────────────────────────────
//  skills/summaryAI.ts
//  Sprint 3.1 — AI Case Summaries
//  Streams a plain-Hebrew summary of a lawsuit via Claude.
//  Falls back to template data if API is unavailable.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../db/index';

const client = new Anthropic();

// ── Prompt templates ─────────────────────────────────────────────────────────

const SUMMARY_SYSTEM_PROMPT = `אתה יועץ משפטי ישראלי שמסביר תביעות ייצוגיות לאזרחים מן השורה.
הסגנון שלך: ידידותי, ברור, ישיר — כמו שחבר שהוא עורך דין היה מסביר.
אל תשתמש בשפה משפטית. אל תכתוב "להלן" או "בהתאם לאמור".

המבנה של התשובה שלך (ענה בעברית בלבד):

**על מה התביעה?**
[2-3 משפטים שמסבירים בפשטות על מה מתלוננים ומה הנזק שנגרם לצרכנים]

**מי יכול להצטרף?**
[2-3 נקודות קצרות של קריטריוני זכאות]

**כמה אפשר לקבל?**
[סכום מוערך לצרכן בודד, אם ידוע]

**מה הסטטוס עכשיו?**
[משפט אחד על המצב הנוכחי של התביעה]`;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StreamSummaryCallbacks {
  onChunk: (text: string) => void;
  onDone:  (fullText: string) => void;
  onError: (err: Error) => void;
}

// ── Main: stream a summary for a lawsuit ─────────────────────────────────────

export async function streamLawsuitSummary(
  lawsuitId: string,
  callbacks: StreamSummaryCallbacks,
): Promise<void> {
  const lawsuit = await prisma.lawsuit.findUnique({ where: { id: lawsuitId } });
  if (!lawsuit) {
    callbacks.onError(new Error('Lawsuit not found'));
    return;
  }

  // Build the user message with all available case data
  const caseData = [
    `חברה/נתבע: ${lawsuit.defendantName}`,
    lawsuit.summary           ? `תיאור: ${lawsuit.summary}` : '',
    lawsuit.eligibilityCriteria ? `קריטריוני זכאות: ${lawsuit.eligibilityCriteria}` : '',
    lawsuit.status            ? `סטטוס: ${lawsuit.status}` : '',
    lawsuit.court             ? `בית משפט: ${lawsuit.court}` : '',
    lawsuit.filingDate        ? `תאריך הגשה: ${lawsuit.filingDate.toISOString().slice(0, 10)}` : '',
    lawsuit.payoutMinILS      ? `פיצוי מינימלי לצרכן: ₪${Number(lawsuit.payoutMinILS).toLocaleString()}` : '',
    lawsuit.payoutMaxILS      ? `פיצוי מקסימלי לצרכן: ₪${Number(lawsuit.payoutMaxILS).toLocaleString()}` : '',
    lawsuit.totalPoolILS      ? `סכום כולל: ₪${Number(lawsuit.totalPoolILS).toLocaleString()}` : '',
    lawsuit.claimDeadline     ? `מועד אחרון להגשה: ${lawsuit.claimDeadline.toISOString().slice(0, 10)}` : '',
  ].filter(Boolean).join('\n');

  // Try Claude streaming
  try {
    const stream = await client.messages.stream({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system:     SUMMARY_SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: `סכם את התביעה הבאה:\n\n${caseData}` }],
    });

    let fullText = '';

    for await (const chunk of stream) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        const text = chunk.delta.text;
        fullText += text;
        callbacks.onChunk(text);
      }
    }

    callbacks.onDone(fullText);
  } catch (err: any) {
    // Fall back to template data already stored in DB
    const fallback = buildFallbackSummary(lawsuit);
    if (fallback) {
      callbacks.onChunk(fallback);
      callbacks.onDone(fallback);
    } else {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

// ── Fallback: build summary from existing DB fields ──────────────────────────

function buildFallbackSummary(lawsuit: any): string | null {
  // Try rawExtraction first (set by enrichWithAI)
  if (lawsuit.rawExtraction) {
    try {
      const parsed = JSON.parse(lawsuit.rawExtraction) as {
        headline?: string;
        summaryClean?: string;
        eligibilityBullets?: string[];
        estimatedPayout?: string;
      };

      const parts: string[] = [];

      if (parsed.summaryClean) {
        parts.push(`**על מה התביעה?**\n${parsed.summaryClean}`);
      }
      if (parsed.eligibilityBullets?.length) {
        parts.push(`**מי יכול להצטרף?**\n${parsed.eligibilityBullets.map(b => `• ${b}`).join('\n')}`);
      }
      if (parsed.estimatedPayout) {
        parts.push(`**כמה אפשר לקבל?**\n${parsed.estimatedPayout}`);
      }

      if (parts.length > 0) return parts.join('\n\n');
    } catch {
      // fall through
    }
  }

  // Minimal fallback from raw DB fields
  if (lawsuit.summary) {
    return [
      `**על מה התביעה?**\n${lawsuit.summary}`,
      lawsuit.eligibilityCriteria
        ? `**מי יכול להצטרף?**\n${lawsuit.eligibilityCriteria}`
        : '',
      lawsuit.payoutMinILS
        ? `**כמה אפשר לקבל?**\n₪${Number(lawsuit.payoutMinILS).toLocaleString()}–₪${Number(lawsuit.payoutMaxILS ?? lawsuit.payoutMinILS).toLocaleString()}`
        : '',
    ].filter(Boolean).join('\n\n');
  }

  return null;
}
