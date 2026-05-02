// ─────────────────────────────────────────────────────────────────────────────
//  agents/scraperAgent.ts
//  Agent 1: Scraper — discovers NEW class action cases
//  Cron: every Sunday 03:00 (weekly)
//
//  agents/statusMonitorAgent.ts
//  Agent 3: Status Monitor — tracks changes in EXISTING cases
//  Cron: every Wednesday 03:00 (weekly, different day to spread load)
// ─────────────────────────────────────────────────────────────────────────────

import { scanLegalSources }   from '../skills/scanLegalSources';
import { AgentRun, AgentError, LawsuitStatus, mapStatus } from '../types';
import { db }                 from '../db';

// ═════════════════════════════════════════════════════════════════════════════
//  SCRAPER AGENT — finds new cases
// ═════════════════════════════════════════════════════════════════════════════

export async function runScraperAgent(): Promise<AgentRun> {
  const run: AgentRun = {
    id:          `scraper_${Date.now()}`,
    agent:       'scraper',
    triggeredBy: 'CRON',
    startedAt:   new Date().toISOString(),
    status:      'RUNNING',
    stats:       { new_cases: 0, status_rechecked: 0, skipped_existing: 0, pdf_downloaded: 0, pdf_failed: 0 },
    errors:      [],
    retryCount:  0,
  };

  try {
    // Incremental scan strategy:
    // 1. Get the latest filing date — only discover NEW cases filed after this
    // 2. Get all open (non-closed) case numbers — re-check these for status updates
    // 3. Get all existing case numbers — avoid re-inserting what we already have
    const [latestDate, openCaseNums, existingCaseNumbers] = await Promise.all([
      db.getLatestFilingDate(),
      db.getOpenCaseNumbers(),
      db.getExistingCaseNumbers(),
    ]);

    console.log(`[ScraperAgent] Incremental since: ${latestDate?.toISOString() ?? 'FULL SCAN'}, tracking ${openCaseNums.length} open cases`);

    // Run the scan skill
    const scanResult = await scanLegalSources({
      downloadPDFs:         false,  // Phase 2: court.gov.il requires browser session for PDFs
      existingCaseNumbers:  new Set(existingCaseNumbers),
      incrementalSince:     latestDate,
      openCaseNumbers:      new Set(openCaseNums),
      outputDir:            process.env.PDF_STORAGE_PATH ?? '/tmp/fair-together-pdfs',
    });

    run.stats.pdf_downloaded     = scanResult.pdfsDownloaded;
    run.stats.pdf_failed         = scanResult.pdfsFailed;
    run.stats.skipped_existing   = scanResult.totalCasesInCSV - scanResult.brandMatches;

    // Persist raw cases to DB — marked as UNVERIFIED until Extraction Agent runs
    const existingSet = new Set(existingCaseNumbers);
    for (const rawCase of scanResult.cases) {
      if (!rawCase.defendantSlug) continue;
      const isExisting = existingSet.has(rawCase.caseNumber);

      await db.upsertRawCase({
        ...rawCase,
        defendantSlug: rawCase.defendantSlug,
        result:        rawCase.result   ?? '',
        closeDate:     rawCase.closeDate ?? '',
      });

      if (isExisting) {
        run.stats.status_rechecked++;
      } else {
        run.stats.new_cases++;
        // Emit event for Extraction Agent — only for genuinely new cases
        await db.emitEvent({
          type:    'NEW_CASE_SCRAPED',
          payload: { caseNumber: rawCase.caseNumber, pdfPath: rawCase.pdfPath },
        });
      }
    }

    // Record scan errors
    for (const err of scanResult.errors) {
      run.errors.push({ code: 'SCAN_ERROR', message: err, context: {}, at: new Date().toISOString() });
    }

    run.status     = run.errors.length === 0 ? 'SUCCESS' : 'PARTIAL';
    run.finishedAt = new Date().toISOString();

    console.log(`[ScraperAgent] Done. New: ${run.stats.new_cases}, PDFs: ${run.stats.pdf_downloaded}, Errors: ${run.errors.length}`);

  } catch (err) {
    run.status     = 'FAILED';
    run.finishedAt = new Date().toISOString();
    const msg = err instanceof Error ? err.message : (err as any)?.message ?? JSON.stringify(err);
    run.errors.push({ code: 'AGENT_CRASH', message: msg, context: {}, at: new Date().toISOString() });
    console.error('[ScraperAgent] FAILED:', err);
  }

  await db.saveAgentRun(run);
  return run;
}

