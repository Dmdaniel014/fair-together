// ─────────────────────────────────────────────────────────────────────────────
//  skills/extractPdfFields.ts
//  Skill: extract_pdf_fields
//  Triggered by: Extraction Agent
//
//  What it does:
//  1. Reads a PDF (text layer via pdfplumber-equivalent, or OCR fallback)
//  2. Sends to Claude API with a structured extraction prompt
//  3. Returns typed JSON with per-field confidence scores
//  4. Fields below CONFIDENCE_THRESHOLD → marked PENDING_REVIEW
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs/promises';
import { CONFIDENCE_THRESHOLD, DataConfidence } from '../types';

// ── Output shape ──────────────────────────────────────────────────────────────

export interface ExtractedLawsuitFields {
  // Core identifiers
  caseNumber?:           string;
  defendantName?:        string;
  plaintiffName?:        string;
  court?:                string;
  status?:               string;          // raw Hebrew, mapped later
  filingDate?:           string;          // ISO YYYY-MM-DD

  // Financial — the critical fields
  payoutMinILS?:         number;
  payoutMaxILS?:         number;
  totalPoolILS?:         number;

  // Eligibility
  eligibilityCriteria?:  string;
  claimDeadline?:        string;          // ISO YYYY-MM-DD
  affectedPeriodStart?:  string;          // ISO YYYY-MM-DD
  affectedPeriodEnd?:    string;          // ISO YYYY-MM-DD
  classSizeEstimate?:    number;

  // Summary
  summary?:              string;          // 2–3 sentence plain Hebrew summary

  // Quality
  confidence:            DataConfidence;
  confidenceScores:      Record<string, number>;   // 0.0–1.0 per field
  rawClaudeOutput:       string;          // kept for audit
  extractedAt:           string;
}

// ── Extraction prompt ─────────────────────────────────────────────────────────
// Engineered for Israeli legal Hebrew documents.
// Claude returns ONLY valid JSON — no preamble, no markdown.

const EXTRACTION_PROMPT = `
You are a legal data extraction assistant specializing in Israeli class action lawsuits (תובענות ייצוגיות).

Extract the following fields from the Hebrew court document below.
Return ONLY a valid JSON object — no preamble, no markdown backticks, no explanation.

For each field, also include a confidence score from 0.0 to 1.0 in a "confidence_scores" object.
Use null for fields not found in the document.
For monetary amounts: always use NIS (ILS) as integers (no commas, no currency symbols).
For dates: always use YYYY-MM-DD format.

Required fields:
{
  "case_number": string | null,
  "defendant_name": string | null,
  "plaintiff_name": string | null,
  "court": string | null,
  "status": string | null,
  "filing_date": string | null,
  "payout_min_ils": number | null,
  "payout_max_ils": number | null,
  "total_pool_ils": number | null,
  "eligibility_criteria": string | null,
  "claim_deadline": string | null,
  "affected_period_start": string | null,
  "affected_period_end": string | null,
  "class_size_estimate": number | null,
  "summary": string | null,
  "confidence_scores": {
    "case_number": 0.0–1.0,
    "defendant_name": 0.0–1.0,
    "payout_min_ils": 0.0–1.0,
    "payout_max_ils": 0.0–1.0,
    "total_pool_ils": 0.0–1.0,
    "eligibility_criteria": 0.0–1.0,
    "claim_deadline": 0.0–1.0,
    "affected_period_start": 0.0–1.0,
    "affected_period_end": 0.0–1.0,
    "summary": 0.0–1.0
  }
}

Important notes:
- "eligibility_criteria": who qualifies — specific conditions (dates, products, amounts). Be precise.
- "claim_deadline": the date by which consumers must submit — NOT the case filing date.
- "summary": 2–3 sentences in plain Hebrew, suitable for a consumer app. No legal jargon.
- "status": use the exact Hebrew term from the document (e.g., "הוגשה", "אושרה", "פשרה").
- If you find a range for payout (e.g., "בין 100 ל-300 שקל"), use payout_min and payout_max.

DOCUMENT:
{PDF_TEXT}
`.trim();

// ── Main skill function ───────────────────────────────────────────────────────

