// ─────────────────────────────────────────────────────────────────────────────
//  agents/deadlineNotifier.ts — Phase 1: Simple deadline reminder agent
//  Sends push notifications for upcoming settlement deadlines
//  Triggered by cron: daily check for deadlines within 30/7/1 days
// ─────────────────────────────────────────────────────────────────────────────

import { db, prisma, withDbRetry } from '../db/index';

interface DeadlineAlert {
  userId: string;
  expoPushToken: string;
  lawsuitId: string;
  defendantName: string;
  daysLeft: number;
}

/** Check for settlements with upcoming deadlines and notify relevant users */
export async function checkDeadlines(): Promise<{ checked: number; notified: number }> {
  const alerts: DeadlineAlert[] = [];

  // Get settlements with deadlines in the next 30 days
  const upcoming = await withDbRetry(() => db.getSettlementsWithUpcomingDeadlines(30));

  if (upcoming.length === 0) {
    return { checked: 0, notified: 0 };
  }

  // Get all users with push tokens and their saved/joined settlements
  const users = await withDbRetry(() => prisma.user.findMany({
    where: { isActive: true, expoPushToken: { not: null } },
    include: {
      profile: true,
      claims: {
        where: { action: { in: ['JOINED', 'SAVED'] } },
        select: { lawsuitId: true },
      },
    },
  }));

  const now = Date.now();

  for (const settlement of upcoming) {
    if (!settlement.claimDeadline) continue;

    const daysLeft = Math.ceil(
      (settlement.claimDeadline.getTime() - now) / (1000 * 60 * 60 * 24)
    );

    // Only notify at specific intervals: 30, 7, 3, 1, 0 days
    if (![30, 7, 3, 1, 0].includes(daysLeft)) continue;

    for (const user of users) {
      if (!user.expoPushToken) continue;

      // Check if user is tracking this settlement
      const isTracking = user.claims.some(c => c.lawsuitId === settlement.id);

      // Also check if the settlement's category matches user's selected categories
      const userCats = user.profile?.selectedCategories ?? [];
      const matchesCategory = settlement.category
        ? userCats.includes(settlement.category)
        : false;

      if (isTracking || matchesCategory) {
        alerts.push({
          userId: user.id,
          expoPushToken: user.expoPushToken,
          lawsuitId: settlement.id,
          defendantName: settlement.defendantName,
          daysLeft,
        });
      }
    }
  }

  // Send notifications
  let notified = 0;
  for (const alert of alerts) {
    try {
      await sendDeadlineNotification(alert);
      notified++;
    } catch (err) {
      console.error(`[DeadlineNotifier] Failed to notify ${alert.userId}:`, err);
    }
  }

  return { checked: upcoming.length, notified };
}

async function sendDeadlineNotification(alert: DeadlineAlert) {
  const { expoPushToken, defendantName, daysLeft, lawsuitId, userId } = alert;

  let title: string;
  let body: string;

  if (daysLeft === 0) {
    title = 'יום אחרון למימוש!';
    body = `היום הוא המועד האחרון למימוש הפיצוי מ-${defendantName}. אל תפספס!`;
  } else if (daysLeft === 1) {
    title = 'מחר נגמר הזמן!';
    body = `נשאר יום אחד למימוש הפיצוי מ-${defendantName}`;
  } else if (daysLeft <= 7) {
    title = `${daysLeft} ימים אחרונים למימוש`;
    body = `הזדרז לממש את הפיצוי מ-${defendantName} לפני שהדדליין עובר`;
  } else {
    title = `תזכורת: ${daysLeft} יום למימוש`;
    body = `יש לך עוד ${daysLeft} ימים למימוש הפיצוי מ-${defendantName}`;
  }

  // Send via Expo Push
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: expoPushToken,
      title,
      body,
      data: {
        lawsuitId,
        screen: 'SETTLEMENT_DETAIL',
      },
      sound: daysLeft <= 1 ? 'default' : undefined,
      priority: daysLeft <= 3 ? 'high' : 'normal',
    }),
  });

  if (!response.ok) {
    throw new Error(`Push failed: ${response.status}`);
  }

  // Record the alert
  await withDbRetry(() => prisma.userAlert.create({
    data: {
      userId,
      type: 'DEADLINE_REMINDER',
      title,
      body,
    },
  }));
}
