# Fair Together (פייר טוגדר) — Project Brain

> Israeli consumer-rights platform that automatically tracks class action lawsuits and alerts users when they're eligible for compensation.

## Mission
Every Israeli consumer deserves to know when money is owed to them. Fair Together scans court databases, extracts case details with AI, matches users to relevant lawsuits, and sends push notifications — all automatically.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Actions (Cron)                     │
│         Sun 03:00 · Wed 03:00 · 1st-of-month 02:00         │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   Orchestrator (orchestrator/)               │
│         Routing · Retry (3x exp backoff) · Events           │
└──────┬──────────┬───────────┬──────────────┬────────────────┘
       ▼          ▼           ▼              ▼
  ┌─────────┐ ┌──────────┐ ┌───────────┐ ┌──────────┐
  │ Scraper │→│Extraction│→│Validation │→│   Push   │
  │ Agent   │ │  Agent   │ │  Agent    │ │  Agent   │
  └─────────┘ └──────────┘ └───────────┘ └──────────┘
       │           │             │              │
       ▼           ▼             ▼              ▼
  CSV from     Claude AI    Rules-based    Match + Notify
  odata.org.il  PDF→JSON    sanity check   via Expo Push
                                           + Self-Learning
```

### Event Flow
```
NEW_CASE_SCRAPED → Extraction → EXTRACTION_COMPLETE → Validation → LAWSUIT_READY → Push
CASE_STATUS_CHANGED → Extraction (re-extract)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + TypeScript |
| Database | PostgreSQL (Neon) via Prisma ORM |
| AI | Anthropic Claude API (PDF extraction + AI insights) |
| Push | Expo Push Notifications |
| Cron | GitHub Actions |
| Mobile | React Native + Expo |
| Validation | Zod schemas |

## Project Structure

```
fair-together/
├── CLAUDE.md                    ← YOU ARE HERE
├── docs/
│   └── SETUP_GUIDE.md          ← Full setup instructions (Hebrew)
├── backend/                     ← Node.js + TypeScript backend
│   ├── CLAUDE.md                ← Backend-specific instructions
│   ├── types.ts                 ← Single source of truth for ALL types
│   ├── package.json
│   ├── api/
│   │   └── server.ts            ← Express API (port 3001)
│   ├── agents/
│   │   ├── scraperAgent.ts      ← Finds new class actions from CSV
│   │   ├── extractionAgent.ts   ← Claude AI extracts fields from PDFs
│   │   └── pushAgent.ts         ← Matches users, sends notifications, learns
│   ├── skills/
│   │   ├── scanLegalSources.ts  ← CSV fetch + PDF download
│   │   └── extractPdfFields.ts  ← Claude API structured extraction
│   ├── orchestrator/
│   │   └── index.ts             ← Cron entry points, event routing, retry
│   ├── services/
│   │   └── matchingEngine.ts    ← User↔Lawsuit scoring algorithm
│   ├── db/
│   │   ├── index.ts             ← All DB operations (never raw SQL)
│   │   ├── schema.prisma        ← Database schema
│   │   └── seed.ts              ← 5 test lawsuits
│   └── .github/workflows/
│       └── agents.yml           ← Cron schedule
└── mobile/                      ← React Native + Expo app
    └── src/
        ├── screens/             ← OnboardingScreen, Dashboard
        ├── components/          ← BrandCard, LawsuitCard, etc.
        ├── theme/               ← Design tokens (Figma-matched)
        └── services/            ← API client
```

## Key Conventions

### Code Style
- **TypeScript strict mode** — no `any` types
- **Single source of truth** — all types live in `backend/types.ts`
- **DB access** — always through `db.*` methods in `db/index.ts`, never raw SQL
- **Agent communication** — via database events (AgentEvent table), not direct calls
- **Hebrew content** — all user-facing text, court data, and AI prompts use Hebrew
- **English code** — variable names, function names, comments in English

### Agent Pattern
Every agent follows this structure:
```typescript
export async function runAgentName(db: DB, config: Config): Promise<AgentRunResult> {
  // 1. Load data
  // 2. Process
  // 3. Emit events for next agent
  // 4. Return stats (new, updated, errors)
}
```

