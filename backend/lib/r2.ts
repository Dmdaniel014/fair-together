// ─────────────────────────────────────────────────────────────────────────────
//  lib/r2.ts
//  Cloudflare R2 client — S3-compatible object storage for case evidence.
//
//  Two buckets of keys:
//    evidence/{caseId}/{evidenceId}/orig.{ext}     — lawyer/admin only
//    evidence/{caseId}/{evidenceId}/redacted.{ext} — visible in case feed
//
//  Workflow:
//    1. Client asks backend for a presigned PUT URL via presignUpload()
//    2. Client PUTs the file directly to R2 (bypassing our server)
//    3. Client posts evidence-complete to backend with the r2Key
//    4. Backend inserts CaseEvidence row (redactionStatus=PENDING), then
//       downloads the bytes via getObjectBuffer() to run screenEvidenceImage.
//
//  Why presigned PUT: avoids proxying multi-MB payloads through Express
//  (Neon/serverless instances have tight memory + time budgets).
//
//  ENV required at runtime:
//    R2_ACCOUNT_ID        — the hex account id from the Cloudflare dashboard
//    R2_ACCESS_KEY_ID     — from R2 > Manage R2 API Tokens > Create Token
//    R2_SECRET_ACCESS_KEY
//    R2_BUCKET            — bucket name (e.g. "fair-together-evidence")
//    R2_PUBLIC_BASE_URL   — (optional) public/CDN domain for served objects
// ─────────────────────────────────────────────────────────────────────────────

import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const {
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
  R2_BUCKET, R2_PUBLIC_BASE_URL,
} = process.env;

// We don't throw at import time — the agent system has cron jobs that import
// this tree without needing R2. The first real call will throw with a clear
// message if env is missing.
const r2Configured: boolean =
  !!R2_ACCOUNT_ID && !!R2_ACCESS_KEY_ID && !!R2_SECRET_ACCESS_KEY && !!R2_BUCKET;

function assertConfigured(): void {
  if (!r2Configured) {
    throw new Error(
      'R2 not configured. Set R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET.'
    );
  }
}

let _client: S3Client | null = null;
function client(): S3Client {
  assertConfigured();
  if (_client) return _client;
  _client = new S3Client({
    // R2's endpoint is account-scoped. The `auto` region is required.
    region:   'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     R2_ACCESS_KEY_ID!,
      secretAccessKey: R2_SECRET_ACCESS_KEY!,
    },
  });
  return _client;
}

export function isR2Configured(): boolean {
  return r2Configured;
}

// Mime → extension map for the small set of types we accept for evidence.
// Keep this narrow: images only for v1 (pdf/docx planned but not yet screened).
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif',
};

export function extForMime(mime: string): string | null {
  return MIME_EXT[mime] ?? null;
}

export function buildEvidenceKey(
  caseId: string,
  evidenceId: string,
  variant: 'orig' | 'redacted',
  mime: string,
): string {
  const ext = extForMime(mime);
  if (!ext) throw new Error(`Unsupported mime for evidence: ${mime}`);
  return `evidence/${caseId}/${evidenceId}/${variant}.${ext}`;
}

// Presign a PUT URL so the client can upload directly. 5-minute expiry —
// long enough to finish a slow cellular upload but short enough that a
// leaked URL is largely useless.
export async function presignUpload(input: {
  key:         string;
  contentType: string;
  // Optional: enforce a max size via Content-Length header on the client.
  expiresInSec?: number;
}): Promise<{ url: string; key: string; expiresAt: Date }> {
  assertConfigured();
  const cmd = new PutObjectCommand({
    Bucket:      R2_BUCKET,
    Key:         input.key,
    ContentType: input.contentType,
  });
  const expiresInSec = input.expiresInSec ?? 300;
  const url = await getSignedUrl(client(), cmd, { expiresIn: expiresInSec });
  return {
    url, key: input.key,
    expiresAt: new Date(Date.now() + expiresInSec * 1000),
  };
}

// Presign a GET URL for short-lived download (e.g. mobile client fetching
// the redacted version). Admins use a separate endpoint that returns the
// ORIGINAL key; regular members only ever see redacted.
export async function presignDownload(input: {
  key: string;
  expiresInSec?: number;
}): Promise<string> {
  assertConfigured();
  const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: input.key });
  return getSignedUrl(client(), cmd, { expiresIn: input.expiresInSec ?? 600 });
}

// Fetch the whole object into memory. Used by screenEvidenceImage + pixel-
// level redaction. Callers should enforce a byte cap before invoking.
export async function getObjectBuffer(key: string): Promise<{ body: Buffer; contentType: string | null }> {
  assertConfigured();
  const out = await client().send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  if (!out.Body) throw new Error(`R2 object not found: ${key}`);
  // @ts-ignore — aws-sdk v3 Body is a Readable in node; transformToByteArray exists.
  const bytes = await out.Body.transformToByteArray();
  return { body: Buffer.from(bytes), contentType: out.ContentType ?? null };
}

export async function putObjectBuffer(input: {
  key:         string;
  body:        Buffer;
  contentType: string;
}): Promise<void> {
  assertConfigured();
  await client().send(new PutObjectCommand({
    Bucket:      R2_BUCKET,
    Key:         input.key,
    Body:        input.body,
    ContentType: input.contentType,
  }));
}

export async function headObject(key: string): Promise<{ size: number; contentType: string | null } | null> {
  assertConfigured();
  try {
    const out = await client().send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return { size: Number(out.ContentLength ?? 0), contentType: out.ContentType ?? null };
  } catch (e: any) {
    if (e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}

export async function deleteObject(key: string): Promise<void> {
  assertConfigured();
  await client().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

// If a public CDN/r2.dev base URL is configured, build a direct public URL.
// Returns null when no public base is set (caller should fall back to
// presignDownload).
export function publicUrl(key: string): string | null {
  if (!R2_PUBLIC_BASE_URL) return null;
  return `${R2_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
}
