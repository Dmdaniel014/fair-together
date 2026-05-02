// ─────────────────────────────────────────────────────────────────────────────
//  orchestrator/index.ts
//  Orchestrator — the single entry point for all agent activity
//
//  Manages:
//  - Cron scheduling (GitHub Actions calls these endpoints)
//  - Event routing between agents
//  - Retry logic (max 3 attempts with exponential backoff)
//  - Centralized logging
//  - Error recovery — a failed agent never silently dies
//
//  Cron schedule (GitHub Actions .github/workflows/agents.yml):
//  - Scraper Agent:        every Sunday    03:00 UTC  (weekly)
//  - Status Monitor:       every Wednesday 03:00 UTC  (weekly, spread load)
//  - Cleanup job:          1st of month    02:00 UTC  (housekeeping)
// ─────────────────────────────────────────────────────────────────────────────

import { runScraperAgent, runStatusMonitorAgent } from '../agents/scraperAgent';
import { runExtractionAgent }                      from '../agents/extractionAgent';
import { runValidationAgent }                      from '../agents/extractionAgent';
import { runPushAgent, recordUserFeedback }        from '../agents/pushAgent';
import { AgentRun, MAX_RETRIES }                   from '../types';
import { db }                                      from '../db';

// ═════════════════════════════════════════════════════════════════════════════
//  CRON ENTRY POINTS (called by GitHub Actions)
// ═════════════════════════════════════════════════════════════════════════════

/** Weekly: discover new class action cases */
export async function cronWeeklyScrape(): Promise<void> {
  console.log('[Orchestrator] ── Weekly scrape starting ──');
  await withRetry('scraper', () => runScraperAgent());
  // Extraction + Validation + Push happen via events — see processEvents()
}

/** Weekly: check for status changes in existing cases */
export async function cronWeeklyStatusCheck(): Promise<void> {
  console.log('[Orchestrator] ── Weekly status check starting ──');
  await withRetry('status_monitor', () => runStatusMonitorAgent());
}

/** Monthly housekeeping */
export async function cronMonthlyCleanup(): Promise<void> {
  console.log('[Orchestrator] ── Monthly cleanup ──');
  await db.archiveOldRuns(90);         // keep 90 days of run logs
  await db.cleanupUnusedPDFs();        // delete PDFs for closed cases
  await db.refreshLearnedWeights();    // recalculate stale learning models
}

// ═════════════════════════════════════════════════════════════════════════════
//  EVENT PROCESSOR
//  Runs continuously — polls for new events and routes to correct agent.
//  In production: replace polling with a proper queue (Redis / SQS).
//  For GitHub Actions MVP: run this after every cron job.
// ═════════════════════════════════════════════════════════════════════════════

export async function processEvents(): Promise<void> {
  // Atomically claim a batch so two overlapping cron runs don't double-dispatch.
  // Events flip PENDING → PROCESSING in a single UPDATE with FOR UPDATE SKIP LOCKED;
  // whoever got them marks them DONE/FAILED when routing completes.
  const claimed = await db.claimPendingEvents(50);
  console.log(`[Orchestrator] Claimed ${claimed.length} pending events`);

  for (const event of claimed) {
    try {
      await routeEvent(event);
      await db.markEventProcessed(event.id);
    } catch (err) {
      console.error(`[Orchestrator] Event ${event.id} routing failed:`, err);
      await db.markEventFailed(event.id, String(err));
    }
  }
}

