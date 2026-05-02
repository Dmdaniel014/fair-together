// ─────────────────────────────────────────────────────────────────────────────
//  db/index.ts
//  Single database access layer — used by all 5 agents via import { db }
//
//  All agents call db.someMethod() — they never write raw SQL or Prisma queries.
//  This means we can swap the DB engine without touching agent code.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import {
  LawsuitRecord, AgentRun, AgentName,
  StatusChange, UserMatchRecord,
  mapStatus as sharedMapStatus,
  BRAND_TO_CATEGORY, SettlementCategory,
} from '../types';

// ── Prisma + Neon WebSocket (port 443, bypasses blocked port 5432) ────────────
neonConfig.webSocketConstructor = ws;

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const adapter = new PrismaNeon(pool);
  return new PrismaClient({ adapter } as any);
}

const prisma = globalForPrisma.prisma ?? createPrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
export { prisma };

// ── Neon wake-up: retry helper for cold-start connection errors ───────────────
// Neon free tier suspends after inactivity and takes ~3-5s to wake.
// Wrap DB calls with this to auto-retry on connection errors.
export async function withDbRetry<T>(fn: () => Promise<T>, retries = 6): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const isConnErr = err?.message?.includes("Can't reach database") ||
                        err?.message?.includes('Connection refused') ||
                        err?.message?.includes('connection timeout') ||
                        err?.message?.includes('ECONNREFUSED') ||
                        err?.code === 'P1001' || err?.code === 'P1002';
      if (isConnErr && i < retries - 1) {
        const wait = Math.min((i + 1) * 5000, 15000); // 5s, 10s, 15s, 15s, 15s
        console.warn(`[DB] Connection failed (${err?.code ?? 'ERR'}), retrying in ${wait}ms (attempt ${i + 1}/${retries})...`);
        await new Promise(r => setTimeout(r, wait));
        await prisma.$connect().catch(() => {}); // try to wake Neon
        continue;
      }
      throw err;
    }
  }
  throw new Error('DB retry exhausted');
}

// ═════════════════════════════════════════════════════════════════════════════
//  DATABASE INTERFACE
// ═════════════════════════════════════════════════════════════════════════════

