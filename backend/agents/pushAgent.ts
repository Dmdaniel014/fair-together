// ─────────────────────────────────────────────────────────────────────────────
//  agents/pushAgent.ts
//  Agent 5: Push — matches lawsuits to users, sends notifications, learns
//
//  Responsibilities:
//  1. Runs computeMatches() for all affected users when a new lawsuit is ready
//  2. Updates match scores and history in DB
//  3. Auto-generates AI insight for high-score matches (score >= HIGH_MATCH_SCORE)
//  4. Sends push notifications via Expo Push API
//  5. Self-learning: adjusts match weights based on user behavior signals
// ─────────────────────────────────────────────────────────────────────────────

import {
  AgentRun, UserMatchRecord, PushPayload,
  MIN_MATCH_SCORE, HIGH_MATCH_SCORE, DataConfidence
} from '../types';
import { db } from '../db';
import { generateNotificationCopy } from '../skills/notificationAI';

// ═════════════════════════════════════════════════════════════════════════════
//  PUSH AGENT
// ═════════════════════════════════════════════════════════════════════════════

export async function runPushAgent(event: {
  caseNumber:    string;
  lawsuitId:     string;
  pendingReview?: boolean;
  statusChange?: boolean;
}): Promise<AgentRun> {

  const run: AgentRun = {
    id:          `push_${Date.now()}`,
    agent:       'push',
    triggeredBy: 'EVENT',
    startedAt:   new Date().toISOString(),
    status:      'RUNNING',
    stats:       {
      users_evaluated: 0,
      matches_created: 0,
      matches_updated: 0,
      notifications_sent: 0,
      ai_insights_generated: 0,
      notifications_skipped: 0,
    },
    errors:  [],
    retryCount: 0,
  };

  try {
    const lawsuit = await db.getLawsuitById(event.lawsuitId);
    if (!lawsuit) throw new Error(`Lawsuit not found: ${event.lawsuitId}`);

    // Get all active users with their profiles and learned weights
    const users = await db.getAllActiveUsersWithProfiles();
    run.stats.users_evaluated = users.length;

    const pushBatch: PushPayload[] = [];

    for (const user of users) {
      if (!user.profile) continue; // skip users without profile

      // ── 1. Compute match score ────────────────────────────────────────────
      const matchResult = computeMatchForUser(user as UserWithProfile, lawsuit);
      if (matchResult.relevanceScore === 0) continue;

      // ── 2. Apply learned weights for this user ────────────────────────────
      const learnedScore = applyLearnedWeights(matchResult.matchConfidence, user.learnedWeights as any);

      // ── 3. Persist match record ───────────────────────────────────────────
      const existing = await db.getMatchRecord(user.id, event.lawsuitId);
      if (existing) {
        await db.updateMatchRecord(user.id, event.lawsuitId, {
          relevanceScore:  matchResult.relevanceScore,
          matchConfidence: learnedScore,
          matchReasons:    matchResult.matchReasons,
        });
        run.stats.matches_updated++;
      } else {
        await db.createMatchRecord({
          userId:          user.id,
          lawsuitId:       event.lawsuitId,
          relevanceScore:  matchResult.relevanceScore,
          matchConfidence: learnedScore,
          matchReasons:    matchResult.matchReasons,
          notified:        false,
        });
        run.stats.matches_created++;
      }

      // Only send notification for scores above threshold and new matches
      if (learnedScore < MIN_MATCH_SCORE) {
        run.stats.notifications_skipped++;
        continue;
      }
      if (existing?.notified) {
        run.stats.notifications_skipped++;
        continue;
      }

      // Respect notification preferences
      const notifPref = (user.profile as any)?.notificationPref ?? 'ALL';
      if (notifPref === 'NONE') {
        run.stats.notifications_skipped++;
        continue;
      }
      if (notifPref === 'ACTIONABLE' && !['SETTLEMENT', 'SETTLEMENT_APPROVED'].includes(lawsuit.status)) {
        run.stats.notifications_skipped++;
        continue;
      }
      if (notifPref === 'WEEKLY_DIGEST') {
        // Digest users don't get real-time push — handled separately
        run.stats.notifications_skipped++;
        continue;
      }

      // ── 4. Auto-generate AI insight for high-score matches ────────────────
      if (learnedScore >= HIGH_MATCH_SCORE) {
        try {
          const insight = await generateAIInsight(lawsuit, user as any, matchResult.matchReasons);
          await db.saveAIInsight(user.id, event.lawsuitId, insight);
          run.stats.ai_insights_generated++;
        } catch (err) {
          // Non-fatal — insight is a bonus, not required
          run.errors.push({ code: 'INSIGHT_FAILED', message: String(err), context: { userId: user.id }, at: new Date().toISOString() });
        }
      }

      // ── 5. Queue push notification (AI-generated copy) ────────────────────
      if (user.expoPushToken) {
        const trigger = event.statusChange ? 'STATUS_CHANGE' : 'NEW_CASE';
        const payload = await buildPushPayloadWithAI(
          user as any, lawsuit, learnedScore, trigger as any, event.pendingReview
        );
        pushBatch.push(payload);
        await db.markMatchNotified(user.id, event.lawsuitId);
        run.stats.notifications_sent++;
      }
    }

    // ── 6. Send all notifications in one batch ────────────────────────────
    if (pushBatch.length > 0) {
      await sendExpoPushBatch(pushBatch);
    }

    run.status     = run.errors.length === 0 ? 'SUCCESS' : 'PARTIAL';
    run.finishedAt = new Date().toISOString();
    console.log(`[PushAgent] Lawsuit ${event.lawsuitId}: ${run.stats.notifications_sent} sent, ${run.stats.ai_insights_generated} insights, ${run.stats.notifications_skipped} skipped`);

  } catch (err) {
    run.status     = 'FAILED';
    run.finishedAt = new Date().toISOString();
    run.errors.push({ code: 'AGENT_CRASH', message: String(err), context: {}, at: new Date().toISOString() });
    console.error('[PushAgent] FAILED:', err);
  }

  await db.saveAgentRun(run);
  return run;
}

