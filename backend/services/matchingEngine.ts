/**
 * ═══════════════════════════════════════════════════════════
 *  Consumer Class-Action Matchmaker — Matching Engine v1.0
 *  File: services/matchingEngine.ts
 * ═══════════════════════════════════════════════════════════
 */

import {
  UserProfile, Lawsuit, MatchResult, LawsuitStatus,
  ShoppingFrequency
} from '../types';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Frequency multipliers for matchConfidenceScore weighting */
const FREQUENCY_MULTIPLIERS: Record<ShoppingFrequency, number> = {
  DAILY:               1.0,
  SEVERAL_TIMES_WEEK:  0.9,
  WEEKLY:              0.75,
  BI_WEEKLY:           0.60,
  MONTHLY:             0.40,
};

/** Score contribution per factor */
const SCORE_WEIGHTS = {
  DIRECT_BRAND_MATCH:   45,   // User selected this exact brand
  CATEGORY_MATCH:       15,   // Lawsuit affects a product category user selected
  IS_ISRAELI:           10,   // Israeli suits are immediately actionable
  HIGH_PRIORITY:         8,
  URGENT_PRIORITY:      12,
  OPEN_STATUS_BONUS:     7,   // Open = can join now
  HOUSEHOLD_SIZE_BONUS:  5,   // Larger household → higher potential payout
  GLOBAL_POTENTIAL:     20,   // Global suits worth tracking
  MULTI_BRAND_BONUS:     5,   // User shops at multiple defendants
} as const;

const MAX_RAW_SCORE = 100;

// ─── Core Engine ─────────────────────────────────────────────────────────────

/**
 * Computes a prioritized list of lawsuit matches for a given user profile.
 *
 * @param user        The user's consumer profile
 * @param lawsuits    Full lawsuit database (from DB or mock)
 * @returns           Sorted array of MatchResult with scores and reasons
 */
