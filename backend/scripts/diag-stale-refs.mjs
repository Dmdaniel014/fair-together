// Find any record (notification, ai-insight, push-event) that references a
// lawsuit ID that no longer exists. This is the most likely source of a
// "Not found" error when the user taps a notification or follows a link.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

(async () => {
  const lawsuits = await prisma.lawsuit.findMany({ select: { id: true } });
  const validIds = new Set(lawsuits.map(l => l.id));
  console.log(`Total lawsuits in DB: ${validIds.size}`);

  // Check Notifications
  try {
    const notifs = await prisma.notification.findMany({
      take: 200,
      orderBy: { createdAt: 'desc' },
    });
    console.log(`\n[notifications] checking ${notifs.length} recent...`);
    let stale = 0;
    for (const n of notifs) {
      const data = n.data ?? {};
      const lid = data.lawsuitId;
      if (lid && !validIds.has(lid)) {
        stale++;
        console.log(`  STALE: notif=${n.id.slice(-10)} type=${n.type} lawsuitId=${lid} (NOT IN DB)`);
      }
    }
    if (stale === 0) console.log('  ✓ all references valid');
  } catch (e) {
    console.log(`  (no Notification model: ${e.message?.slice(0, 80)})`);
  }

  // Check AiInsight
  try {
    const insights = await prisma.aiInsight.findMany({ take: 200, orderBy: { createdAt: 'desc' } });
    console.log(`\n[aiInsight] checking ${insights.length}...`);
    let stale = 0;
    for (const i of insights) {
      if (!validIds.has(i.lawsuitId)) {
        stale++;
        console.log(`  STALE: insight=${i.id.slice(-10)} lawsuitId=${i.lawsuitId}`);
      }
    }
    if (stale === 0) console.log('  ✓ all references valid');
  } catch (e) {
    console.log(`  (no AiInsight: ${e.message?.slice(0, 80)})`);
  }

  // Check UserMatch
  try {
    const matches = await prisma.userMatch.findMany({ take: 200, orderBy: { createdAt: 'desc' } });
    console.log(`\n[userMatch] checking ${matches.length}...`);
    let stale = 0;
    for (const m of matches) {
      if (!validIds.has(m.lawsuitId)) {
        stale++;
        console.log(`  STALE: match=${m.id.slice(-10)} lawsuitId=${m.lawsuitId}`);
      }
    }
    if (stale === 0) console.log('  ✓ all references valid');
  } catch (e) {
    console.log(`  (no UserMatch: ${e.message?.slice(0, 80)})`);
  }

  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