export const db = {

  // ── Lawsuit ───────────────────────────────────────────────────────────────

  async getExistingCaseNumbers(): Promise<string[]> {
    const rows = await prisma.lawsuit.findMany({
      select: { caseNumber: true },
    });
    return rows.map(r => r.caseNumber);
  },

  async getActiveLawsuits() {
    return prisma.lawsuit.findMany({
      where: { isActive: true, status: { notIn: ['CLOSED', 'DISMISSED'] } },
      select: {
        id: true, caseNumber: true, status: true,
        defendantSlug: true, confidence: true, lastUpdatedAt: true,
      },
    });
  },

  // Get the latest filing date in our DB (for incremental scan cutoff)
  async getLatestFilingDate(): Promise<Date | null> {
    const row = await prisma.lawsuit.aggregate({ _max: { filingDate: true } });
    return row._max.filingDate;
  },

  // Get case numbers of all non-closed cases (for status re-check)
  async getOpenCaseNumbers(): Promise<string[]> {
    const rows = await prisma.lawsuit.findMany({
      where: { status: { notIn: ['CLOSED', 'DISMISSED'] } },
      select: { caseNumber: true },
    });
    return rows.map(r => r.caseNumber);
  },

  async getLawsuitByCaseNumber(caseNumber: string) {
    return prisma.lawsuit.findUnique({ where: { caseNumber } });
  },

  async getLawsuitById(id: string) {
    return prisma.lawsuit.findUnique({ where: { id } });
  },

  async getLawsuitsByIds(ids: string[]) {
    return prisma.lawsuit.findMany({ where: { id: { in: ids } } });
  },

  async upsertRawCase(rawCase: {
    caseNumber:       string;
    defendantName:    string;
    defendantSlug:    string;
    court:            string;
    status:           string;
    result:           string;
    filingDate:       string;
    closeDate:        string;
    plaintiffName:    string;
    lawyers:          string;
    pdfPath:          string | null;
    pdfUrl:           string | null;
    // CSV enrichment fields
    summary?:         string | null;
    affectedGroup?:   string | null;
    legalQuestion?:   string | null;
    reliefType?:      string | null;
    reliefDetail?:    string | null;
    claimAmount?:     string | null;
    individualAmount?: string | null;
    judge?:           string | null;
    permalink?:       string | null;
  }) {
    const mappedStatus = mapStatus(rawCase.status, rawCase.result);

    // Parse amounts from CSV strings (Hebrew amounts like "1,000,000" or "1000000")
    const totalPool = parseAmount(rawCase.claimAmount);
    const individualPayout = parseAmount(rawCase.individualAmount);

    // Determine if this case has enough data to be user-ready
    const hasMeaningfulData = !!(rawCase.summary || rawCase.affectedGroup || totalPool);
    const DEAD = ['DISMISSED', 'CLOSED'];
    const isReadyForUsers = hasMeaningfulData && !DEAD.includes(mappedStatus);

    // Fetch existing so we can make update decisions explicit — Prisma's `undefined`
    // means "do not touch this column"; `false || undefined === undefined` previously
    // silently dropped isReady=false writes, and raw CSV affectedGroup was clobbering
    // AI-enriched eligibilityCriteria on every re-scrape.
    const existing = await prisma.lawsuit.findUnique({
      where: { caseNumber: rawCase.caseNumber },
      select: { confidence: true, eligibilityCriteria: true },
    });

    return prisma.lawsuit.upsert({
      where:  { caseNumber: rawCase.caseNumber },
      update: {
        status:              mappedStatus,
        result:              rawCase.result || undefined,
        closeDate:           parseDate(rawCase.closeDate) ?? undefined,
        pdfPath:             rawCase.pdfPath ?? undefined,
        summary:             rawCase.summary || undefined,
        // Only overwrite eligibilityCriteria if no AI-enriched value is present.
        // `confidence === 'VERIFIED'` means the extraction agent already wrote a
        // higher-quality value — don't let a raw CSV re-scrape clobber it.
        eligibilityCriteria: (rawCase.affectedGroup && existing?.confidence !== 'VERIFIED')
          ? rawCase.affectedGroup
          : undefined,
        totalPoolILS:        totalPool ?? undefined,
        payoutMinILS:        individualPayout ?? undefined,
        sourceUrl:           rawCase.permalink || undefined,
        // Explicit boolean — was `|| undefined`, which turned `false` into a no-op.
        isReady:             isReadyForUsers,
        confidence:          hasMeaningfulData && existing?.confidence !== 'VERIFIED'
          ? 'PENDING_REVIEW'
          : undefined,
        lastUpdatedAt:       new Date(),
      },
      create: {
        caseNumber:          rawCase.caseNumber,
        defendantName:       rawCase.defendantName,
        defendantSlug:       rawCase.defendantSlug,
        court:               rawCase.court,
        status:              mappedStatus,
        result:              rawCase.result || null,
        filingDate:          parseDate(rawCase.filingDate),
        closeDate:           parseDate(rawCase.closeDate),
        plaintiffName:       rawCase.plaintiffName || null,
        lawyers:             rawCase.lawyers || null,
        pdfPath:             rawCase.pdfPath,
        sourceUrl:           rawCase.permalink || rawCase.pdfUrl || null,
        summary:             rawCase.summary || null,
        eligibilityCriteria: rawCase.affectedGroup || null,
        totalPoolILS:        totalPool,
        payoutMinILS:        individualPayout,
        confidence:          hasMeaningfulData ? 'PENDING_REVIEW' : 'UNVERIFIED',
        isReady:             isReadyForUsers,
        firstSeenAt:         new Date(),
      },
    });
  },

  async updateLawsuitFromExtraction(
    caseNumber: string,
    fields: {
      payoutMinILS?:        number;
      payoutMaxILS?:        number;
      totalPoolILS?:        number;
      eligibilityCriteria?: string;
      claimDeadline?:       string;
      affectedPeriodStart?: string;
      affectedPeriodEnd?:   string;
      classSizeEstimate?:   number;
      summary?:             string;
      confidence:           'VERIFIED' | 'PENDING_REVIEW' | 'UNVERIFIED';
      confidenceScores:     Record<string, number>;
      rawExtraction:        string;
    }
  ) {
    return prisma.lawsuit.update({
      where: { caseNumber },
      data:  {
        payoutMinILS:        fields.payoutMinILS        ? new Prisma.Decimal(fields.payoutMinILS)  : undefined,
        payoutMaxILS:        fields.payoutMaxILS        ? new Prisma.Decimal(fields.payoutMaxILS)  : undefined,
        totalPoolILS:        fields.totalPoolILS        ? new Prisma.Decimal(fields.totalPoolILS)  : undefined,
        eligibilityCriteria: fields.eligibilityCriteria ?? undefined,
        claimDeadline:       fields.claimDeadline       ? new Date(fields.claimDeadline)           : undefined,
        affectedPeriodStart: fields.affectedPeriodStart ? new Date(fields.affectedPeriodStart)     : undefined,
        affectedPeriodEnd:   fields.affectedPeriodEnd   ? new Date(fields.affectedPeriodEnd)       : undefined,
        classSizeEstimate:   fields.classSizeEstimate   ?? undefined,
        summary:             fields.summary             ?? undefined,
        confidence:          fields.confidence,
        confidenceScores:    fields.confidenceScores,
        rawExtraction:       fields.rawExtraction,
        lastUpdatedAt:       new Date(),
      },
    });
  },

  async updateLawsuitConfidence(caseNumber: string, confidence: 'VERIFIED' | 'PENDING_REVIEW' | 'UNVERIFIED') {
    return prisma.lawsuit.update({
      where: { caseNumber },
      data:  { confidence, lastUpdatedAt: new Date() },
    });
  },

  async setLawsuitReady(caseNumber: string) {
    return prisma.lawsuit.update({
      where: { caseNumber },
      data:  { isReady: true, requiresReview: false, lastUpdatedAt: new Date() },
    });
  },

  async setLawsuitPendingReview(caseNumber: string, notes: string) {
    return prisma.lawsuit.update({
      where: { caseNumber },
      data:  {
        isReady:        true,   // still publishable — just shows "בבדיקת ייתכנות"
        requiresReview: true,
        reviewNotes:    notes,
        confidence:     'PENDING_REVIEW',
        lastUpdatedAt:  new Date(),
      },
    });
  },

  async markForReview(caseNumber: string, notes: string) {
    return prisma.lawsuit.update({
      where: { caseNumber },
      data:  {
        isReady:        false,  // NOT shown to users
        requiresReview: true,
        reviewNotes:    notes,
        lastUpdatedAt:  new Date(),
      },
    });
  },

  async countLawsuitsRequiringReview(): Promise<number> {
    return prisma.lawsuit.count({ where: { requiresReview: true } });
  },

  async recordStatusChange(
    lawsuitId: string,
    change:    { from: string; to: string; detectedAt: string; source: 'CSV' | 'PDF' | 'MANUAL' }
  ) {
    // Update the lawsuit status
    await prisma.lawsuit.update({
      where: { id: lawsuitId },
      data:  { status: change.to as any, lastUpdatedAt: new Date() },
    });
    // Record in history
    return prisma.statusChange.create({
      data: {
        lawsuitId,
        fromStatus: change.from as any,
        toStatus:   change.to   as any,
        detectedAt: new Date(change.detectedAt),
        source:     change.source,
      },
    });
  },

  // ── Events ────────────────────────────────────────────────────────────────

  async emitEvent(event: { type: string; payload: Record<string, unknown> }) {
    return prisma.agentEvent.create({
      data: {
        type:      event.type,
        payload:   event.payload as any,
        lawsuitId: (event.payload.lawsuitId as string) ?? null,
        status:    'PENDING',
      },
    });
  },

  async getPendingEvents() {
    return prisma.agentEvent.findMany({
      where:   { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take:    50, // process in batches
    });
  },

  /**
   * Atomically claim a batch of pending events by flipping them to PROCESSING
   * in a single transactional UPDATE ... FOR UPDATE SKIP LOCKED. This is the
   * correct pattern for the orchestrator: without it, two overlapping cron
   * runs both see the same PENDING rows and dispatch each event twice.
   */
  async claimPendingEvents(limit = 50) {
    const rows = await prisma.$queryRaw<Array<{ id: string; type: string; payload: any }>>`
      UPDATE "agent_events"
         SET status = 'PROCESSING'
       WHERE id IN (
         SELECT id FROM "agent_events"
          WHERE status = 'PENDING'
          ORDER BY "createdAt" ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
       )
       RETURNING id, type, payload;
    `;
    return rows;
  },

  async markEventProcessed(eventId: string) {
    return prisma.agentEvent.update({
      where: { id: eventId },
      data:  { status: 'DONE', processedAt: new Date() },
    });
  },

  async markEventFailed(eventId: string, reason: string) {
    return prisma.agentEvent.update({
      where: { id: eventId },
      data:  { status: 'FAILED', failedAt: new Date(), failReason: reason },
    });
  },

  async countPendingEvents(): Promise<number> {
    return prisma.agentEvent.count({ where: { status: 'PENDING' } });
  },

  // ── Agent Runs ────────────────────────────────────────────────────────────

  async saveAgentRun(run: AgentRun) {
    return prisma.agentRun.upsert({
      where:  { id: run.id },
      update: {
        status:     run.status     as any,
        finishedAt: run.finishedAt ? new Date(run.finishedAt) : null,
        stats:      run.stats      as any,
        errors:     run.errors     as any,
        retryCount: run.retryCount,
      },
      create: {
        id:          run.id,
        agent:       run.agent       as any,
        triggeredBy: run.triggeredBy as any,
        startedAt:   new Date(run.startedAt),
        finishedAt:  run.finishedAt ? new Date(run.finishedAt) : null,
        status:      run.status      as any,
        stats:       run.stats       as any,
        errors:      run.errors      as any,
        retryCount:  run.retryCount,
      },
    });
  },

  async getLastAgentRun(agent: AgentName): Promise<AgentRun | null> {
    const row = await prisma.agentRun.findFirst({
      where:   { agent: agent as any },
      orderBy: { startedAt: 'desc' },
    });
    if (!row) return null;
    return {
      id:          row.id,
      agent:       row.agent       as AgentName,
      triggeredBy: row.triggeredBy as AgentRun['triggeredBy'],
      startedAt:   row.startedAt.toISOString(),
      finishedAt:  row.finishedAt?.toISOString(),
      status:      row.status      as AgentRun['status'],
      stats:       row.stats       as Record<string, number>,
      errors:      row.errors      as unknown as AgentRun['errors'],
      retryCount:  row.retryCount,
    };
  },

  async archiveOldRuns(olderThanDays: number) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    return prisma.agentRun.deleteMany({
      where: { startedAt: { lt: cutoff }, status: { in: ['SUCCESS', 'PARTIAL'] } },
    });
  },

  // ── Users ─────────────────────────────────────────────────────────────────

  async getAllActiveUsersWithProfiles() {
    return prisma.user.findMany({
      where:   { isActive: true, expoPushToken: { not: null } },
      include: { profile: true, learnedWeights: true },
    });
  },

  async getUserProfile(userId: string) {
    return prisma.userProfile.findUnique({ where: { userId } });
  },

  async getUserByPhone(phone: string) {
    return prisma.user.findUnique({ where: { phone } });
  },

  async getUserByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  },

  async createUser(data: { phone?: string; email?: string; expoPushToken?: string }) {
    return prisma.user.create({ data });
  },

  async createUserProfile(userId: string, profile: {
    selectedBrands:        string[];
    consumerCategoryPrefs: string[];
    shoppingFrequency:     string;
    householdSize:         number;
  }) {
    return prisma.userProfile.upsert({
      where:  { userId },
      update: {
        selectedBrands:        profile.selectedBrands,
        consumerCategoryPrefs: profile.consumerCategoryPrefs,
        shoppingFrequency:     profile.shoppingFrequency as any,
        householdSize:         profile.householdSize,
        onboardingComplete:    true,
      },
      create: {
        userId,
        selectedBrands:        profile.selectedBrands,
        consumerCategoryPrefs: profile.consumerCategoryPrefs,
        shoppingFrequency:     profile.shoppingFrequency as any,
        householdSize:         profile.householdSize,
        onboardingComplete:    true,
      },
    });
  },

  async updateExpoPushToken(userId: string, token: string) {
    return prisma.user.update({ where: { id: userId }, data: { expoPushToken: token } });
  },

  // ── Matches ───────────────────────────────────────────────────────────────

  async getMatchRecord(userId: string, lawsuitId: string) {
    return prisma.match.findUnique({
      where: { userId_lawsuitId: { userId, lawsuitId } },
    });
  },

  async createMatchRecord(data: {
    userId:          string;
    lawsuitId:       string;
    relevanceScore:  number;
    matchConfidence: number;
    matchReasons:    string[];
    notified:        boolean;
  }) {
    return prisma.match.create({ data });
  },

  async updateMatchRecord(
    userId:    string,
    lawsuitId: string,
    data:      { relevanceScore: number; matchConfidence: number; matchReasons: string[] }
  ) {
    return prisma.match.update({
      where: { userId_lawsuitId: { userId, lawsuitId } },
      data:  { ...data, updatedAt: new Date() },
    });
  },

  async markMatchNotified(userId: string, lawsuitId: string) {
    return prisma.match.update({
      where: { userId_lawsuitId: { userId, lawsuitId } },
      data:  { notified: true, notifiedAt: new Date() },
    });
  },

  async updateMatchUserAction(userId: string, lawsuitId: string, action: string) {
    return prisma.match.update({
      where: { userId_lawsuitId: { userId, lawsuitId } },
      data:  { userAction: action as any, userActionAt: new Date() },
    });
  },

  async getUserMatchHistory(userId: string, opts: { limit?: number } = {}) {
    return prisma.match.findMany({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
      take:    opts.limit ?? 100,
    });
  },

  // ── Self-learning ─────────────────────────────────────────────────────────

  async updateLearnedWeights(userId: string, weights: {
    engagementRate:  number;
    brandEngagement: Record<string, number>;
    lastUpdatedAt:   string;
  }) {
    return prisma.userLearnedWeights.upsert({
      where:  { userId },
      update: {
        engagementRate:  weights.engagementRate,
        brandEngagement: weights.brandEngagement,
        lastUpdatedAt:   new Date(weights.lastUpdatedAt),
        totalActions: {
          increment: 1,
        },
      },
      create: {
        userId,
        engagementRate:  weights.engagementRate,
        brandEngagement: weights.brandEngagement,
        totalActions:    1,
      },
    });
  },

  async refreshLearnedWeights() {
    // Recalculate for all users who have had recent activity
    const activeUsers = await prisma.user.findMany({
      where: {
        matches: {
          some: {
            userActionAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
          },
        },
      },
      select: { id: true },
    });

    console.log(`[DB] Refreshing learned weights for ${activeUsers.length} users`);
    // Full recalculation happens in pushAgent.recordUserFeedback
    // This just resets stale entries
    await prisma.userLearnedWeights.updateMany({
      where: {
        userId:       { notIn: activeUsers.map(u => u.id) },
        lastUpdatedAt: { lt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000) },
      },
      data: { engagementRate: 0.5 }, // reset to neutral
    });
  },

  // ── AI Insights ───────────────────────────────────────────────────────────

  async saveAIInsight(userId: string, lawsuitId: string, content: string) {
    return prisma.aiInsight.upsert({
      where:  { userId_lawsuitId: { userId, lawsuitId } },
      update: { content, generatedAt: new Date() },
      create: { userId, lawsuitId, content },
    });
  },

  async getAIInsight(userId: string, lawsuitId: string) {
    return prisma.aiInsight.findUnique({
      where: { userId_lawsuitId: { userId, lawsuitId } },
    });
  },

  async markInsightViewed(userId: string, lawsuitId: string) {
    return prisma.aiInsight.update({
      where: { userId_lawsuitId: { userId, lawsuitId } },
      data:  { viewedAt: new Date() },
    });
  },

  // ── System Alerts ─────────────────────────────────────────────────────────

  async createAlert(alert: { type: string; message: string; at: string }) {
    return prisma.systemAlert.create({
      data: { type: alert.type, message: alert.message, createdAt: new Date(alert.at) },
    });
  },

  // ── User-facing lawsuits ───────────────────────────────────────────────────
  // Shows: last 5 years of non-dead cases + any old case that became actionable
  // Priority: SETTLEMENT_APPROVED > SETTLEMENT > RULING > CERTIFIED > FILED

  async getReadyLawsuits(brandSlugs?: string[], status?: string) {
    // Data source: odata.org.il CSV, frozen at Nov 2020.
    // No status updates since → FILED cases from 2018 or older are almost certainly dead.
    // Rules:
    //   FILED/CERTIFIED: filed 2018+ (realistic window for an active case without ruling)
    //   SETTLEMENT_APPROVED: filed 2015+ (claim periods can run several years)
    //   RULING: filed 2016+ (enforcement takes time)
    //   Future claim deadline: any age
    const filedCutoff      = new Date('2019-01-01'); // FILED older than ~2yrs without update = likely dead
    const settlementCutoff = new Date('2015-01-01'); // Settlements: claim periods can run 5+ years
    const rulingCutoff     = new Date('2016-01-01'); // Rulings: enforcement + appeals take time

    return prisma.lawsuit.findMany({
      where: {
        isReady:  true,
        isActive: true,
        ...(brandSlugs?.length ? { defendantSlug: { in: brandSlugs } } : {}),
        ...(status             ? { status: status as any }             : {}),
        OR: [
          { status: { in: ['FILED', 'CERTIFIED', 'DISCOVERY'] as any[] }, filingDate: { gte: filedCutoff } },
          { status: { in: ['SETTLEMENT_APPROVED'] as any[] }, filingDate: { gte: settlementCutoff } },
          { status: { in: ['SETTLEMENT', 'RULING'] as any[] }, filingDate: { gte: rulingCutoff } },
          { claimDeadline: { gte: new Date() } },
        ],
      },
      orderBy: [
        { filingDate: 'desc' },
      ],
    });
  },

  // ── User Claims (התביעות שלי) ──────────────────────────────────────────────

  async getUserClaims(userId: string, filter?: { action?: string }) {
    return prisma.userClaim.findMany({
      where: {
        userId,
        ...(filter?.action ? { action: filter.action } : {}),
      },
      include: { lawsuit: true },
      orderBy: { updatedAt: 'desc' },
    });
  },

  async upsertUserClaim(userId: string, lawsuitId: string, action: string) {
    return prisma.userClaim.upsert({
      where:  { userId_lawsuitId: { userId, lawsuitId } },
      update: { action, updatedAt: new Date() },
      create: { userId, lawsuitId, action },
    });
  },

  async getUserClaimStats(userId: string) {
    const rows = await prisma.userClaim.groupBy({
      by:     ['action'],
      where:  { userId },
      _count: true,
    });
    const stats: Record<string, number> = { JOINED: 0, SAVED: 0, DISMISSED: 0 };
    for (const r of rows) {
      stats[r.action] = r._count;
    }
    return stats;
  },

  // ── Settlements (Phase 1) ──────────────────────────────────────────────────

  /** Get active settlements + actionable rulings.
   *
   *  Filter philosophy:
   *  - User-actionable status: settlement (any sub-state) OR ruling (court win
   *    with claim window). FILED / DISMISSED / CLOSED never appear here.
   *  - Deadline: null (open-ended) or in the future. Past deadlines hide.
   *  - isReady: must have meaningful descriptor data (summary / affected group
   *    / total pool). Stops empty rows from showing as bald entries.
   *  - Category filter: optional, supports the home-screen profile categories.
   *
   *  Old logic also gated by `filingDate >= 2021` — that hid hundreds of
   *  legitimately-active older settlements. The deadline check alone is the
   *  right freshness signal: if the claim window is still open we want users
   *  to see it regardless of when the case was filed.
   */
  async getActiveSettlements(categories?: string[]) {
    const now = new Date();
    return prisma.lawsuit.findMany({
      where: {
        isReady:  true,
        isActive: true,
        ...(categories?.length ? { category: { in: categories } } : {}),
        AND: [
          {
            // Actionable: explicit settlement flag OR known settlement/ruling status
            OR: [
              { isSettlement: true },
              { status: { in: ['SETTLEMENT_APPROVED', 'SETTLEMENT', 'RULING'] as any[] } },
            ],
          },
          {
            // Deadline must be open-ended or future
            OR: [
              { claimDeadline: null },
              { claimDeadline: { gte: now } },
            ],
          },
        ],
      },
      orderBy: [
        // AI-enriched ("golden") rows first
        { estimatedPayout: { sort: 'desc', nulls: 'last' } },
        // Then by approaching deadline
        { claimDeadline:   { sort: 'asc',  nulls: 'last' } },
        // Then newest filing date
        { filingDate:      'desc' },
      ],
    });
  },

  /** Get settlements with approaching deadlines (for notifications) */
  async getSettlementsWithUpcomingDeadlines(withinDays: number) {
    const now = new Date();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + withinDays);
    return prisma.lawsuit.findMany({
      where: {
        isSettlement: true,
        isActive: true,
        claimDeadline: { gte: now, lte: cutoff },
      },
      orderBy: { claimDeadline: 'asc' },
    });
  },

  /** Mark a lawsuit as a claimable settlement with guide info */
  async markAsSettlement(id: string, data: {
    claimFormUrl?:      string;
    payoutMethod?:      string;
    distributionStatus?: string;
    claimGuideSteps?:   string[];
    claimGuideHe?:      string;
    estimatedPayout?:   string;
    category?:          string;
  }) {
    return prisma.lawsuit.update({
      where: { id },
      data: {
        isSettlement: true,
        ...data,
        claimGuideSteps: data.claimGuideSteps ?? undefined,
        lastUpdatedAt: new Date(),
      },
    });
  },

  /** Bulk assign categories to lawsuits based on their brand slug */
  async assignCategories() {
    let updated = 0;
    const lawsuits = await prisma.lawsuit.findMany({
      where: { category: null },
      select: { id: true, defendantSlug: true },
    });
    for (const l of lawsuits) {
      const cat = BRAND_TO_CATEGORY[l.defendantSlug] ?? 'other';
      await prisma.lawsuit.update({
        where: { id: l.id },
        data: { category: cat },
      });
      updated++;
    }
    return { updated };
  },

  /** Auto-mark lawsuits with settlement status as isSettlement */
  async autoDetectSettlements() {
    const result = await prisma.lawsuit.updateMany({
      where: {
        status: { in: ['SETTLEMENT_APPROVED', 'SETTLEMENT'] as any[] },
        isSettlement: false,
        isActive: true,
      },
      data: { isSettlement: true },
    });
    return { marked: result.count };
  },

  // ── Simplified Onboarding (Phase 1) ──────────────────────────────────────

  async createSimpleProfile(userId: string, profile: {
    displayName?: string;
    selectedCategories: string[];
  }) {
    // Derive selectedBrands from chosen categories so the AI eligibility engine has brand context
    const brandsFromCategories = Object.entries(BRAND_TO_CATEGORY)
      .filter(([, cat]) => profile.selectedCategories.includes(cat))
      .map(([slug]) => slug);

    return prisma.userProfile.upsert({
      where: { userId },
      update: {
        displayName:           profile.displayName,
        selectedCategories:    profile.selectedCategories,
        consumerCategoryPrefs: profile.selectedCategories,
        selectedBrands:        brandsFromCategories,
        onboardingComplete:    true,
      },
      create: {
        userId,
        displayName:           profile.displayName,
        selectedCategories:    profile.selectedCategories,
        consumerCategoryPrefs: profile.selectedCategories,
        selectedBrands:        brandsFromCategories,
        onboardingComplete:    true,
      },
    });
  },

  // ── Housekeeping ──────────────────────────────────────────────────────────

  async cleanupUnusedPDFs() {
    // Find lawsuits that are closed/dismissed and have PDFs
    const stale = await prisma.lawsuit.findMany({
      where:  { status: { in: ['CLOSED', 'DISMISSED'] }, pdfPath: { not: null } },
      select: { id: true, pdfPath: true },
    });
    const { unlink } = await import('fs/promises');
    for (const s of stale) {
      try {
        if (s.pdfPath) await unlink(s.pdfPath);
        await prisma.lawsuit.update({
          where: { id: s.id },
          data:  { pdfPath: null },
        });
      } catch { /* file may already be gone */ }
    }
    console.log(`[DB] Cleaned up ${stale.length} stale PDFs`);
  },

  // ── Incubator / יוזמת תביעה ───────────────────────────────────────────────

  async getUserRole(userId: string) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    return u?.role ?? null;
  },

  async getUserSummary(userId: string) {
    return prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, role: true, phone: true, email: true, profile: { select: { displayName: true } } },
    });
  },

  async listPendingIncubatorCases() {
    return prisma.incubatorCase.findMany({
      where:   { status: 'PENDING_REVIEW' },
      orderBy: { createdAt: 'asc' },
      include: {
        founder: { select: { id: true, phone: true, profile: { select: { displayName: true } } } },
        _count:  { select: { members: true, evidence: true } },
      },
    });
  },

  async getIncubatorCase(id: string) {
    return prisma.incubatorCase.findUnique({
      where:   { id },
      include: {
        founder: { select: { id: true, phone: true, profile: { select: { displayName: true } } } },
        _count:  { select: { members: true, evidence: true, messages: true } },
      },
    });
  },

  // Similar-case detection signal for admin: how many OTHER cases exist against the
  // same defendantCompany that are already LIVE / GOAL_REACHED / LEGAL_ACTION.
  // Admin uses this to decide whether to reject a duplicate initiative.
  async countSimilarLiveCases(defendantCompany: string, excludeId: string) {
    return prisma.incubatorCase.count({
      where: {
        id: { not: excludeId },
        defendantCompany,
        status: { in: ['LIVE', 'GOAL_REACHED', 'LEGAL_ACTION'] },
      },
    });
  },

  // Atomic: only transitions if still in PENDING_REVIEW. Returns null on race loss.
  // Writes an AdminAction audit row in the same transaction — either both land
  // or neither does, so the audit trail never drifts from the status.
  async approveIncubatorCase(id: string, adminUserId: string, adminNote?: string) {
    return prisma.$transaction(async (tx) => {
      const result = await tx.incubatorCase.updateMany({
        where: { id, status: 'PENDING_REVIEW' },
        data:  { status: 'LIVE', approvedAt: new Date(), adminNote: adminNote ?? null },
      });
      if (result.count === 0) return null;
      await tx.adminAction.create({
        data: {
          adminUserId,
          action:     'CASE_APPROVE',
          targetType: 'CASE',
          targetId:   id,
          reason:     adminNote ?? null,
          metadata:   { fromStatus: 'PENDING_REVIEW', toStatus: 'LIVE' },
        },
      });
      return tx.incubatorCase.findUnique({ where: { id } });
    });
  },

  async rejectIncubatorCase(id: string, adminUserId: string, reason: string) {
    return prisma.$transaction(async (tx) => {
      const result = await tx.incubatorCase.updateMany({
        where: { id, status: 'PENDING_REVIEW' },
        data:  { status: 'REJECTED', adminNote: reason },
      });
      if (result.count === 0) return null;
      await tx.adminAction.create({
        data: {
          adminUserId,
          action:     'CASE_REJECT',
          targetType: 'CASE',
          targetId:   id,
          reason,
          metadata:   { fromStatus: 'PENDING_REVIEW', toStatus: 'REJECTED' },
        },
      });
      return tx.incubatorCase.findUnique({ where: { id } });
    });
  },

  async requestIncubatorRevisions(id: string, adminUserId: string, note: string) {
    return prisma.$transaction(async (tx) => {
      const result = await tx.incubatorCase.updateMany({
        where: { id, status: 'PENDING_REVIEW' },
        data:  { status: 'REVISIONS_REQUESTED', adminNote: note },
      });
      if (result.count === 0) return null;
      await tx.adminAction.create({
        data: {
          adminUserId,
          action:     'CASE_REQUEST_REVISIONS',
          targetType: 'CASE',
          targetId:   id,
          reason:     note,
          metadata:   { fromStatus: 'PENDING_REVIEW', toStatus: 'REVISIONS_REQUESTED' },
        },
      });
      return tx.incubatorCase.findUnique({ where: { id } });
    });
  },

  // ── Admin audit trail ────────────────────────────────────────────────────────

  async logAdminAction(input: {
    adminUserId: string;
    action:      'CASE_APPROVE' | 'CASE_REJECT' | 'CASE_REQUEST_REVISIONS'
                | 'EVIDENCE_MARK_READY' | 'EVIDENCE_MARK_FAILED' | 'EVIDENCE_SCREENED';
    targetType:  'CASE' | 'EVIDENCE' | 'USER';
    targetId:    string;
    reason?:     string | null;
    metadata?:   Prisma.InputJsonValue | null;
  }) {
    return prisma.adminAction.create({
      data: {
        adminUserId: input.adminUserId,
        action:      input.action,
        targetType:  input.targetType,
        targetId:    input.targetId,
        reason:      input.reason ?? null,
        metadata:    input.metadata ?? Prisma.JsonNull,
      },
    });
  },

  async listAdminActions(opts: {
    limit?:      number;
    targetType?: 'CASE' | 'EVIDENCE' | 'USER';
    targetId?:   string;
    adminUserId?: string;
  } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    return prisma.adminAction.findMany({
      where: {
        ...(opts.targetType  ? { targetType:  opts.targetType  } : {}),
        ...(opts.targetId    ? { targetId:    opts.targetId    } : {}),
        ...(opts.adminUserId ? { adminUserId: opts.adminUserId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take:    limit,
      include: {
        admin: { select: { id: true, email: true, phone: true, role: true } },
      },
    });
  },

  // ── Founder flow ─────────────────────────────────────────────────────────────

  async createIncubatorCase(founderUserId: string, input: {
    title:              string;
    defendantCompany:   string;
    legalClaimType:     Prisma.IncubatorCaseCreateInput['legalClaimType'];
    damageEstimateNis:  number;
    narrative:          string;
    incidentDate?:      Date | null;
    incidentPeriodEnd?: Date | null;
    estimatedAffected?: Prisma.IncubatorCaseCreateInput['estimatedAffected'] | null;
  }) {
    return prisma.incubatorCase.create({
      data: {
        title:             input.title,
        defendantCompany:  input.defendantCompany,
        legalClaimType:    input.legalClaimType,
        damageEstimateNis: input.damageEstimateNis,
        narrative:         input.narrative,
        incidentDate:      input.incidentDate      ?? null,
        incidentPeriodEnd: input.incidentPeriodEnd ?? null,
        estimatedAffected: input.estimatedAffected ?? null,
        founderUserId,
        status:            'DRAFT',
      },
    });
  },

  async patchIncubatorCase(id: string, data: Prisma.IncubatorCaseUpdateInput) {
    return prisma.incubatorCase.update({ where: { id }, data });
  },

  async getCaseForOwner(id: string, userId: string) {
    return prisma.incubatorCase.findFirst({
      where: { id, founderUserId: userId },
      include: {
        evidence: true,
        _count:   { select: { members: true, evidence: true } },
      },
    });
  },

  async addCaseEvidence(caseId: string, uploaderUserId: string, input: {
    kind:           'TEXT' | 'URL' | 'FILE';
    textContent?:   string | null;
    externalUrl?:   string | null;
    description?:   string | null;
    // FILE-kind fields — set during complete-upload, not during reservation.
    r2KeyOriginal?: string | null;
    mimeType?:      string | null;
    originalHash?:  string | null;
  }) {
    return prisma.caseEvidence.create({
      data: {
        caseId,
        uploaderUserId,
        kind:          input.kind,
        textContent:   input.textContent   ?? null,
        externalUrl:   input.externalUrl   ?? null,
        description:   input.description   ?? null,
        r2KeyOriginal: input.r2KeyOriginal ?? null,
        mimeType:      input.mimeType      ?? null,
        originalHash:  input.originalHash  ?? null,
      },
    });
  },

  // Reserve a CaseEvidence row BEFORE the client uploads. The row starts with
  // r2KeyOriginal=null and kind=FILE; after PUT, the client calls
  // completeFileEvidence() to attach the key + mime. This two-step shape lets
  // us presign against a stable evidenceId-scoped key path.
  async reserveFileEvidence(caseId: string, uploaderUserId: string, input: {
    mimeType:    string;
    description?: string | null;
  }) {
    return prisma.caseEvidence.create({
      data: {
        caseId,
        uploaderUserId,
        kind:            'FILE',
        mimeType:        input.mimeType,
        description:     input.description ?? null,
        redactionStatus: 'PENDING',
      },
    });
  },

  // Attach the uploaded key to a reserved evidence row. Guards against a
  // completion landing on a row that's already been completed (race).
  async completeFileEvidence(evidenceId: string, uploaderUserId: string, input: {
    r2KeyOriginal: string;
    mimeType:      string;
    originalHash?: string | null;
  }) {
    const result = await prisma.caseEvidence.updateMany({
      where: {
        id:             evidenceId,
        uploaderUserId,
        kind:           'FILE',
        r2KeyOriginal:  null,
      },
      data: {
        r2KeyOriginal:  input.r2KeyOriginal,
        mimeType:       input.mimeType,
        originalHash:   input.originalHash ?? null,
      },
    });
    if (result.count === 0) return null;
    return prisma.caseEvidence.findUnique({ where: { id: evidenceId } });
  },

  async getEvidenceById(id: string) {
    return prisma.caseEvidence.findUnique({ where: { id } });
  },

  async submitIncubatorCase(id: string) {
    return prisma.incubatorCase.update({
      where: { id },
      data:  { status: 'PENDING_REVIEW' },
    });
  },

  async saveCaseAiAnalysis(id: string, data: {
    aiAnalysis:      unknown;
    aiModel:         string;
    powerScore:      number;
    legalDifficulty: number;
  }) {
    return prisma.incubatorCase.update({
      where: { id },
      data: {
        aiAnalysis:      data.aiAnalysis as any,
        aiAnalyzedAt:    new Date(),
        aiModel:         data.aiModel,
        powerScore:      data.powerScore,
        legalDifficulty: data.legalDifficulty,
      },
    });
  },

  async listMyIncubatorCases(userId: string) {
    return prisma.incubatorCase.findMany({
      where:   { founderUserId: userId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { members: true, evidence: true } } },
    });
  },

  // ── CaseMember join / referrals ───────────────────────────────────────────
  // A user joins an incubator case (optionally via a referral link). Idempotent:
  // a second call for the same (caseId, userId) returns the existing membership.
  //
  // Referral-loop guard: walking the referredBy chain inside the case must not
  // reach the joining user — prevents A→B→A farming. IP/fingerprint farming is
  // mitigated by counting distinct ReferralEvent rows per inviter+ipHash.
  async joinIncubatorCase(input: {
    caseId:            string;
    userId:            string;
    referralToken?:    string | null;
    ipHash?:           string | null;
    deviceFingerprint?: string | null;
    personalDamageNis?: number | null;
  }) {
    return prisma.$transaction(async (tx) => {
      const kase = await tx.incubatorCase.findUnique({
        where:  { id: input.caseId },
        select: { id: true, status: true, founderUserId: true },
      });
      if (!kase) throw new Error('CASE_NOT_FOUND');

      // Only LIVE / GOAL_REACHED / LEGAL_ACTION accept new members. DRAFT /
      // PENDING_REVIEW / REVISIONS_REQUESTED / REJECTED / CLOSED reject.
      if (!['LIVE', 'GOAL_REACHED', 'LEGAL_ACTION'].includes(kase.status)) {
        throw new Error(`CASE_NOT_OPEN:${kase.status}`);
      }
      if (kase.founderUserId === input.userId) {
        throw new Error('CASE_FOUNDER_CANNOT_REJOIN');
      }

      // Idempotent: return existing membership.
      const existing = await tx.caseMember.findUnique({
        where: { caseId_userId: { caseId: input.caseId, userId: input.userId } },
      });
      if (existing) return { member: existing, alreadyMember: true };

      // Resolve referral token (if any) to an inviter in this case.
      let referredByUserId: string | null = null;
      let referral: { id: string; inviterUserId: string } | null = null;
      if (input.referralToken) {
        const r = await tx.referralEvent.findUnique({
          where:  { linkToken: input.referralToken },
          select: { id: true, inviterUserId: true, caseId: true, inviteeUserId: true },
        });
        if (r && r.caseId === input.caseId && r.inviterUserId !== input.userId) {
          // Walk the chain up via CaseMember.referredByUserId to block cycles.
          const chain = new Set<string>();
          let cursor: string | null = r.inviterUserId;
          let depth = 0;
          while (cursor && depth < 32) {
            if (cursor === input.userId) {
              throw new Error('REFERRAL_CYCLE_DETECTED');
            }
            if (chain.has(cursor)) break; // malformed data — stop, don't loop
            chain.add(cursor);
            const up: { referredByUserId: string | null } | null =
              await tx.caseMember.findUnique({
                where:  { caseId_userId: { caseId: input.caseId, userId: cursor } },
                select: { referredByUserId: true },
              });
            cursor = up?.referredByUserId ?? null;
            depth++;
          }
          referredByUserId = r.inviterUserId;
          referral = { id: r.id, inviterUserId: r.inviterUserId };
        }
      }

      const member = await tx.caseMember.create({
        data: {
          caseId:            input.caseId,
          userId:            input.userId,
          role:              'MEMBER',
          personalDamageNis: input.personalDamageNis ?? null,
          referredByUserId,
        },
      });

      if (referral) {
        await tx.referralEvent.update({
          where: { id: referral.id },
          data:  {
            inviteeUserId: input.userId,
            convertedAt:   new Date(),
            ipHash:        input.ipHash ?? undefined,
            deviceFingerprint: input.deviceFingerprint ?? undefined,
          },
        });
        // Award inviter a small influence bump (capped by farming detection below).
        await tx.caseMember.updateMany({
          where: { caseId: input.caseId, userId: referral.inviterUserId },
          data:  { influencePoints: { increment: 10 } },
        });
      }

      return { member, alreadyMember: false, referredByUserId };
    }, { isolationLevel: 'Serializable' });
  },

  async createReferralLink(caseId: string, inviterUserId: string) {
    // Inviter must be an existing member (or the founder) of this case.
    const kase = await prisma.incubatorCase.findUnique({
      where:  { id: caseId },
      select: { founderUserId: true, status: true },
    });
    if (!kase) throw new Error('CASE_NOT_FOUND');
    const isFounder = kase.founderUserId === inviterUserId;
    if (!isFounder) {
      const member = await prisma.caseMember.findUnique({
        where: { caseId_userId: { caseId, userId: inviterUserId } },
        select: { id: true },
      });
      if (!member) throw new Error('NOT_A_MEMBER');
    }
    // 22-char url-safe token — cryptographically random.
    const { randomBytes } = await import('crypto');
    const linkToken = randomBytes(16).toString('base64url');
    const ev = await prisma.referralEvent.create({
      data: { caseId, inviterUserId, linkToken },
    });
    return ev;
  },

  async recordReferralClick(linkToken: string, ipHash?: string | null, fingerprint?: string | null) {
    const existing = await prisma.referralEvent.findUnique({
      where: { linkToken },
      select: { id: true, clickedAt: true, caseId: true, inviterUserId: true },
    });
    if (!existing) return null;
    if (!existing.clickedAt) {
      await prisma.referralEvent.update({
        where: { id: existing.id },
        data:  {
          clickedAt:         new Date(),
          ipHash:            ipHash ?? undefined,
          deviceFingerprint: fingerprint ?? undefined,
        },
      });
    }
    return { caseId: existing.caseId, inviterUserId: existing.inviterUserId };
  },

  // ── Anti-farming aggregate caps ──────────────────────────────────────────
  // These are cheap ipHash-window counts used by the click & join handlers
  // to detect "one person spinning up 50 accounts from the same IP" style
  // abuse. They do NOT block innocent shared-WiFi users at low counts —
  // thresholds in the handlers are intentionally generous (50 clicks/hour,
  // 20 joins/day). Swap to Redis if we ever shard.

  async countReferralClicksByIpHash(ipHash: string, windowMs: number): Promise<number> {
    if (!ipHash) return 0;
    const since = new Date(Date.now() - windowMs);
    return prisma.referralEvent.count({
      where: { ipHash, clickedAt: { gte: since } },
    });
  },

  async countReferralConversionsByIpHash(ipHash: string, windowMs: number): Promise<number> {
    if (!ipHash) return 0;
    const since = new Date(Date.now() - windowMs);
    return prisma.referralEvent.count({
      where: { ipHash, convertedAt: { gte: since } },
    });
  },

  async countCasesCreatedByUserSince(userId: string, windowMs: number): Promise<number> {
    const since = new Date(Date.now() - windowMs);
    return prisma.incubatorCase.count({
      where: { founderUserId: userId, createdAt: { gte: since } },
    });
  },

  // ── Global search (Explore tab) ───────────────────────────────────────────
  // Two ILIKE queries + client-side merge. Hebrew collation doesn't need
  // special config for ILIKE on Postgres; accents/niqqud are not expected.
  // Only user-visible records are returned: Lawsuit.isReady = true and
  // IncubatorCase.status IN (LIVE, GOAL_REACHED, LEGAL_ACTION).
  async globalSearch(rawQuery: string, opts: { limit?: number } = {}) {
    const q = rawQuery.trim();
    if (q.length < 2) return { lawsuits: [], cases: [] };
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
    const [lawsuits, cases] = await Promise.all([
      prisma.lawsuit.findMany({
        where: {
          isReady: true,
          OR: [
            { defendantName: { contains: q, mode: 'insensitive' } },
            { caseNumber:    { contains: q, mode: 'insensitive' } },
            { summary:       { contains: q, mode: 'insensitive' } },
            { category:      { contains: q, mode: 'insensitive' } },
          ],
        },
        orderBy: [{ filingDate: 'desc' }, { lastUpdatedAt: 'desc' }],
        take:    limit,
        select: {
          id: true, caseNumber: true, defendantName: true, defendantSlug: true,
          status: true, category: true, summary: true, filingDate: true,
          claimDeadline: true, payoutMinILS: true, payoutMaxILS: true,
        },
      }),
      prisma.incubatorCase.findMany({
        where: {
          status: { in: ['LIVE', 'GOAL_REACHED', 'LEGAL_ACTION'] },
          OR: [
            { title:            { contains: q, mode: 'insensitive' } },
            { defendantCompany: { contains: q, mode: 'insensitive' } },
            { narrative:        { contains: q, mode: 'insensitive' } },
          ],
        },
        orderBy: [{ powerScore: 'desc' }, { createdAt: 'desc' }],
        take:    limit,
        select: {
          id: true, title: true, defendantCompany: true, status: true,
          legalClaimType: true, powerScore: true, damageEstimateNis: true,
          goalMembers: true, createdAt: true,
          _count: { select: { members: true } },
        },
      }),
    ]);
    return { lawsuits, cases };
  },

  // Admin closes out a MANUAL_REVIEW on a piece of evidence — either marking
  // it READY (with a pointer to the redacted file the admin uploaded) or
  // FAILED (rejecting the evidence). Atomic: returns null if the evidence is
  // not in MANUAL_REVIEW (guards against overwriting a later decision).
  async resolveEvidenceReview(
    evidenceId: string,
    adminUserId: string,
    decision:   'READY' | 'FAILED',
    r2KeyRedacted: string | null,
  ) {
    return prisma.$transaction(async (tx) => {
      const result = await tx.caseEvidence.updateMany({
        where: { id: evidenceId, redactionStatus: 'MANUAL_REVIEW' },
        data:  {
          redactionStatus:   decision,
          r2KeyRedacted:     decision === 'READY' ? r2KeyRedacted : null,
          verifiedByAdminId: adminUserId,
        },
      });
      if (result.count === 0) return null;
      await tx.adminAction.create({
        data: {
          adminUserId,
          action:     decision === 'READY' ? 'EVIDENCE_MARK_READY' : 'EVIDENCE_MARK_FAILED',
          targetType: 'EVIDENCE',
          targetId:   evidenceId,
          metadata:   {
            fromStatus: 'MANUAL_REVIEW',
            toStatus:   decision,
            ...(decision === 'READY' && r2KeyRedacted ? { r2KeyRedacted } : {}),
          },
        },
      });
      return tx.caseEvidence.findUnique({ where: { id: evidenceId } });
    });
  },

  async listCaseMembers(caseId: string, opts: { limit?: number } = {}) {
    return prisma.caseMember.findMany({
      where:   { caseId },
      orderBy: { joinedAt: 'asc' },
      take:    Math.min(Math.max(opts.limit ?? 100, 1), 500),
      select: {
        id: true, userId: true, role: true, influencePoints: true,
        kycLevel: true, joinedAt: true, personalDamageNis: true,
        user: { select: { id: true, profile: { select: { displayName: true } } } },
      },
    });
  },

  // ── Legal Consultation ────────────────────────────────────────────────────
  // Chat threads between a user and the AI legal consultant.
  // Mode STRENGTHEN binds the thread to a specific IncubatorCase (caseId set);
  // Mode GENERAL is free-form (caseId null). Stage-2 lawyer handoff is marked
  // by setting status='ESCALATED_TO_LAWYER' — not wired to a real lawyer yet.

  async createLegalThread(userId: string, input: {
    mode:   'STRENGTHEN' | 'GENERAL';
    caseId?: string | null;
    title?: string | null;
  }) {
    // Defensive: for STRENGTHEN the caseId must belong to this user. The caller
    // should already have checked, but double-check here to avoid leaking
    // someone else's case into a thread header.
    if (input.mode === 'STRENGTHEN') {
      if (!input.caseId) throw new Error('caseId is required for STRENGTHEN mode');
      const owns = await prisma.incubatorCase.findFirst({
        where:  { id: input.caseId, founderUserId: userId },
        select: { id: true, title: true },
      });
      if (!owns) throw new Error('Case not found or not owned by user');
      return prisma.legalThread.create({
        data: {
          userId,
          mode:   'STRENGTHEN',
          caseId: input.caseId,
          title:  input.title ?? `חיזוק: ${owns.title}`.slice(0, 200),
        },
      });
    }
    return prisma.legalThread.create({
      data: {
        userId,
        mode:   'GENERAL',
        caseId: null,
        title:  input.title ?? null,
      },
    });
  },

  async listLegalThreads(userId: string) {
    return prisma.legalThread.findMany({
      where:   { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { messages: true } },
        case:   { select: { id: true, title: true, powerScore: true, status: true } },
      },
    });
  },

  async getLegalThreadForUser(threadId: string, userId: string) {
    return prisma.legalThread.findFirst({
      where: { id: threadId, userId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        case:     { select: { id: true, title: true, powerScore: true, status: true } },
      },
    });
  },

  async updateLegalThreadTitle(threadId: string, userId: string, title: string) {
    // Scope by userId so one user can't rename another's thread.
    return prisma.legalThread.updateMany({
      where: { id: threadId, userId },
      data:  { title },
    });
  },

  async setLegalThreadStatus(
    threadId: string,
    userId:   string,
    status:   'ACTIVE' | 'RESOLVED' | 'ESCALATED_TO_LAWYER' | 'ARCHIVED',
  ) {
    return prisma.legalThread.updateMany({
      where: { id: threadId, userId },
      data:  { status },
    });
  },
};

// ── Date parsing helper ──────────────────────────────────────────────────────

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// ── Amount parsing helper ────────────────────────────────────────────────────

function parseAmount(value?: string | null, maxVal = 9999999999): number | null {
  if (!value) return null;
  // Remove commas, spaces, currency symbols, ₪
  const cleaned = value.replace(/[,\s₪]/g, '').trim();
  const num = Number(cleaned);
  if (!isFinite(num) || num <= 0) return null;
  return num <= maxVal ? num : null; // skip values that overflow Decimal precision
}

// Use shared mapStatus from types.ts (single source of truth)
const mapStatus = sharedMapStatus;
