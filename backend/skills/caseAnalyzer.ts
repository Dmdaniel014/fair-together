// ─────────────────────────────────────────────────────────────────────────────
//  skills/caseAnalyzer.ts
//  Incubator case analyzer — 5-factor scoring by Claude Sonnet.
//  Runs on submit → saves aiAnalysis JSON + powerScore + legalDifficulty on the case.
//  Admin sees scores when reviewing the pending queue; scores never replace human judgment.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../db/index';
import { sanitizePII } from './sanitizePII';

const client = new Anthropic();
const MODEL = 'claude-sonnet-4-6';

// Factor weights — must sum to 100. Reviewed with product:
//  harm proof 25 / plausibility 25 / affected 25 / narrative 15 / form 10
const WEIGHTS = {
  harmProof:          25,
  narrativeDetail:    15,
  legalPlausibility:  25,
  formCompleteness:   10,
  affectedPotential:  25,
} as const;

export interface CaseAnalysis {
  factors: {
    harmProof:         number;  // 0-100
    narrativeDetail:   number;
    legalPlausibility: number;
    formCompleteness:  number;
    affectedPotential: number;
  };
  powerScore:      number;          // 0-100 (weighted)
  legalDifficulty: number;          // 1-10
  recommendation:  'APPROVE' | 'REVISIONS' | 'REJECT';
  summary:         string;          // Hebrew, 1-2 sentences
  strengths:       string[];        // Hebrew bullets
  weaknesses:      string[];        // Hebrew bullets
  flags:           string[];        // machine tags: DUPLICATE_SUSPECTED, STATUTE_OF_LIMITATIONS, etc.
}

const AFFECTED_HE: Record<string, string> = {
  TENS:                  'עשרות',
  HUNDREDS:              'מאות',
  THOUSANDS:             'אלפים',
  TENS_OF_THOUSANDS:     'עשרות אלפים',
  HUNDREDS_OF_THOUSANDS: 'מאות אלפים',
  MILLIONS:              'מיליונים',
};

const CLAIM_TYPE_HE: Record<string, string> = {
  MISREPRESENTATION:  'הטעיה צרכנית',
  OVERCHARGING:       'חיוב יתר',
  DEFECTIVE_PRODUCT:  'מוצר פגום',
  POOR_SERVICE:       'שירות לקוי',
  DISCRIMINATION:     'אפליה',
  PRIVACY_VIOLATION:  'פגיעה בפרטיות',
  OTHER:              'אחר',
};

