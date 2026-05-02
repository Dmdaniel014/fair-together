// ─────────────────────────────────────────────────────────────────────────────
//  services/api.ts — Backend API client for Fair Together
//  Handles auth tokens, error handling, and typed responses
// ─────────────────────────────────────────────────────────────────────────────

import * as SecureStore from 'expo-secure-store';

const API_BASE = __DEV__
  ? 'http://192.168.1.130:3001'   // PC local IP — phone & PC must be on same WiFi
  : 'https://api.fairtogether.co.il';

const TOKEN_KEY = 'ft_jwt_token';
const USER_ID_KEY = 'ft_user_id';

// ── Types ────────────────────────────────────────────────────────────────────
// These types mirror the API response shapes from the backend.
// They intentionally differ from backend/types.ts (which defines internal agent models).
// Keep in sync with: backend/api/server.ts endpoint responses.

export interface Lawsuit {
  id:                  string;
  caseNumber:          string;
  court:               string | null;
  status:              LawsuitStatus;
  defendantName:       string;
  defendantSlug:       string;
  plaintiffName:       string | null;
  filingDate:          string | null;
  closeDate:           string | null;
  result:              string | null;
  lawyers:             string | null;
  payoutMinILS:        string | null;
  payoutMaxILS:        string | null;
  totalPoolILS:        string | null;
  eligibilityCriteria: string | null;
  claimDeadline:       string | null;
  classSizeEstimate:   number | null;
  summary:             string | null;
  confidence:          string;
  isReady:             boolean;
  lastUpdatedAt:       string | null;
}

export type LawsuitStatus =
  | 'FILED' | 'CERTIFIED' | 'DISCOVERY' | 'SETTLEMENT'
  | 'SETTLEMENT_APPROVED' | 'RULING' | 'CLOSED' | 'DISMISSED';

export interface MatchResult {
  id:                    string;
  relevanceScore:        number;
  matchConfidenceScore:  number;
  matchReasons:          string[];
  matchType:             'DIRECT_BRAND' | 'GLOBAL_WATCH' | 'CATEGORY' | 'SECTOR';
}

export interface UserClaim {
  id:        string;
  lawsuitId: string;
  action:    'JOINED' | 'SAVED' | 'DISMISSED';
  createdAt: string;
  updatedAt: string;
  lawsuit:   Lawsuit;
}

export interface AuthResponse {
  token:  string;
  userId: string;
}

// ── Token management ─────────────────────────────────────────────────────────

async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

async function saveToken(token: string, userId: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await SecureStore.setItemAsync(USER_ID_KEY, userId);
}

export async function getUserId(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(USER_ID_KEY);
  } catch {
    return null;
  }
}

export async function clearAuth(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(USER_ID_KEY);
}

// ── HTTP wrapper ─────────────────────────────────────────────────────────────

async function apiFetch<T>(
  path:    string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> ?? {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, body || `HTTP ${res.status}`);
  }

  return res.json();
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function register(email: string): Promise<AuthResponse> {
  const data = await apiFetch<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body:   JSON.stringify({ email }),
  });
  await saveToken(data.token, data.userId);
  return data;
}

// ── Onboarding ───────────────────────────────────────────────────────────────

export async function saveOnboarding(profile: {
  selectedBrands:   string[];
  categories:       string[];
  frequency:        string;
  householdSize:    number;
}): Promise<void> {
  await apiFetch('/api/user/onboarding', {
    method: 'POST',
    body:   JSON.stringify(profile),
  });
}

// ── Push Token ──────────────────────────────────────────────────────────

export async function updatePushToken(token: string): Promise<void> {
  await apiFetch('/api/user/push-token', {
    method: 'PUT',
    body: JSON.stringify({ token }),
  });
}

// ── User Profile ────────────────────────────────────────────────────────

export interface UserProfile {
  selectedBrands:     string[];
  categories:         string[];
  frequency:          string;
  householdSize:      number;
  onboardingComplete: boolean;
}

export async function getProfile(): Promise<UserProfile | null> {
  const data = await apiFetch<{ profile: UserProfile | null }>('/api/user/profile');
  return data.profile;
}

// ── Lawsuits ─────────────────────────────────────────────────────────────────