export function computeMatches(
  user: UserProfile,
  lawsuits: Lawsuit[]
): MatchResult[] {
  const brandSet   = new Set(user.selectedBrands);
  const catSet     = new Set(user.consumerCategoryPrefs);
  const freqMult   = FREQUENCY_MULTIPLIERS[user.shoppingFrequency];
  const householdBonus = user.householdSize >= 4 ? SCORE_WEIGHTS.HOUSEHOLD_SIZE_BONUS : 0;

  const results: MatchResult[] = [];

  for (const suit of lawsuits) {
    // Skip dismissed/closed suits
    if (suit.status === "DISMISSED" || suit.status === "CLOSED") continue;

    let rawScore = 0;
    const reasons: string[] = [];
    let matchType: MatchResult["matchType"] = "SECTOR";

    // ── 1. Direct brand match ──────────────────────────────────────────────
    const matchedBrands = suit.defendants.filter(d => brandSet.has(d));
    if (matchedBrands.length > 0) {
      rawScore += SCORE_WEIGHTS.DIRECT_BRAND_MATCH * Math.min(matchedBrands.length, 2);
      matchType = suit.isGlobal ? "GLOBAL_WATCH" : "DIRECT_BRAND";
      reasons.push(
        `You shop at ${matchedBrands.map(b => b).join(" & ")} — a named defendant`
      );
      if (matchedBrands.length > 1) {
        rawScore += SCORE_WEIGHTS.MULTI_BRAND_BONUS;
        reasons.push("Multiple defendants match your profile");
      }
    }

    // ── 2. Product category overlap ────────────────────────────────────────
    const matchedCats = suit.affectedProductCategories.filter(c => catSet.has(c));
    if (matchedCats.length > 0) {
      rawScore += SCORE_WEIGHTS.CATEGORY_MATCH * Math.min(matchedCats.length, 3);
      if (matchType === "SECTOR") matchType = "CATEGORY";
      reasons.push(
        `Affects categories you buy: ${matchedCats.join(", ")}`
      );
    }

    // Skip if no match at all
    if (rawScore === 0) continue;

    // ── 3. Status / actionability bonuses ──────────────────────────────────
    if (suit.isIsraeli) {
      rawScore += SCORE_WEIGHTS.IS_ISRAELI;
      reasons.push("Active Israeli case — actionable now");
    } else if (suit.isGlobal) {
      rawScore += SCORE_WEIGHTS.GLOBAL_POTENTIAL;
      matchType = "GLOBAL_WATCH";
      reasons.push("Global suit with Israeli applicability potential");
    }

    if (suit.status === "SETTLEMENT_APPROVED" || suit.status === "CERTIFIED") {
      rawScore += SCORE_WEIGHTS.OPEN_STATUS_BONUS;
      reasons.push("Claims are currently open");
    }

    // ── 4. Priority bonuses ────────────────────────────────────────────────
    if (suit.priority === "HIGH")   rawScore += SCORE_WEIGHTS.HIGH_PRIORITY;
    if (suit.priority === "URGENT") rawScore += SCORE_WEIGHTS.URGENT_PRIORITY;

    // ── 5. Household size bonus ────────────────────────────────────────────
    if (householdBonus > 0) {
      rawScore += householdBonus;
      reasons.push(`Household of ${user.householdSize} may qualify for higher payout`);
    }

    // ── 6. Deadline urgency ────────────────────────────────────────────────
    if (suit.claimDeadline) {
      const daysUntilDeadline = Math.floor(
        (new Date(suit.claimDeadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      if (daysUntilDeadline > 0 && daysUntilDeadline <= 60) {
        rawScore += 8;
        reasons.push(`Deadline in ${daysUntilDeadline} days — act soon`);
      }
    }

    // ── 7. Clamp and weight ────────────────────────────────────────────────
    const relevanceScore = Math.min(rawScore, MAX_RAW_SCORE);

    // matchConfidenceScore = relevanceScore × frequency multiplier
    // + optional technicalSpecs.confidenceRating blend (if available)
    let confidenceBase = relevanceScore * freqMult;
    if (suit.technicalSpecs?.confidenceRating != null) {
      // Blend 70% our score + 30% legal filing strength
      confidenceBase = confidenceBase * 0.7 + suit.technicalSpecs.confidenceRating * 0.3;
    }
    const matchConfidenceScore = Math.round(Math.min(confidenceBase, 99));

    results.push({
      ...suit,
      relevanceScore,
      matchConfidenceScore,
      matchReasons: reasons,
      matchType,
    });
  }

  // ── Sort: direct brand > open status > confidence score ──────────────────
  return results.sort((a, b) => {
    const typeRank = { DIRECT_BRAND: 4, GLOBAL_WATCH: 3, CATEGORY: 2, SECTOR: 1 };
    const statusRank: Record<LawsuitStatus, number> = {
      SETTLEMENT_APPROVED: 5, CERTIFIED: 4, FILED: 4,
      DISCOVERY: 3, SETTLEMENT: 3, RULING: 2,
      GLOBAL_POTENTIAL: 2, DISMISSED: 0, CLOSED: 0,
    };
    const aRank = typeRank[a.matchType] * 1000 + statusRank[a.status] * 100 + a.matchConfidenceScore;
    const bRank = typeRank[b.matchType] * 1000 + statusRank[b.status] * 100 + b.matchConfidenceScore;
    return bRank - aRank;
  });
}

/**
 * Returns only "global watch" suits that could become Israeli cases.
 */
export function getGlobalWatchItems(
  user: UserProfile,
  lawsuits: Lawsuit[]
): MatchResult[] {
  return computeMatches(user, lawsuits).filter(m => m.matchType === "GLOBAL_WATCH");
}

/**
 * Returns a summary stats object for the user's match set.
 */
export function getMatchSummary(matches: MatchResult[]) {
  const active        = matches.filter(m => m.isIsraeli && m.status !== "DISMISSED" && m.status !== "CLOSED");
  const global        = matches.filter(m => m.isGlobal);
  const highPriority  = matches.filter(m => m.priority === "HIGH" || m.priority === "URGENT");
  const totalPoolMin  = active.reduce((sum, m) => sum + (m.estimatedPoolILS ?? 0), 0);

  return {
    totalMatches:     matches.length,
    activeIsraeli:    active.length,
    globalWatch:      global.length,
    highPriority:     highPriority.length,
    estimatedPoolILS: totalPoolMin,
    topMatch:         matches[0] ?? null,
    avgConfidence:    matches.length
      ? Math.round(matches.reduce((s, m) => s + m.matchConfidenceScore, 0) / matches.length)
      : 0,
  };
}