const SYSTEM_PROMPT = `אתה יועץ משפטי-צרכני בכיר בישראל, מומחה בדיני הגנת הצרכן ובתובענות ייצוגיות. אתה בודק יוזמות תביעה (pre-action) שהוגשו על ידי צרכנים לפני שהן מגיעות לאדמין של הפלטפורמה.

⚠️ חשוב: אלו **יוזמות תביעה / קבוצות דרישה** — לא תובענות ייצוגיות. הן טרם אושרו ע"י בית משפט. אל תשתמש במונח "תובענה ייצוגית".

התפקיד שלך: לנתח את הקייס לפי 5 פקטורים ולתת ציון אובייקטיבי שיעזור לצוות הפלטפורמה להחליט אם לאשר, לבקש שינויים, או לדחות.

5 הפקטורים (כל אחד 0-100):

1. **harmProof** — הוכחת פגיעה: האם היוזם מתאר פגיעה קונקרטית שניתנת לכימות? האם יש ראיות (טקסט/קישור/קובץ) שתומכות? ציון גבוה = פגיעה ברורה ומדידה עם ראיות. ציון נמוך = פגיעה עמומה או ללא תמיכה.

2. **narrativeDetail** — נוסח מפורט: האם התיאור מכיל מי, מתי, איפה, איך, סכומים, תאריכים? ציון גבוה = סיפור עובדתי מפורט עם פרטים ספציפיים. ציון נמוך = כללי, מעורפל, חסר פרטים.

3. **legalPlausibility** — סבירות משפטית: האם בעוולה הנטענת יש עילה משפטית בישראל (חוק הגנת הצרכן, חוק עוולות מסחריות, חוק החוזים, חוק איסור אפליה וכו')? האם הסיפור עקבי? ציון גבוה = עילה ברורה ומבוססת. ציון נמוך = קלוש/לא חוקי/מופרך.

4. **formCompleteness** — שלמות הטופס: האם כל השדות הנדרשים מולאו (חברה נתבעת, סוג עוולה, סכום נזק, תאריך אירוע, הערכת פוטנציאל)? ציון גבוה = כל השדות מלאים ועקביים. ציון נמוך = שדות חיוניים חסרים.

5. **affectedPotential** — פוטנציאל נפגעים: *כמה שיטתית* העוולה, לא כמה המשתמש הצליח לאמוד. ⚠️ חשוב: הרוב המוחלט של משתמשים *לא יודעים* כמה עוד נפגעו — זה כל הרעיון של הפלטפורמה הזו: לאגד נפגעים. אל תעניש על חוסר ידיעה. דרג לפי: (א) האם הפרקטיקה נראית אוטומטית/מובנית בשיטות החברה (תמחור, חוזה, אלגוריתם, מערך שירות)? (ב) האם הנתבע עסק גדול עם בסיס לקוחות רחב? (ג) האם מדובר בעוולה חד-פעמית ויחודית למשתמש הזה בלבד? → ציון גבוה = שיטתי/מובנה מול חברה גדולה (גם אם המשתמש כתב "TENS" או לא ציין). ציון נמוך = סכסוך אישי מובהק.

חישוב powerScore: ממוצע משוקלל (harmProof 25% · narrativeDetail 15% · legalPlausibility 25% · formCompleteness 10% · affectedPotential 25%). החזר את זה כ-number 0-100 עם דיוק של תו אחד אחרי הנקודה.

legalDifficulty: הערכת מורכבות משפטית 1-10 (1=פשוט מאוד, 10=מורכב מאוד). בהתחשב בצורך בראיות נוספות, מומחים, הליכים מקדמיים.

recommendation:
- APPROVE אם powerScore ≥ 65 ואין flags חמורים
- REVISIONS אם 45 ≤ powerScore < 65 או חסרים פרטים שניתן להשלים ע"י ייעוץ
- REJECT שמור רק למקרים קיצוניים: טענה מופרכת, ללא עילה משפטית בכלל, או סכסוך אישי מובהק ללא פוטנציאל שיטתי. ⚠️ חוסר ידע של המשתמש (למשל "לא יודע כמה נפגעו") לעולם אינו עילה ל-REJECT — זה בדיוק התפקיד של הפלטפורמה לחשוף זאת.

flags אפשריים (החזר רק את אלו הרלוונטיים):
- MISSING_EVIDENCE — אין ראיות כלל
- VAGUE_NARRATIVE — תיאור כללי מדי
- WEAK_LEGAL_BASIS — אין עילה משפטית מוצקה
- PERSONAL_DISPUTE — נראה כסכסוך אישי ולא פגיעה רחבה
- STATUTE_OF_LIMITATIONS — חשש להתיישנות (> 7 שנים)
- DAMAGE_ESTIMATE_UNREALISTIC — סכום נזק לא עקבי עם התיאור
- DEFENDANT_UNCLEAR — זהות הנתבע לא ברורה
- INCOMPLETE_FORM — חסרים שדות חיוניים

summary: 1-2 משפטים בעברית מדוברת המסבירים את המסקנה הכללית.
strengths: עד 3 נקודות חוזק קונקרטיות בעברית.
weaknesses: עד 3 נקודות חולשה/שיפור קונקרטיות בעברית.

החזר JSON בלבד (ללא markdown, ללא הסבר נוסף) במבנה:
{
  "factors": {
    "harmProof": <0-100>,
    "narrativeDetail": <0-100>,
    "legalPlausibility": <0-100>,
    "formCompleteness": <0-100>,
    "affectedPotential": <0-100>
  },
  "powerScore": <0-100, decimal>,
  "legalDifficulty": <1-10>,
  "recommendation": "APPROVE" | "REVISIONS" | "REJECT",
  "summary": "<hebrew>",
  "strengths": ["<hebrew>", ...],
  "weaknesses": ["<hebrew>", ...],
  "flags": ["<FLAG_CODE>", ...]
}`;

/**
 * Analyze an IncubatorCase with Claude Sonnet and persist the result.
 * Called on submit. Safe to call repeatedly — overwrites previous analysis.
 */