### Event-Driven Flow
- Agents never call each other directly
- Agent emits event → Orchestrator picks it up → Routes to next agent
- Events: `NEW_CASE_SCRAPED`, `CASE_STATUS_CHANGED`, `EXTRACTION_COMPLETE`, `LAWSUIT_READY`

### Database Operations
```typescript
// Always use the db object:
db.upsertRawCase(...)           // Scraper → insert/update lawsuit
db.updateLawsuitFromExtraction(...) // Extraction → save AI fields
db.setLawsuitReady(...)         // Validation → mark ready for users
db.emitEvent(...)               // Any agent → trigger next step
db.saveAgentRun(...)            // All agents → log execution
```

## Data Sources

### Israeli Court System
| Source | URL | Data |
|--------|-----|------|
| Lawsuits CSV | `odata.org.il/datastore/dump/12ff06bf-...` | Case metadata |
| Parties CSV | `odata.org.il/datastore/dump/02a3642f-...` | Plaintiffs, defendants, lawyers |
| Court PDFs | `elyon1.court.gov.il` | Full case documents (⚠️ BROKEN URL) |

### CSV Columns (Lawsuits)
`_id, serial, case_number, casename, court, judge, issue, amount, amount_individual, group, question, aid_type, aid_esence, result, status, open_date, close_date, scrape_date, permalink`

### Brand Matching
34 known Israeli brands mapped in `BRAND_NAME_MAP`:
- **Supermarkets**: shufersal, ramilevi, victory, mega, yohananoff, osheraad, tivtaam
- **Food**: tnuva, strauss, elite, osem, nestle, unilever, prigat
- **Telecom**: partner, cellcom, pelephone
- **Banking**: hapoalim, leumi
- **Health**: clalit, maccabi
- **Other**: elal, amazon, bit

## Lawsuit Lifecycle

```
FILED → CERTIFIED → DISCOVERY → SETTLEMENT → SETTLEMENT_APPROVED → RULING → CLOSED
                                                                           → DISMISSED
```

**Consumer-relevant transitions** (trigger re-extraction + notification):
- `FILED → CERTIFIED` — class action officially approved
- `CERTIFIED → SETTLEMENT` — agreement reached
- `SETTLEMENT → SETTLEMENT_APPROVED` — consumers can now file claims
- `DISCOVERY → SETTLEMENT` — fast-tracked settlement
- `FILED → RULING` — direct ruling without certification

## Matching Algorithm (matchingEngine.ts)

**Score range: 0–100** (threshold: 50 to notify, 75 for AI insight)

| Signal | Points |
|--------|--------|
| Direct brand match | +45 (max 2x = 90) |
| Category match | +15 (max 3x = 45) |
| Israeli case | +10 |
| Global potential | +20 |
| Status bonus (CERTIFIED/SETTLEMENT) | +10 |
| Deadline ≤30 days | +12 |
| High/Urgent priority | +8/+12 |

Score is multiplied by shopping frequency weight (DAILY=1.0 → MONTHLY=0.4).

## API Endpoints (localhost:3001)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | None | DB ping |
| GET | `/api/agents/status` | None | Dashboard: last runs, pending events |
| POST | `/api/auth/register` | None | Register/login — returns JWT token |
| POST | `/api/user/onboarding` | JWT | Save user profile (brands, categories) |
| POST | `/api/matches` | None | Compute matches for user profile |
| GET | `/api/lawsuits` | None | Query ready lawsuits (?brand=&status=) |
| GET | `/api/lawsuits/:id` | None | Single case detail |
| POST | `/api/user/feedback` | JWT | Record user action (JOINED/DISMISSED/SAVED) |
| GET | `/api/insights/:userId/:lawsuitId` | JWT | AI-generated explanation |
| POST | `/api/agents/cron/scrape` | CRON_SECRET | Trigger scraper |
| POST | `/api/agents/cron/status-check` | CRON_SECRET | Trigger status monitor |
| POST | `/api/agents/events/process` | CRON_SECRET | Process event queue |