export async function getLawsuits(
  brand?: string,
  status?: string,
): Promise<{ lawsuits: Lawsuit[]; total: number }> {
  const params = new URLSearchParams();
  if (brand)  params.set('brand', brand);
  if (status) params.set('status', status);
  const qs = params.toString();
  return apiFetch(`/api/lawsuits${qs ? `?${qs}` : ''}`);
}

export async function getLawsuitById(id: string): Promise<Lawsuit> {
  return apiFetch(`/api/lawsuits/${id}`);
}

// ── Matching ─────────────────────────────────────────────────────────────────

export async function computeMatches(profile: {
  selectedBrands:   string[];
  categories:       string[];
  frequency:        string;
  householdSize:    number;
}): Promise<MatchResult[]> {
  const data = await apiFetch<{ matches: MatchResult[] }>('/api/matches', {
    method: 'POST',
    body:   JSON.stringify(profile),
  });
  return data.matches;
}

// ── User Claims (התביעות שלי) ────────────────────────────────────────────

export async function getUserClaims(
  action?: string,
): Promise<{ claims: UserClaim[]; total: number }> {
  const qs = action ? `?action=${action}` : '';
  return apiFetch(`/api/user/claims${qs}`);
}

export async function getUserClaimStats(): Promise<{ JOINED: number; SAVED: number; DISMISSED: number }> {
  return apiFetch('/api/user/claims/stats');
}

export async function submitClaim(
  lawsuitId: string,
  action:    'JOINED' | 'SAVED' | 'DISMISSED',
): Promise<void> {
  await apiFetch('/api/user/claims', {
    method: 'POST',
    body:   JSON.stringify({ lawsuitId, action }),
  });
}

// ── User feedback (legacy) ──────────────────────────────────────────────

export async function sendFeedback(
  lawsuitId: string,
  action:    'JOINED' | 'DISMISSED' | 'SAVED',
): Promise<void> {
  await apiFetch('/api/user/feedback', {
    method: 'POST',
    body:   JSON.stringify({ lawsuitId, action }),
  });
}

// ── AI Insights ──────────────────────────────────────────────────────────────

export async function getInsight(
  lawsuitId: string,
): Promise<{ content: string }> {
  const userId = await getUserId();
  return apiFetch(`/api/insights/${userId}/${lawsuitId}`);
}

// ── AI Streaming Summary (SSE) ──────────────────────────────────────────────