export async function analyzeIncubatorCase(caseId: string): Promise<CaseAnalysis> {
  const c = await prisma.incubatorCase.findUnique({
    where: { id: caseId },
    include: {
      evidence: { select: { id: true, kind: true, textContent: true, externalUrl: true, description: true } },
      _count:   { select: { members: true, evidence: true } },
    },
  });
  if (!c) throw new Error(`IncubatorCase not found: ${caseId}`);

  // Duplicate-detection signal — raw count of LIVE cases against the same defendant
  const similarLive = await prisma.incubatorCase.count({
    where: { defendantCompany: c.defendantCompany, status: 'LIVE', id: { not: c.id } },
  });

  // Redact PII from every free-text field before handing it to Anthropic.
  const cleanNarrative = sanitizePII(c.narrative).clean;
  const evidenceBlock = c.evidence.length === 0
    ? 'אין ראיות מצורפות.'
    : c.evidence.map((e, i) => {
        const rawBody = e.kind === 'TEXT' ? e.textContent
                      : e.kind === 'URL'  ? e.externalUrl
                      : '[קובץ מצורף]';
        const body = e.kind === 'TEXT' ? sanitizePII(rawBody ?? '').clean : rawBody;
        const descRaw = e.description ?? '';
        const desc = descRaw ? ` — ${sanitizePII(descRaw).clean}` : '';
        return `[${i + 1}] (${e.kind})${desc}\n${body ?? ''}`;
      }).join('\n\n');

  const incidentLine = c.incidentDate
    ? `תאריך אירוע: ${c.incidentDate.toISOString().slice(0, 10)}${c.incidentPeriodEnd ? ` → ${c.incidentPeriodEnd.toISOString().slice(0, 10)}` : ''}`
    : 'תאריך אירוע: לא צוין';

  const userMessage = [
    `כותרת היוזמה: ${c.title}`,
    `חברה נתבעת: ${c.defendantCompany}`,
    `סוג עוולה: ${CLAIM_TYPE_HE[c.legalClaimType] ?? c.legalClaimType}`,
    `סכום נזק משוער אישי: ₪ ${c.damageEstimateNis.toLocaleString('he-IL')}`,
    `פוטנציאל נפגעים (הערכת יוזם): ${c.estimatedAffected ? AFFECTED_HE[c.estimatedAffected] : 'לא צוין'}`,
    incidentLine,
    `יוזמות פעילות אחרות נגד אותה חברה: ${similarLive}`,
    ``,
    `תיאור היוזם:`,
    cleanNarrative,
    ``,
    `ראיות מצורפות (${c.evidence.length}):`,
    evidenceBlock,
    ``,
    `נתח את היוזמה והחזר JSON בלבד.`,
  ].join('\n');

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 1500,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userMessage }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';
  const json = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();

  let parsed: CaseAnalysis;
  try {
    parsed = JSON.parse(json) as CaseAnalysis;
  } catch (err) {
    console.error('[caseAnalyzer] Failed to parse JSON:', text);
    throw new Error('AI analyzer returned malformed JSON');
  }

  // Defensive: recompute powerScore from factors (don't trust model arithmetic)
  const f = parsed.factors;
  const recomputed =
    (f.harmProof         * WEIGHTS.harmProof +
     f.narrativeDetail   * WEIGHTS.narrativeDetail +
     f.legalPlausibility * WEIGHTS.legalPlausibility +
     f.formCompleteness  * WEIGHTS.formCompleteness +
     f.affectedPotential * WEIGHTS.affectedPotential) / 100;
  parsed.powerScore = Math.round(recomputed * 10) / 10;

  // Clamp legalDifficulty to 1-10
  parsed.legalDifficulty = Math.max(1, Math.min(10, Math.round(parsed.legalDifficulty)));

  // Validate recommendation
  if (!['APPROVE', 'REVISIONS', 'REJECT'].includes(parsed.recommendation)) {
    parsed.recommendation = parsed.powerScore >= 65 ? 'APPROVE'
                          : parsed.powerScore >= 45 ? 'REVISIONS' : 'REJECT';
  }

  parsed.strengths  = (parsed.strengths  ?? []).slice(0, 3);
  parsed.weaknesses = (parsed.weaknesses ?? []).slice(0, 3);
  parsed.flags      = Array.isArray(parsed.flags) ? parsed.flags : [];

  // Auto-add DUPLICATE_SUSPECTED flag if model missed it
  if (similarLive > 0 && !parsed.flags.includes('DUPLICATE_SUSPECTED')) {
    parsed.flags.push('DUPLICATE_SUSPECTED');
  }

  await prisma.incubatorCase.update({
    where: { id: caseId },
    data: {
      aiAnalysis:      parsed as any,
      aiAnalyzedAt:    new Date(),
      aiModel:         MODEL,
      powerScore:      parsed.powerScore,
      legalDifficulty: parsed.legalDifficulty,
    },
  });

  return parsed;
}
