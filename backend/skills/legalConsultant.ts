// ─────────────────────────────────────────────────────────────────────────────
//  skills/legalConsultant.ts
//  Legal Consultation chat — two modes:
//    STRENGTHEN  — grounded in a specific IncubatorCase, goal = help the user
//                  strengthen the narrative/evidence so a re-submit scores higher
//    GENERAL     — free-form chat on Israeli consumer-rights / legal topics
//
//  Product direction (from founder):
//    - The platform's whole purpose is to aggregate victims who don't yet know
//      how widespread the wrong is. *Never* discourage a user because they
//      don't know how many people were affected — help them articulate the
//      *systematic* nature of the wrong instead.
//    - Stage 2 (real lawyer opinion) is a future escalation point. For now
//      we only run stage 1 (AI) and mark stage-2-ready threads via status.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../db/index';
import type { CaseAnalysis } from './caseAnalyzer';
import { sanitizePII } from './sanitizePII';

const client = new Anthropic();

// Haiku is fast + cheap for back-and-forth chat and keeps cache warm.
// Sonnet is reserved for the one-shot analyzer where depth matters more than cost.
const MODEL = 'claude-haiku-4-5-20251001';

const AFFECTED_HE: Record<string, string> = {
  TENS: 'עשרות', HUNDREDS: 'מאות', THOUSANDS: 'אלפים',
  TENS_OF_THOUSANDS: 'עשרות אלפים',
  HUNDREDS_OF_THOUSANDS: 'מאות אלפים', MILLIONS: 'מיליונים',
};

const CLAIM_TYPE_HE: Record<string, string> = {
  MISREPRESENTATION: 'הטעיה צרכנית', OVERCHARGING: 'חיוב יתר',
  DEFECTIVE_PRODUCT: 'מוצר פגום',     POOR_SERVICE: 'שירות לקוי',
  DISCRIMINATION: 'אפליה',            PRIVACY_VIOLATION: 'פגיעה בפרטיות',
  OTHER: 'אחר',
};

const BASE_PROMPT = `אתה יועץ משפטי-צרכני בישראל, מומחה בדיני הגנת הצרכן, חוק עוולות מסחריות, חוק החוזים, חוק איסור הפליה ודיני תובענות. אתה מדבר עברית רהוטה, מובנת, בגובה העיניים, ללא ז'רגון מיותר.

⚠️ מונחים: אנחנו פועלים בפלטפורמת "יוזמות תביעה / קבוצות דרישה" (pre-action). אל תשתמש במונח "תובענה ייצוגית" — זה לא שלב זה בתהליך.

עקרונות יסוד:
1. **גישה חיובית ומעצימה** — רוב המשתמשים *לא יודעים* אם עוד נפגעו. זה בדיוק מה שהפלטפורמה קיימת כדי לחשוף. לעולם אל תסתייג ממקרה רק כי המשתמש לא יודע את היקף הפגיעה — עזור לו להראות שהעוולה *שיטתית* (בנויה במערך החברה, התמחור, החוזה, האלגוריתם, השירות).
2. **דיוק משפטי** — כשיש עילה מוכרת בישראל, תן לה שם (חוק הגנת הצרכן §, חוק עוולות מסחריות §, חוק החוזים §39 תום לב, וכו'). אל תמציא סעיפים שאתה לא בטוח בהם — במקום לנחש, אמור "כדאי לבדוק את הסעיף בחוק הגנת הצרכן שעוסק בהטעיה".
3. **פרקטי, לא מטופל** — שאל שאלות קונקרטיות (מתי? כמה שילמת? יש לך קבלה? SMS? תמונת מסך?). בקש ראיות ספציפיות. הצע ניסוח משופר.
4. **זהירות** — אל תתחייב לתוצאה משפטית. השתמש בניסוחים כמו "יש סיכוי טוב ש-", "עשוי להוות עילה", "כדאי לברר עם עו"ד בטרם הגשה".`;