### Auth Flow
1. `POST /api/auth/register` with `{ phone }` or `{ email }` → returns `{ token, userId, isNew }`
2. `POST /api/user/onboarding` with JWT + `{ selectedBrands, categories, frequency, householdSize }` → saves profile
3. All protected endpoints require `Authorization: Bearer <token>` header
4. Tokens expire after 90 days

## NPM Scripts

```bash
npm run dev              # Start backend server (port 3001)
npm run build            # TypeScript compilation
npm run agent:scrape     # Run scraper manually
npm run agent:status     # Run status monitor manually
npm run agent:events     # Process pending events
npm run db:migrate       # Run Prisma migrations
npm run db:seed          # Insert test data
```

## Environment Variables

```bash
DATABASE_URL=            # Neon PostgreSQL connection string
ANTHROPIC_API_KEY=       # Claude API key (for extraction + insights)
PDF_STORAGE_PATH=        # Local: /tmp/fair-together-pdfs
CRON_SECRET=             # Bearer token for GitHub Actions webhooks
EXPO_ACCESS_TOKEN=       # Expo push notification token
PORT=3001
NODE_ENV=development
API_BASE_URL=            # Production API URL
```

## Known Issues & TODOs

### Critical
- ⚠️ **PDF download broken** — `downloadCourtPDF()` in `scanLegalSources.ts` uses wrong URL pattern for `elyon1.court.gov.il`. Need to find correct נט המשפט URL format.

### Completed
- ✅ TypeScript compiles with zero errors (tsconfig.json added)
- ✅ Type conflicts between matchingEngine and types.ts resolved
- ✅ Zod validation on all API input endpoints
- ✅ JWT authentication on user endpoints (register, onboarding, feedback, insights)
- ✅ End-to-end tested: server → DB → matching → response
- ✅ Orchestrator no longer auto-runs scraper on import

### Next Steps
1. **Fix PDF download** — research correct court.gov.il API/URL pattern
2. **Mobile app connection** — connect to backend API, implement onboarding flow
3. **Production deployment** — deploy backend (Railway/Render), configure real cron
4. **Add more brands** — expand BRAND_NAME_MAP beyond 34 entries
5. **Rate limiting** — protect public API endpoints
6. **Monitoring** — add health checks and alerting for agent failures

## Setup (Quick Start)

```bash
# 1. Clone & install
cd ~/Desktop/fair-together/backend
npm install

# 2. Configure environment
cp .env.example .env
# Fill in DATABASE_URL, ANTHROPIC_API_KEY, CRON_SECRET

# 3. Setup database
npx prisma generate
npx prisma migrate dev --name init

# 4. Seed test data
npx ts-node db/seed.ts

# 5. Start server
npm run dev
# → http://localhost:3001

# 6. Test scraper
npm run agent:scrape

# 7. Verify
curl http://localhost:3001/health
curl http://localhost:3001/api/agents/status
```

For full setup guide (Hebrew): see `docs/SETUP_GUIDE.md`

## Working With This Codebase

### Before making changes
1. Read the relevant file(s) first — understand before modifying
2. Check `types.ts` for type definitions
3. Check `db/index.ts` for available DB methods

### When adding a new feature
1. Add types to `types.ts`
2. Add DB methods to `db/index.ts`
3. Update schema if needed → `npx prisma migrate dev`
4. Implement in the appropriate agent/skill/service
5. Add API endpoint if user-facing
6. Test with `npm run dev` + manual curl

### When modifying agents
- Never make agents call each other directly — use events
- Always log execution via `db.saveAgentRun()`
- Emit events for downstream processing
- Handle errors gracefully — failed agents retry 3x

### When touching the database
- Always go through `db/index.ts` — no raw Prisma calls elsewhere
- After schema changes: `npx prisma migrate dev --name description`
- After migration: `npx prisma generate`

## Git Workflow

```
main     ← Production. Never commit directly.
develop  ← Integration branch. Test here.
feature/ ← New work. Branch from develop.
```

```bash
git checkout develop
git pull origin develop
git checkout -b feature/your-feature
# ... work ...
git checkout develop && git merge feature/your-feature
# ... test ...
git checkout main && git merge develop
```