export async function extractPdfFields(options: {
  pdfPath:      string;
  caseNumber:   string;
  anthropicKey: string;
}): Promise<ExtractedLawsuitFields> {

  const { pdfPath, caseNumber, anthropicKey } = options;

  // ── Step 1: Extract text from PDF ─────────────────────────────────────────
  let pdfText: string;
  try {
    pdfText = await extractTextFromPDF(pdfPath);
  } catch (err) {
    throw new Error(`PDF text extraction failed for ${caseNumber}: ${err}`);
  }

  if (!pdfText || pdfText.trim().length < 100) {
    throw new Error(`PDF text too short for ${caseNumber} — may be a scanned image without OCR`);
  }

  // ── Step 2: Call Claude API ────────────────────────────────────────────────
  const prompt = EXTRACTION_PROMPT.replace('{PDF_TEXT}', pdfText.slice(0, 80000)); // 80k char limit

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const data: any  = await response.json();
  const rawOutput  = data.content?.map((b: any) => b.text ?? '').join('') ?? '';

  // ── Step 3: Parse JSON response ───────────────────────────────────────────
  let parsed: Record<string, any>;
  try {
    const clean = rawOutput.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    throw new Error(`Claude returned non-JSON for ${caseNumber}: ${rawOutput.slice(0, 200)}`);
  }

  const scores: Record<string, number> = parsed.confidence_scores ?? {};

  // ── Step 4: Determine overall confidence ─────────────────────────────────
  // Critical fields: payout, deadline, eligibility
  const criticalScores = [
    scores.payout_min_ils    ?? 0,
    scores.claim_deadline    ?? 0,
    scores.eligibility_criteria ?? 0,
  ];
  const minCriticalScore = Math.min(...criticalScores);
  const avgScore = Object.values(scores).reduce((a, b) => a + b, 0) / Math.max(Object.values(scores).length, 1);

  let confidence: DataConfidence;
  if (minCriticalScore >= CONFIDENCE_THRESHOLD && avgScore >= CONFIDENCE_THRESHOLD) {
    confidence = 'VERIFIED';
  } else if (avgScore >= 0.5) {
    confidence = 'PENDING_REVIEW';
  } else {
    confidence = 'UNVERIFIED';
  }

  return {
    caseNumber:           parsed.case_number         ?? undefined,
    defendantName:        parsed.defendant_name      ?? undefined,
    plaintiffName:        parsed.plaintiff_name      ?? undefined,
    court:                parsed.court               ?? undefined,
    status:               parsed.status              ?? undefined,
    filingDate:           parsed.filing_date         ?? undefined,
    payoutMinILS:         parsed.payout_min_ils      ?? undefined,
    payoutMaxILS:         parsed.payout_max_ils      ?? undefined,
    totalPoolILS:         parsed.total_pool_ils      ?? undefined,
    eligibilityCriteria:  parsed.eligibility_criteria ?? undefined,
    claimDeadline:        parsed.claim_deadline      ?? undefined,
    affectedPeriodStart:  parsed.affected_period_start ?? undefined,
    affectedPeriodEnd:    parsed.affected_period_end ?? undefined,
    classSizeEstimate:    parsed.class_size_estimate ?? undefined,
    summary:              parsed.summary             ?? undefined,
    confidence,
    confidenceScores:     scores,
    rawClaudeOutput:      rawOutput,
    extractedAt:          new Date().toISOString(),
  };
}

// ── PDF text extraction ───────────────────────────────────────────────────────
// Uses Python pdfplumber via child_process for text-layer PDFs.
// Falls back to Tesseract OCR (Hebrew) for scanned images.

async function extractTextFromPDF(pdfPath: string): Promise<string> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  // Try pdfplumber first (text-layer PDFs — most court documents)
  const pythonScript = `
import pdfplumber, sys, json
try:
    with pdfplumber.open('${pdfPath}') as pdf:
        text = '\\n'.join(page.extract_text() or '' for page in pdf.pages)
    print(json.dumps({'text': text, 'method': 'pdfplumber'}))
except Exception as e:
    print(json.dumps({'text': '', 'error': str(e)}))
`.trim();

  try {
    const { stdout } = await execAsync(`python3 -c "${pythonScript.replace(/"/g, '\\"')}"`);
    const result = JSON.parse(stdout);
    if (result.text && result.text.length > 100) return result.text;
  } catch {
    // fall through to OCR
  }

  // Fallback: Tesseract OCR with Hebrew language pack
  // Requires: apt-get install tesseract-ocr tesseract-ocr-heb
  try {
    const { stdout: ocrOut } = await execAsync(
      `tesseract "${pdfPath}" stdout -l heb+eng --psm 6 2>/dev/null`
    );
    return ocrOut;
  } catch (err) {
    throw new Error(`Both pdfplumber and Tesseract failed: ${err}`);
  }
}