// ── Match computation ─────────────────────────────────────────────────────────

function computeMatchForUser(
  user: UserWithProfile,
  lawsuit: any
): { relevanceScore: number; matchConfidence: number; matchReasons: string[] } {

  let score = 0;
  const reasons: string[] = [];
  const brandSet = new Set(user.profile?.selectedBrands ?? []);
  const catSet   = new Set(user.profile?.consumerCategoryPrefs ?? []);

  // Direct brand match — highest weight
  const matchedBrands = (lawsuit.defendants ?? [lawsuit.defendantSlug]).filter((d: string) => brandSet.has(d));
  if (matchedBrands.length > 0) {
    score += 45 * Math.min(matchedBrands.length, 2);
    reasons.push(`אתה משתמש ב-${matchedBrands.join(' ו-')} — נתבעת בתיק`);
  }

  // Category match
  const matchedCats = (lawsuit.affectedProductCategories ?? []).filter((c: string) => catSet.has(c));
  if (matchedCats.length > 0) {
    score += 15 * Math.min(matchedCats.length, 3);
    reasons.push(`התיק משפיע על: ${matchedCats.join(', ')}`);
  }

  if (score === 0) return { relevanceScore: 0, matchConfidence: 0, matchReasons: [] };

  // Status bonuses
  if (['CERTIFIED', 'SETTLEMENT', 'SETTLEMENT_APPROVED'].includes(lawsuit.status)) {
    score += 10;
    reasons.push('התביעה אושרה — ניתן להגיש');
  }

  // Deadline urgency
  if (lawsuit.claimDeadline) {
    const daysLeft = Math.floor((new Date(lawsuit.claimDeadline).getTime() - Date.now()) / 86_400_000);
    if (daysLeft > 0 && daysLeft <= 30) {
      score += 12;
      reasons.push(`נותרו ${daysLeft} ימים להגשה`);
    } else if (daysLeft > 0 && daysLeft <= 60) {
      score += 6;
    }
  }

  // Shopping frequency multiplier
  const freqMult: Record<string, number> = {
    DAILY: 1.0, SEVERAL_TIMES_WEEK: 0.9, WEEKLY: 0.75, BI_WEEKLY: 0.6, MONTHLY: 0.4,
  };
  const mult = freqMult[user.profile?.shoppingFrequency ?? 'WEEKLY'] ?? 0.75;

  const relevanceScore  = Math.min(score, 99);
  const matchConfidence = Math.round(Math.min(relevanceScore * mult, 99));

  return { relevanceScore, matchConfidence, matchReasons: reasons };
}

// ── Self-learning: adjust scores based on user behavior ──────────────────────
// When a user consistently joins cases with X brand match → boost brand match weight
// When a user dismisses cases from Y category → reduce category weight for that user

function applyLearnedWeights(
  baseScore:     number,
  learnedWeights?: UserLearnedWeights
): number {
  if (!learnedWeights) return baseScore;

  // Apply a small multiplier based on historical engagement rate
  // engagementRate: 0 = never joined anything, 1 = joined everything shown
  const engagementBoost = 1 + (learnedWeights.engagementRate - 0.5) * 0.2;
  return Math.round(Math.min(baseScore * engagementBoost, 99));
}

// ── AI Insight generation ─────────────────────────────────────────────────────
// Auto-generates plain Hebrew explanation for high-match cases