const STRENGTHEN_SUFFIX = `
**מצב: STRENGTHEN** — המשתמש הגיש יוזמת תביעה שקיבלה ציון נמוך מהמנתח (AI). התפקיד שלך: לעזור לו לחזק את הטענה כדי שבהגשה חוזרת הציון יעלה.

יעדי העבודה:
- לכסות את ה-weaknesses שהמנתח זיהה (תראה אותם בהקשר למטה)
- להוציא מהמשתמש פרטים עובדתיים שחסרים (מי/מתי/איפה/איך/סכומים/תאריכים)
- להנחות ליקוט ראיות ספציפיות (קבלות, SMS, תקנון, פרסומות, צילום מסך)
- לעזור לזהות עילה משפטית מוצקה ולקשר אותה לסעיף בחוק הישראלי
- להראות מדוע העוולה *שיטתית* — גם כשהמשתמש לא יודע כמה אחרים נפגעו

תמיד התייחס לקייס הספציפי שבהקשר. אל תיתן הדרכה גנרית כש-יש פרטים קונקרטיים לעבוד איתם.
בסוף תשובה משמעותית, כשאתה רואה שהמשתמש סיפק פרטים חדשים, הצע משפט קצר: "רוצה שארכז את השינויים לטקסט מעודכן שתוכל להחליף בטופס?" — כדי שהוא ידע שיש לו כפתור כזה.`;

const GENERAL_SUFFIX = `
**מצב: GENERAL** — זו שיחה חופשית על נושאים משפטיים-צרכניים.

- ענה על שאלות משפטיות כלליות (חוקי הגנת הצרכן, זכויות אזרח, עילות מוכרות, הליכי תביעה, התיישנות וכו').
- כשהמשתמש מתאר מקרה קונקרטי שנראה כמו עוולה רחבה, הצע: "אם אתה חושב שעוד אנשים נפגעו, אתה יכול לפתוח יוזמת תביעה בפלטפורמה — הטופס מחכה בתפריט 'יוזמות תביעה'."
- אל תמציא מידע משפטי. אם לא בטוח — אמור את זה.`;

export type ThreadMode = 'STRENGTHEN' | 'GENERAL';

interface ThreadContext {
  mode: ThreadMode;
  caseId: string | null;
}

/**
 * Post a user message to a legal thread and get back the assistant reply.
 * Persists both the user message (role=USER) and the assistant reply (role=ASSISTANT).
 * Updates the thread's updatedAt for proper sorting.
 */
export async function sendLegalMessage(
  threadId:    string,
  userContent: string,
): Promise<{ assistant: string; model: string }> {
  const thread = await prisma.legalThread.findUnique({
    where:   { id: threadId },
    include: {
      case: {
        select: {
          id: true, title: true, defendantCompany: true, legalClaimType: true,
          damageEstimateNis: true, estimatedAffected: true, narrative: true,
          incidentDate: true, powerScore: true, legalDifficulty: true,
          aiAnalysis: true,
          evidence: { select: { kind: true, textContent: true, externalUrl: true, description: true } },
        },
      },
    },
  });
  if (!thread) throw new Error(`LegalThread not found: ${threadId}`);

  // Redact PII (Israeli ID, credit card, IBAN, phone, email) before anything else
  // touches the content: DB row, chat history, Anthropic API.
  const { clean: sanitized, hits } = sanitizePII(userContent);
  if (hits.length > 0) {
    console.log(`[legal] redacted PII from user message: ${hits.join(',')}`);
  }

  // Persist user message first so history always includes it, even on failure.
  await prisma.legalMessage.create({
    data: { threadId, role: 'USER', content: sanitized },
  });

  const history = await prisma.legalMessage.findMany({
    where:   { threadId },
    orderBy: { createdAt: 'asc' },
    select:  { role: true, content: true },
  });

  const systemPrompt = buildSystemPrompt({ mode: thread.mode, caseId: thread.caseId }, thread.case);

  const messages = history
    .filter(m => m.role !== 'SYSTEM')
    .map(m => ({
      role:    m.role === 'USER' ? 'user' as const : 'assistant' as const,
      content: m.content,
    }));

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 1200,
    system:     systemPrompt,
    messages,
  });

  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
  if (!text) throw new Error('AI returned empty response');

  await prisma.legalMessage.create({
    data: { threadId, role: 'ASSISTANT', content: text, model: MODEL },
  });
  await prisma.legalThread.update({
    where: { id: threadId },
    data:  { updatedAt: new Date() },
  });

  return { assistant: text, model: MODEL };
}

