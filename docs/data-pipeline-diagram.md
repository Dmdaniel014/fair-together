# Fair Together — Data Pipeline & Filtering Diagram

## Flow: From Court Registry to User Screen

```
  +───────────────────────────────────────────────────────────────+
  │               SOURCE: Israeli Court Registry                  │
  │          court.gov.il/RepresentativeRegistry.aspx             │
  │              + odata.org.il CSV (frozen Nov 2020)             │
  +───────────────────────────────────┬───────────────────────────+
                                      │
                                      ▼
  +───────────────────────────────────────────────────────────────+
  │                   STAGE 1: SCRAPER                            │
  │                 scrapeCourtRegistry.ts                         │
  │                                                               │
  │  - Playwright opens court site (ASP.NET __VIEWSTATE)          │
  │  - 3-month time slices (2021–2026)                            │
  │  - Extracts: case#, title, date, court, affected group        │
  │  - resolveSlug() maps defendant → brand slug                  │
  │  - All entries → status: FILED, source: CSV_ONLY              │
  │                                                               │
  │  Brand resolution (two-pass):                                 │
  │  ┌──────────────────────────────────────────────────────────┐ │
  │  │ Pass 1 — Direct includes() match (fast path)             │ │
  │  │ Pass 2 — Normalized fuzzy match:                         │ │
  │  │   strips בע"מ, (1968), Ltd, Inc, Corp, חברת, רשת,        │ │
  │  │   ישראל, quotes, dashes, parens, punctuation             │ │
  │  │   → catches "שופרסל (1968) בע\"מ" → shufersal            │ │
  │  │                                                          │ │
  │  │ BRAND_NAME_MAP (types.ts) — 80+ entries including:       │ │
  │  │ ▸ Direct brands: שופרסל→shufersal, סלקום→cellcom        │ │
  │  │ ▸ Importers:     דיפלומט→diplomat, שסטוביץ→schestowitz  │ │
  │  │ ▸ Energy:        דלק→delek, פז→paz, סונול→sonol          │ │
  │  │ ▸ Banks:         בנק דיסקונט→discount, כאל→cal           │ │
  │  │ ▸ Aliases:       P&G→procter, L'Oréal→loreal             │ │
  │  └──────────────────────────────────────────────────────────┘ │
  +───────────────────────────────────┬───────────────────────────+
                                      │
                                      ▼
  +───────────────────────────────────────────────────────────────+
  │                   STAGE 2: UPSERT TO DB                       │
  │                   db.upsertRawCase()                           │
  │                                                               │
  │  Quality gate:                                                │
  │  ┌──────────────────────────────────────────────────────────┐ │
  │  │ hasMeaningfulData = has(summary OR affectedGroup         │ │
  │  │                         OR totalPool)                    │ │
  │  │                                                          │ │
  │  │ isReady = hasMeaningfulData AND status NOT IN            │ │
  │  │          (DISMISSED, CLOSED)                             │ │
  │  │                                                          │ │
  │  │ isActive = true (default)                                │ │
  │  └──────────────────────────────────────────────────────────┘ │
  │                                                               │
  │  If NOT hasMeaningfulData → saved but isReady=false           │
  │  If DISMISSED/CLOSED → saved but isReady=false                │
  +───────────────────────────────────┬───────────────────────────+
                                      │
                                      ▼
  +───────────────────────────────────────────────────────────────+
  │           STAGE 3: SETTLEMENT DETECTION                       │
  │          POST /api/admin/init-settlements                     │
  │                                                               │
  │  Step A — autoDetectSettlements():                            │
  │  ┌──────────────────────────────────────────────────────────┐ │
  │  │ WHERE status IN ('SETTLEMENT_APPROVED', 'SETTLEMENT')    │ │
  │  │   AND isActive = true                                    │ │
  │  │   AND isSettlement = false                               │ │
  │  │                                                          │ │
  │  │ → SET isSettlement = true                                │ │
  │  └──────────────────────────────────────────────────────────┘ │
  │                                                               │
  │  Step B — assignCategories():                                 │
  │  ┌──────────────────────────────────────────────────────────┐ │
  │  │ WHERE category IS NULL                                   │ │
  │  │                                                          │ │
  │  │ → category = BRAND_TO_CATEGORY[slug] ?? 'other'          │ │
  │  │                                                          │ │
  │  │ BRAND_TO_CATEGORY covers 60+ slugs across 9 categories:  │ │
  │  │ telecom · banks · retail · insurance · food              │ │
  │  │ tech · health · transport · other                        │ │
  │  │                                                          │ │
  │  │ Includes importers mapped to product category:           │ │
  │  │ diplomat→retail, noga→food, delek→transport, etc.        │ │
  │  └──────────────────────────────────────────────────────────┘ │
  +───────────────────────────────────┬───────────────────────────+
                                      │
                                      ▼
  +───────────────────────────────────────────────────────────────+
  │           STAGE 4: ENRICHMENT                                 │
  │                                                               │
  │  4A — Manual enrichment (enrichSettlements.ts)                │
  │  ┌──────────────────────────────────────────────────────────┐ │
  │  │ Hardcoded array of 10 settlements with:                  │ │
  │  │ estimatedPayout, claimFormUrl, payoutMethod,             │ │
  │  │ distributionStatus, claimGuideSteps, claimDeadline       │ │
  │  │                                                          │ │
  │  │ Run: npx tsx scripts/enrichSettlements.ts                │ │
  │  └──────────────────────────────────────────────────────────┘ │
  │                                                               │
  │  4B — AI auto-enrichment (autoEnrichWithAI.ts)         [NEW]  │
  │  ┌──────────────────────────────────────────────────────────┐ │
  │  │ Finds: isSettlement=true AND estimatedPayout IS NULL     │ │
  │  │                                                          │ │
  │  │ For each unenriched settlement:                          │ │
  │  │ 1. Sends case data to Claude Haiku                       │ │
  │  │ 2. AI extracts: payout, method, guide steps              │ │
  │  │ 3. Skips if confidence < 30%                             │ │
  │  │ 4. Updates DB with extracted data                        │ │
  │  │                                                          │ │
  │  │ Run: npx tsx scripts/autoEnrichWithAI.ts                 │ │
  │  │      npx tsx scripts/autoEnrichWithAI.ts --dry-run       │ │
  │  │      npx tsx scripts/autoEnrichWithAI.ts --limit 5       │ │
  │  └──────────────────────────────────────────────────────────┘ │
  +───────────────────────────────────┬───────────────────────────+
                                      │
                                      ▼
  +───────────────────────────────────────────────────────────────+
  │         STAGE 5: API → USER SCREEN                            │
  │        GET /api/settlements                                   │
  │                                                               │
  │  Quality-first query (getActiveSettlements):                  │
  │  ┌──────────────────────────────────────────────────────────┐ │
  │  │ WHERE isReady = true                                     │ │
  │  │   AND isActive = true                                    │ │
  │  │   AND isSettlement = true                                │ │
  │  │   AND (category IN filter — optional)                    │ │
  │  │   AND (                                                  │ │
  │  │     -- Exclude expired deadlines                         │ │
  │  │     claimDeadline IS NULL                                │ │
  │  │     OR claimDeadline >= NOW()                            │ │
  │  │   )                                                      │ │
  │  │   AND (                                                  │ │
  │  │     -- Quality gate: at least one of:                    │ │
  │  │     estimatedPayout IS NOT NULL            (enriched)    │ │
  │  │     OR (status = 'SETTLEMENT_APPROVED'                   │ │
  │  │         AND filingDate >= 2021-01-01)      (recent)      │ │
  │  │     OR (status = 'SETTLEMENT'                            │ │
  │  │         AND filingDate >= 2023-01-01)      (fresh)       │ │
  │  │   )                                                      │ │
  │  │                                                          │ │
  │  │ ORDER BY claimDeadline ASC NULLS LAST, filingDate DESC   │ │
  │  └──────────────────────────────────────────────────────────┘ │
  │                                                               │
  │  Frontend secondary filter:                                   │
  │  ┌──────────────────────────────────────────────────────────┐ │
  │  │ Enriched (has estimatedPayout) → shown first (golden)    │ │
  │  │ Unenriched → hidden behind "show more" button            │ │
  │  │ Expired deadline → hidden                                │ │
  │  └──────────────────────────────────────────────────────────┘ │
  │                                                               │
  │  AI Eligibility (on detail screen):                           │
  │  ┌──────────────────────────────────────────────────────────┐ │
  │  │ GET /api/settlements/:id/classify                        │ │
  │  │                                                          │ │
  │  │ 4-state classification per user:                         │ │
  │  │ ▸ NO_ACTION_REQUIRED — payout is automatic               │ │
  │  │ ▸ ACTION_REQUIRED_WITH_DEADLINE — must act by date       │ │
  │  │ ▸ CLAIM_FORM_REQUIRED — must submit form                 │ │
  │  │ ▸ MAYBE_NEED_MORE_INFO — follow-up questions             │ │
  │  │                                                          │ │
  │  │ Cached in AICache (7 days, type: CLASSIFY_V2)            │ │
  │  └──────────────────────────────────────────────────────────┘ │
  +───────────────────────────────────────────────────────────────+


  ═══════════════════════════════════════════════════════════════

  WHAT GETS EXCLUDED (should NOT appear to users):

  ❌ Lawsuit filed before 2021 with no enrichment data
  ❌ Settlement with expired claimDeadline (past date)
  ❌ Status = DISMISSED or CLOSED (isReady=false blocks these)
  ❌ No meaningful data (isReady=false blocks these)
  ❌ Manually deactivated (isActive=false)
  ❌ SETTLEMENT status filed before 2023 (too old, no enrichment)

  WHAT GETS INCLUDED (should appear to users):

  ✅ Enriched settlement (has estimatedPayout) — always shown
  ✅ AI-enriched settlement (confidence ≥ 30%) — shown with data
  ✅ Settlement with future claimDeadline — always shown
  ✅ Recent SETTLEMENT_APPROVED (2021+) — shown even without enrichment
  ✅ Recent SETTLEMENT (2023+) — shown even without enrichment

  ═══════════════════════════════════════════════════════════════

  OPERATIONAL COMMANDS:

  # 1. Scrape new cases from court registry
  npx tsx agents/scraperAgent.ts

  # 2. Detect settlements + assign categories
  curl -X POST http://localhost:3001/api/admin/init-settlements

  # 3. Manual enrichment (10 hardcoded settlements)
  npx tsx scripts/enrichSettlements.ts

  # 4. AI auto-enrichment (remaining unenriched)
  npx tsx scripts/autoEnrichWithAI.ts --dry-run   # preview
  npx tsx scripts/autoEnrichWithAI.ts              # live

  # 5. Start server
  npx tsx api/server.ts
```