// ═════════════════════════════════════════════════════════════════════════════
//  STATUS MONITOR AGENT — detects changes in existing cases
// ═════════════════════════════════════════════════════════════════════════════

export async function runStatusMonitorAgent(): Promise<AgentRun> {
  const run: AgentRun = {
    id:          `status_monitor_${Date.now()}`,
    agent:       'status_monitor',
    triggeredBy: 'CRON',
    startedAt:   new Date().toISOString(),
    status:      'RUNNING',
    stats:       { cases_checked: 0, status_changes: 0, re_extraction_queued: 0 },
    errors:      [],
    retryCount:  0,
  };

  try {
    // Only monitor active cases (not CLOSED or DISMISSED)
    const activeCases = await db.getActiveLawsuits();
    run.stats.cases_checked = activeCases.length;

    // Fetch fresh CSV to compare statuses
    const freshScan = await scanLegalSources({
      downloadPDFs: false, // no PDF needed just for status check
      brandsToScan: [...new Set(activeCases.map(c => c.defendantSlug))],
    });

    const freshCaseMap: Record<string, { status: string; result: string }> = {};
    for (const c of freshScan.cases) {
      freshCaseMap[c.caseNumber] = { status: c.status, result: c.result };
    }

    for (const existing of activeCases) {
      const fresh = freshCaseMap[existing.caseNumber];
      if (!fresh) continue;

      const statusChanged = existing.status !== normalizeStatus(fresh.status, fresh.result);

      if (statusChanged) {
        run.stats.status_changes++;

        // Record the status change
        const newStatus = normalizeStatus(fresh.status, fresh.result);
        await db.recordStatusChange(existing.id, {
          from:       existing.status,
          to:         newStatus,
          detectedAt: new Date().toISOString(),
          source:     'CSV',
        });

        // Only queue re-extraction for consumer-relevant status changes
        // FILED → CERTIFIED, DISCOVERY → SETTLEMENT, SETTLEMENT → SETTLEMENT_APPROVED
        if (isConsumerRelevantChange(existing.status, newStatus)) {
          run.stats.re_extraction_queued++;

          // Download updated PDF for the case
          const pdfResult = await downloadLatestPDF(existing.caseNumber);
          if (pdfResult.pdfPath) {
            await db.emitEvent({
              type:    'CASE_STATUS_CHANGED',
              payload: {
                caseNumber:  existing.caseNumber,
                pdfPath:     pdfResult.pdfPath,
                oldStatus:   existing.status,
                newStatus:   newStatus,
                lawsuitId:   existing.id,
              },
            });
          }
        }
      }
    }

    run.status     = 'SUCCESS';
    run.finishedAt = new Date().toISOString();
    console.log(`[StatusMonitor] Checked: ${run.stats.cases_checked}, Changed: ${run.stats.status_changes}, Re-extraction: ${run.stats.re_extraction_queued}`);

  } catch (err) {
    run.status     = 'FAILED';
    run.finishedAt = new Date().toISOString();
    const msg = err instanceof Error ? err.message : (err as any)?.message ?? JSON.stringify(err);
    run.errors.push({ code: 'AGENT_CRASH', message: msg, context: {}, at: new Date().toISOString() });
  }

  await db.saveAgentRun(run);
  return run;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Use shared mapStatus from types.ts (single source of truth)
const normalizeStatus = mapStatus;

function isConsumerRelevantChange(
  from: LawsuitStatus,
  to:   LawsuitStatus
): boolean {
  // Only these transitions warrant re-extraction + user notification
  const relevantTransitions: Array<[LawsuitStatus, LawsuitStatus]> = [
    ['FILED',       'CERTIFIED'],           // case approved — now officially a class action
    ['CERTIFIED',   'SETTLEMENT'],          // settlement started
    ['SETTLEMENT',  'SETTLEMENT_APPROVED'], // consumers can now submit claims
    ['DISCOVERY',   'SETTLEMENT'],
    ['FILED',       'RULING'],
  ];
  return relevantTransitions.some(([f, t]) => f === from && t === to);
}

async function downloadLatestPDF(caseNumber: string): Promise<{ pdfPath: string | null }> {
  const result = await scanLegalSources({
    downloadPDFs:  true,
    brandsToScan:  undefined,
    outputDir:     process.env.PDF_STORAGE_PATH ?? '/tmp/fair-together-pdfs',
    existingCaseNumbers: new Set(),
  });
  const found = result.cases.find((c: { caseNumber: string }) => c.caseNumber === caseNumber);
  return { pdfPath: found?.pdfPath ?? null };
}
