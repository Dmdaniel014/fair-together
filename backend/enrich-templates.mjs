import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { readFileSync } from 'fs';

const env = readFileSync('.env', 'utf8');
const dbUrl = env.match(/DATABASE_URL="([^"]+)"/)?.[1];
neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: dbUrl });

const BRAND_DISPLAY = {
  'shufersal': 'שופרסל', 'ramilevi': 'רמי לוי', 'victory': 'ויקטורי',
  'mega': 'מגה', 'tnuva': 'תנובה', 'strauss': 'שטראוס', 'elite': 'עלית',
  'osem': 'אסם', 'partner': 'פרטנר', 'cellcom': 'סלקום', 'pelephone': 'פלאפון',
  'hapoalim': 'בנק הפועלים', 'leumi': 'בנק לאומי', 'clalit': 'כללית',
  'maccabi': 'מכבי', 'elal': 'אל על', 'tivtaam': 'טיב טעם',
  'osheraad': 'אושר עד', 'yohananoff': 'יוחננוף',
  'hot': 'הוט', 'bezeq': 'בזק', 'golan': 'גולן טלקום',
  'superpharm': 'סופר-פארם', 'fox': 'פוקס', 'golf': 'גולף',
  'phoenix': 'הפניקס', 'migdal': 'מגדל', 'harel': 'הראל',
  'clal': 'כלל', 'menora': 'מנורה', 'ayalon': 'איילון',
  'isracard': 'ישראכרט', 'apple': 'אפל', 'unilever': 'יוניליוור',
};

const CATEGORY_KEYWORDS = {
  'ביטוח': 'ביטוח', 'פוליס': 'ביטוח', 'גמל': 'פנסיה',
  'בנק': 'בנקאות', 'משכנתא': 'בנקאות', 'הלוואה': 'בנקאות',
  'תקשורת': 'תקשורת', 'סלולר': 'תקשורת', 'אינטרנט': 'תקשורת',
  'חלב': 'מזון', 'שוקולד': 'מזון', 'מזון': 'מזון', 'מוצר': 'צרכנות',
  'בריאות': 'בריאות', 'רפואי': 'בריאות',
  'עבודה': 'זכויות עובדים', 'שכר': 'זכויות עובדים',
  'סביבת': 'איכות סביבה', 'זיהום': 'איכות סביבה',
};

function detectCategory(text) {
  for (const [kw, cat] of Object.entries(CATEGORY_KEYWORDS)) {
    if (text.includes(kw)) return cat;
  }
  return 'צרכנות';
}

function formatAmount(amount) {
  const num = Number(amount);
  if (!amount || !isFinite(num) || num <= 0) return null;
  if (num >= 1_000_000_000) return `₪${(num/1_000_000_000).toFixed(1)} מיליארד`;
  if (num >= 1_000_000)     return `₪${(num/1_000_000).toFixed(1)} מיליון`;
  if (num >= 1_000)         return `₪${(num/1_000).toFixed(0)} אלף`;
  return `₪${num.toLocaleString()}`;
}

function headline(row) {
  const brand = BRAND_DISPLAY[row.defendantSlug] || row.defendantName.split(' ')[0];
  if (row.status === 'SETTLEMENT_APPROVED' || row.status === 'SETTLEMENT') {
    if (row.eligibilityCriteria?.includes('רכש')) return `רכשת מוצרים של ${brand}? ייתכן שמגיע לך פיצוי`;
    if (row.eligibilityCriteria?.includes('לקוח')) return `היית לקוח/ה של ${brand}? ייתכן שמגיע לך פיצוי`;
    return `פשרה אושרה נגד ${brand} — בדוק/י אם את/ה זכאי/ת`;
  }
  if (row.status === 'RULING') return `פסק דין ניתן: תביעה ייצוגית נגד ${brand}`;
  const cat = detectCategory((row.summary||'')+(row.eligibilityCriteria||''));
  if (cat === 'ביטוח')          return `מבוטח/ת ב${brand}? הוגשה תביעה ייצוגית`;
  if (cat === 'בנקאות')         return `לקוח/ה של ${brand}? הוגשה תביעה ייצוגית`;
  if (cat === 'מזון' || cat === 'צרכנות') return `קנית מוצרי ${brand}? הוגשה תביעה ייצוגית`;
  if (cat === 'תקשורת')         return `מנוי/ה ב${brand}? הוגשה תביעה ייצוגית`;
  return `תביעה ייצוגית הוגשה נגד ${brand}`;
}

