// backend/api/server.ts
// שרת ה-API — נקודת הכניסה לכל ה-backend
// הרץ: npm run dev

import express from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { handleCronScrape, handleCronStatusCheck, getAgentStatus, processEvents } from '../orchestrator/index';
import { checkDeadlines } from '../agents/deadlineNotifier';
import { computeMatches } from '../services/matchingEngine';
import { recordUserFeedback } from '../agents/pushAgent';
import { db, prisma, withDbRetry } from '../db/index';
import { enrichOne, enrichAllPending } from '../skills/enrichWithAI';
import { streamLawsuitSummary } from '../skills/summaryAI';
import { checkEligibility, getCachedEligibility, recheckEligibilityWithAnswers, classifySettlement } from '../skills/eligibilityAI';
import { scrapeCourtRegistry, scrapeFullRange } from '../skills/scrapeCourtRegistry';
import { SETTLEMENT_CATEGORIES } from '../types';

const app  = express();
const PORT = process.env.PORT ?? 3001;
const JWT_SECRET = process.env.JWT_SECRET ?? (() => {
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production');
  console.warn('[WARN] JWT_SECRET not set — using dev fallback. Set JWT_SECRET in .env for production.');
  return 'dev-only-jwt-secret-DO-NOT-USE-IN-PRODUCTION';
})();

// Trust the first proxy hop in production so req.ip reflects the real client
// (needed for the rate limiter and for the referral-farming ipHash). Behind
// more than one hop, set TRUST_PROXY to the hop count explicitly.
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy) {
  const n = Number(trustProxy);
  app.set('trust proxy', Number.isFinite(n) ? n : trustProxy);
} else if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(express.json({ limit: '20mb' })); // evidence screening sends base64 images

// ── CORS ────────────────────────────────────────────────────────────────────
// Wildcard + Authorization is dangerous: once the mobile app's token lands in a
// web context, any site could call our API on the user's behalf. Restrict to a
// known allowlist; dev falls back to localhost only.
const CORS_ALLOWLIST = (process.env.CORS_ORIGINS ?? 'http://localhost:8081,http://localhost:3000,http://localhost:19006')
  .split(',').map(o => o.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && CORS_ALLOWLIST.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH');
  if (req.method === 'OPTIONS') { res.sendStatus(200); return; }
  next();
});

// ── Middleware: בדוק CRON_SECRET לנקודות קצה אוטומטיות ─────────────────────
function requireCronSecret(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== process.env.CRON_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// ── In-memory rate limiter ────────────────────────────────────────────────────
// Protects billed Anthropic endpoints from single-user abuse. Single-process
// memory is fine for the current MVP deployment; if this ever runs behind a
// multi-instance load balancer, swap this for a Redis token bucket.
type RLBucket = { count: number; windowStart: number };
const rateLimiters = new Map<string, RLBucket>();
function rateLimit(opts: { windowMs: number; max: number; name: string }) {
  return (req: AuthRequest, res: express.Response, next: express.NextFunction) => {
    const key = `${opts.name}:${req.userId ?? req.ip ?? 'anon'}`;
    const now = Date.now();
    const b = rateLimiters.get(key);
    if (!b || now - b.windowStart >= opts.windowMs) {
      rateLimiters.set(key, { count: 1, windowStart: now });
      return next();
    }
    if (b.count >= opts.max) {
      const retryAfter = Math.ceil((b.windowStart + opts.windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'Too many requests', retryAfter });
      return;
    }
    b.count++;
    next();
  };
}
// Periodic cleanup so long-lived processes don't grow the map unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateLimiters) {
    if (now - b.windowStart > 3_600_000) rateLimiters.delete(k);
  }
}, 10 * 60 * 1000);

const aiLimit = rateLimit({ windowMs: 60_000, max: 10, name: 'ai' });

// Anti-farming caps. Thresholds are intentionally loose — they catch
// "spin up 200 accounts from the same IP" style abuse, not normal usage.
//   registerLimit       — 10 new accounts / hour / IP (protects the signup door)
//   createCaseLimit     — 5 cases / day / user (creating cases is heavy;
//                         anyone making more is probably spamming)
//   referralLinkLimit   — 30 new links / hour / user (one user generating
//                         hundreds of links is the classic farming tell)
// Paired with ipHash aggregate caps on click & join below.
const registerLimit     = rateLimit({ windowMs: 60 * 60_000,      max: 10, name: 'register' });
const createCaseLimit   = rateLimit({ windowMs: 24 * 60 * 60_000, max: 5,  name: 'createCase' });
const referralLinkLimit = rateLimit({ windowMs: 60 * 60_000,      max: 30, name: 'refLink' });

// ── Middleware: JWT auth for user endpoints ───────────────────────────────────
interface AuthRequest extends express.Request {
  userId?: string;
}

function requireAuth(req: AuthRequest, res: express.Response, next: express.NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

// ── בריאות ──────────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await withDbRetry(() => db.countPendingEvents()); // auto-wakes Neon on cold start
    res.json({ ok: true, db: 'connected', ts: new Date().toISOString() });
  } catch {
    res.status(503).json({ ok: false, db: 'disconnected' });
  }
});

// ── Auth — הרשמה והתחברות ─────────────────────────────────────────────────────

const registerSchema = z.object({
  phone:          z.string().min(9).max(15).optional(),
  email:          z.string().email().optional(),
  expoPushToken:  z.string().optional(),
}).refine(data => data.phone || data.email, { message: 'Phone or email required' });

app.post('/api/auth/register', registerLimit, async (req, res) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      return;
    }
    const { phone, email, expoPushToken } = parsed.data;

    // Check if user already exists (withDbRetry wakes Neon on cold start)
    if (phone) {
      const existing = await withDbRetry(() => db.getUserByPhone(phone));
      if (existing) {
        const token = jwt.sign({ userId: existing.id }, JWT_SECRET, { expiresIn: '90d' });
        res.json({ token, userId: existing.id, isNew: false });
        return;
      }
    }
    if (email) {
      const existing = await db.getUserByEmail(email);
      if (existing) {
        const token = jwt.sign({ userId: existing.id }, JWT_SECRET, { expiresIn: '90d' });
        res.json({ token, userId: existing.id, isNew: false });
        return;
      }
    }

    const user = await db.createUser({ phone, email, expoPushToken });
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '90d' });
    res.status(201).json({ token, userId: user.id, isNew: true });
  } catch (err: any) {
    console.error('[Register] Error:', err);
    res.status(500).json({ error: err?.message ?? JSON.stringify(err) });
  }
});

// ── Onboarding — save user profile after brand/category selection ─────────────

const onboardingSchema = z.object({
  selectedBrands:   z.array(z.string()).min(1),
  categories:       z.array(z.string()).default([]),
  frequency:        z.enum(['DAILY', 'SEVERAL_TIMES_WEEK', 'WEEKLY', 'BI_WEEKLY', 'MONTHLY']).default('WEEKLY'),
  householdSize:    z.number().int().min(1).max(20).default(2),
  expoPushToken:    z.string().optional(),
});

