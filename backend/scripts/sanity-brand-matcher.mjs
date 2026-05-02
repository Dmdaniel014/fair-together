// Quick standalone test of the new brand matcher logic.
// Reproduces the regex logic inline so it doesn't depend on TS compilation.
const BRAND_NAME_MAP = {
  'הוט':           'hot',
  'בזק':           'bezeq',
  'פז':            'paz',
  'גט':            'gett',
  'דן':            'dan-bus',
  'סמסונג':        'samsung',
  'samsung':       'samsung',
  'אל גי':         'lg',
  'LG':            'lg',
  'אפל':           'apple',
  'בנק הפועלים':   'hapoalim',
  'בנק לאומי':     'leumi',
  'שופרסל':        'shufersal',
  'רמי לוי':       'ramilevi',
};

const STRIP_TOKENS  = [/חברה לביטוח/g, /\bחברת\b/g, /\bקבוצת\b/g, /\bרשת\b/g, /\bישראל\b/g];
const LEGAL_SUFFIX  = [
  /\s*בע["״]?מ\.?$/i,
  /\s*בע['׳]מ\.?$/i,
  /\s*בעירבון\s+מוגבל$/i,
  /\s*\(ב"מ\)$/i,
  /\s*\(\d{4}\)$/,
  /\s*\bltd\.?$/i,
  /\s*\binc\.?$/i,
];

function normalize(s) {
  if (!s) return '';
  let n = s
    .replace(/["'׳״]/g, '')
    .replace(/[.,()[\]]/g, ' ')
    .replace(/[\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const rx of STRIP_TOKENS) n = n.replace(rx, ' ');
  for (const rx of LEGAL_SUFFIX) n = n.replace(rx, '');
  return n.replace(/\s+/g, ' ').trim().toLowerCase();
}

const MIN_ALIAS_LEN = 2;

function resolve(name) {
  const norm = normalize(name);
  if (!norm) return null;
  let best = null;

  for (const [alias, slug] of Object.entries(BRAND_NAME_MAP)) {
    const normAlias = normalize(alias);
    if (normAlias.length < MIN_ALIAS_LEN) continue;

    if (norm === normAlias) return { slug, score: 1.0, alias };

    const escaped = normAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordRe = new RegExp(`(^|\\s)${escaped}(\\s|$)`);
    if (wordRe.test(norm)) {
      if (!best || normAlias.length > best.aliasLen) {
        best = { slug, score: 0.8, alias, aliasLen: normAlias.length };
      }
    }
  }
  return best ? { slug: best.slug, score: best.score, alias: best.alias } : null;
}

const cases = [
  // Should match (currently broken or missing)
  ['סמסונג ישראל בע"מ',                'samsung'],
  ['Samsung Electronics Israel Ltd',     'samsung'],
  ['LG Electronics',                     'lg'],
  ['הוט מערכות תקשורת בע"מ',            'hot'],     // <-- failed before
  ['בזק החברה הישראלית לתקשורת בע"מ',   'bezeq'],   // <-- failed before
  ['פז חברת נפט בע"מ',                  'paz'],     // <-- failed before
  ['בנק הפועלים בע"מ',                  'hapoalim'],
  ['רמי לוי שיווק השקמה 2006 בע"מ',     'ramilevi'],
  ['שופרסל בע"מ',                       'shufersal'],
  ['אפל ישראל בע"מ',                    'apple'],
  ['גט אינק בע"מ',                      'gett'],

  // Should NOT match (false-positive prevention)
  ['אינטרפז',                'NULL'],   // 'פז' inside word — must NOT match paz
  ['אוגוסטה',                'NULL'],   // 'גט' inside word — must NOT match gett
  ['אדן בע"מ',               'NULL'],   // 'דן' inside word — must NOT match dan-bus
  ['בית בזיקא',              'NULL'],   // 'בז' inside word — must NOT match bezeq
  ['חברה אחרת לגמרי',        'NULL'],   // unrelated
];

let pass = 0, fail = 0;
console.log('━━━ Brand matcher sanity test ━━━\n');
for (const [input, expected] of cases) {
  const result = resolve(input);
  const got = result?.slug ?? 'NULL';
  const ok = got === expected;
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${input.padEnd(50)} → expected=${expected.padEnd(10)} got=${got}`);
}
console.log(`\nResults: ${pass}/${cases.length} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
