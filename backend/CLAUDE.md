# Backend — Agent System Brain

## Quick Reference

```bash
npm run dev              # Start server on :3001
npm run agent:scrape     # Manual scrape run
npm run agent:events     # Process event queue
npx prisma studio        # Visual DB browser
npx prisma migrate dev   # After schema changes
```

## Architecture Rules

### Types
- **ALL types** live in `types.ts` at backend root — never define types elsewhere
- Key interfaces: `Lawsuit`, `LawsuitRecord`, `UserProfile`, `MatchResult`, `AgentRun`
- Key constants: `CONFIDENCE_THRESHOLD=0.85`, `MIN_MATCH_SCORE=50`, `HIGH_MATCH_SCORE=75`

### Database (`db/index.ts`)
- **Single entry point** — all agents call `db.methodName()`, never use Prisma directly
- Exports a `db` object with methods grouped by domain:
  - Lawsuits: `upsertRawCase`, `updateLawsuitFromExtraction`, `setLawsuitReady`, `markForReview`
  - Events: `emitEvent`, `getPendingEvents`, `markEventProcessed`, `markEventFailed`
  - Runs: `saveAgentRun`, `getLastAgentRun`, `archiveOldRuns`
  - Matches: `createMatchRecord`, `updateMatchUserAction`, `getUserMatchHistory`
  - Learning: `updateLearnedWeights`, `refreshLearnedWeights`
  - Insights: `saveAIInsight`, `getAIInsight`, `markInsightViewed`

### Agents Pattern
```
Agent receives: (db, config)
Agent returns:  AgentRunResult { stats, errors, events_emitted }
Agent logs:     db.saveAgentRun() at start and end
Agent emits:    db.emitEvent() for downstream processing
Agent NEVER:    calls another agent directly
```

### Event Types & Routing (orchestrator/index.ts)
| Event | Routed To | Purpose |
|-------|-----------|---------|
| `NEW_CASE_SCRAPED` | Extraction Agent | Extract PDF fields |
| `CASE_STATUS_CHANGED` | Extraction Agent | Re-extract updated case |
| `EXTRACTION_COMPLETE` | Validation Agent | Sanity check |
| `LAWSUIT_READY` | Push Agent | Match & notify users |

### Orchestrator (`orchestrator/index.ts`)
- `cronWeeklyScrape()` — Sunday 03:00
- `cronWeeklyStatusCheck()` — Wednesday 03:00
- `cronMonthlyCleanup()` — 1st of month 02:00
- Retry: 3x with exponential backoff (2s, 4s, 8s)
- Failed retries → `db.createAlert()`

## Agent Details

### 1. Scraper Agent (`agents/scraperAgent.ts`)
- Calls `scanLegalSources` skill
- Fetches 2 CSVs from odata.org.il (lawsuits + parties)
- Filters class actions: `תובענה ייצוגית` in casename/issue, or `ת"צ` prefix
- Extracts defendant from casename: `"... נ' DEFENDANT_NAME"`
- Matches defendants against `BRAND_NAME_MAP` (34 brands)
- Upserts new cases → emits `NEW_CASE_SCRAPED`

### 2. Extraction Agent (`agents/extractionAgent.ts`)
- Calls `extractPdfFields` skill (Claude API)
- Model: `claude-sonnet-4-20250514`, max 2,000 tokens
- Extracts: payoutMin/Max, deadline, eligibility, summary, status
- Per-field confidence scores (0.0–1.0)
- Overall: VERIFIED (≥0.85), PENDING_REVIEW (≥0.5), UNVERIFIED
- Also contains **Validation Agent** (second exported function):
  - Rules: no negative payouts, deadline in future, defendant exists
  - Pass → `LAWSUIT_READY`, Fail → `markForReview()`

### 3. Push Agent (`agents/pushAgent.ts`)
- Gets all active users with profiles
- Runs `matchingEngine.computeMatches()` for each
- Applies learned weights from user history
- Score ≥ 50 → create match record
- Score ≥ 75 → generate AI insight via Claude
- Sends Expo push notifications (batches of 100)
- Records feedback → updates `user_learned_weights`

## Skills

### `scanLegalSources.ts`
- CSV URLs (odata.org.il): hardcoded in file
- `downloadCourtPDF()` — ⚠️ **BROKEN** — elyon1.court.gov.il URL is wrong
- Rate limit: 3,000ms between PDF downloads

### `extractPdfFields.ts`
- PDF text extraction: pdfplumber (preferred) or Tesseract OCR (fallback)
- Claude prompt: structured Hebrew legal extraction
- Returns typed `ExtractedLawsuitFields` with confidence scores

## Matching Engine (`services/matchingEngine.ts`)
- Input: `UserProfile` + `Lawsuit[]`
- Output: `MatchResult[]` sorted by relevance
- Scoring: brand(+45), category(+15), israeli(+10), status(+10), deadline(+12)
- Frequency multiplier: DAILY=1.0, WEEKLY=0.75, MONTHLY=0.4
- Self-learning: engagement weights adjust future scores

## API Security
- Public endpoints: `/health`, `/api/matches`, `/api/lawsuits`
- Protected (CRON_SECRET bearer): `/api/agents/cron/*`, `/api/agents/events/*`
- No user auth yet (MVP) — add before production

## Database Schema Highlights
- `Lawsuit.isReady` + `Lawsuit.isActive` — compound index, controls visibility
- `Lawsuit.requiresReview` — flagged by validation, needs manual check
- `AgentEvent.status` — PENDING/PROCESSING/DONE/FAILED event queue
- `UserLearnedWeights.brandEngagement` — JSON map of brand→engagement score
- `StatusChange` — full audit trail of lawsuit transitions

## Common Tasks

### Add a new brand
1. Add Hebrew→English mapping to `BRAND_NAME_MAP` in `scanLegalSources.ts`
2. Re-run scraper: `npm run agent:scrape`

### Add a new DB field
1. Update `schema.prisma`
2. Run `npx prisma migrate dev --name add-field-name`
3. Run `npx prisma generate`
4. Add getter/setter to `db/index.ts`
5. Update `types.ts` if needed

### Debug agent failures
1. Check `npx prisma studio` → AgentRun table (last runs + errors)
2. Check AgentEvent table for FAILED events
3. Run manually: `npm run agent:scrape` and read console output
4. Check SystemAlert table for escalated failures

### Test matching locally
```bash
curl -X POST http://localhost:3001/api/matches \
  -H "Content-Type: application/json" \
  -d '{"selectedBrands":["shufersal","tnuva"],"categories":["dairy"]}'
```