async function routeEvent(event: { id: string; type: string; payload: any }): Promise<void> {
  switch (event.type) {

    case 'NEW_CASE_SCRAPED':
      // Scraper found new case → extract fields from PDF
      await withRetry('extraction', () =>
        runExtractionAgent({
          caseNumber: event.payload.caseNumber,
          pdfPath:    event.payload.pdfPath,
        })
      );
      break;

    case 'CASE_STATUS_CHANGED':
      // Status monitor found change → re-extract with new PDF
      await withRetry('extraction', () =>
        runExtractionAgent({
          caseNumber: event.payload.caseNumber,
          pdfPath:    event.payload.pdfPath,
          lawsuitId:  event.payload.lawsuitId,
        })
      );
      break;

    case 'EXTRACTION_COMPLETE':
      // Extraction done → validate before showing to users
      await withRetry('validation', () =>
        runValidationAgent({
          caseNumber: event.payload.caseNumber,
          confidence: event.payload.confidence,
          lawsuitId:  event.payload.lawsuitId,
        })
      );
      break;

    case 'LAWSUIT_READY':
      // Validated → match against all users and notify
      await withRetry('push', () =>
        runPushAgent({
          caseNumber:    event.payload.caseNumber,
          lawsuitId:     event.payload.lawsuitId,
          pendingReview: event.payload.pendingReview,
        })
      );
      break;

    default:
      console.warn(`[Orchestrator] Unknown event type: ${event.type}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  API ROUTES (called from the Express/FastAPI server)
// ═════════════════════════════════════════════════════════════════════════════

/** POST /api/agents/cron/scrape — triggered by GitHub Actions */
export async function handleCronScrape(): Promise<{ ok: boolean; stats: any }> {
  await cronWeeklyScrape();
  await processEvents();
  const lastRun = await db.getLastAgentRun('scraper');
  return { ok: true, stats: lastRun?.stats };
}

/** POST /api/agents/cron/status-check — triggered by GitHub Actions */
export async function handleCronStatusCheck(): Promise<{ ok: boolean; stats: any }> {
  await cronWeeklyStatusCheck();
  await processEvents();
  const lastRun = await db.getLastAgentRun('status_monitor');
  return { ok: true, stats: lastRun?.stats };
}

/** POST /api/user/feedback — called when user joins/dismisses a lawsuit */
export async function handleUserFeedback(body: {
  userId:    string;
  lawsuitId: string;
  action:    'JOINED' | 'DISMISSED' | 'SAVED' | 'AI_INSIGHT_VIEWED';
}): Promise<void> {
  await recordUserFeedback(body);
}

/** GET /api/agents/status — dashboard for monitoring */
export async function getAgentStatus(): Promise<{
  lastRuns:    Record<string, AgentRun | null>;
  pendingEvents: number;
  reviewQueue:   number;
}> {
  const [scraper, extraction, validation, statusMonitor, push] = await Promise.all([
    db.getLastAgentRun('scraper'),
    db.getLastAgentRun('extraction'),
    db.getLastAgentRun('validation'),
    db.getLastAgentRun('status_monitor'),
    db.getLastAgentRun('push'),
  ]);
  const pendingEvents = await db.countPendingEvents();
  const reviewQueue   = await db.countLawsuitsRequiringReview();

  return {
    lastRuns: { scraper, extraction, validation, statusMonitor, push },
    pendingEvents,
    reviewQueue,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  RETRY LOGIC
// ═════════════════════════════════════════════════════════════════════════════

async function withRetry<T>(
  agentName: string,
  fn:        () => Promise<T>,
  maxRetries = MAX_RETRIES
): Promise<T | null> {

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      if (attempt > 1) {
        console.log(`[Orchestrator] ${agentName} succeeded on attempt ${attempt}`);
      }
      return result;
    } catch (err) {
      const isLast = attempt === maxRetries;
      console.error(`[Orchestrator] ${agentName} attempt ${attempt}/${maxRetries} failed:`, err);

      if (!isLast) {
        const backoffMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        console.log(`[Orchestrator] Retrying ${agentName} in ${backoffMs}ms...`);
        await sleep(backoffMs);
      } else {
        // All retries exhausted — alert and continue
        console.error(`[Orchestrator] ${agentName} EXHAUSTED all retries. Manual intervention needed.`);
        await db.createAlert({
          type:    'AGENT_FAILURE',
          message: `${agentName} failed after ${maxRetries} attempts: ${err}`,
          at:      new Date().toISOString(),
        });
      }
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
// Run when called directly (not when imported by server)
const isDirectRun = process.argv[1]?.includes('orchestrator');
if (isDirectRun) {
  cronWeeklyScrape().then(() => {
    console.log('[Orchestrator] Scrape complete');
    process.exit(0);
  });
}