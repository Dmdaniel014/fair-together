// ─────────────────────────────────────────────────────────────────────────────
//  skills/screenEvidenceImage.ts
//  PII screening AND pixel-level redaction for image evidence.
//
//  Pipeline (new — now two-pass where possible):
//   1. Claude Vision inspects the image and returns a JSON verdict with
//      *bounding boxes* for each PII region found:
//        {
//          hasPII: boolean,
//          detectedTypes: string[],
//          confidence: 'HIGH'|'MED'|'LOW',
//          boxes: Array<{
//            type: string,
//            xPct: number, yPct: number, wPct: number, hPct: number
//          }>  // percentages relative to full image, 0–100
//        }
//   2. If hasPII=false AND confidence=HIGH → status=READY; r2KeyRedacted = r2KeyOriginal.
//   3. If hasPII=true AND boxes.length>0 AND R2 is configured → sharp blurs
//      those boxes, uploads a redacted PNG to R2, status=READY with a NEW
//      r2KeyRedacted pointing at the blurred copy.
//   4. If hasPII=true but no boxes (confidence=LOW, unreadable) → MANUAL_REVIEW.
//   5. API/transport failure → FAILED (will be retried).
//
//  The reason we still keep MANUAL_REVIEW: low-confidence reads shouldn't
//  auto-ship — if Vision isn't sure *what* the PII is, a sharp blur over
//  guessed regions will either leak PII or mangle legitimate content.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { prisma } from '../db/index';
import { isR2Configured, putObjectBuffer, buildEvidenceKey } from '../lib/r2';

const client = new Anthropic();
const MODEL  = 'claude-sonnet-4-6';

export interface PIIBox {
  type: string;                                 // 'IL_ID' | 'CC' | 'EMAIL' | etc.
  xPct: number; yPct: number; wPct: number; hPct: number;  // 0–100
}

export interface ScreenResult {
  hasPII:        boolean;
  detectedTypes: string[];
  confidence:    'HIGH' | 'MED' | 'LOW';
  status:        'READY' | 'MANUAL_REVIEW' | 'FAILED';
  boxes?:        PIIBox[];
  redactedKey?:  string;   // populated when pixel-level redaction succeeded
  reason?:       string;
}

const SYSTEM = `You are a privacy-screening assistant for an Israeli consumer-rights platform.
Users upload photos as evidence (screenshots, receipts, contracts). Before a photo is
visible to other members of a group, we must detect whether it contains personal data
that would leak the uploader's or anyone else's identity, AND tell us where in the
image each such region is so we can blur it.

Treat these as PII:
- Israeli ID numbers (תעודת זהות — 9 digits, often labeled ת.ז. or מספר זהות) → type "IL_ID"
- Credit card numbers (any 13–19 digit sequence that looks card-like)         → type "CC"
- IBAN / bank account numbers                                                 → type "IBAN"
- Full phone numbers                                                          → type "PHONE"
- Full email addresses                                                        → type "EMAIL"
- Full home addresses (street + number + city together)                       → type "ADDRESS"
- Full names of private individuals (not company names)                       → type "NAME"
- Signatures                                                                  → type "SIGNATURE"
- Passport or driver-license numbers                                          → type "DOC_ID"
- Dates of birth                                                              → type "DOB"

Do NOT treat as PII:
- Company names (even if trademarked)
- Product names, SKU codes, prices
- Store addresses or branch names
- Generic first names without surnames or other identifiers

Return STRICT JSON only — no prose, no markdown fencing. Shape:
{
  "hasPII": boolean,
  "detectedTypes": string[],
  "confidence": "HIGH"|"MED"|"LOW",
  "boxes": [
    { "type": "<type from list above>",
      "xPct": <0-100>, "yPct": <0-100>,
      "wPct": <0-100>, "hPct": <0-100> }
  ]
}

Coordinates are percentages of the full image (0 = top-left corner). Pad each
box by 2-3% on each side so the blur comfortably covers the PII with no
character spilling out the edges. Return an empty boxes array when hasPII=false.

Set confidence=HIGH only when the image is clearly readable and you are sure
about BOTH the presence/absence of PII and the position of every box.
If the image is blurry, partially obscured, or you cannot read the text, set
confidence=LOW and hasPII=true with an empty boxes array (err on the side of
manual review).`;

