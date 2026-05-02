// ─────────────────────────────────────────────────────────────────────────────
//  scripts/extract-deadlines.ts
//  Attempts to extract claim deadlines from eligibility text and other fields.
//  Looks for Hebrew date patterns, "מועד אחרון", "עד ליום", etc.
//  Run: npx tsx scripts/extract-deadlines.ts
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../db/index.js';

const HEBREW_MONTHS: Record<string, number> = {
  'ינואר': 1, 'פברואר': 2, 'מרץ': 3, 'מרס': 3, 'אפריל': 4,
  'מאי': 5, 'יוני': 6, 'יולי': 7, 'אוגוסט': 8,
  'ספטמבר': 9, 'אוקטובר': 10, 'נובמבר': 11, 'דצמבר': 12,
};

function extractDatesFromText(text: string): Date[] {
  const dates: Date[] = [];

  // Pattern 1: DD/MM/YYYY or DD.MM.YYYY
  const slashDates = text.matchAll(/(\d{1,2})[./](\d{1,2})[./](\d{4})/g);
  for (const m of slashDates) {
    const d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2015) dates.push(d);
  }

  // Pattern 2: DD בMonth YYYY (Hebrew month names)
  const hebrewDateRe = /(\d{1,2})\s+ב?(ינואר|פברואר|מרץ|מרס|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)\s+(\d{4})/g;
  const hebrewDates = text.matchAll(hebrewDateRe);
  for (const m of hebrewDates) {
    const month = HEBREW_MONTHS[m[2]];
    if (month) {
      const d = new Date(parseInt(m[3]), month - 1, parseInt(m[1]));
      if (!isNaN(d.getTime()) && d.getFullYear() >= 2015) dates.push(d);
    }
  }

  return dates;
}

function isLikelyDeadline(text: string, dateIndex: number): boolean {
  // Check if the surrounding text contains deadline-related keywords
  const context = text.substring(Math.max(0, dateIndex - 80), dateIndex + 20).toLowerCase();
  const deadlineKeywords = ['מועד אחרון', 'עד ליום', 'עד לתאריך', 'לא יאוחר', 'תוך', 'מועד הגשת', 'הגשת תביעות'];
  return deadlineKeywords.some(kw => context.includes(kw));
}

async function main() {
  // Get settlement cases (most likely to have deadlines)
  const cases = await prisma.lawsuit.findMany({
    where: {
      isReady: true,
      claimDeadline: null,
      status: { in: ['SETTLEMENT_APPROVED', 'SETTLEMENT', 'RULING'] },
    },
    select: {
      id: true, caseNumber: true, defendantName: true, defendantSlug: true,
      status: true, eligibilityCriteria: true, summary: true, rawExtraction: true,
    },
  });

  console.log(`Scanning ${cases.length} cases for deadline dates...\n`);

  let found = 0;
  let updated = 0;

  for (const c of cases) {
    const allText = [c.eligibilityCriteria, c.summary, c.rawExtraction as string].filter(Boolean).join(' ');
    const dates = extractDatesFromText(allText);

    if (dates.length > 0) {
      // Filter for likely deadline dates (future or recent past)
      const now = new Date();
      const futureDates = dates.filter(d => d > new Date('2020-01-01'));

      // Check if any date is contextually a deadline
      for (const date of futureDates) {
        const dateStr = date.toLocaleDateString('he-IL');
        const idx = allText.indexOf(dateStr.replace(/\./g, '/'));
        const isDeadline = idx >= 0 ? isLikelyDeadline(allText, idx) : false;

        if (isDeadline || futureDates.length === 1) {
          console.log(`  FOUND: ${c.caseNumber} (${c.defendantSlug}) → ${date.toISOString().slice(0, 10)}`);
          console.log(`    Context: ...${allText.substring(Math.max(0, idx - 50), idx + 50)}...`);
          found++;

          // Only auto-update if the date is clearly a deadline
          if (isDeadline) {
            await prisma.lawsuit.update({
              where: { id: c.id },
              data: { claimDeadline: date, lastUpdatedAt: new Date() },
            });
            updated++;
            console.log(`    → UPDATED in DB`);
          }
          break;
        }
      }
    }
  }

  console.log(`\nDone. Found ${found} potential deadlines, updated ${updated} in DB.`);
  console.log(`Remaining without deadline: ${cases.length - updated}`);
  console.log(`\nNote: Most deadlines come from court settlement approval orders (PDFs),`);
  console.log(`not from the CSV data. Use /api/admin/lawsuit/:id/deadline to set manually.`);

  await prisma.$disconnect();
}

main();