export async function streamLawsuitSummary(
  lawsuitId: string,
  onChunk:   (text: string) => void,
  onDone:    () => void,
  onError:   (err: Error) => void,
): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/lawsuits/${lawsuitId}/summary`);
    if (!res.ok) {
      onError(new Error(`HTTP ${res.status}`));
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) { onError(new Error('No reader')); return; }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') { onDone(); return; }
        try {
          const parsed = JSON.parse(payload);
          if (parsed.error) { onError(new Error(parsed.error)); return; }
          if (parsed.text)  onChunk(parsed.text);
        } catch { /* skip malformed */ }
      }
    }
    onDone();
  } catch (err: any) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}

// ── AI Eligibility Check ────────────────────────────────────────────────────

export interface EligibilityResult {
  eligible:    'YES' | 'NO' | 'MAYBE';
  confidence:  number;
  explanation: string;
  followUp?:   string;
}

export async function checkEligibility(lawsuitId: string): Promise<EligibilityResult> {
  return apiFetch(`/api/lawsuits/${lawsuitId}/eligibility`);
}

export async function submitFollowUpAnswers(
  lawsuitId: string,
  answers: { question: string; answer: string }[],
): Promise<EligibilityResult> {
  return apiFetch(`/api/lawsuits/${lawsuitId}/eligibility/followup`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
}

// ── Notification Preferences ────────────────────────────────────────────────

export type NotificationPref = 'ALL' | 'ACTIONABLE' | 'WEEKLY_DIGEST' | 'NONE';

export async function updateNotificationPref(preference: NotificationPref): Promise<void> {
  await apiFetch('/api/user/notification-pref', {
    method: 'PUT',
    body: JSON.stringify({ preference }),
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  PHASE 1 — SETTLEMENT ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

export interface Settlement extends Lawsuit {
  category:           string | null;
  claimFormUrl:       string | null;
  payoutMethod:       string | null;
  distributionStatus: string | null;
  claimGuideSteps:    string[] | null;
  claimGuideHe:       string | null;
  estimatedPayout:    string | null;
  isSettlement:       boolean;
}

export type SettlementCategory = 'telecom' | 'banks' | 'retail' | 'insurance' | 'food' | 'tech' | 'transport' | 'health' | 'other';

export const CATEGORY_INFO: Record<SettlementCategory, { he: string; icon: string }> = {
  telecom:   { he: 'תקשורת',   icon: '📱' },
  banks:     { he: 'בנקים',    icon: '🏦' },
  retail:    { he: 'קמעונאות', icon: '🛒' },
  insurance: { he: 'ביטוח',    icon: '🛡️' },
  food:      { he: 'מזון',     icon: '🍎' },
  tech:      { he: 'טכנולוגיה', icon: '💻' },
  transport: { he: 'תחבורה',   icon: '✈️' },
  health:    { he: 'בריאות',   icon: '🏥' },
  other:     { he: 'אחר',      icon: '📋' },
};

// ── Settlements ─────────────────────────────────────────────────────────────

export async function getSettlements(
  categories?: string[],
): Promise<{ settlements: Settlement[]; total: number }> {
  const qs = categories?.length ? `?categories=${categories.join(',')}` : '';
  return apiFetch(`/api/settlements${qs}`);
}

export async function getSettlementById(id: string): Promise<Settlement> {
  return apiFetch(`/api/settlements/${id}`);
}

// ── User Settlement Actions ─────────────────────────────────────────────────

export async function markSettlement(
  lawsuitId: string,
  action: 'INTERESTED' | 'CLAIMED' | 'DISMISSED',
): Promise<void> {
  await apiFetch('/api/user/settlements', {
    method: 'POST',
    body: JSON.stringify({ lawsuitId, action }),
  });
}

export async function getMySettlements(): Promise<{ settlements: UserClaim[]; total: number }> {
  return apiFetch('/api/user/settlements');
}

// ── Simplified Onboarding ───────────────────────────────────────────────────

export async function saveSimpleOnboarding(profile: {
  displayName?: string;
  selectedCategories: string[];
}): Promise<void> {
  await apiFetch('/api/user/onboarding/simple', {
    method: 'POST',
    body: JSON.stringify(profile),
  });
}

// ── 4-State Eligibility Classification Engine ───────────────────────────────

export type ClassificationState =
  | 'NO_ACTION_REQUIRED'
  | 'ACTION_REQUIRED_WITH_DEADLINE'
  | 'CLAIM_FORM_REQUIRED'
  | 'MAYBE_NEED_MORE_INFO';

export interface ClassificationResult {
  classification:       ClassificationState;
  confidence:           number;
  reason_hebrew:        string;
  deadline: {
    exists: boolean;
    date:   string | null;
    type:   'objection' | 'claim' | 'opt_out' | 'document_upload' | 'other' | null;
  };
  user_action: {
    required:    boolean;
    action_type: 'none' | 'open_case' | 'submit_form' | 'upload_docs' |
                 'answer_questions' | 'opt_out' | 'object' | 'wait' | 'other';
  };
  eligibility: {
    likely_eligible: boolean | 'unknown';
    why: string[];
  };
  follow_up_questions:  string[];
  notification_copy_he: string;
}

/** Classify a settlement for the current user (optional auth — personalizes if logged in) */
export async function classifySettlement(id: string): Promise<ClassificationResult> {
  return apiFetch(`/api/settlements/${id}/classify`);
}

/** Re-classify after user answers follow-up questions */
export async function reclassifyWithAnswers(
  id: string,
  answers: { question: string; answer: string }[],
): Promise<ClassificationResult> {
  return apiFetch(`/api/settlements/${id}/classify`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
}

// ── Incubator / Admin ───────────────────────────────────────────────────────

export type UserRole = 'USER' | 'ADMIN' | 'LAWYER';

export interface Me {
  id:          string;
  role:        UserRole;
  phone:       string | null;
  email:       string | null;
  displayName: string | null;
}

export async function getMe(): Promise<Me> {
  return apiFetch<Me>('/api/auth/me');
}

export type IncubatorCaseStatus =
  | 'DRAFT' | 'PENDING_REVIEW' | 'REVISIONS_REQUESTED' | 'LIVE'
  | 'GOAL_REACHED' | 'LEGAL_ACTION' | 'CLOSED' | 'REJECTED';

export type LegalClaimType =
  | 'MISREPRESENTATION' | 'OVERCHARGING' | 'DEFECTIVE_PRODUCT'
  | 'POOR_SERVICE' | 'DISCRIMINATION' | 'PRIVACY_VIOLATION' | 'OTHER';

export type AffectedSize =
  | 'TENS' | 'HUNDREDS' | 'THOUSANDS'
  | 'TENS_OF_THOUSANDS' | 'HUNDREDS_OF_THOUSANDS' | 'MILLIONS';

export interface CaseAnalysis {
  factors: {
    harmProof:         number;
    narrativeDetail:   number;
    legalPlausibility: number;
    formCompleteness:  number;
    affectedPotential: number;
  };
  powerScore:      number;
  legalDifficulty: number;
  recommendation:  'APPROVE' | 'REVISIONS' | 'REJECT';
  summary:         string;
  strengths:       string[];
  weaknesses:      string[];
  flags:           string[];
}

export interface PendingIncubatorCase {
  id:                string;
  title:             string;
  defendantCompany:  string;
  legalClaimType:    LegalClaimType;
  damageEstimateNis: number;
  narrative:         string;
  status:            IncubatorCaseStatus;
  goalMembers:       number;
  goalDamageNis:     number;
  createdAt:         string;
  incidentDate:      string | null;
  incidentPeriodEnd: string | null;
  estimatedAffected: AffectedSize | null;
  aiAnalysis:        CaseAnalysis | null;
  aiAnalyzedAt:      string | null;
  aiModel:           string | null;
  powerScore:        number | null;
  legalDifficulty:   number | null;
  founder: {
    id:          string;
    phone:       string | null;
    profile:     { displayName: string | null } | null;
  } | null;
  _count: { members: number; evidence: number };
  similarLiveCount:  number; // admin duplicate-detection flag
}

export async function getPendingCases(): Promise<{ cases: PendingIncubatorCase[]; total: number }> {
  return apiFetch('/api/admin/cases/pending');
}

export async function approveCase(id: string, note?: string): Promise<void> {
  await apiFetch(`/api/admin/cases/${id}/approve`, {
    method: 'POST',
    body:   JSON.stringify({ note }),
  });
}

export async function rejectCase(id: string, reason: string): Promise<void> {
  await apiFetch(`/api/admin/cases/${id}/reject`, {
    method: 'POST',
    body:   JSON.stringify({ reason }),
  });
}

export async function requestCaseRevisions(id: string, reason: string): Promise<void> {
  await apiFetch(`/api/admin/cases/${id}/request-revisions`, {
    method: 'POST',
    body:   JSON.stringify({ reason }),
  });
}

// ── Incubator / Founder flow ────────────────────────────────────────────────

export interface IncubatorCase {
  id:                string;
  title:             string;
  defendantCompany:  string;
  legalClaimType:    LegalClaimType;
  damageEstimateNis: number;
  narrative:         string;
  status:            IncubatorCaseStatus;
  incidentDate:      string | null;
  incidentPeriodEnd: string | null;
  estimatedAffected: AffectedSize | null;
  powerScore:        number | null;
  legalDifficulty:   number | null;
  aiAnalysis:        CaseAnalysis | null;
  aiAnalyzedAt:      string | null;
  adminNote:         string | null;
  goalMembers:       number;
  goalDamageNis:     number;
  approvedAt:        string | null;
  createdAt:         string;
  updatedAt:         string;
  _count?:           { members: number; evidence: number };
}

export interface CaseEvidenceItem {
  id:          string;
  caseId:      string;
  kind:        'TEXT' | 'URL' | 'FILE';
  textContent: string | null;
  externalUrl: string | null;
  description: string | null;
  createdAt:   string;
}

export interface CreateCaseInput {
  title:              string;
  defendantCompany:   string;
  legalClaimType:     LegalClaimType;
  damageEstimateNis:  number;
  narrative:          string;
  incidentDate?:      string;         // ISO
  incidentPeriodEnd?: string;         // ISO
  estimatedAffected?: AffectedSize;
}

export async function createCase(input: CreateCaseInput): Promise<{ case: IncubatorCase }> {
  return apiFetch('/api/cases', { method: 'POST', body: JSON.stringify(input) });
}

export async function patchCase(id: string, input: Partial<CreateCaseInput>): Promise<{ case: IncubatorCase }> {
  return apiFetch(`/api/cases/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export async function addEvidence(
  caseId: string,
  input: { kind: 'TEXT' | 'URL'; textContent?: string; externalUrl?: string; description?: string },
): Promise<{ evidence: CaseEvidenceItem }> {
  return apiFetch(`/api/cases/${caseId}/evidence`, {
    method: 'POST',
    body:   JSON.stringify(input),
  });
}

