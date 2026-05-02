// ─────────────────────────────────────────────────────────────────────────────
//  skills/brandMatcher.ts
//  Single shared defendant-name → brand-slug matcher.
//  Replaces duplicated resolveSlug / resolveDefendantSlug across:
//    - skills/scanLegalSources.ts
//    - skills/scrapeCourtRegistry.ts
//
//  Problems this fixes:
//    1. Short aliases (e.g. 'מקס' 3-char) caused substring false-positives that
//       collapsed unrelated companies into the same slug.
//    2. Legal suffixes ("בע״מ", "Ltd", "(1968)") broke exact matches.
//    3. Two different files, two slightly different match implementations, so
//       a fix to one never reached the other.
//
//  Scoring: prefer exact normalized match; otherwise the alias whose length
//  covers the largest fraction of the candidate name. Reject matches where
//  the alias < 4 chars or covers < 40% of the candidate name.
// ─────────────────────────────────────────────────────────────────────────────

import { BRAND_NAME_MAP } from '../types';

const LEGAL_SUFFIX_PATTERNS: RegExp[] = [
  /\s*בע["\u05F4]?מ\.?$/i,      // בע"מ / בעמ
  /\s*בע['\u05F3]מ\.?$/i,        // בע'מ
  /\s*בעירבון\s+מוגבל$/i,
  /\s*\(ב"מ\)$/i,
  /\s*\(\d{4}\)$/,              // (1968)
  /\s*\bltd\.?$/i,
  /\s*\binc\.?$/i,
  /\s*\bllc\.?$/i,
  /\s*\bcorp\.?$/i,
  /\s*\bs\.?a\.?$/i,
  /\s*\bgmbh$/i,
  /\s*\bplc$/i,
];

const STRIP_TOKENS: RegExp[] = [
  /חברה לביטוח/g,
  /\bחברת\b/g,
  /\bקבוצת\b/g,
  /\bרשת\b/g,
  /\bישראל\b/g,
];

function normalize(s: string): string {
  if (!s) return '';
  let n = s
    .replace(/["'\u05F3\u05F4]/g, '')            // quotes, gershayim, geresh
    .replace(/[.,()[\]]/g, ' ')
    .replace(/[\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const rx of STRIP_TOKENS) n = n.replace(rx, ' ');
  for (const rx of LEGAL_SUFFIX_PATTERNS) n = n.replace(rx, '');
  return n.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Curated aliases as short as 2 chars (e.g. 'דן') are intentional — we need
// 'הוט', 'בזק', 'פז', 'גט' to match. Safety comes from WORD-BOUNDARY matching
// (below): a 2-char alias only matches if it appears as a whole word in the
// normalized defendant name, never as a substring of a larger word — so 'פז'
// will never be falsely matched to 'אינטרפז' or 'אוגוסט'.
const MIN_ALIAS_LEN = 2;

export interface BrandMatch {
  slug:  string;
  score: number;  // 1.0 = exact normalized; 0.8 = word-boundary
  alias: string;
}

/**
 * Resolve a defendant name to a brand slug.
 * @param name defendant name as it appears in the court/CSV source
 * @param allowList optional set of slugs to restrict matches to
 * @returns slug or null if no confident match
 */
export function resolveBrandSlug(name: string, allowList?: string[]): string | null {
  return resolveBrandMatch(name, allowList)?.slug ?? null;
}

/**
 * Full match result (slug + score + matched alias). Use this when you want to
 * audit match quality — e.g. validation agent flagging low-confidence brand matches.
 */
export function resolveBrandMatch(name: string, allowList?: string[]): BrandMatch | null {
  const norm = normalize(name);
  if (!norm) return null;

  let best: { slug: string; score: number; alias: string; aliasLen: number } | null = null;

  for (const [alias, slug] of Object.entries(BRAND_NAME_MAP)) {
    if (allowList && !allowList.includes(slug)) continue;

    const normAlias = normalize(alias);
    if (normAlias.length < MIN_ALIAS_LEN) continue;

    // 1. Exact normalized match — winning condition, return immediately.
    if (norm === normAlias) {
      return { slug, score: 1.0, alias };
    }

    // 2. Word-boundary match — alias must appear as a complete word (or
    //    multi-word phrase) inside the candidate name. This prevents false
    //    positives like 'פז' matching 'אינטרפז'. No coverage-ratio gate
    //    needed because word boundaries already prevent fragment matches.
    const escaped = normAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordRe = new RegExp(`(^|\\s)${escaped}(\\s|$)`);
    if (wordRe.test(norm)) {
      // Among multiple word-boundary matches, prefer the longest alias —
      // more specific (e.g. 'בנק הפועלים' beats 'בנק').
      if (!best || normAlias.length > best.aliasLen) {
        best = { slug, score: 0.8, alias, aliasLen: normAlias.length };
      }
    }
  }

  return best ? { slug: best.slug, score: best.score, alias: best.alias } : null;
}