function summary(row) {
  const brand = BRAND_DISPLAY[row.defendantSlug] || row.defendantName.split(' ')[0];
  const elig = (row.eligibilityCriteria || '').trim();
  const payout = formatAmount(row.payoutMinILS) || formatAmount(row.totalPoolILS);

  // If we have real eligibility text, build a proper consumer-facing summary
  if (elig && elig.length > 10 && elig !== '.' && elig !== 'כללי') {
    // Clean up legal jargon from eligibility
    let cleanElig = elig
      .replace(/^א\.\s*/, '')           // Remove list prefixes
      .replace(/["״]/g, '')             // Remove quotes
      .replace(/\s+/g, ' ')            // Normalize whitespace
      .trim();

    // Truncate at a sensible boundary (sentence or comma)
    if (cleanElig.length > 200) {
      const cutPoint = cleanElig.lastIndexOf('.', 200);
      const commaCut = cleanElig.lastIndexOf(',', 200);
      const bestCut = cutPoint > 100 ? cutPoint : commaCut > 100 ? commaCut : 200;
      cleanElig = cleanElig.substring(0, bestCut);
    }

    const cat = detectCategory(cleanElig + (row.summary || ''));
    let s = '';

    // Lead with who is affected, not "תביעה ייצוגית נגד"
    if (row.status === 'SETTLEMENT_APPROVED') {
      s = `פשרה אושרה נגד ${brand}. `;
    } else if (row.status === 'RULING') {
      s = `פסק דין ניתן נגד ${brand}. `;
    } else {
      s = `הוגשה תביעה ייצוגית נגד ${brand}`;
      if (cat !== 'צרכנות') s += ` בתחום ה${cat}`;
      s += '. ';
    }

    s += `הזכאים: ${cleanElig}.`;
    if (payout) s += ` סכום: ${payout}.`;
    return s;
  }

  // Fallback for cases with no eligibility data
  const raw = row.summary || '';
  const cat = detectCategory(raw);
  let s = `תביעה ייצוגית נגד ${brand}`;
  if (cat !== 'צרכנות') s += ` בתחום ה${cat}`;
  s += '.';
  if (payout) s += ` הסכום הנתבע: ${payout}.`;
  return s;
}

function bullets(row) {
  const result = [];
  const elig = row.eligibilityCriteria || '';
  if (elig && elig !== '.' && elig !== 'כללי' && elig.length > 3) {
    const parts = elig.split(/[;,]|ו\/או|וכן|לרבות/).map(s=>s.trim()).filter(s=>s.length>5);
    result.push(...parts.slice(0,2).map(p=>p.substring(0,120)));
    if (result.length === 0) result.push(elig.substring(0,150));
  }
  if (row.status === 'SETTLEMENT_APPROVED') result.push('פשרה אושרה על ידי בית המשפט');
  else if (row.status === 'RULING')         result.push('ניתן פסק דין לטובת התובעים');
  else                                       result.push('התביעה בטיפול בית המשפט');
  const p = formatAmount(row.payoutMinILS);
  if (p) result.push(`פיצוי אישי מוערך: ${p}`);
  return result.slice(0,3);
}

function payout(row) {
  const ind   = formatAmount(row.payoutMinILS);
  const total = formatAmount(row.totalPoolILS);
  if (ind && total) return `${ind} לצרכן | סה"כ ${total}`;
  if (ind)   return `${ind} לצרכן`;
  if (total) return `${total} סה"כ לקבוצה`;
  return 'טרם נקבע';
}

// ── Main ─────────────────────────────────────────────────────────────────────
const cases = await pool.query(`SELECT id,"defendantName","defendantSlug",status,summary,"eligibilityCriteria","totalPoolILS","payoutMinILS" FROM lawsuits WHERE "isReady"=true`);
console.log(`Enriching ${cases.rows.length} cases...`);

let enriched=0, errors=0;
const BATCH=50;
for (let i=0; i<cases.rows.length; i+=BATCH) {
  const stmts=[];
  for (const row of cases.rows.slice(i,i+BATCH)) {
    const data = { headline: headline(row), summaryClean: summary(row), eligibilityBullets: bullets(row), estimatedPayout: payout(row) };
    const esc = s => s.replace(/'/g,"''");
    stmts.push(`UPDATE lawsuits SET summary='${esc(data.summaryClean)}', "rawExtraction"='${esc(JSON.stringify(data))}', confidence='VERIFIED', "lastUpdatedAt"=NOW() WHERE id='${row.id}';`);
    enriched++;
  }
  try {
    await pool.query('BEGIN');
    await pool.query(stmts.join('\n'));
    await pool.query('COMMIT');
  } catch(e) {
    await pool.query('ROLLBACK').catch(()=>{});
    errors++;
  }
  console.log(`  ${Math.min(i+BATCH,cases.rows.length)}/${cases.rows.length}`);
}

console.log(`\nDone: ${enriched} enriched, ${errors} errors`);
await pool.end();
process.exit(0);
