// ─────────────────────────────────────────────────────────────────────────────
//  skills/eligibilityAI.ts
//  Sprint 3.2 — Smart Eligibility Engine
//  Claude checks if a user is likely eligible for a lawsuit based on profile + case data.
//  Returns YES/NO/MAYBE with confidence score and Hebrew explanation.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../db/index';

const client = new Anthropic();

export interface EligibilityResult {
  eligible:    'YES' | 'NO' | 'MAYBE';
  confidence:  number;   // 0-100
  explanation: string;   // Hebrew
  followUp?:   string;   // optional follow-up question when MAYBE
}

const ELIGIBILITY_SYSTEM_PROMPT = `אתה יועץ זכויות צרכנים ישראלי. התפקיד שלך לבדוק אם משתמש מסוים זכאי להצטרף לתביעה ייצוגית ספציפית.

אתה מקבל:
1. פרטי התביעה (נתבע, קריטריוני זכאות, תיאור)
2. פרופיל המשתמש (מותגים שהוא קונה, קטגוריות, תדירות קנייה)

עליך להחזיר JSON בלבד (ללא markdown):
{
  "eligible": "YES" | "NO" | "MAYBE",
  "confidence": <מספר 0-100>,
  "explanation": "<הסבר קצר בעברית מדוברת, 1-2 משפטים>",
  "followUp": "<שאלה אחת למשתמש אם eligible=MAYBE, אחרת null>"
}

כללים:
- YES = המשתמש קונה את המותג/קטגוריה הרלוונטית ועומד בקריטריונים
- NO = המשתמש לא קונה את המותג ולא שייך לקבוצה הרלוונטית
- MAYBE = יש חפיפה חלקית, צריך מידע נוסף
- confidence מבוסס על כמה ברורה ההתאמה (100 = בטוח, 50 = חפיפה חלקית, 0 = אין מידע)
- הסבר תמיד בעברית פשוטה ומדוברת
- followUp רק כש-eligible=MAYBE — שאלה ספציפית אחת שיכולה להכריע`;

/**
 * Check if a user is eligible for a specific lawsuit
 */
export async function checkEligibility(
  lawsuitId: string,
  userId?: string,
): Promise<EligibilityResult> {
  const lawsuit = await prisma.lawsuit.findUnique({ where: { id: lawsuitId } });
  if (!lawsuit) throw new Error('Lawsuit not found');

  // Get user profile if available
  let profileData = 'אין פרופיל משתמש — בדוק על סמך קריטריוני הזכאות בלבד';
  if (userId) {
    const profile = await prisma.userProfile.findUnique({ where: { userId } });
    if (profile) {
      profileData = [
        `מותגים שהמשתמש קונה: ${(profile.selectedBrands as string[]).join(', ')}`,
        `קטגוריות: ${(profile.consumerCategoryPrefs as string[]).join(', ')}`,
        `תדירות קנייה: ${profile.shoppingFrequency}`,
        `גודל משק בית: ${profile.householdSize}`,
      ].join('\n');
    }
  }

  const caseData = [
    `נתבע: ${lawsuit.defendantName} (${lawsuit.defendantSlug})`,
    lawsuit.eligibilityCriteria ? `קריטריוני זכאות: ${lawsuit.eligibilityCriteria}` : '',
    lawsuit.summary ? `תיאור: ${lawsuit.summary}` : '',
    lawsuit.status ? `סטטוס: ${lawsuit.status}` : '',
  ].filter(Boolean).join('\n');

  const userMessage = `פרטי התביעה:\n${caseData}\n\nפרופיל המשתמש:\n${profileData}`;

  try {
    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system:     ELIGIBILITY_SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userMessage }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const parsed = JSON.parse(text) as EligibilityResult;

    // Validate and clamp confidence
    parsed.confidence = Math.max(0, Math.min(100, Math.round(parsed.confidence)));
    if (!['YES', 'NO', 'MAYBE'].includes(parsed.eligible)) parsed.eligible = 'MAYBE';

    // Cache result in DB
    if (userId) {
      await cacheEligibility(userId, lawsuitId, parsed);
    }

    return parsed;
  } catch (err) {
    console.error(`[Eligibility] Failed for lawsuit ${lawsuitId}:`, err);

    // Fallback: basic brand matching
    return buildFallbackEligibility(lawsuit, userId);
  }
}