export async function submitCase(id: string): Promise<{
  case:       IncubatorCase;
  aiAnalysis: CaseAnalysis | null;
  aiError:    string | null;
}> {
  return apiFetch(`/api/cases/${id}/submit`, { method: 'POST' });
}

// ── FILE evidence via R2 presigned PUT ──────────────────────────────────────
// Three calls:
//   1. presignEvidenceUpload — reserves an evidence row + returns a PUT URL
//   2. (client) fetch(url, { method: 'PUT', body: blob, headers }) to R2
//   3. completeEvidenceUpload — tells the server the bytes landed; kicks off
//      background PII screening.

export type ScreenableMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export async function presignEvidenceUpload(
  caseId: string,
  input: { mimeType: ScreenableMime; description?: string; sizeBytes?: number },
): Promise<{
  evidenceId: string;
  uploadUrl:  string;
  r2Key:      string;
  expiresAt:  string;
  maxBytes:   number;
  method:     'PUT';
  headers:    Record<string, string>;
}> {
  return apiFetch(`/api/cases/${caseId}/evidence/upload-url`, {
    method: 'POST',
    body:   JSON.stringify(input),
  });
}

export async function completeEvidenceUpload(
  caseId: string, evidenceId: string,
  input: { originalHash?: string } = {},
): Promise<{ evidence: CaseEvidenceItem }> {
  return apiFetch(`/api/cases/${caseId}/evidence/${evidenceId}/complete`, {
    method: 'POST',
    body:   JSON.stringify(input),
  });
}

