// Compare: how many cases exist in the public registry, how many we ingest,
// what fraction we drop, and which big-name defendants we miss.
const CASES_URLS = [
  'https://www.odata.org.il/datastore/dump/12ff06bf-e672-4fd9-ae63-b94dd8b71d69?bom=True',
  'https://api.tl8.me/datasets/1.0/latest/cases.csv',
];
const PARTIES_URLS = [
  'https://www.odata.org.il/datastore/dump/02a3642f-5285-4bfa-bb00-afdd62887e06?bom=True',
  'https://api.tl8.me/datasets/1.0/latest/parties.csv',
];

function splitCSVLine(line) {
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') { q = !q; continue; }
    if (ch === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur); return out;
}
function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const v = splitCSVLine(line); const r = {};
    headers.forEach((h, i) => { r[h] = (v[i] ?? '').trim().replace(/^"|"$/g, ''); });
    return r;
  });
}
async function fetchCSV(urls) {
  const errs = [];
  for (const url of urls) {
    try {
      console.error(`[fetch] ${url.slice(0, 80)}`);
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 300000);
      const res = await fetch(url, { headers: { 'User-Agent': 'FT-diag/1.0' }, redirect: 'follow', signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) { errs.push(`${url.slice(0,60)} → HTTP ${res.status}`); continue; }
      const text = await res.text();
      console.error(`[fetch] got ${text.length} bytes`);
      const rows = parseCSV(text);
      if (rows.length > 0) return rows;
      errs.push(`${url.slice(0,60)} → 0 rows`);
    } catch (e) {
      errs.push(`${url.slice(0,60)} → ${e.message}`);
    }
  }
  throw new Error('all sources failed: ' + errs.join(' | '));
}

const cases   = await fetchCSV(CASES_URLS);
const parties = await fetchCSV(PARTIES_URLS);

console.log(`Public registry — total cases: ${cases.length}`);

// Build defendants map
const partiesByCase = {};
for (const p of parties) {
  if (!partiesByCase[p.case_number]) partiesByCase[p.case_number] = [];
  partiesByCase[p.case_number].push(p);
}

function extractDefendant(casename) {
  const m = (casename ?? '').match(/נ['']\s*(.+)$/);
  return m?.[1]?.trim() ?? '';
}

// Counts
let withDefendant = 0;
const defendantCounts = new Map();

for (const c of cases) {
  const ps = partiesByCase[c.case_number] ?? [];
  const defendant = ps.find(p => p.role === 'נתבע' || p.role === 'משיב');
  const name = defendant?.name ?? extractDefendant(c.casename ?? '');
  if (!name) continue;
  withDefendant++;
  defendantCounts.set(name, (defendantCounts.get(name) ?? 0) + 1);
}

console.log(`Cases with extractable defendant: ${withDefendant}`);
console.log(`Unique defendant names: ${defendantCounts.size}`);

// Search for Samsung
console.log('\n── Samsung in public registry ──');
const samsung = [...defendantCounts.entries()]
  .filter(([n]) => /סמסונג|samsung/i.test(n))
  .sort((a, b) => b[1] - a[1]);
samsung.forEach(([n, c]) => console.log(`  ${n}: ${c} cases`));
console.log(`(${samsung.length} unique Samsung-related defendants)`);

// Top 30 defendants by case count
console.log('\n── Top 30 defendants in public registry ──');
const top = [...defendantCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
top.forEach(([n, c]) => console.log(`  ${c}× ${n}`));

// Big-name brands not in our system — common Hebrew names users care about
const userMissingChecks = ['LG', 'אל ג\'י', 'אפל', 'גוגל', 'מיקרוסופט', 'נטפליקס', 'IKEA',
  'איקאה', 'טויוטה', 'יונדאי', 'מאזדה', 'ניסאן', 'הונדה', 'נייקי', 'אדידס',
  'מקדונלדס', 'בורגר קינג', 'דומינוס', 'פיצה האט', 'ארומה', 'קופיקס', 'קסטרו',
  'גולף', 'פוקס', 'אמריקן איגל', 'זארה', 'H&M', 'מנגו', 'סוני', 'שיאומי',
  'הואוויי', 'נינטנדו', 'פלייסטיישן', 'אקסבוקס', 'ספוטיפיי', 'דיסני', 'נטפליקס',
  'AirBNB', 'בוקינג', 'הוסטל', 'טראיולוקה', 'אגד', 'דן', 'מטרופולין', 'רכבת ישראל',
  'טוטו', 'מפעל הפיס', 'בנק הפועלים', 'בנק לאומי', 'מגה', 'ויקטוריה', 'יוחננוף',
  'ויקס', 'מונדיי', 'פייבר', 'AppsFlyer', 'גוגל פליי', 'אפל סטור', 'PayPal', 'Wise'];

console.log('\n── Brand presence check (cases per top public-registry name match) ──');
for (const brand of userMissingChecks) {
  const matches = [...defendantCounts.entries()].filter(([n]) => n.includes(brand));
  if (matches.length === 0) continue;
  const totalCases = matches.reduce((s, [, c]) => s + c, 0);
  console.log(`  ${brand}: ${totalCases} cases across ${matches.length} variant names`);
  matches.slice(0, 3).forEach(([n, c]) => console.log(`     · ${c}× ${n}`));
}