/**
 * Cache AI eligibility result so we don't recompute on every open
 */
async function cacheEligibility(
  userId: string,
  lawsuitId: string,
  result: EligibilityResult,
): Promise<void> {
  try {
    await prisma.aICache.upsert({
      where: { userId_lawsuitId_type: { userId, lawsuitId, type: 'ELIGIBILITY' } },
      create: {
        userId,
        lawsuitId,
        type:      'ELIGIBILITY',
        result:    JSON.stringify(result),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
      update: {
        result:    JSON.stringify(result),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  } catch {
    // Cache is optional — don't fail the request
  }
}

/**
 * Check cache before calling Claude
 */
export async function getCachedEligibility(
  userId: string,
  lawsuitId: string,
): Promise<EligibilityResult | null> {
  try {
    const cached = await prisma.aICache.findUnique({
      where: { userId_lawsuitId_type: { userId, lawsuitId, type: 'ELIGIBILITY' } },
    });
    if (!cached || cached.expiresAt < new Date()) return null;
    return JSON.parse(cached.result) as EligibilityResult;
  } catch {
    return null;
  }
}

/**
 * Re-check eligibility after user answers a follow-up question.
 * Sends the original case data + user profile + the follow-up Q&A to Claude.
 */
export async function recheckEligibilityWithAnswers(
  lawsuitId: string,
  userId: string,
  answers: { question: string; answer: string }[],
): Promise<EligibilityResult> {
  const lawsuit = await prisma.lawsuit.findUnique({ where: { id: lawsuitId } });
  if (!lawsuit) throw new Error('Lawsuit not found');

  let profileData = 'אין פרופיל משתמש';
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  if (profile) {
    profileData = [
      `מותגים שהמשתמש קונה: ${(profile.selectedBrands as string[]).join(', ')}`,
      `קטגוריות: ${(profile.consumerCategoryPrefs as string[]).join(', ')}`,
      `תדירות קנייה: ${profile.shoppingFrequency}`,
      `גודל משק בית: ${profile.householdSize}`,
    ].join('\n');
  }

  const caseData = [
    `נתבע: ${lawsuit.defendantName} (${lawsuit.defendantSlug})`,
    lawsuit.eligibilityCriteria ? `קריטריוני זכאות: ${lawsuit.eligibilityCriteria}` : '',
    lawsuit.summary ? `תיאור: ${lawsuit.summary}` : '',
    lawsuit.status ? `סטטוס: ${lawsuit.status}` : '',
  ].filter(Boolean).join('\n');

  const answersText = answers
    .map(a => `שאלה: ${a.question}\nתשובה: ${a.answer}`)
    .join('\n\n');

  const userMessage = [
    `פרטי התביעה:\n${caseData}`,
    `\nפרופיל המשתמש:\n${profileData}`,
    `\nשאלות המשך ותשובות המשתמש:\n${answersText}`,
    `\nעל סמך התשובות הנ"ל, האם המשתמש זכאי? החזר JSON בלבד.`,
  ].join('\n');

  try {
    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system:     ELIGIBILITY_SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userMessage }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const parsed = JSON.parse(text) as EligibilityResult;

    parsed.confidence = Math.max(0, Math.min(100, Math.round(parsed.confidence)));
    if (!['YES', 'NO', 'MAYBE'].includes(parsed.eligible)) parsed.eligible = 'MAYBE';

    // Cache the updated result (overwrites old MAYBE)
    await cacheEligibility(userId, lawsuitId, parsed);

    return parsed;
  } catch (err) {
    console.error(`[Eligibility] Recheck failed for ${lawsuitId}:`, err);
    return {
      eligible: 'MAYBE',
      confidence: 40,
      explanation: 'לא הצלחנו לעבד את התשובה. נסו שוב מאוחר יותר.',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  4-State Classification Engine
//  Classifies a settlement for a user into exactly one of:
//    NO_ACTION_REQUIRED | ACTION_REQUIRED_WITH_DEADLINE |
//    CLAIM_FORM_REQUIRED | MAYBE_NEED_MORE_INFO
// ─────────────────────────────────────────────────────────────────────────────

export type ClassificationState =
  | 'NO_ACTION_REQUIRED'
  | 'ACTION_REQUIRED_WITH_DEADLINE'
  | 'CLAIM_FORM_REQUIRED'
  | 'MAYBE_NEED_MORE_INFO';

export interface ClassificationResult {
  classification:       ClassificationState;
  confidence:           number;
  reason_hebrew:        string;
  deadline: {
    exists:  boolean;
    date:    string | null;
    type:    'objection' | 'claim' | 'opt_out' | 'document_upload' | 'other' | null;
  };
  user_action: {
    required:    boolean;
    action_type: 'none' | 'open_case' | 'submit_form' | 'upload_docs' |
                 'answer_questions' | 'opt_out' | 'object' | 'wait' | 'other';
  };
  eligibility: {
    likely_eligible: boolean | 'unknown';
    why: string[];
  };
  follow_up_questions:  string[];
  notification_copy_he: string;
}

const CLASSIFICATION_SYSTEM_PROMPT = `You are an Israeli consumer rights advisor. Your task is to classify each lawsuit for a specific user into exactly one of 4 states.

CLASSIFICATION STATES:
1) NO_ACTION_REQUIRED — case is relevant but user doesn't need to act right now; payout is automatic/passive/pending court steps
2) ACTION_REQUIRED_WITH_DEADLINE — user must act before a deadline (object, opt-out, file, verify identity, upload receipt)
3) CLAIM_FORM_REQUIRED — user must submit a claim form or proof-of-eligibility to receive money
4) MAYBE_NEED_MORE_INFO — eligibility cannot be determined confidently from available data

IMPORTANT RULES:
- Do NOT invent legal advice
- Do NOT say "the user is definitely entitled" unless case data clearly supports it
- Prefer conservative classification
- If data is incomplete, return MAYBE_NEED_MORE_INFO
- Optimized for Israeli class actions (חוק תובענות ייצוגיות 2006)
- Israeli settlements may require public notice, objections period, opt-out, or a claim form
- Some cases require only passive eligibility with automatic payout
- Deadlines are critical and must be extracted when present

DECISION LOGIC:
- If likely relevant + deadline → ACTION_REQUIRED_WITH_DEADLINE
- If likely relevant + needs claim form → CLAIM_FORM_REQUIRED
- If relevant + no current user action needed → NO_ACTION_REQUIRED
- If missing user-specific info (purchase date, product model, account) → MAYBE_NEED_MORE_INFO

Return ONLY a JSON object matching this exact schema (no markdown, no explanation):
{
  "classification": "NO_ACTION_REQUIRED | ACTION_REQUIRED_WITH_DEADLINE | CLAIM_FORM_REQUIRED | MAYBE_NEED_MORE_INFO",
  "confidence": 0-100,
  "reason_hebrew": "short plain Hebrew explanation (1-2 sentences)",
  "deadline": {
    "exists": true/false,
    "date": "ISO-8601 or null",
    "type": "objection | claim | opt_out | document_upload | other | null"
  },
  "user_action": {
    "required": true/false,
    "action_type": "none | open_case | submit_form | upload_docs | answer_questions | opt_out | object | wait | other"
  },
  "eligibility": {
    "likely_eligible": true/false/"unknown",
    "why": ["short bullets in Hebrew, max 3"]
  },
  "follow_up_questions": ["question 1 in Hebrew", "question 2 in Hebrew"],
  "notification_copy_he": "1 short emotionally compelling but accurate Hebrew notification (use loss aversion + simplicity + value, never promise money unless confirmed)"
}`;

/**
 * Classify a settlement for a specific user using the 4-state engine
 */
export async function classifySettlement(
  settlementId: string,
  userId?: string,
  followUpAnswers?: { question: string; answer: string }[],
): Promise<ClassificationResult> {

  const lawsuit = await prisma.lawsuit.findUnique({ where: { id: settlementId } });
  if (!lawsuit) throw new Error('Settlement not found');

  // Build user profile context
  let profileContext = 'אין פרופיל משתמש — סווג על סמך נתוני ההסדר בלבד';
  if (userId) {
    const profile = await prisma.userProfile.findUnique({ where: { userId } });
    if (profile) {
      profileContext = [
        profile.displayName     ? `שם: ${profile.displayName}` : '',
        (profile.selectedCategories as string[])?.length
          ? `קטגוריות שנבחרו: ${(profile.selectedCategories as string[]).join(', ')}` : '',
        (profile.selectedBrands as string[])?.length
          ? `מותגים: ${(profile.selectedBrands as string[]).join(', ')}` : '',
        profile.shoppingFrequency ? `תדירות קנייה: ${profile.shoppingFrequency}` : '',
      ].filter(Boolean).join('\n');
    }
  }

  // Build case context
  const deadline = (lawsuit as any).claimDeadline
    ? `מועד אחרון לתביעה: ${(lawsuit as any).claimDeadline.toISOString()}`
    : '';
  const caseContext = [
    `נתבע: ${lawsuit.defendantName}`,
    `קטגוריה: ${(lawsuit as any).category ?? 'לא ידוע'}`,
    `סטטוס: ${lawsuit.status}`,
    `האם הסדר פשרה: ${(lawsuit as any).isSettlement ? 'כן' : 'לא'}`,
    lawsuit.eligibilityCriteria ? `קריטריוני זכאות: ${lawsuit.eligibilityCriteria}` : '',
    lawsuit.summary             ? `תקציר: ${lawsuit.summary}` : '',
    (lawsuit as any).claimFormUrl      ? `קישור טופס: ${(lawsuit as any).claimFormUrl}` : '',
    (lawsuit as any).distributionStatus ? `סטטוס חלוקה: ${(lawsuit as any).distributionStatus}` : '',
    (lawsuit as any).payoutMethod       ? `אופן תשלום: ${(lawsuit as any).payoutMethod}` : '',
    (lawsuit as any).estimatedPayout    ? `פיצוי משוער: ${(lawsuit as any).estimatedPayout}` : '',
    (lawsuit as any).claimGuideHe       ? `מדריך מימוש: ${(lawsuit as any).claimGuideHe}` : '',
    deadline,
  ].filter(Boolean).join('\n');

  const followUpSection = followUpAnswers?.length
    ? `\n\nתשובות המשתמש לשאלות המשך:\n${followUpAnswers.map(a => `ש: ${a.question}\nת: ${a.answer}`).join('\n\n')}`
    : '';

  const userMessage = `נתוני ההסדר:\n${caseContext}\n\nפרופיל משתמש:\n${profileContext}${followUpSection}`;

  // Check cache (skip if follow-up answers provided)
  const cacheType = 'CLASSIFY_V2';
  if (userId && !followUpAnswers) {
    try {
      const cached = await prisma.aICache.findUnique({
        where: { userId_lawsuitId_type: { userId, lawsuitId: settlementId, type: cacheType } },
      });
      if (cached && cached.expiresAt > new Date()) {
        return JSON.parse(cached.result) as ClassificationResult;
      }
    } catch { /* cache miss is fine */ }
  }

  try {
    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system:     CLASSIFICATION_SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userMessage }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';

    // Strip markdown fences if model wraps response
    const json = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    const result = JSON.parse(json) as ClassificationResult;

    // Validate classification
    const validStates: ClassificationState[] = [
      'NO_ACTION_REQUIRED', 'ACTION_REQUIRED_WITH_DEADLINE',
      'CLAIM_FORM_REQUIRED', 'MAYBE_NEED_MORE_INFO',
    ];
    if (!validStates.includes(result.classification)) {
      result.classification = 'MAYBE_NEED_MORE_INFO';
    }
    result.confidence = Math.max(0, Math.min(100, Math.round(result.confidence ?? 50)));
    result.follow_up_questions = (result.follow_up_questions ?? []).slice(0, 2);

    // Cache
    if (userId) {
      try {
        await prisma.aICache.upsert({
          where:  { userId_lawsuitId_type: { userId, lawsuitId: settlementId, type: cacheType } },
          create: { userId, lawsuitId: settlementId, type: cacheType,
            result: JSON.stringify(result), expiresAt: new Date(Date.now() + 7 * 86_400_000) },
          update: { result: JSON.stringify(result), expiresAt: new Date(Date.now() + 7 * 86_400_000) },
        });
      } catch { /* cache failure is non-fatal */ }
    }

    return result;

  } catch (err) {
    console.error('[Classify] Claude failed:', err);
    return buildFallbackClassification(lawsuit);
  }
}

function buildFallbackClassification(lawsuit: any): ClassificationResult {
  const hasDeadline = !!lawsuit.claimDeadline && new Date(lawsuit.claimDeadline) > new Date();
  const hasForm     = !!lawsuit.claimFormUrl;
  const status      = lawsuit.status as string;
  const isApproved  = status === 'SETTLEMENT_APPROVED' || status === 'SETTLEMENT';
  const isRuling    = status === 'RULING';

  // Smart state derivation based on lawsuit status
  let state: ClassificationState;
  let reason: string;
  let actionType: string;
  let actionRequired: boolean;

  if (hasDeadline) {
    state         = 'ACTION_REQUIRED_WITH_DEADLINE';
    reason        = `יש מועד אחרון להגשת תביעה — ${new Date(lawsuit.claimDeadline).toLocaleDateString('he-IL')}`;
    actionType    = hasForm ? 'submit_form' : 'open_case';
    actionRequired = true;
  } else if (hasForm) {
    state         = 'CLAIM_FORM_REQUIRED';
    reason        = 'נדרש מילוי טופס תביעה לקבלת הפיצוי.';
    actionType    = 'submit_form';
    actionRequired = true;
  } else if (isApproved) {
    // Settlement was approved — distribution is typically automatic or already completed
    state         = 'NO_ACTION_REQUIRED';
    reason        = 'הסדר הפשרה אושר. הפיצוי חולק לחברי הקבוצה — בדוק אם קיבלת זיכוי ישיר.';
    actionType    = 'wait';
    actionRequired = false;
  } else if (isRuling) {
    // Court ruling exists — case concluded, usually no user action needed
    state         = 'NO_ACTION_REQUIRED';
    reason        = 'בית המשפט נתן פסיקה בתיק זה. ייתכן שהפיצוי חולק אוטומטית.';
    actionType    = 'wait';
    actionRequired = false;
  } else {
    state         = 'MAYBE_NEED_MORE_INFO';
    reason        = 'התיק בטיפול — לא ניתן לקבוע בוודאות אם נדרשת פעולה כרגע.';
    actionType    = 'wait';
    actionRequired = false;
  }

  return {
    classification: state,
    confidence: isApproved ? 70 : isRuling ? 65 : hasDeadline ? 80 : 45,
    reason_hebrew: reason,
    deadline: {
      exists: hasDeadline,
      date:   hasDeadline ? new Date(lawsuit.claimDeadline).toISOString() : null,
      type:   hasDeadline ? 'claim' : null,
    },
    user_action: {
      required:    actionRequired,
      action_type: actionType as any,
    },
    eligibility: {
      likely_eligible: isApproved || isRuling ? true : 'unknown',
      why: isApproved
        ? ['הסדר הפשרה אושר על ידי בית המשפט', 'הפיצוי מחולק לכל מי שעמד בקריטריונים']
        : isRuling
          ? ['בית המשפט סיים את הדיון בתיק']
          : ['אין מידע מספיק לקביעת זכאות'],
    },
    follow_up_questions: [],
    notification_copy_he: isApproved
      ? `הסדר פשרה אושר עם ${lawsuit.defendantName} — בדוק אם מגיע לך פיצוי!`
      : `תיק פעיל עם ${lawsuit.defendantName} — עקוב אחר עדכונים.`,
  };
}

/**
 * Fallback when Claude is unavailable — simple brand match
 */
async function buildFallbackEligibility(
  lawsuit: any,
  userId?: string,
): Promise<EligibilityResult> {
  if (!userId) {
    return {
      eligible: 'MAYBE',
      confidence: 0,
      explanation: 'לא הצלחנו לבדוק כרגע. נסו שוב מאוחר יותר.',
    };
  }

  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  if (!profile) {
    return {
      eligible: 'MAYBE',
      confidence: 30,
      explanation: 'השלימו את הפרופיל כדי שנוכל לבדוק התאמה.',
      followUp: 'באילו חנויות אתם קונים בדרך כלל?',
    };
  }

  const brands = profile.selectedBrands as string[];
  if (brands.includes(lawsuit.defendantSlug)) {
    return {
      eligible: 'YES',
      confidence: 70,
      explanation: `אתם קונים ב${lawsuit.defendantName}, אז סביר שהתביעה רלוונטית עבורכם.`,
    };
  }

  return {
    eligible: 'MAYBE',
    confidence: 30,
    explanation: `${lawsuit.defendantName} לא ברשימת המותגים שלכם, אבל ייתכן שעדיין זכאים.`,
    followUp: `האם רכשתם מוצרים מ${lawsuit.defendantName} בשנים האחרונות?`,
  };
}