// End-to-end helper: reserves, PUTs to R2, then completes. The caller passes
// either a blob (web) or a local file URI (RN — we read it as a blob).
export async function uploadEvidenceFile(
  caseId: string, file: {
    uri?:       string;        // RN — file:// URI from expo-image-picker
    blob?:      Blob;          // web — File/Blob
    mimeType:   ScreenableMime;
    description?: string;
  },
): Promise<{ evidence: CaseEvidenceItem }> {
  let blob: Blob;
  if (file.blob) {
    blob = file.blob;
  } else if (file.uri) {
    const resp = await fetch(file.uri);
    blob = await resp.blob();
  } else {
    throw new Error('uploadEvidenceFile: pass either blob or uri');
  }

  const reserved = await presignEvidenceUpload(caseId, {
    mimeType:    file.mimeType,
    description: file.description,
    sizeBytes:   blob.size,
  });

  if (blob.size > reserved.maxBytes) {
    throw new Error(`File too large: ${blob.size} > ${reserved.maxBytes}`);
  }

  // Direct PUT to R2. We DON'T send our JWT here — R2 authenticates the PUT
  // via the presigned URL signature. The Content-Type header is required
  // because it was baked into the signature.
  const putResp = await fetch(reserved.uploadUrl, {
    method:  'PUT',
    body:    blob,
    headers: reserved.headers,
  });
  if (!putResp.ok) {
    throw new Error(`R2 upload failed: ${putResp.status} ${putResp.statusText}`);
  }

  return completeEvidenceUpload(caseId, reserved.evidenceId);
}

export async function getEvidenceDownloadUrl(
  caseId: string, evidenceId: string,
  variant: 'original' | 'redacted' = 'redacted',
): Promise<{ url: string; public: boolean; expiresInSec?: number }> {
  const q = new URLSearchParams({ variant }).toString();
  return apiFetch(`/api/cases/${caseId}/evidence/${evidenceId}/download-url?${q}`);
}

export async function getMyCases(): Promise<{ cases: IncubatorCase[]; total: number }> {
  return apiFetch('/api/cases/mine');
}

// ────────────────────────────────────────────────────────────────────────────
//  Legal consultation (ייעוץ משפטי) — AI chat, stage 1
// ────────────────────────────────────────────────────────────────────────────

