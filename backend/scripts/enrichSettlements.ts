// ─────────────────────────────────────────────────────────────────────────────
//  scripts/enrichSettlements.ts — Phase 1: Enrich settlements with real data
//  Run: npx tsx scripts/enrichSettlements.ts
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../db/index';

interface SettlementEnrichment {
  caseNumber: string;
  estimatedPayout: string;
  claimFormUrl?: string;
  payoutMethod: string;
  distributionStatus: string;
  claimGuideSteps: string[];
  claimGuideHe: string;
  claimDeadline?: string; // ISO date
}

const ENRICHMENTS: SettlementEnrichment[] = [
  // ── פלאפון — 298 ₪ או 2 מוצרים חינם ──────────────────────────────────────
  {
    caseNumber: '42526-03-12',
    estimatedPayout: '298 ₪ או 2 מוצרים חינם',
    claimFormUrl: 'https://www.pelephone.co.il/digitalsite/heb/support/general_info/legal/',
    payoutMethod: 'credit',
    distributionStatus: 'open',
    claimDeadline: '2025-06-08',
    claimGuideSteps: [
      'בדוק אם היית לקוח פלאפון עם מכשיר שלא נרכש דרך פלאפון',
      'היכנס לאתר פלאפון או הגע למרכז שירות',
      'בחר 2 מוצרים חינם (סוללה ניידת, רמקול, משטח טעינה, כרטיס SIM גלובלי) או זיכוי של 298 ₪',
      'המימוש עד 8 ביוני 2025',
    ],
    claimGuideHe: 'לקוחות פלאפון שהצטרפו עם מכשיר שנרכש מחוץ לפלאפון ונתקלו בבעיות קליטה זכאים ל-2 מוצרים חינם (סוללה ניידת, רמקול, משטח טעינה או כרטיס SIM גלובלי) או לחלופין זיכוי כספי של 298 ₪. המימוש במרכזי שירות פלאפון עד 8/6/2025.',
  },

  // ── סלקום — 23 מיליון ₪ פיצוי אוטומטי ────────────────────────────────────
  {
    caseNumber: '43661-11-14',
    estimatedPayout: '25-30 ₪ שובר או שירות סינון',
    payoutMethod: 'automatic',
    distributionStatus: 'distributing',
    claimGuideSteps: [
      'ההטבה ניתנת אוטומטית ללקוחות סלקום שהתנתקו בין 2014-2017',
      'בדוק אם קיבלת הודעה מסלקום על זיכוי',
      'שובר 30 ₪ לרכישה ברשת דינמיקה או שירות רשת בטוחה ל-4.5 חודשים',
      'הפיצוי מועבר אוטומטית - אין צורך בפעולה',
    ],
    claimGuideHe: 'סלקום מפצה אוטומטית לקוחות שהתנתקו משירותי רדיו נייד בין אוגוסט 2014 לינואר 2017. הפיצוי: שובר 30 ₪ לדינמיקה או שירות רשת בטוחה ל-4.5 חודשים. אין צורך לפנות.',
  },

  // ── סלקום — 20 מיליון ₪ מכירת מידע איכון ──────────────────────────────────
  {
    caseNumber: '11114-11-14',
    estimatedPayout: 'כ-25 ₪ לכל לקוח (סה״כ 20 מיליון ₪)',
    payoutMethod: 'automatic',
    distributionStatus: 'distributing',
    claimGuideSteps: [
      'סלקום מכרה נתוני מיקום של לקוחותיה ללא ידיעתם',
      'אם היית לקוח סלקום - ייתכן שמגיע לך פיצוי',
      'הפיצוי ניתן כזיכוי לחשבון או כהטבה',
      'בדוק הודעות מסלקום או פנה לשירות לקוחות',
    ],
    claimGuideHe: 'סלקום נקנסה על מכירת נתוני איכון ומיקום של לקוחותיה. הפיצוי כ-20 מיליון ₪ המחולקים בין לקוחות שנפגעו. בדוק אם קיבלת הודעה מסלקום.',
  },

  // ── שופרסל אונליין — 5 ₪ הנחה (קוד 4295) ─────────────────────────────────
  {
    caseNumber: '39785-05-15',
    estimatedPayout: '5 ₪ הנחה בהזמנה',
    claimFormUrl: 'https://www.shufersal.co.il/online/he/A',
    payoutMethod: 'credit',
    distributionStatus: 'open',
    claimGuideSteps: [
      'היכנס לשופרסל אונליין ובצע הזמנה',
      'הזן קוד קופון: 4295',
      'קבל הנחה של 5 ₪ בסל הקניות',
      'ההטבה חד-פעמית ומוגבלת ל-157,500 לקוחות ראשונים',
    ],
    claimGuideHe: 'לקוחות שופרסל אונליין שהזמינו בתקופת הקורונה וסכום ההזמנה ירד מ-750 ₪ בגלל חוסר מוצרים זכאים להנחה של 5 ₪. יש להזין קוד 4295 בהזמנה הבאה.',
  },

  // ── שופרסל — 15% הנחה על מאפים בסוף יום ───────────────────────────────────
  {
    caseNumber: '33632-05-15',
    estimatedPayout: '15% הנחה על מאפים בסוף יום',
    payoutMethod: 'credit',
    distributionStatus: 'open',
    claimGuideSteps: [
      'הגע לסניף שופרסל אחרי 20:00',
      'בחר מאפים מהמאפייה',
      'קבל 15% הנחה נוספת אוטומטית בקופה',
      'ההטבה לכל לקוחות שופרסל - ללא צורך ברישום',
    ],
    claimGuideHe: 'שופרסל מחויבת לתת הנחה נוספת של 15% על מאפים בסוף יום המכירה. ההנחה ניתנת אוטומטית בקופה.',
  },

  // ── בנק הפועלים — חשבונות רדומים 65 מיליון ₪ ──────────────────────────────
  {
    caseNumber: '33018-11-13',
    estimatedPayout: 'משתנה לפי חשבון (סה״כ 65 מיליון ₪)',
    payoutMethod: 'bank_transfer',
    distributionStatus: 'distributing',
    claimGuideSteps: [
      'בדוק אם יש לך חשבון רדום בבנק הפועלים (ללא פעילות 10+ חודשים)',
      'פנה לסניף בנק הפועלים עם תעודת זהות',
      'בקש בדיקה האם נגבו ממך עמלות על חשבון רדום',
      'קבל החזר עמלות + ריבית + הצמדה',
    ],
    claimGuideHe: 'בנק הפועלים ישלם 65 מיליון ₪ ללקוחות עם חשבונות רדומים. אם היה לך חשבון ללא פעילות למעלה מ-10 חודשים ונגבו עמלות - מגיע לך החזר. פנה לסניף הבנק עם ת.ז.',
  },

  // ── בנק הפועלים — העברות מט"ח ──────────────────────────────────────────────
  {
    caseNumber: '31935-11-13',
    estimatedPayout: 'משתנה לפי היקף העברות',
    payoutMethod: 'bank_transfer',
    distributionStatus: 'distributing',
    claimGuideSteps: [
      'אם ביצעת העברות מטח דרך בנק הפועלים',
      'הבנק עיכב העברות מטח שהתקבלו לפחות יומיים',
      'פנה לסניף הבנק ובקש בדיקת זכאות',
      'ייתכן שמגיע לך החזר על הפרשי שער',
    ],
    claimGuideHe: 'בנק הפועלים עיכב העברות מטח שהתקבלו ללקוחותיו לפחות יומיים, מה שגרם להפסדים בשל הפרשי שער. פנה לסניף לבירור זכאותך.',
  },

  // ── פלאפון — 12.5 מיליון ₪ ────────────────────────────────────────────────
  {
    caseNumber: '35643-05-14',
    estimatedPayout: 'שובר 50 ₪ או 10GB גלישה או שירות Cloud',
    payoutMethod: 'credit',
    distributionStatus: 'open',
    claimGuideSteps: [
      'בדוק אם היית לקוח פלאפון בתקופה הרלוונטית',
      'בחר הטבה אחת: שובר 50 ₪ לרכישת אביזרים',
      'או: תוספת 10GB גלישה ל-3 חודשים',
      'או: שירות Cloud ל-10 חודשים',
    ],
    claimGuideHe: 'לקוחות פלאפון זכאים לבחור הטבה: שובר 50 ₪ לרכישת אביזרים ומכשירים, 10GB גלישה ל-3 חודשים, או שירות Cloud ל-10 חודשים.',
  },

  // ── סלקום — סינון אתרים 11.8 מיליון ₪ ────────────────────────────────────
  {
    caseNumber: '48959-11-12',
    estimatedPayout: 'שירות סינון אתרים חינם (שווי 11.8 מיליון ₪)',
    payoutMethod: 'automatic',
    distributionStatus: 'distributing',
    claimGuideSteps: [
      'סלקום תספק שירות סינון אתרים בחינם ללקוחות',
      'השירות ניתן אוטומטית ללא צורך בפעולה',
      'בדוק בחשבון סלקום שלך אם השירות הופעל',
      'שווי ההטבה הכולל: 11.8 מיליון ₪',
    ],
    claimGuideHe: 'סלקום תספק שירות סינון אתרים בחינם ללקוחותיה. השירות ניתן אוטומטית.',
  },

  // ── תנובה — קנס 25 מיליון ₪ + שוברי זיכוי ────────────────────────────────
  {
    caseNumber: '51742-04-15',
    estimatedPayout: 'שוברי זיכוי ברשתות שופרסל ומגה',
    payoutMethod: 'credit',
    distributionStatus: 'distributing',
    claimGuideSteps: [
      'תנובה התערבה במחירי גבינות בשופרסל ובמגה',
      'הפיצוי ניתן כשוברי זיכוי ברכישת מוצרי חלב',
      'בדוק אם יש לך שוברים באפליקציית שופרסל/מגה',
      'השוברים ניתנים אוטומטית ללקוחות הרשתות',
    ],
    claimGuideHe: 'תנובה נקנסה על התערבות במחירי גבינות ברשתות שופרסל ומגה. הפיצוי ניתן כשוברי זיכוי לרכישת מוצרי חלב ברשתות אלו.',
  },
];