export async function screenEvidenceImage(input: {
  evidenceId:  string;
  imageBase64: string;
  mimeType:    'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
}): Promise<ScreenResult> {
  // Mark as PROCESSING so a concurrent re-trigger is a no-op.
  const claim = await prisma.caseEvidence.updateMany({
    where: { id: input.evidenceId, redactionStatus: { in: ['PENDING', 'FAILED'] } },
    data:  { redactionStatus: 'PROCESSING' },
  });
  if (claim.count === 0) {
    const cur = await prisma.caseEvidence.findUnique({
      where:  { id: input.evidenceId },
      select: { redactionStatus: true },
    });
    throw new Error(`EVIDENCE_NOT_SCREENABLE:${cur?.redactionStatus ?? 'UNKNOWN'}`);
  }

  let verdict: ScreenResult;
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: input.mimeType,
              data: input.imageBase64,
            },
          },
          {
            type: 'text',
            text: 'Screen this image for PII per the instructions. Return JSON only, including boxes.',
          },
        ],
      }],
    });

    const textBlock = resp.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined;
    const raw = textBlock?.text?.trim() ?? '';
    const jsonStart = raw.indexOf('{');
    const jsonEnd   = raw.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON in vision response');
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
      hasPII: boolean; detectedTypes?: unknown; confidence?: unknown; boxes?: unknown;
    };
    const hasPII     = Boolean(parsed.hasPII);
    const types      = Array.isArray(parsed.detectedTypes)
      ? parsed.detectedTypes.filter((x): x is string => typeof x === 'string').slice(0, 10)
      : [];
    const confidence = ['HIGH', 'MED', 'LOW'].includes(String(parsed.confidence))
      ? (parsed.confidence as 'HIGH' | 'MED' | 'LOW') : 'LOW';
    const boxes = sanitizeBoxes(parsed.boxes);

    // Decision tree — see header comment for rationale.
    let status: 'READY' | 'MANUAL_REVIEW';
    let redactedKey: string | undefined;

    if (!hasPII && confidence === 'HIGH') {
      status = 'READY';
    } else if (hasPII && boxes.length > 0 && confidence !== 'LOW') {
      // Try pixel-level redaction.
      const redacted = await tryRedact(input.evidenceId, boxes);
      if (redacted) {
        status = 'READY';
        redactedKey = redacted;
      } else {
        // Redaction pipeline unavailable / failed → fall back to manual review.
        status = 'MANUAL_REVIEW';
      }
    } else {
      status = 'MANUAL_REVIEW';
    }

    verdict = { hasPII, detectedTypes: types, confidence, status, boxes, redactedKey };
  } catch (err: any) {
    console.error('[screenEvidenceImage] failed:', err?.message ?? err);
    await prisma.caseEvidence.update({
      where: { id: input.evidenceId },
      data:  { redactionStatus: 'FAILED' },
    });
    return {
      hasPII: true, detectedTypes: [], confidence: 'LOW',
      status: 'FAILED', reason: err?.message ?? 'vision_error',
    };
  }

  // Persist verdict. For READY we either:
  //   - mirror r2KeyOriginal → r2KeyRedacted (no PII), OR
  //   - point r2KeyRedacted at the blurred copy we just uploaded.
  const ev = await prisma.caseEvidence.findUnique({
    where:  { id: input.evidenceId },
    select: { r2KeyOriginal: true },
  });
  const resolvedRedactedKey =
    verdict.status === 'READY'
      ? (verdict.redactedKey ?? ev?.r2KeyOriginal ?? null)
      : null;

  await prisma.caseEvidence.update({
    where: { id: input.evidenceId },
    data: {
      redactionStatus: verdict.status,
      r2KeyRedacted:   resolvedRedactedKey,
    },
  });

  return verdict;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sanitizeBoxes(raw: unknown): PIIBox[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b: any): PIIBox | null => {
      if (!b || typeof b !== 'object') return null;
      const xPct = Number(b.xPct); const yPct = Number(b.yPct);
      const wPct = Number(b.wPct); const hPct = Number(b.hPct);
      if ([xPct, yPct, wPct, hPct].some(n => !Number.isFinite(n))) return null;
      // Clamp and ensure the box is inside the image.
      const x = clamp(xPct, 0, 100);
      const y = clamp(yPct, 0, 100);
      const w = clamp(wPct, 0, 100 - x);
      const h = clamp(hPct, 0, 100 - y);
      if (w <= 0 || h <= 0) return null;
      const type = typeof b.type === 'string' ? b.type.slice(0, 32) : 'PII';
      return { type, xPct: x, yPct: y, wPct: w, hPct: h };
    })
    .filter((b): b is PIIBox => b !== null)
    .slice(0, 25);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// Pull the original out of R2, blur each box, upload the redacted copy, and
// return its key. Returns null if anything goes wrong — caller falls back to
// MANUAL_REVIEW. This intentionally doesn't throw so a single pipeline hiccup
// doesn't blow up the whole screening request.
async function tryRedact(evidenceId: string, boxes: PIIBox[]): Promise<string | null> {
  if (!isR2Configured()) return null;
  try {
    const ev = await prisma.caseEvidence.findUnique({
      where:  { id: evidenceId },
      select: { caseId: true, r2KeyOriginal: true, mimeType: true },
    });
    if (!ev || !ev.r2KeyOriginal || !ev.mimeType) return null;

    const { getObjectBuffer } = await import('../lib/r2');
    const { body: origBuf } = await getObjectBuffer(ev.r2KeyOriginal);

    // Read image metadata so we can translate percentage boxes → pixels.
    const img = sharp(origBuf, { failOn: 'truncated' });
    const meta = await img.metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    if (W <= 0 || H <= 0) return null;

    // Composite a blurred version of each region over the original.
    const composites: sharp.OverlayOptions[] = [];
    for (const b of boxes) {
      const left   = Math.round((b.xPct / 100) * W);
      const top    = Math.round((b.yPct / 100) * H);
      const width  = Math.max(1, Math.round((b.wPct / 100) * W));
      const height = Math.max(1, Math.round((b.hPct / 100) * H));
      // Guard against edge overruns after rounding.
      const safeW = Math.min(width,  W - left);
      const safeH = Math.min(height, H - top);
      if (safeW <= 0 || safeH <= 0) continue;

      // Extract the region, blur it heavily, then composite it back.
      // Radius 20 is enough to obliterate ~9pt text at typical screenshot
      // resolutions without turning the whole image into mush.
      const regionBuf = await sharp(origBuf)
        .extract({ left, top, width: safeW, height: safeH })
        .blur(20)
        .toBuffer();
      composites.push({ input: regionBuf, left, top });
    }
    if (composites.length === 0) return null;

    // Always emit PNG — lossless, and mobile clients all render it.
    const redactedBuf = await sharp(origBuf)
      .composite(composites)
      .png()
      .toBuffer();

    const redactedKey = buildEvidenceKey(ev.caseId, evidenceId, 'redacted', 'image/png');
    await putObjectBuffer({ key: redactedKey, body: redactedBuf, contentType: 'image/png' });
    return redactedKey;
  } catch (e: any) {
    console.error('[screenEvidenceImage] redact failed:', e?.message ?? e);
    return null;
  }
}
