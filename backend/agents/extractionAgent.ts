// ─────────────────────────────────────────────────────────────────────────────
//  agents/extractionAgent.ts  — extracts structured fields from PDFs via Claude
//  agents/validationAgent.ts  — validates extracted data before it reaches users
// ─────────────────────────────────────────────────────────────────────────────

import { extractPdfFields }  from '../skills/extractPdfFields';
import { AgentRun, LawsuitRecord, DataConfidence, CONFIDENCE_THRESHOLD } from '../types';
import { db }                from '../db';

// ═════════════════════════════════════════════════════════════════════════════
//  EXTRACTION AGENT
//  Triggered by: events NEW_CASE_SCRAPED and CASE_STATUS_CHANGED
// ═════════════════════════════════════════════════════════════════════════════

export async function runExtractionAgent(event: {
  caseNumber: string;
  pdfPath:    string | null;
  lawsuitId?: string;
}): Promise<AgentRun> {

  const run: AgentRun = {
    id:          `extraction_${Date.now()}`,
    agent:       'extraction',
    triggeredBy: 'EVENT',
    startedAt:   new Date().toISOString(),
    status:      'RUNNING',
    stats:       { fields_extracted: 0, fields_pending_review: 0, fields_unverified: 0 },
    errors:      [],
    retryCount:  0,
  };

  try {
    if (!event.pdfPath) {
      // No PDF — mark case as PENDING_REVIEW with CSV-only data
      await db.updateLawsuitConfidence(event.caseNumber, 'PENDING_REVIEW');
      run.status     = 'PARTIAL';
      run.finishedAt = new Date().toISOString();
      run.errors.push({
        code: 'NO_PDF', message: `No PDF available for ${event.caseNumber}`,
        context: {}, at: new Date().toISOString(),
      });
      await db.saveAgentRun(run);
      return run;
    }

    // Run extraction skill
    const extracted = await extractPdfFields({
      pdfPath:      event.pdfPath,
      caseNumber:   event.caseNumber,
      anthropicKey: process.env.ANTHROPIC_API_KEY!,
    });

    // Count field quality
    for (const [field, score] of Object.entries(extracted.confidenceScores)) {
      if (score >= CONFIDENCE_THRESHOLD)       run.stats.fields_extracted++;
      else if (score >= 0.5)                   run.stats.fields_pending_review++;
      else                                     run.stats.fields_unverified++;
    }

    // Persist extracted fields to DB
    await db.updateLawsuitFromExtraction(event.caseNumber, {
      payoutMinILS:        extracted.payoutMinILS,
      payoutMaxILS:        extracted.payoutMaxILS,
      totalPoolILS:        extracted.totalPoolILS,
      eligibilityCriteria: extracted.eligibilityCriteria,
      claimDeadline:       extracted.claimDeadline,
      affectedPeriodStart: extracted.affectedPeriodStart,
      affectedPeriodEnd:   extracted.affectedPeriodEnd,
      classSizeEstimate:   extracted.classSizeEstimate,
      summary:             extracted.summary,
      confidence:          extracted.confidence,
      confidenceScores:    extracted.confidenceScores,
      rawExtraction:       extracted.rawClaudeOutput,
    });

    // Emit to validation queue — even UNVERIFIED records go through validation
    await db.emitEvent({
      type:    'EXTRACTION_COMPLETE',
      payload: {
        caseNumber:  event.caseNumber,
        confidence:  extracted.confidence,
        lawsuitId:   event.lawsuitId,
      },
    });

    run.status     = 'SUCCESS';
    run.finishedAt = new Date().toISOString();
    console.log(`[ExtractionAgent] ${event.caseNumber}: ${extracted.confidence} | fields ok: ${run.stats.fields_extracted}`);

  } catch (err) {
    run.status     = 'FAILED';
    run.finishedAt = new Date().toISOString();
    run.errors.push({ code: 'EXTRACTION_FAILED', message: String(err), context: { caseNumber: event.caseNumber }, at: new Date().toISOString() });
    // Mark for manual review — don't lose the case
    await db.markForReview(event.caseNumber, `Extraction failed: ${err}`);
    console.error(`[ExtractionAgent] FAILED for ${event.caseNumber}:`, err);
  }

  await db.saveAgentRun(run);
  return run;
}

// ═════════════════════════════════════════════════════════════════════════════
//  VALIDATION AGENT
//  Triggered by: event EXTRACTION_COMPLETE
//  Applies rules-based sanity checks before data reaches the Push Agent
// ═════════════════════════════════════════════════════════════════════════════

interface ValidationResult {
  passed:   boolean;
  warnings: string[];
  errors:   string[];
  finalConfidence: DataConfidence;
}