function buildSystemPrompt(ctx: ThreadContext, c: any | null): string {
  if (ctx.mode === 'GENERAL') {
    return BASE_PROMPT + '\n\n' + GENERAL_SUFFIX;
  }
  // STRENGTHEN — case is required, but be defensive if deleted.
  if (!c) {
    return BASE_PROMPT + '\n\n' + STRENGTHEN_SUFFIX + '\n\n(שים לב: ההקשר של הקייס לא זמין כרגע — בקש מהמשתמש לתאר מחדש.)';
  }
  const ai = c.aiAnalysis as CaseAnalysis | null;

  const evidenceLine = (c.evidence?.length ?? 0) === 0
    ? 'אין ראיות מצורפות.'
    : c.evidence.map((e: any, i: number) => {
        const body = e.kind === 'TEXT' ? e.textContent : e.kind === 'URL' ? e.externalUrl : '[קובץ]';
        return `[${i + 1}] (${e.kind})${e.description ? ' — ' + e.description : ''}: ${body ?? ''}`;
      }).join('\n');

  const aiBlock = ai ? [
    `ציון נוכחי: powerScore=${ai.powerScore} / legalDifficulty=${ai.legalDifficulty} / ${ai.recommendation}`,
    `סיכום המנתח: ${ai.summary}`,
    ai.strengths?.length  ? `חוזקות:\n- ${ai.strengths.join('\n- ')}`  : '',
    ai.weaknesses?.length ? `חולשות לחיזוק:\n- ${ai.weaknesses.join('\n- ')}` : '',
    ai.flags?.length      ? `דגלי מנתח: ${ai.flags.join(', ')}` : '',
  ].filter(Boolean).join('\n') : 'הקייס טרם נותח.';

  const caseBlock = [
    `כותרת: ${c.title}`,
    `חברה נתבעת: ${c.defendantCompany}`,
    `סוג עוולה: ${CLAIM_TYPE_HE[c.legalClaimType] ?? c.legalClaimType}`,
    `נזק אישי משוער: ₪ ${Number(c.damageEstimateNis).toLocaleString('he-IL')}`,
    `פוטנציאל נפגעים (הערכת יוזם): ${c.estimatedAffected ? AFFECTED_HE[c.estimatedAffected] : 'לא צוין'}`,
    c.incidentDate ? `תאריך אירוע: ${new Date(c.incidentDate).toISOString().slice(0, 10)}` : 'תאריך אירוע: לא צוין',
    ``,
    `תיאור היוזם:`,
    c.narrative,
    ``,
    `ראיות:`,
    evidenceLine,
    ``,
    `ניתוח AI קיים:`,
    aiBlock,
  ].join('\n');

  return `${BASE_PROMPT}\n\n${STRENGTHEN_SUFFIX}\n\n=== הקשר הקייס ===\n${caseBlock}\n=== סוף הקשר ===`;
}

/**
 * Generate a short thread title (3–6 words) based on the user's first message.
 * Used only for GENERAL threads; STRENGTHEN threads take their title from the case.
 */
export async function suggestThreadTitle(firstMessage: string): Promise<string> {
  try {
    const resp = await client.messages.create({
      model:      MODEL,
      max_tokens: 60,
      system:     'תן כותרת קצרה בעברית (3–6 מילים, ללא סימני פיסוק, ללא גרשיים) לשיחה המשפטית הבאה. החזר רק את הכותרת.',
      messages:   [{ role: 'user', content: firstMessage.slice(0, 500) }],
    });
    const t = resp.content[0].type === 'text' ? resp.content[0].text.trim() : '';
    return t.replace(/["'״׳]/g, '').slice(0, 80) || 'שיחה משפטית';
  } catch {
    return 'שיחה משפטית';
  }
}