async function generateAIInsight(
  lawsuit:      any,
  user:         UserWithProfile,
  matchReasons: string[]
): Promise<string> {

  const prompt = `
אתה עוזר משפטי לצרכנים ישראלים. כתוב הסבר קצר ופשוט (3 משפטים) על התביעה הייצוגית הבאה,
מותאם אישית למשתמש זה. אל תשתמש בשפה משפטית. כתוב בגוף שני (אתה/את).

פרטי התביעה:
- שם: ${lawsuit.caseTitleHe ?? lawsuit.caseNumber}
- נתבעת: ${lawsuit.defendantName}
- סיכום: ${lawsuit.summary ?? 'לא זמין'}
- זכאות: ${lawsuit.eligibilityCriteria ?? 'לא זמין'}
- פיצוי: ${lawsuit.payoutMinILS ? `₪${lawsuit.payoutMinILS}–₪${lawsuit.payoutMaxILS}` : 'בבדיקה'}

מדוע המשתמש הזה תואם:
${matchReasons.join('\n')}

כתוב 3 משפטים בלבד בעברית פשוטה. המשפט השלישי יתחיל ב"פעולה:".
`.trim();

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
  const data: any = await response.json();
  return data.content?.map((b: any) => b.text ?? '').join('') ?? '';
}

// ── Push notification builder ─────────────────────────────────────────────────

async function buildPushPayloadWithAI(
  user:          UserWithProfile,
  lawsuit:       any,
  matchScore:    number,
  trigger:       'NEW_CASE' | 'STATUS_CHANGE' | 'DEADLINE_APPROACHING',
  pendingReview?: boolean,
): Promise<PushPayload> {
  // Try AI-generated copy, fall back to template
  let title: string;
  let body: string;

  try {
    const copy = await generateNotificationCopy(lawsuit.id, user.id, trigger);
    title = copy.title;
    body  = copy.body;
  } catch {
    // Fallback to simple template
    title = `${lawsuit.defendantName} — ייתכן שמגיע לך פיצוי`;
    body  = `ציון התאמה: ${matchScore}%. כנס לפרטים`;
  }

  return {
    userId:        user.id,
    expoPushToken: user.expoPushToken!,
    title,
    body,
    data: {
      lawsuitId:  lawsuit.id,
      screen:     'LAWSUIT_DETAIL',  // deep-link target
      matchScore,
    },
  };
}

// ── Expo Push API ─────────────────────────────────────────────────────────────

async function sendExpoPushBatch(payloads: PushPayload[]): Promise<void> {
  // Expo accepts up to 100 messages per batch
  const BATCH_SIZE = 100;
  for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
    const batch = payloads.slice(i, i + BATCH_SIZE).map(p => ({
      to:    p.expoPushToken,
      title: p.title,
      body:  p.body,
      data:  p.data,
      sound: 'default',
      badge: 1,
    }));

    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(batch),
    });

    if (!res.ok) console.error('[PushAgent] Expo batch failed:', await res.text());
  }
}

// ── Self-learning: record user feedback signal ────────────────────────────────
// Called from the API when user takes an action (join, dismiss, view insight)

export async function recordUserFeedback(options: {
  userId:    string;
  lawsuitId: string;
  action:    UserMatchRecord['userAction'];
}): Promise<void> {
  const { userId, lawsuitId, action } = options;

  await db.updateMatchUserAction(userId, lawsuitId, action!);

  // Update learned weights for this user
  const profile = await db.getUserProfile(userId);
  const history = await db.getUserMatchHistory(userId, { limit: 50 });

  const joined   = history.filter(m => m.userAction === 'JOINED').length;
  const dismissed = history.filter(m => m.userAction === 'DISMISSED').length;
  const total    = joined + dismissed;

  if (total < 5) return; // not enough data yet to learn

  const engagementRate = joined / total;

  // Identify which brands the user tends to act on
  const joinedLawsuits = await db.getLawsuitsByIds(
    history.filter(m => m.userAction === 'JOINED').map(m => m.lawsuitId)
  );
  const brandEngagement: Record<string, number> = {};
  for (const l of joinedLawsuits) {
    const slug = l.defendantSlug;
    brandEngagement[slug] = (brandEngagement[slug] ?? 0) + 1;
  }

  await db.updateLearnedWeights(userId, {
    engagementRate,
    brandEngagement,
    lastUpdatedAt: new Date().toISOString(),
  });

  console.log(`[SelfLearning] User ${userId}: engagement ${Math.round(engagementRate * 100)}%, top brand: ${Object.entries(brandEngagement).sort((a,b) => b[1]-a[1])[0]?.[0]}`);
}

// ── Types (local to this agent) ───────────────────────────────────────────────

interface UserLearnedWeights {
  engagementRate:  number;           // 0–1
  brandEngagement: Record<string, number>;
  lastUpdatedAt:   string | Date;
}

interface UserWithProfile {
  id:              string;
  expoPushToken?:  string | null;
  profile:         {
    selectedBrands:        string[];
    consumerCategoryPrefs: string[];
    shoppingFrequency:     string;
    householdSize:         number;
  } | null;
  learnedWeights?: UserLearnedWeights | null;
}