async function enrichAll() {
  console.log(`Enriching ${ENRICHMENTS.length} settlements...`);
  let success = 0;

  for (const e of ENRICHMENTS) {
    try {
      const lawsuit = await prisma.lawsuit.findUnique({
        where: { caseNumber: e.caseNumber },
        select: { id: true, defendantName: true },
      });

      if (!lawsuit) {
        console.log(`  SKIP: ${e.caseNumber} — not found in DB`);
        continue;
      }

      await prisma.lawsuit.update({
        where: { caseNumber: e.caseNumber },
        data: {
          isSettlement: true,
          estimatedPayout: e.estimatedPayout,
          claimFormUrl: e.claimFormUrl ?? null,
          payoutMethod: e.payoutMethod,
          distributionStatus: e.distributionStatus,
          claimGuideSteps: e.claimGuideSteps,
          claimGuideHe: e.claimGuideHe,
          claimDeadline: e.claimDeadline ? new Date(e.claimDeadline) : undefined,
          lastUpdatedAt: new Date(),
        },
      });

      console.log(`  OK: ${lawsuit.defendantName} (${e.caseNumber}) — ${e.estimatedPayout}`);
      success++;
    } catch (err) {
      console.error(`  ERROR: ${e.caseNumber}:`, err);
    }
  }

  console.log(`\nDone: ${success}/${ENRICHMENTS.length} enriched successfully.`);
  await prisma.$disconnect();
}

enrichAll();
