-- ─────────────────────────────────────────────────────────────────────────────
--  setup-vector.sql
--  Manual migration — pgvector extension + IVFFLAT index for IncubatorCase
--
--  Prisma's Unsupported("vector(1536)") type can't auto-generate the extension
--  or the index. Run this AFTER `prisma migrate dev` (or `db push`) creates
--  the incubator_cases table.
--
--  Requires Neon Postgres (pgvector available since PG 15).
--
--  Usage:
--    psql "$DATABASE_URL" -f db/setup-vector.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;

-- IVFFLAT on cosine distance — good fit for semantic similarity of narratives.
-- lists=100 is the PG default; tune up (sqrt(N)) once we have thousands of cases.
-- NOTE: ivfflat is usable on an empty table but quality improves after data exists.
-- If query recall is poor early on, REINDEX once the table has >1000 rows.
CREATE INDEX IF NOT EXISTS idx_case_embedding
  ON incubator_cases
  USING ivfflat ("narrativeEmbedding" vector_cosine_ops)
  WITH (lists = 100);