export type LegalThreadMode   = 'STRENGTHEN' | 'GENERAL';
export type LegalThreadStatus = 'ACTIVE' | 'RESOLVED' | 'ESCALATED_TO_LAWYER' | 'ARCHIVED';
export type LegalMessageRole  = 'USER' | 'ASSISTANT' | 'SYSTEM';

export interface LegalMessage {
  id:        string;
  threadId:  string;
  role:      LegalMessageRole;
  content:   string;
  model:     string | null;
  createdAt: string;
}

export interface LegalThread {
  id:        string;
  userId:    string;
  mode:      LegalThreadMode;
  status:    LegalThreadStatus;
  title:     string | null;
  caseId:    string | null;
  createdAt: string;
  updatedAt: string;
  // Expanded fields (present depending on endpoint):
  messages?: LegalMessage[];
  case?:    { id: string; title: string; powerScore: number | null; status: IncubatorCaseStatus } | null;
  _count?:  { messages: number };
}

export async function listLegalThreads(): Promise<{ threads: LegalThread[]; total: number }> {
  return apiFetch('/api/legal/threads');
}

export async function createLegalThread(input: {
  mode:    LegalThreadMode;
  caseId?: string;
  title?:  string;
}): Promise<{ thread: LegalThread }> {
  return apiFetch('/api/legal/threads', { method: 'POST', body: JSON.stringify(input) });
}

export async function getLegalThread(id: string): Promise<{ thread: LegalThread }> {
  return apiFetch(`/api/legal/threads/${id}`);
}

export async function postLegalMessage(
  threadId: string,
  content:  string,
): Promise<{ assistant: string; model: string }> {
  return apiFetch(`/api/legal/threads/${threadId}/messages`, {
    method: 'POST',
    body:   JSON.stringify({ content }),
  });
}

export async function escalateLegalThread(threadId: string): Promise<{ ok: true }> {
  return apiFetch(`/api/legal/threads/${threadId}/escalate`, { method: 'POST' });
}

// ── Global search (Explore) ─────────────────────────────────────────────────

export interface SearchLawsuit {
  id:             string;
  caseNumber:     string;
  defendantName:  string;
  defendantSlug:  string;
  status:         string;
  category:       string | null;
  summary:        string | null;
  filingDate:     string | null;
  claimDeadline:  string | null;
  payoutMinILS:   string | null;
  payoutMaxILS:   string | null;
}

export interface SearchIncubatorCase {
  id:                string;
  title:             string;
  defendantCompany:  string;
  status:            string;
  legalClaimType:    string;
  powerScore:        number | null;
  damageEstimateNis: number;
  goalMembers:       number;
  createdAt:         string;
  _count:            { members: number };
}

export async function globalSearch(
  q: string,
  limit = 20,
): Promise<{ lawsuits: SearchLawsuit[]; cases: SearchIncubatorCase[]; query: string }> {
  const trimmed = q.trim();
  if (trimmed.length < 2) return { lawsuits: [], cases: [], query: trimmed };
  const params = new URLSearchParams({ q: trimmed, limit: String(limit) });
  return apiFetch(`/api/search?${params.toString()}`);
}

// ── Public case detail ──────────────────────────────────────────────────────

export async function getCase(id: string): Promise<{ case: any }> {
  return apiFetch(`/api/cases/${id}`);
}

// ── CaseMember join / referrals ─────────────────────────────────────────────

export async function joinCase(
  caseId: string,
  input: { referralToken?: string; personalDamageNis?: number } = {},
): Promise<{ member: any; alreadyMember: boolean; referredByUserId?: string | null }> {
  return apiFetch(`/api/cases/${caseId}/join`, {
    method: 'POST',
    body:   JSON.stringify(input),
  });
}

export async function createReferralLink(
  caseId: string,
): Promise<{ linkToken: string; url: string | null; caseId: string; createdAt: string }> {
  return apiFetch(`/api/cases/${caseId}/referral-link`, { method: 'POST' });
}

export async function recordReferralClick(
  token: string,
  deviceFingerprint?: string,
): Promise<{ caseId: string }> {
  return apiFetch(`/api/referrals/${encodeURIComponent(token)}/click`, {
    method: 'POST',
    body:   JSON.stringify(deviceFingerprint ? { deviceFingerprint } : {}),
  });
}