export async function runValidationAgent(event: {
  caseNumber: string;
  confidence: LawsuitRecord['confidence'];
  lawsuitId?: string;
}): Promise<AgentRun> {

  const run: AgentRun = {
    id:          `validation_${Date.now()}`,
    agent:       'validation',
    triggeredBy: 'EVENT',
    startedAt:   new Date().toISOString(),
    status:      'RUNNING',
    stats:       { passed: 0, pending_review: 0, failed: 0 },
    errors:      [],
    retryCount:  0,
  };

  try {
    const lawsuit = await db.getLawsuitByCaseNumber(event.caseNumber);
    if (!lawsuit) throw new Error(`Lawsuit not found: ${event.caseNumber}`);

    const validation = validateLawsuit(lawsuit);

    if (validation.passed && validation.errors.length === 0) {
      // All good — ready for matching
      await db.setLawsuitReady(event.caseNumber);
      run.stats.passed++;

      await db.emitEvent({
        type:    'LAWSUIT_READY',
        payload: { caseNumber: event.caseNumber, lawsuitId: event.lawsuitId },
      });

    } else if (validation.warnings.length > 0 && validation.errors.length === 0) {
      // Warnings only — show as "בבדיקת ייתכנות"
      await db.setLawsuitPendingReview(event.caseNumber, validation.warnings.join(' | '));
      run.stats.pending_review++;

      // Still emit to Push Agent — it knows to show "בבדיקת ייתכנות" label
      await db.emitEvent({
        type:    'LAWSUIT_READY',
        payload: { caseNumber: event.caseNumber, pendingReview: true, lawsuitId: event.lawsuitId },
      });

    } else {
      // Hard errors — do NOT show to users
      await db.markForReview(event.caseNumber, validation.errors.join(' | '));
      run.stats.failed++;
      console.warn(`[ValidationAgent] ${event.caseNumber} failed validation: ${validation.errors.join(', ')}`);
    }

    run.status     = 'SUCCESS';
    run.finishedAt = new Date().toISOString();

  } catch (err) {
    run.status     = 'FAILED';
    run.finishedAt = new Date().toISOString();
    run.errors.push({ code: 'VALIDATION_FAILED', message: String(err), context: {}, at: new Date().toISOString() });
  }

  await db.saveAgentRun(run);
  return run;
}

// ── Validation rules ──────────────────────────────────────────────────────────

function validateLawsuit(lawsuit: any): ValidationResult {
  const warnings: string[] = [];
  const errors:   string[] = [];
  const now = new Date();

  // ── Hard errors — block from showing to users ──────────────────────────────

  if (!lawsuit.caseNumber || lawsuit.caseNumber.trim().length < 3) {
    errors.push('Missing or invalid case number');
  }
  if (!lawsuit.defendantName || lawsuit.defendantName.trim().length < 2) {
    errors.push('Missing defendant name');
  }
  if (!lawsuit.defendantSlug) {
    errors.push('Defendant not matched to any known brand');
  }
  if (lawsuit.payoutMinILS !== undefined && lawsuit.payoutMaxILS !== undefined) {
    if (lawsuit.payoutMinILS > lawsuit.payoutMaxILS) {
      errors.push(`Payout min (${lawsuit.payoutMinILS}) > max (${lawsuit.payoutMaxILS})`);
    }
    if (lawsuit.payoutMaxILS > 1_000_000) {
      errors.push(`Payout max suspiciously high: ${lawsuit.payoutMaxILS} ILS`);
    }
    if (lawsuit.payoutMinILS < 0) {
      errors.push('Payout min is negative');
    }
  }

  // ── Warnings — show as "בבדיקת ייתכנות" ──────────────────────────────────

  if (lawsuit.claimDeadline) {
    const deadline = new Date(lawsuit.claimDeadline);
    if (deadline < now) {
      warnings.push(`Claim deadline ${lawsuit.claimDeadline} is in the past`);
    }
    // Deadline more than 5 years away — suspicious
    const fiveYears = new Date(now);
    fiveYears.setFullYear(now.getFullYear() + 5);
    if (deadline > fiveYears) {
      warnings.push(`Claim deadline ${lawsuit.claimDeadline} seems far in the future`);
    }
  }

  if (!lawsuit.payoutMinILS && !lawsuit.payoutMaxILS) {
    warnings.push('No payout amount found — showing as unknown');
  }
  if (!lawsuit.eligibilityCriteria) {
    warnings.push('No eligibility criteria extracted — showing partial');
  }
  if (!lawsuit.summary) {
    warnings.push('No summary available');
  }

  // Confidence-based warnings
  if (lawsuit.confidence === 'PENDING_REVIEW') {
    warnings.push('Low confidence in extracted fields');
  }
  if (lawsuit.confidence === 'UNVERIFIED') {
    errors.push('Extraction confidence too low for any field');
  }

  const passed = errors.length === 0;
  const finalConfidence: DataConfidence =
    errors.length > 0   ? 'UNVERIFIED'     :
    warnings.length > 0 ? 'PENDING_REVIEW' :
                          'VERIFIED';

  return { passed, warnings, errors, finalConfidence };
}
