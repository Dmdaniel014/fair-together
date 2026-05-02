// ─────────────────────────────────────────────────────────────────────────────
//  skills/notificationAI.ts
//  Sprint 3.4 — Smart Push Notifications
//  Claude generates personalized Hebrew notification text per user+case.
//  Falls back to template when AI unavailable.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../db/index';

const client = new Anthropic();

export interface NotificationCopy {
  title: string;  // max 50 chars
  body:  string;  // max 150 chars
}

const NOTIFICATION_SYSTEM_PROMPT = `אתה כותב הודעות push לאפליקציה ישראלית לזכויות צרכנים.

כללים:
- title: עד 50 תווים. ישיר, אישי, עם שם המותג. לדוגמה: "חדשות על התביעה נגד שופרסל"
- body: עד 150 תווים. מה השתנה + מה צריך לעשות. לדוגמה: "אושרה פשרה — אפשר להגיש בקשת פיצוי עד 30.6"
- כתוב בעברית מדוברת, לא רשמית
- תמיד תעורר פעולה (כנס, בדוק, הצטרף)
- אל תשתמש בסימני קריאה מיותרים

ענה אך ורק ב-JSON: {"title":"...","body":"..."}`;

/**
 * Generate personalized notification copy using Claude
 */
export async function generateNotificationCopy(
  lawsuitId: string,
  userId:    string,
  trigger:   'NEW_CASE' | 'STATUS_CHANGE' | 'DEADLINE_APPROACHING',
): Promise<NotificationCopy> {
  const lawsuit = await prisma.lawsuit.findUnique({ where: { id: lawsuitId } });
  if (!lawsuit) return fallbackCopy('unknown', trigger);

  const profile = await prisma.userProfile.findUnique({ where: { userId } });

  const context = [
    `אירוע: ${triggerLabel(trigger)}`,
    `נתבע: ${lawsuit.defendantName}`,
    lawsuit.status ? `סטטוס: ${lawsuit.status}` : '',
    lawsuit.summary ? `נושא: ${lawsuit.summary.slice(0, 100)}` : '',
    lawsuit.claimDeadline ? `מועד אחרון: ${lawsuit.claimDeadline.toISOString().slice(0, 10)}` : '',
    profile ? `מותגים שהמשתמש קונה: ${(profile.selectedBrands as string[]).join(', ')}` : '',
  ].filter(Boolean).join('\n');

  try {
    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system:     NOTIFICATION_SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: context }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const parsed = JSON.parse(text) as NotificationCopy;

    // Enforce length limits
    return {
      title: parsed.title.slice(0, 50),
      body:  parsed.body.slice(0, 150),
    };
  } catch (err) {
    console.error('[NotificationAI] Failed:', err);
    return fallbackCopy(lawsuit.defendantName, trigger);
  }
}

function triggerLabel(trigger: string): string {
  switch (trigger) {
    case 'NEW_CASE':            return 'תביעה חדשה שרלוונטית למשתמש';
    case 'STATUS_CHANGE':       return 'שינוי סטטוס בתביעה';
    case 'DEADLINE_APPROACHING': return 'המועד האחרון מתקרב';
    default:                    return trigger;
  }
}

function fallbackCopy(defendantName: string, trigger: string): NotificationCopy {
  switch (trigger) {
    case 'NEW_CASE':
      return {
        title: `תביעה חדשה נגד ${defendantName}`,
        body:  'ייתכן שמגיע לך פיצוי — כנס לבדוק',
      };
    case 'STATUS_CHANGE':
      return {
        title: `עדכון בתביעה נגד ${defendantName}`,
        body:  'חל שינוי בסטטוס התביעה — כנס לפרטים',
      };
    case 'DEADLINE_APPROACHING':
      return {
        title: `מועד אחרון מתקרב!`,
        body:  `התביעה נגד ${defendantName} — אל תפספס את המועד`,
      };
    default:
      return {
        title: `עדכון מ-Fair Together`,
        body:  'יש חדשות על תביעה שרלוונטית לך',
      };
  }
}