app.post('/api/user/onboarding', requireAuth, async (req: AuthRequest, res) => {
  try {
    const parsed = onboardingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      return;
    }
    const { selectedBrands, categories, frequency, householdSize, expoPushToken } = parsed.data;

    await withDbRetry(() => db.createUserProfile(req.userId!, {
      selectedBrands,
      consumerCategoryPrefs: categories,
      shoppingFrequency: frequency,
      householdSize,
    }));

    if (expoPushToken) {
      await withDbRetry(() => db.updateExpoPushToken(req.userId!, expoPushToken));
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── User profile retrieval ──────────────────────────────────────────────────

app.get('/api/user/profile', requireAuth, async (req: AuthRequest, res) => {
  try {
    const profile = await withDbRetry(() => db.getUserProfile(req.userId!));
    if (!profile) {
      res.json({ profile: null });
      return;
    }
    res.json({
      profile: {
        selectedBrands:   profile.selectedBrands,
        categories:       profile.consumerCategoryPrefs,
        frequency:        profile.shoppingFrequency,
        householdSize:    profile.householdSize,
        onboardingComplete: profile.onboardingComplete,
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── Notification preferences ───────────────────────────────────────────────

const notifPrefSchema = z.object({
  preference: z.enum(['ALL', 'ACTIONABLE', 'WEEKLY_DIGEST', 'NONE']),
});

app.put('/api/user/notification-pref', requireAuth, async (req: AuthRequest, res) => {
  try {
    const parsed = notifPrefSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      return;
    }
    await withDbRetry(() => prisma.userProfile.update({
      where: { userId: req.userId! },
      data: { notificationPref: parsed.data.preference as any },
    }));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── Push token update ──────────────────────────────────────────────────────

app.put('/api/user/push-token', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      res.status(400).json({ error: 'Missing push token' });
      return;
    }
    await withDbRetry(() => db.updateExpoPushToken(req.userId!, token));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── Matching — נקודת הקצה הראשית שהאפליקציה קוראת ──────────────────────────

const matchesSchema = z.object({
  selectedBrands:   z.array(z.string()).default([]),
  categories:       z.array(z.string()).default([]),
  frequency:        z.enum(['DAILY', 'SEVERAL_TIMES_WEEK', 'WEEKLY', 'BI_WEEKLY', 'MONTHLY']).default('WEEKLY'),
  householdSize:    z.number().int().min(1).max(20).default(2),
});

app.post('/api/matches', aiLimit, async (req, res) => {
  try {
    const parsed = matchesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      return;
    }
    const { selectedBrands, categories, frequency, householdSize } = parsed.data;

    const rawLawsuits = await withDbRetry(() => db.getReadyLawsuits(selectedBrands.length ? selectedBrands : undefined));

    // Transform Prisma results to match engine's Lawsuit interface
    const lawsuits = rawLawsuits.map(l => ({
      id:                       l.id,
      caseNumber:               l.caseNumber,
      brandName:                l.defendantName,
      defendants:               [l.defendantSlug],
      caseTitleEn:              l.summary ?? l.caseNumber,
      caseTitleHe:              l.summary ?? undefined,
      court:                    l.court ?? undefined,
      status:                   l.status as any,
      priority:                 'MEDIUM' as const,
      isIsraeli:                true,
      isGlobal:                 false,
      potentialPayout:          l.payoutMinILS && l.payoutMaxILS ? `₪${l.payoutMinILS}–₪${l.payoutMaxILS}` : undefined,
      estimatedPoolILS:         l.totalPoolILS ? Number(l.totalPoolILS) : undefined,
      classSize:                l.classSizeEstimate?.toString(),
      affectedProductCategories: [],
      summary:                  l.summary ?? '',
      eligibilityCriteria:      l.eligibilityCriteria ?? '',
      claimDeadline:            l.claimDeadline?.toISOString(),
      confidence:               l.confidence as any,
    }));

    const matches = computeMatches(
      { id: 'temp', selectedBrands, consumerCategoryPrefs: categories, shoppingFrequency: frequency, householdSize },
      lawsuits
    );

    res.json({ matches, total: matches.length });
  } catch (err) {
    console.error('/api/matches error:', err);
    res.status(500).json({ error: 'Matching failed' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  PHASE 1 — SETTLEMENT ENDPOINTS (simplified)
// ════════════════════════════════════════════════════════════════════════════

// ── Active settlements — "כסף שמחכה לך" ─────────────────────────────────────
app.get('/api/settlements', async (req, res) => {
  try {
    const categories = req.query.categories
      ? String(req.query.categories).split(',')
      : undefined;
    const settlements = await withDbRetry(() => db.getActiveSettlements(categories));
    res.json({ settlements, total: settlements.length });
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── Single settlement detail ─────────────────────────────────────────────────
app.get('/api/settlements/:id', async (req, res) => {
  try {
    const settlement = await withDbRetry(() => db.getLawsuitById(req.params.id));
    if (!settlement || !settlement.isSettlement) {
      res.status(404).json({ error: 'Settlement not found' });
      return;
    }
    res.json(settlement);
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── Simplified onboarding (Phase 1) ─────────────────────────────────────────
const simpleOnboardingSchema = z.object({
  displayName:        z.string().min(1).max(50).optional(),
  selectedCategories: z.array(z.string()).min(1),
  expoPushToken:      z.string().optional(),
});

app.post('/api/user/onboarding/simple', requireAuth, async (req: AuthRequest, res) => {
  try {
    const parsed = simpleOnboardingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      return;
    }
    const { displayName, selectedCategories, expoPushToken } = parsed.data;

    await withDbRetry(() => db.createSimpleProfile(req.userId!, {
      displayName,
      selectedCategories,
    }));

    if (expoPushToken) {
      await withDbRetry(() => db.updateExpoPushToken(req.userId!, expoPushToken));
    }

    res.json({ ok: true });
  } catch (err: any) {
    console.error('[Onboarding Simple] Error:', err);
    const msg = err instanceof Error ? err.message : JSON.stringify(err);
    res.status(500).json({ error: msg });
  }
});

// ── Mark settlement as claimed by user ──────────────────────────────────────
const claimSettlementSchema = z.object({
  lawsuitId: z.string().min(1),
  action:    z.enum(['INTERESTED', 'CLAIMED', 'DISMISSED']),
});

app.post('/api/user/settlements', requireAuth, async (req: AuthRequest, res) => {
  try {
    const parsed = claimSettlementSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      return;
    }
    const { lawsuitId, action } = parsed.data;
    // Map new actions to existing UserClaim model
    const mappedAction = action === 'INTERESTED' ? 'SAVED' : action === 'CLAIMED' ? 'JOINED' : 'DISMISSED';
    const claim = await withDbRetry(() => db.upsertUserClaim(req.userId!, lawsuitId, mappedAction));
    res.json({ ok: true, claim });
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── My settlements ─────────────────────────────────────────────────────────
app.get('/api/user/settlements', requireAuth, async (req: AuthRequest, res) => {
  try {
    const claims = await withDbRetry(() => db.getUserClaims(req.userId!));
    // Filter to only settlements
    const settlements = claims.filter(c => (c.lawsuit as any).isSettlement);
    res.json({ settlements, total: settlements.length });
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── Admin: assign categories + auto-detect settlements ──────────────────────
app.post('/api/admin/init-settlements', requireCronSecret, async (_req, res) => {
  try {
    const [catResult, settResult] = await Promise.all([
      db.assignCategories(),
      db.autoDetectSettlements(),
    ]);
    res.json({ categories: catResult, settlements: settResult });
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── Admin: mark specific lawsuit as settlement with claim guide ─────────────
const markSettlementSchema = z.object({
  claimFormUrl:       z.string().optional(),
  payoutMethod:       z.string().optional(),
  distributionStatus: z.string().optional(),
  claimGuideSteps:    z.array(z.string()).optional(),
  claimGuideHe:       z.string().optional(),
  estimatedPayout:    z.string().optional(),
  category:           z.string().optional(),
});

app.put('/api/admin/settlement/:id', requireCronSecret, async (req, res) => {
  try {
    const parsed = markSettlementSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      return;
    }
    const result = await db.markAsSettlement(req.params.id, parsed.data);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── Categories list ─────────────────────────────────────────────────────────
app.get('/api/categories', (_req, res) => {
  res.json({ categories: SETTLEMENT_CATEGORIES });
});

// ════════════════════════════════════════════════════════════════════════════
//  LEGACY ENDPOINTS (kept for backward compatibility)
// ════════════════════════════════════════════════════════════════════════════

// ── תביעות ─────────────────────────────────────────────────────────────────
// ── Global search (Explore tab) — unified lawsuit + incubator-case lookup ────
const searchLimit = rateLimit({ windowMs: 60_000, max: 30, name: 'search' });
app.get('/api/search', searchLimit, async (req, res) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) { res.json({ lawsuits: [], cases: [], query: q }); return; }
    if (q.length > 100) { res.status(400).json({ error: 'Query too long' }); return; }
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 50);
    const result = await withDbRetry(() => db.globalSearch(q, { limit }));
    res.json({ ...result, query: q });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

app.get('/api/lawsuits', async (req, res) => {
  try {
    const { brand, status } = req.query;
    const lawsuits = await withDbRetry(() => db.getReadyLawsuits(
      brand ? [String(brand)] : undefined,
      status ? String(status) : undefined
    ));
    res.json({ lawsuits, total: lawsuits.length });
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

app.get('/api/lawsuits/:id', async (req, res) => {
  try {
    const lawsuit = await withDbRetry(() => db.getLawsuitById(req.params.id));
    if (!lawsuit) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(lawsuit);
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── AI Summary — streams plain-Hebrew summary via SSE ────────────────────────
// GET /api/lawsuits/:id/summary
// Client consumes Server-Sent Events: data: <chunk>\n\n  |  data: [DONE]\n\n
app.get('/api/lawsuits/:id/summary', aiLimit, async (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (chunk: string) => {
    res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
  };

  await streamLawsuitSummary(req.params.id, {
    onChunk: (text) => send(text),
    onDone:  (_full) => {
      res.write('data: [DONE]\n\n');
      res.end();
    },
    onError: (err) => {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    },
  });
});

// ── AI Eligibility Check ────────────────────────────────────────────────────
// GET /api/lawsuits/:id/eligibility — returns YES/NO/MAYBE with explanation
app.get('/api/lawsuits/:id/eligibility', aiLimit, async (req: AuthRequest, res) => {
  try {
    // Try to get userId from JWT if present (optional auth)
    let userId: string | undefined;
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
        userId = payload.userId;
      } catch { /* no auth is fine */ }
    }

    // Check cache first
    if (userId) {
      const cached = await getCachedEligibility(userId, req.params.id);
      if (cached) { res.json(cached); return; }
    }

    const result = await checkEligibility(req.params.id, userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── AI Eligibility Follow-Up — re-check after user answers questions ─────────
// POST /api/lawsuits/:id/eligibility/followup

const followUpSchema = z.object({
  answers: z.array(z.object({
    question: z.string().min(1),
    answer:   z.string().min(1),
  })).min(1).max(3),
});

app.post('/api/lawsuits/:id/eligibility/followup', requireAuth, aiLimit, async (req: AuthRequest, res) => {
  try {
    const parsed = followUpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      return;
    }
    const result = await recheckEligibilityWithAnswers(req.params.id, req.userId!, parsed.data.answers);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── 4-State Settlement Classification Engine ────────────────────────────────
// GET /api/settlements/:id/classify
// Optional auth — if token present, personalizes to user; otherwise generic

app.get('/api/settlements/:id/classify', aiLimit, async (req: AuthRequest, res) => {
  try {
    let userId: string | undefined;
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
        userId = payload.userId;
      } catch { /* optional auth */ }
    }
    const result = await classifySettlement(req.params.id, userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// POST /api/settlements/:id/classify — re-classify after follow-up answers
app.post('/api/settlements/:id/classify', aiLimit, async (req: AuthRequest, res) => {
  try {
    let userId: string | undefined;
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
        userId = payload.userId;
      } catch { /* optional */ }
    }
    const answers = req.body?.answers ?? [];
    const result = await classifySettlement(req.params.id, userId, answers);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── התביעות שלי (My Claims) ──────────────────────────────────────────────────

app.get('/api/user/claims', requireAuth, async (req: AuthRequest, res) => {
  try {
    const action = req.query.action ? String(req.query.action) : undefined;
    const claims = await withDbRetry(() => db.getUserClaims(req.userId!, { action }));
    res.json({ claims, total: claims.length });
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

app.get('/api/user/claims/stats', requireAuth, async (req: AuthRequest, res) => {
  try {
    const stats = await withDbRetry(() => db.getUserClaimStats(req.userId!));
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

const claimSchema = z.object({
  lawsuitId: z.string().min(1),
  action:    z.enum(['JOINED', 'DISMISSED', 'SAVED']),
});

app.post('/api/user/claims', requireAuth, async (req: AuthRequest, res) => {
  try {
    const parsed = claimSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      return;
    }
    const { lawsuitId, action } = parsed.data;
    const claim = await withDbRetry(() => db.upsertUserClaim(req.userId!, lawsuitId, action));

    // גם מעדכן את ה-feedback loop של pushAgent (תאימות לאחור)
    try {
      await withDbRetry(() => recordUserFeedback({ userId: req.userId!, lawsuitId, action }));
    } catch {
      // לא קריטי — המשיכו גם אם ה-feedback נכשל
    }

    res.json({ ok: true, claim });
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── פידבק משתמש (לוגיקת למידה עצמית) ───────────────────────────────────────

// IDOR fix: ignore any userId the client sends — always derive from JWT.
const feedbackSchema = z.object({
  lawsuitId: z.string().min(1),
  action:    z.enum(['JOINED', 'DISMISSED', 'SAVED', 'AI_INSIGHT_VIEWED']),
});

app.post('/api/user/feedback', requireAuth, async (req: AuthRequest, res) => {
  try {
    const parsed = feedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      return;
    }
    await withDbRetry(() => recordUserFeedback({ ...parsed.data, userId: req.userId! }));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── AI Insight ───────────────────────────────────────────────────────────────
// Canonical endpoint: insight is always for the authenticated user.
app.get('/api/insights/:lawsuitId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const insight = await withDbRetry(() => db.getAIInsight(req.userId!, req.params.lawsuitId));
    if (!insight) { res.status(404).json({ error: 'No insight yet' }); return; }
    await withDbRetry(() => db.markInsightViewed(req.userId!, req.params.lawsuitId));
    res.json(insight);
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// Back-compat alias — ignores the path userId (IDOR fix) and uses JWT identity.
app.get('/api/insights/:userId/:lawsuitId', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (req.params.userId !== req.userId) {
      res.status(403).json({ error: 'Cannot read another user\'s insight' });
      return;
    }
    const insight = await withDbRetry(() => db.getAIInsight(req.userId!, req.params.lawsuitId));
    if (!insight) { res.status(404).json({ error: 'No insight yet' }); return; }
    await withDbRetry(() => db.markInsightViewed(req.userId!, req.params.lawsuitId));
    res.json(insight);
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── Cron endpoints (מופעלים ע"י GitHub Actions) ──────────────────────────────
app.post('/api/agents/cron/scrape', requireCronSecret, async (_req, res) => {
  try {
    const result = await handleCronScrape();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

app.post('/api/agents/cron/status-check', requireCronSecret, async (_req, res) => {
  try {
    const result = await handleCronStatusCheck();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

app.post('/api/agents/events/process', requireCronSecret, async (_req, res) => {
  try {
    await processEvents();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── Deadline check (Phase 1 — daily cron) ────────────────────────────────────
app.post('/api/agents/cron/deadlines', requireCronSecret, async (_req, res) => {
  try {
    const result = await checkDeadlines();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── ניטור (Dashboard פנימי) ───────────────────────────────────────────────────
app.get('/api/agents/status', async (_req, res) => {
  try {
    const status = await getAgentStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// Debug: total lawsuit count (includes unverified)
app.get('/api/debug/counts', async (_req, res) => {
  try {
    const [total, ready, unverified] = await Promise.all([
      prisma.lawsuit.count(),
      prisma.lawsuit.count({ where: { isReady: true } }),
      prisma.lawsuit.count({ where: { isReady: false } }),
    ]);
    const byBrand = await prisma.lawsuit.groupBy({
      by: ['defendantSlug'],
      _count: true,
      orderBy: { _count: { defendantSlug: 'desc' } },
      take: 15,
    });
    const dateRange = await prisma.lawsuit.aggregate({
      _min: { filingDate: true },
      _max: { filingDate: true },
    });
    const byStatus = await prisma.lawsuit.groupBy({
      by: ['status'],
      _count: true,
      orderBy: { _count: { status: 'desc' } },
    });
    res.json({ total, ready, unverified, topBrands: byBrand, dateRange, byStatus });
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── Admin: AI Enrichment ─────────────────────────────────────────────────────
app.post('/api/admin/enrich', requireCronSecret, async (_req, res) => {
  try {
    const batchSize = Number(_req.query.batch) || 10;
    const max = Number(_req.query.max) || 50;
    const result = await enrichAllPending(batchSize, max);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

app.post('/api/admin/enrich/:id', requireCronSecret, async (req, res) => {
  try {
    const result = await enrichOne(req.params.id);
    if (!result) { res.status(404).json({ error: 'Not found or enrichment failed' }); return; }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── Admin: Court Registry Scraper ────────────────────────────────────────────
app.post('/api/admin/scrape-court', requireCronSecret, async (req, res) => {
  try {
    const { dateFrom, dateTo, headless = true, brandFilterOnly = false } = req.body;
    if (!dateFrom || !dateTo) {
      res.status(400).json({ error: 'dateFrom and dateTo required (YYYY-MM-DD)' });
      return;
    }
    const result = await scrapeCourtRegistry({
      dateFrom: new Date(dateFrom),
      dateTo:   new Date(dateTo),
      headless,
      brandFilterOnly,
    });

    // Store scraped cases in DB
    let stored = 0;
    for (const rawCase of result.cases) {
      if (!rawCase.defendantSlug) continue;
      await db.upsertRawCase({
        ...rawCase,
        defendantSlug: rawCase.defendantSlug,
        result: rawCase.result ?? '',
        closeDate: rawCase.closeDate ?? '',
      });
      stored++;
    }

    res.json({ ...result, stored });
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

app.post('/api/admin/scrape-court-full', requireCronSecret, async (req, res) => {
  try {
    const { fromYear = 2021, toYear = 2026, headless = true } = req.body;
    const result = await scrapeFullRange({ fromYear, toYear, headless });

    let stored = 0;
    for (const rawCase of result.cases) {
      if (!rawCase.defendantSlug) continue;
      await db.upsertRawCase({
        ...rawCase,
        defendantSlug: rawCase.defendantSlug,
        result: rawCase.result ?? '',
        closeDate: rawCase.closeDate ?? '',
      });
      stored++;
    }

    res.json({ ...result, stored });
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── Admin: Set claim deadline for a lawsuit ─────────────────────────────────
app.put('/api/admin/lawsuit/:id/deadline', requireCronSecret, async (req, res) => {
  try {
    const { deadline } = req.body; // ISO date string
    if (!deadline) { res.status(400).json({ error: 'deadline is required (ISO date)' }); return; }
    const updated = await prisma.lawsuit.update({
      where: { id: req.params.id },
      data: { claimDeadline: new Date(deadline), lastUpdatedAt: new Date() },
    });
    res.json({ id: updated.id, caseNumber: updated.caseNumber, claimDeadline: updated.claimDeadline });
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── Admin: Bulk update lawsuit field ────────────────────────────────────────
// Validate status against the known enum so a bad status string doesn't crash
// the admin panel with a 500.
const LAWSUIT_STATUSES = [
  'FILED', 'CERTIFIED', 'DISCOVERY', 'SETTLEMENT', 'SETTLEMENT_APPROVED',
  'RULING', 'CLOSED', 'DISMISSED', 'GLOBAL_POTENTIAL',
] as const;
const adminLawsuitSchema = z.object({
  claimDeadline: z.string().datetime().optional(),
  payoutMinILS:  z.number().nonnegative().optional(),
  payoutMaxILS:  z.number().nonnegative().optional(),
  totalPoolILS:  z.number().nonnegative().optional(),
  status:        z.enum(LAWSUIT_STATUSES).optional(),
  result:        z.string().max(500).optional(),
}).refine(d => Object.values(d).some(v => v !== undefined), { message: 'No valid fields to update' });

app.put('/api/admin/lawsuit/:id', requireCronSecret, async (req, res) => {
  try {
    const parsed = adminLawsuitSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
    const updates: Record<string, any> = {};
    if (parsed.data.claimDeadline !== undefined) updates.claimDeadline = new Date(parsed.data.claimDeadline);
    if (parsed.data.payoutMinILS  !== undefined) updates.payoutMinILS  = parsed.data.payoutMinILS;
    if (parsed.data.payoutMaxILS  !== undefined) updates.payoutMaxILS  = parsed.data.payoutMaxILS;
    if (parsed.data.totalPoolILS  !== undefined) updates.totalPoolILS  = parsed.data.totalPoolILS;
    if (parsed.data.status        !== undefined) updates.status        = parsed.data.status;
    if (parsed.data.result        !== undefined) updates.result        = parsed.data.result;
    updates.lastUpdatedAt = new Date();
    const updated = await prisma.lawsuit.update({ where: { id: req.params.id }, data: updates });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── Admin: Delete cases by brand slug ────────────────────────────────────────
app.delete('/api/admin/brand/:slug', requireCronSecret, async (req, res) => {
  try {
    const { count } = await prisma.lawsuit.deleteMany({ where: { defendantSlug: req.params.slug } });
    res.json({ deleted: count });
  } catch (err) {
    res.status(500).json({ error: (err as any)?.message ?? JSON.stringify(err) });
  }
});

// ── Keep-alive ping (prevents Neon DB auto-suspend after 5 min) ───────────────
setInterval(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    // silent — will retry on next interval
  }
}, 4 * 60 * 1000); // every 4 minutes

// ════════════════════════════════════════════════════════════════════════════
//  INCUBATOR — Admin approval flow (פאנל אדמין בתוך פרופיל המשתמש)
// ════════════════════════════════════════════════════════════════════════════

type UserRole = 'USER' | 'ADMIN' | 'LAWYER';

function requireRole(allowed: UserRole[]) {
  return async (req: AuthRequest, res: express.Response, next: express.NextFunction) => {
    if (!req.userId) { res.status(401).json({ error: 'Not authenticated' }); return; }
    try {
      const role = await withDbRetry(() => db.getUserRole(req.userId!));
      if (!role || !allowed.includes(role as UserRole)) {
        res.status(403).json({ error: 'Insufficient role', required: allowed });
        return;
      }
      next();
    } catch (err: any) {
      res.status(500).json({ error: 'Role check failed', detail: err?.message });
    }
  };
}

// Returns the authenticated user's identity + role. Mobile uses this to decide
// whether to render the admin section inside the profile screen.
app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const u = await withDbRetry(() => db.getUserSummary(req.userId!));
    if (!u) { res.status(404).json({ error: 'User not found' }); return; }
    res.json({
      id: u.id,
      role: u.role,
      phone: u.phone,
      email: u.email,
      displayName: u.profile?.displayName ?? null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

app.get('/api/admin/cases/pending', requireAuth, requireRole(['ADMIN']), async (_req, res) => {
  try {
    const cases = await withDbRetry(() => db.listPendingIncubatorCases());
    // Attach duplicate-detection signal (Q6): count of LIVE cases against the same company.
    const enriched = await Promise.all(
      cases.map(async c => ({
        ...c,
        similarLiveCount: await withDbRetry(() => db.countSimilarLiveCases(c.defendantCompany, c.id)),
      }))
    );
    res.json({ cases: enriched, total: enriched.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// ── Admin diagnostic: uncurated brands (x- prefix) ──────────────────────────
//
// Surfaces defendants we ingested but haven't mapped to a curated brand slug.
// Use the output to grow BRAND_NAME_MAP — e.g. if 47 cases come back with
// defendantName='סמסונג ישראל' under slug='x-samsung-israel', add 'סמסונג' to
// BRAND_NAME_MAP and run scripts/backfill-missing-cases.ts to promote them.
app.get('/api/admin/uncurated-brands', requireAuth, requireRole(['ADMIN']), async (_req, res) => {
  try {
    const rows = await withDbRetry(() => prisma.lawsuit.groupBy({
      by:        ['defendantName', 'defendantSlug'],
      where:     { defendantSlug: { startsWith: 'x-' } },
      _count:    { _all: true },
      orderBy:   { _count: { defendantName: 'desc' } },
      take:      200,
    }));
    const total = rows.reduce((s, r) => s + r._count._all, 0);
    res.json({
      total,
      uniqueDefendants: rows.length,
      defendants: rows.map(r => ({
        defendantName: r.defendantName,
        defendantSlug: r.defendantSlug,
        caseCount:     r._count._all,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

const adminActionSchema = z.object({ note: z.string().trim().max(2000).optional() });
const adminRejectSchema = z.object({ reason: z.string().trim().min(3).max(2000) });

// Transitional helper: the DB method now returns null if the row was no longer
// PENDING_REVIEW at the moment of the atomic update (race loss / already actioned).
async function respondTransition(
  req: AuthRequest,
  res: express.Response,
  fn: () => Promise<any>,
) {
  const updated = await withDbRetry(fn);
  if (updated) { res.json({ case: updated }); return; }
  // Figure out why the transition failed (for a useful 404 vs 409).
  const existing = await withDbRetry(() => db.getIncubatorCase(req.params.id));
  if (!existing) { res.status(404).json({ error: 'Case not found' }); return; }
  res.status(409).json({ error: 'Case is not in PENDING_REVIEW', currentStatus: existing.status });
}

app.post('/api/admin/cases/:id/approve', requireAuth, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const parsed = adminActionSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
    await respondTransition(req, res, () => db.approveIncubatorCase(req.params.id, req.userId!, parsed.data.note));
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

app.post('/api/admin/cases/:id/reject', requireAuth, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const parsed = adminRejectSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'reason required (min 3 chars)', details: parsed.error.flatten() }); return; }
    await respondTransition(req, res, () => db.rejectIncubatorCase(req.params.id, req.userId!, parsed.data.reason));
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

app.post('/api/admin/cases/:id/request-revisions', requireAuth, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const parsed = adminRejectSchema.safeParse(req.body); // reuse: reason required
    if (!parsed.success) { res.status(400).json({ error: 'reason required (min 3 chars)', details: parsed.error.flatten() }); return; }
    await respondTransition(req, res, () => db.requestIncubatorRevisions(req.params.id, req.userId!, parsed.data.reason));
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// Admin audit trail — searchable "who did what" view.
app.get('/api/admin/actions', requireAuth, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const limit      = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);
    const targetType = req.query.targetType  ? String(req.query.targetType)  as 'CASE' | 'EVIDENCE' | 'USER' : undefined;
    const targetId   = req.query.targetId    ? String(req.query.targetId)    : undefined;
    const adminUserId = req.query.adminUserId ? String(req.query.adminUserId) : undefined;
    if (targetType && !['CASE', 'EVIDENCE', 'USER'].includes(targetType)) {
      res.status(400).json({ error: 'targetType must be CASE | EVIDENCE | USER' });
      return;
    }
    const actions = await withDbRetry(() => db.listAdminActions({ limit, targetType, targetId, adminUserId }));
    res.json({ actions });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// ── Evidence PII screening ──────────────────────────────────────────────────
// POST /api/admin/evidence/:id/screen       — run Claude Vision against a
//   base64 image to decide READY vs MANUAL_REVIEW. Called by the upload hook
//   (once R2 is wired) or manually by an admin via the dashboard.
// POST /api/admin/evidence/:id/approve      — admin overrides MANUAL_REVIEW
//   by providing a redacted r2Key (or confirming the original is safe).

const screenEvidenceSchema = z.object({
  imageBase64: z.string().min(100).max(15_000_000), // ~11MB after b64 decode
  mimeType:    z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
});

app.post('/api/admin/evidence/:id/screen', requireAuth, requireRole(['ADMIN']), aiLimit, async (req: AuthRequest, res) => {
  try {
    const parsed = screenEvidenceSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
    const { screenEvidenceImage } = await import('../skills/screenEvidenceImage');
    const verdict = await screenEvidenceImage({
      evidenceId:  req.params.id,
      imageBase64: parsed.data.imageBase64,
      mimeType:    parsed.data.mimeType,
    });
    // Audit the manual admin-triggered screen. Background/pipeline screens skip
    // this (no admin on the line) — only user-initiated admin reviews log here.
    await db.logAdminAction({
      adminUserId: req.userId!,
      action:      'EVIDENCE_SCREENED',
      targetType:  'EVIDENCE',
      targetId:    req.params.id,
      metadata:    {
        status:        verdict.status,
        hasPII:        verdict.hasPII,
        confidence:    verdict.confidence,
        detectedTypes: verdict.detectedTypes,
      },
    }).catch(e => console.error('[audit] screen-log failed:', e?.message ?? e));
    res.json({ verdict });
  } catch (err: any) {
    const msg = String(err?.message ?? 'Internal error');
    if (msg.startsWith('EVIDENCE_NOT_SCREENABLE')) {
      res.status(409).json({ error: 'Evidence is already processing or resolved', state: msg.split(':')[1] });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

const approveEvidenceSchema = z.object({
  r2KeyRedacted: z.string().trim().min(1).max(512).optional(),
  decision:      z.enum(['READY', 'FAILED']),
}).refine(d => d.decision === 'FAILED' || !!d.r2KeyRedacted, {
  message: 'r2KeyRedacted required when marking READY',
});

app.post('/api/admin/evidence/:id/approve', requireAuth, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const parsed = approveEvidenceSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
    const updated = await withDbRetry(() => db.resolveEvidenceReview(
      req.params.id, req.userId!, parsed.data.decision, parsed.data.r2KeyRedacted ?? null,
    ));
    if (!updated) { res.status(404).json({ error: 'Evidence not found or not in MANUAL_REVIEW' }); return; }
    res.json({ evidence: updated });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  INCUBATOR — Founder flow (any authenticated user can initiate a case)
// ════════════════════════════════════════════════════════════════════════════

const LEGAL_CLAIM_TYPES = [
  'MISREPRESENTATION', 'OVERCHARGING', 'DEFECTIVE_PRODUCT',
  'POOR_SERVICE',      'DISCRIMINATION', 'PRIVACY_VIOLATION', 'OTHER',
] as const;
const AFFECTED_SIZES = [
  'TENS', 'HUNDREDS', 'THOUSANDS',
  'TENS_OF_THOUSANDS', 'HUNDREDS_OF_THOUSANDS', 'MILLIONS',
] as const;

const createCaseSchema = z.object({
  title:             z.string().trim().min(3).max(200),
  defendantCompany:  z.string().trim().min(2).max(200),
  legalClaimType:    z.enum(LEGAL_CLAIM_TYPES),
  damageEstimateNis: z.number().int().positive().max(1_000_000_000),
  narrative:         z.string().trim().min(20).max(10_000),
  incidentDate:      z.string().datetime().optional(),
  incidentPeriodEnd: z.string().datetime().optional(),
  estimatedAffected: z.enum(AFFECTED_SIZES).optional(),
});

const patchCaseSchema = createCaseSchema.partial();

const evidenceSchema = z.object({
  kind:        z.enum(['TEXT', 'URL']),
  textContent: z.string().trim().min(1).max(10_000).optional(),
  externalUrl: z.string().url().max(2048).optional(),
  description: z.string().trim().max(500).optional(),
}).refine(d => (d.kind === 'TEXT' && d.textContent) || (d.kind === 'URL' && d.externalUrl), {
  message: 'textContent required for TEXT, externalUrl required for URL',
});

app.post('/api/cases', requireAuth, createCaseLimit, async (req: AuthRequest, res) => {
  try {
    const parsed = createCaseSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
    // Belt-and-braces: the per-user rate-limiter counts by req.userId (good),
    // but a second DB count guards against process restarts / memory wipes.
    const recentCases = await withDbRetry(() =>
      db.countCasesCreatedByUserSince(req.userId!, 24 * 60 * 60_000),
    );
    if (recentCases >= 5) {
      res.status(429).json({ error: 'Too many cases created recently. Try again tomorrow.' });
      return;
    }
    const d = parsed.data;
    const created = await withDbRetry(() => db.createIncubatorCase(req.userId!, {
      title:             d.title,
      defendantCompany:  d.defendantCompany,
      legalClaimType:    d.legalClaimType,
      damageEstimateNis: d.damageEstimateNis,
      narrative:         d.narrative,
      incidentDate:      d.incidentDate      ? new Date(d.incidentDate)      : null,
      incidentPeriodEnd: d.incidentPeriodEnd ? new Date(d.incidentPeriodEnd) : null,
      estimatedAffected: d.estimatedAffected ?? null,
    }));
    res.status(201).json({ case: created });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

app.patch('/api/cases/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const parsed = patchCaseSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
    const existing = await withDbRetry(() => db.getCaseForOwner(req.params.id, req.userId!));
    if (!existing) { res.status(404).json({ error: 'Case not found' }); return; }
    if (!['DRAFT', 'REVISIONS_REQUESTED'].includes(existing.status)) {
      res.status(409).json({ error: 'Case is locked for editing', currentStatus: existing.status });
      return;
    }
    const d = parsed.data;
    const updated = await withDbRetry(() => db.patchIncubatorCase(req.params.id, {
      ...(d.title             !== undefined && { title: d.title }),
      ...(d.defendantCompany  !== undefined && { defendantCompany: d.defendantCompany }),
      ...(d.legalClaimType    !== undefined && { legalClaimType: d.legalClaimType }),
      ...(d.damageEstimateNis !== undefined && { damageEstimateNis: d.damageEstimateNis }),
      ...(d.narrative         !== undefined && { narrative: d.narrative }),
      ...(d.incidentDate      !== undefined && { incidentDate: d.incidentDate ? new Date(d.incidentDate) : null }),
      ...(d.incidentPeriodEnd !== undefined && { incidentPeriodEnd: d.incidentPeriodEnd ? new Date(d.incidentPeriodEnd) : null }),
      ...(d.estimatedAffected !== undefined && { estimatedAffected: d.estimatedAffected }),
    }));
    res.json({ case: updated });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

app.post('/api/cases/:id/evidence', requireAuth, async (req: AuthRequest, res) => {
  try {
    const parsed = evidenceSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
    const existing = await withDbRetry(() => db.getCaseForOwner(req.params.id, req.userId!));
    if (!existing) { res.status(404).json({ error: 'Case not found' }); return; }
    if (!['DRAFT', 'REVISIONS_REQUESTED'].includes(existing.status)) {
      res.status(409).json({ error: 'Cannot attach evidence to a locked case', currentStatus: existing.status });
      return;
    }
    const ev = await withDbRetry(() => db.addCaseEvidence(req.params.id, req.userId!, parsed.data));
    res.status(201).json({ evidence: ev });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// ── FILE evidence via R2 presigned PUT ──────────────────────────────────────
// Three-step flow:
//   1. POST /api/cases/:id/evidence/upload-url  → reserves a CaseEvidence row
//      in PENDING state and returns a presigned PUT URL + the r2Key.
//   2. Client uploads bytes directly to R2 via that URL.
//   3. POST /api/cases/:id/evidence/:evId/complete → attaches r2Key + mime
//      to the row and triggers PII screening asynchronously.
//
// The reserve-then-complete shape keeps the R2 key stable (scoped by
// evidenceId) and lets us detect and garbage-collect abandoned uploads.

const SCREENABLE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024; // 10 MB

const presignEvidenceSchema = z.object({
  mimeType:    z.enum(SCREENABLE_MIMES),
  description: z.string().trim().max(500).optional(),
  sizeBytes:   z.number().int().positive().max(MAX_EVIDENCE_BYTES).optional(),
});

app.post('/api/cases/:id/evidence/upload-url', requireAuth, async (req: AuthRequest, res) => {
  try {
    const parsed = presignEvidenceSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }

    const kase = await withDbRetry(() => db.getCaseForOwner(req.params.id, req.userId!));
    if (!kase) { res.status(404).json({ error: 'Case not found' }); return; }
    if (!['DRAFT', 'REVISIONS_REQUESTED'].includes(kase.status)) {
      res.status(409).json({ error: 'Cannot attach evidence to a locked case', currentStatus: kase.status });
      return;
    }

    const { isR2Configured, buildEvidenceKey, presignUpload } = await import('../lib/r2');
    if (!isR2Configured()) { res.status(503).json({ error: 'File uploads not configured on this server' }); return; }

    // Reserve a row so we get a stable evidenceId for the key.
    const reserved = await withDbRetry(() => db.reserveFileEvidence(
      req.params.id, req.userId!, {
        mimeType:    parsed.data.mimeType,
        description: parsed.data.description ?? null,
      },
    ));

    const key = buildEvidenceKey(req.params.id, reserved.id, 'orig', parsed.data.mimeType);
    const presigned = await presignUpload({
      key,
      contentType:  parsed.data.mimeType,
      expiresInSec: 300,
    });

    res.status(201).json({
      evidenceId:  reserved.id,
      uploadUrl:   presigned.url,
      r2Key:       presigned.key,
      expiresAt:   presigned.expiresAt,
      maxBytes:    MAX_EVIDENCE_BYTES,
      method:      'PUT',
      headers:     { 'Content-Type': parsed.data.mimeType },
    });
  } catch (err: any) {
    console.error('[evidence/upload-url] failed:', err?.message ?? err);
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

const completeEvidenceSchema = z.object({
  originalHash: z.string().trim().length(64).optional(), // sha256 hex
});

app.post('/api/cases/:id/evidence/:evId/complete', requireAuth, async (req: AuthRequest, res) => {
  try {
    const parsed = completeEvidenceSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }

    const kase = await withDbRetry(() => db.getCaseForOwner(req.params.id, req.userId!));
    if (!kase) { res.status(404).json({ error: 'Case not found' }); return; }
    if (!['DRAFT', 'REVISIONS_REQUESTED'].includes(kase.status)) {
      res.status(409).json({ error: 'Cannot modify evidence on a locked case', currentStatus: kase.status });
      return;
    }

    const { isR2Configured, buildEvidenceKey, headObject } = await import('../lib/r2');
    if (!isR2Configured()) { res.status(503).json({ error: 'File uploads not configured on this server' }); return; }

    // Resolve the row to find the mime (was set at reserve-time).
    const evRow = await withDbRetry(() => db.getEvidenceById(req.params.evId));
    if (!evRow || evRow.caseId !== req.params.id || evRow.uploaderUserId !== req.userId) {
      res.status(404).json({ error: 'Evidence not found' }); return;
    }
    if (evRow.kind !== 'FILE' || !evRow.mimeType) {
      res.status(409).json({ error: 'Evidence is not a reserved file' }); return;
    }
    if (evRow.r2KeyOriginal) {
      res.status(409).json({ error: 'Evidence already completed' }); return;
    }

    const expectedKey = buildEvidenceKey(req.params.id, req.params.evId, 'orig', evRow.mimeType);
    // HEAD the object to confirm it actually landed + enforce size ceiling.
    const head = await headObject(expectedKey);
    if (!head) { res.status(400).json({ error: 'Upload not found at expected key' }); return; }
    if (head.size > MAX_EVIDENCE_BYTES) {
      res.status(413).json({ error: `Upload exceeds max size (${MAX_EVIDENCE_BYTES} bytes)` });
      return;
    }

    const completed = await withDbRetry(() => db.completeFileEvidence(req.params.evId, req.userId!, {
      r2KeyOriginal: expectedKey,
      mimeType:      evRow.mimeType!,
      originalHash:  parsed.data.originalHash ?? null,
    }));
    if (!completed) { res.status(409).json({ error: 'Evidence already completed or missing' }); return; }

    // Kick off PII screening in the background. We don't await because the
    // client has already "finished" from its perspective; screening result
    // lands on the row's redactionStatus field.
    (async () => {
      try {
        const { getObjectBuffer } = await import('../lib/r2');
        const { screenEvidenceImage } = await import('../skills/screenEvidenceImage');
        const { body } = await getObjectBuffer(expectedKey);
        await screenEvidenceImage({
          evidenceId:  req.params.evId,
          imageBase64: body.toString('base64'),
          mimeType:    evRow.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
        });
      } catch (e: any) {
        console.error('[evidence/complete] background screen failed:', e?.message ?? e);
      }
    })();

    res.status(200).json({ evidence: completed });
  } catch (err: any) {
    console.error('[evidence/complete] failed:', err?.message ?? err);
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// ── Evidence download — presigned GET scoped by viewer role ────────────────
// Regular members: only redacted variant (if READY). Admins: original.
app.get('/api/cases/:caseId/evidence/:evId/download-url', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { isR2Configured, presignDownload, publicUrl } = await import('../lib/r2');
    if (!isR2Configured()) { res.status(503).json({ error: 'File downloads not configured on this server' }); return; }

    const evRow = await withDbRetry(() => db.getEvidenceById(req.params.evId));
    if (!evRow || evRow.caseId !== req.params.caseId) { res.status(404).json({ error: 'Evidence not found' }); return; }
    if (evRow.kind !== 'FILE') { res.status(400).json({ error: 'Evidence is not a file' }); return; }

    const viewerRole = await withDbRetry(() => db.getUserRole(req.userId!));
    const wantsOriginal = req.query.variant === 'original';
    const key = wantsOriginal
      ? evRow.r2KeyOriginal
      : (evRow.r2KeyRedacted ?? evRow.r2KeyOriginal); // fall back to orig when redacted=orig (READY)

    if (wantsOriginal && viewerRole !== 'ADMIN' && viewerRole !== 'LAWYER') {
      res.status(403).json({ error: 'Original variant is admin/lawyer only' }); return;
    }
    if (!key) { res.status(404).json({ error: 'No file available for this variant' }); return; }
    if (!wantsOriginal && evRow.redactionStatus !== 'READY') {
      res.status(409).json({ error: 'Redacted variant not available', redactionStatus: evRow.redactionStatus });
      return;
    }

    const publicU = publicUrl(key);
    if (publicU && !wantsOriginal) {
      res.json({ url: publicU, public: true });
      return;
    }
    const url = await presignDownload({ key, expiresInSec: 600 });
    res.json({ url, public: false, expiresInSec: 600 });
  } catch (err: any) {
    console.error('[evidence/download-url] failed:', err?.message ?? err);
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// Submit a draft for admin review. Transitions to PENDING_REVIEW and runs the
// AI analyzer synchronously — admin sees a scored case. If AI fails, we still
// submit (admin can review manually) and surface the error non-fatally.
app.post('/api/cases/:id/submit', requireAuth, aiLimit, async (req: AuthRequest, res) => {
  try {
    const existing = await withDbRetry(() => db.getCaseForOwner(req.params.id, req.userId!));
    if (!existing) { res.status(404).json({ error: 'Case not found' }); return; }
    if (!['DRAFT', 'REVISIONS_REQUESTED'].includes(existing.status)) {
      res.status(409).json({ error: 'Case already submitted', currentStatus: existing.status });
      return;
    }
    // Basic completeness check — AI will give a better score, but this prevents obviously-empty submits.
    if (!existing.title || !existing.defendantCompany || existing.narrative.trim().length < 20) {
      res.status(400).json({ error: 'Case is not complete enough to submit' });
      return;
    }
    const submitted = await withDbRetry(() => db.submitIncubatorCase(req.params.id));

    let aiAnalysis: any = null;
    let aiError: string | null = null;
    try {
      const { analyzeIncubatorCase } = await import('../skills/caseAnalyzer');
      aiAnalysis = await analyzeIncubatorCase(req.params.id);
    } catch (err: any) {
      console.error('[submit] AI analysis failed (non-fatal):', err?.message);
      aiError = err?.message ?? 'analysis failed';
    }

    res.json({ case: submitted, aiAnalysis, aiError });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

app.get('/api/cases/mine', requireAuth, async (req: AuthRequest, res) => {
  try {
    const cases = await withDbRetry(() => db.listMyIncubatorCases(req.userId!));
    res.json({ cases, total: cases.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// ── Live incubator cases feed (for Explore tab "בהקמה" section) ──────────────
// Declared BEFORE /api/cases/:id so "live" is not treated as an :id.
app.get('/api/cases/live', async (req, res) => {
  try {
    const limit  = Math.min(Number(req.query.limit  ?? 20), 50);
    const offset = Math.max(Number(req.query.offset ?? 0),  0);
    const [cases, total] = await Promise.all([
      withDbRetry(() => db.listLiveIncubatorCases({ limit, offset })),
      withDbRetry(() => db.countLiveIncubatorCases()),
    ]);
    res.json({ cases, total, limit, offset });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// Public case detail. Only visible states (LIVE / GOAL_REACHED / LEGAL_ACTION)
// are shown to non-owners; founder sees their own regardless of state.
// Declared AFTER /api/cases/mine and /api/cases/live so literals match first.
app.get('/api/cases/:id', async (req: AuthRequest, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    let viewerId: string | null = null;
    if (token) { try { viewerId = (jwt.verify(token, JWT_SECRET) as any).userId; } catch {} }
    const kase = await withDbRetry(() => db.getIncubatorCase(req.params.id));
    if (!kase) { res.status(404).json({ error: 'Case not found' }); return; }
    const isFounder = viewerId && kase.founder?.id === viewerId;
    if (!isFounder && !['LIVE', 'GOAL_REACHED', 'LEGAL_ACTION'].includes(kase.status)) {
      res.status(404).json({ error: 'Case not found' }); return;
    }
    res.json({ case: kase });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// ── CaseMember join + referral links ─────────────────────────────────────────
// POST /api/cases/:id/join            — join a case (optionally via referralToken)
// POST /api/cases/:id/referral-link   — generate a shareable link for myself
// POST /api/referrals/:token/click    — record a click (pre-join attribution)
// GET  /api/cases/:id/members         — list members (founder/admin only)

const joinCaseSchema = z.object({
  referralToken:     z.string().trim().min(8).max(64).optional(),
  deviceFingerprint: z.string().trim().max(128).optional(),
  personalDamageNis: z.number().int().nonnegative().max(100_000_000).optional(),
});

// Hash the request IP so we can detect farming without storing raw PII.
function hashIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

const joinLimit = rateLimit({ windowMs: 60_000, max: 20, name: 'join' });

app.post('/api/cases/:id/join', requireAuth, joinLimit, async (req: AuthRequest, res) => {
  try {
    const parsed = joinCaseSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
    const ipHash = hashIp(req.ip);

    // Aggregate ipHash cap: if 20+ referral conversions happened from this IP
    // in the last 24h, treat further joins via referral as suspect. We only
    // block when a referralToken is present — that's the farming path. Plain
    // self-joins still succeed (shared WiFi, office network, family device).
    if (ipHash && parsed.data.referralToken) {
      const conversionsFromIp = await withDbRetry(() =>
        db.countReferralConversionsByIpHash(ipHash, 24 * 60 * 60_000),
      );
      if (conversionsFromIp >= 20) {
        console.warn(`[farming] join conversion cap hit for ipHash=${ipHash.slice(0, 8)}… (${conversionsFromIp})`);
        res.status(429).json({ error: 'Too many referral conversions from this network. Try again later.' });
        return;
      }
    }

    const result = await withDbRetry(() => db.joinIncubatorCase({
      caseId:            req.params.id,
      userId:            req.userId!,
      referralToken:     parsed.data.referralToken ?? null,
      ipHash,
      deviceFingerprint: parsed.data.deviceFingerprint ?? null,
      personalDamageNis: parsed.data.personalDamageNis ?? null,
    }));
    res.status(result.alreadyMember ? 200 : 201).json(result);
  } catch (err: any) {
    const msg = String(err?.message ?? 'Internal error');
    if (msg === 'CASE_NOT_FOUND')              { res.status(404).json({ error: 'Case not found' }); return; }
    if (msg.startsWith('CASE_NOT_OPEN'))       { res.status(409).json({ error: 'Case is not accepting members', status: msg.split(':')[1] }); return; }
    if (msg === 'CASE_FOUNDER_CANNOT_REJOIN')  { res.status(409).json({ error: 'Founder is already part of the case' }); return; }
    if (msg === 'REFERRAL_CYCLE_DETECTED')     { res.status(409).json({ error: 'Referral chain loops back to you' }); return; }
    res.status(500).json({ error: msg });
  }
});

app.post('/api/cases/:id/referral-link', requireAuth, referralLinkLimit, async (req: AuthRequest, res) => {
  try {
    const ev = await withDbRetry(() => db.createReferralLink(req.params.id, req.userId!));
    const base = process.env.PUBLIC_APP_URL?.replace(/\/$/, '') ?? '';
    res.status(201).json({
      linkToken: ev.linkToken,
      url:       base ? `${base}/r/${ev.linkToken}` : null,
      caseId:    ev.caseId,
      createdAt: ev.createdAt,
    });
  } catch (err: any) {
    const msg = String(err?.message ?? 'Internal error');
    if (msg === 'CASE_NOT_FOUND') { res.status(404).json({ error: 'Case not found' }); return; }
    if (msg === 'NOT_A_MEMBER')   { res.status(403).json({ error: 'Only members can share referral links' }); return; }
    res.status(500).json({ error: msg });
  }
});

app.post('/api/referrals/:token/click', async (req, res) => {
  try {
    const token = req.params.token;
    if (!token || token.length < 8 || token.length > 64) {
      res.status(400).json({ error: 'Invalid token' }); return;
    }
    const fingerprint = typeof req.body?.deviceFingerprint === 'string'
      ? String(req.body.deviceFingerprint).slice(0, 128) : null;
    const ipHash = hashIp(req.ip);

    // Aggregate ipHash cap: one IP clicking 50+ distinct referral links in an
    // hour is almost certainly a farmer. Real shared-WiFi users don't even
    // come close. Return a benign 200 so the farmer can't probe the threshold.
    if (ipHash) {
      const clicksFromIp = await withDbRetry(() =>
        db.countReferralClicksByIpHash(ipHash, 60 * 60_000),
      );
      if (clicksFromIp >= 50) {
        console.warn(`[farming] click cap hit for ipHash=${ipHash.slice(0, 8)}… (${clicksFromIp})`);
        res.json({ caseId: null, throttled: true });
        return;
      }
    }
    const hit = await withDbRetry(() => db.recordReferralClick(token, ipHash, fingerprint));
    if (!hit) { res.status(404).json({ error: 'Unknown link' }); return; }
    res.json({ caseId: hit.caseId });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

app.get('/api/cases/:id/members', requireAuth, async (req: AuthRequest, res) => {
  try {
    // Founder-or-admin view. Public member lists would leak pseudo-identity.
    const kase = await withDbRetry(() => db.getIncubatorCase(req.params.id));
    if (!kase) { res.status(404).json({ error: 'Case not found' }); return; }
    const viewerRole = await withDbRetry(() => db.getUserRole(req.userId!));
    const isAdmin   = viewerRole === 'ADMIN';
    const isFounder = kase.founder?.id === req.userId;
    if (!isAdmin && !isFounder) { res.status(403).json({ error: 'Forbidden' }); return; }
    const members = await withDbRetry(() => db.listCaseMembers(req.params.id, { limit: 500 }));
    res.json({ members, total: members.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  LEGAL CONSULTATION — AI chat (stage 1). Two modes:
//    STRENGTHEN — bound to a user's own IncubatorCase, goal = raise powerScore
//    GENERAL    — free-form chat on Israeli consumer-rights topics
//  Stage 2 (real lawyer) is a placeholder: status=ESCALATED_TO_LAWYER.
// ════════════════════════════════════════════════════════════════════════════

const createThreadSchema = z.object({
  mode:   z.enum(['STRENGTHEN', 'GENERAL']),
  caseId: z.string().cuid().optional(),
  title:  z.string().trim().max(200).optional(),
}).refine(d => d.mode === 'GENERAL' || !!d.caseId, {
  message: 'caseId is required for STRENGTHEN mode',
});

const postMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
});

app.post('/api/legal/threads', requireAuth, async (req: AuthRequest, res) => {
  try {
    const parsed = createThreadSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
    const thread = await withDbRetry(() => db.createLegalThread(req.userId!, parsed.data));
    res.status(201).json({ thread });
  } catch (err: any) {
    // createLegalThread throws on ownership failures — surface as 404 rather than 500.
    const msg = err?.message ?? 'Internal error';
    const code = msg.includes('not found') || msg.includes('not owned') ? 404 : 500;
    res.status(code).json({ error: msg });
  }
});

app.get('/api/legal/threads', requireAuth, async (req: AuthRequest, res) => {
  try {
    const threads = await withDbRetry(() => db.listLegalThreads(req.userId!));
    res.json({ threads, total: threads.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

app.get('/api/legal/threads/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const thread = await withDbRetry(() => db.getLegalThreadForUser(req.params.id, req.userId!));
    if (!thread) { res.status(404).json({ error: 'Thread not found' }); return; }
    res.json({ thread });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// Post a user message and return the assistant reply in the same response.
// Messages are short so we skip streaming — mobile just awaits this.
app.post('/api/legal/threads/:id/messages', requireAuth, aiLimit, async (req: AuthRequest, res) => {
  try {
    const parsed = postMessageSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }
    // Ownership guard before running the (billed) AI call.
    const thread = await withDbRetry(() => db.getLegalThreadForUser(req.params.id, req.userId!));
    if (!thread) { res.status(404).json({ error: 'Thread not found' }); return; }

    const { sendLegalMessage, suggestThreadTitle } = await import('../skills/legalConsultant');
    const { assistant, model } = await sendLegalMessage(req.params.id, parsed.data.content);

    // First exchange on a GENERAL thread with no title → auto-title from user msg.
    if (thread.mode === 'GENERAL' && !thread.title && thread.messages.length === 0) {
      try {
        const title = await suggestThreadTitle(parsed.data.content);
        await db.updateLegalThreadTitle(req.params.id, req.userId!, title);
      } catch { /* title is cosmetic, don't fail the request */ }
    }

    res.json({ assistant, model });
  } catch (err: any) {
    console.error('[legal/messages] error:', err?.message);
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// Escalate to stage-2 (real lawyer). Placeholder until a lawyer inbox exists —
// for now we flip status so the user sees "נשלח לבדיקת עו״ד".
app.post('/api/legal/threads/:id/escalate', requireAuth, async (req: AuthRequest, res) => {
  try {
    const r = await withDbRetry(() => db.setLegalThreadStatus(req.params.id, req.userId!, 'ESCALATED_TO_LAWYER'));
    if (r.count === 0) { res.status(404).json({ error: 'Thread not found' }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  INCUBATOR GROUP CHAT — per-case group discussion
//  PII is auto-sanitized before persistence (Israeli ID, CC, phone, email).
// ════════════════════════════════════════════════════════════════════════════

const chatMessageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

// GET  /api/cases/:id/messages   — fetch message history (members + founder only)
app.get('/api/cases/:id/messages', requireAuth, async (req: AuthRequest, res) => {
  try {
    const kase = await withDbRetry(() => db.getIncubatorCase(req.params.id));
    if (!kase) { res.status(404).json({ error: 'Case not found' }); return; }

    // Only members, founder, or admin may read the chat.
    const [role, membership] = await Promise.all([
      withDbRetry(() => db.getUserRole(req.userId!)),
      withDbRetry(() => prisma.caseMember.findUnique({
        where: { caseId_userId: { caseId: req.params.id, userId: req.userId! } },
        select: { id: true },
      })),
    ]);
    const isAdmin   = role === 'ADMIN';
    const isFounder = kase.founder?.id === req.userId;
    const isMember  = !!membership;
    if (!isAdmin && !isFounder && !isMember) {
      res.status(403).json({ error: 'Only members can read the chat' }); return;
    }

    const before = typeof req.query.before === 'string' ? req.query.before : undefined;
    const limit  = Math.min(Number(req.query.limit ?? 50), 100);
    const messages = await withDbRetry(() =>
      db.getCaseChatMessages(req.params.id, { limit, before }),
    );
    // Return in chronological order (oldest first for rendering)
    res.json({ messages: messages.reverse(), total: messages.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// POST /api/cases/:id/messages   — send a chat message (PII auto-stripped)
const chatLimit = rateLimit({ windowMs: 60_000, max: 30, name: 'chat' });
app.post('/api/cases/:id/messages', requireAuth, chatLimit, async (req: AuthRequest, res) => {
  try {
    const parsed = chatMessageSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() }); return; }

    // Sanitize PII before storing
    const { sanitizePII } = await import('../skills/sanitizePII');
    const { clean: sanitizedBody, hits: piiHits } = sanitizePII(parsed.data.body);

    const msg = await withDbRetry(() =>
      db.postCaseChatMessage({
        caseId:  req.params.id,
        userId:  req.userId!,
        body:    sanitizedBody,
        piiHits,
      }),
    );

    if (piiHits.length > 0) {
      console.log(`[chat] PII stripped for user ${req.userId} in case ${req.params.id}: ${piiHits.join(', ')}`);
    }

    res.status(201).json({ message: msg, piiStripped: piiHits });
  } catch (err: any) {
    const msg = String(err?.message ?? 'Internal error');
    if (msg === 'CASE_NOT_FOUND') { res.status(404).json({ error: 'Case not found' }); return; }
    if (msg === 'NOT_A_MEMBER')   { res.status(403).json({ error: 'Only members can post' }); return; }
    if (msg === 'CASE_NOT_LIVE')  { res.status(409).json({ error: 'Case is not active' }); return; }
    res.status(500).json({ error: msg });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`[Server] Running on http://0.0.0.0:${PORT}`);
  console.log(`[Server] LAN:    http://10.94.76.138:${PORT}`);
  console.log(`[Server] Health: http://localhost:${PORT}/health`);
});

export default app;
