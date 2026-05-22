-- ============================================================
-- Migration 000: Create the schema_migrations tracking table
-- This table records which migrations have been applied.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  id SERIAL PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  checksum TEXT
);

-- Grant access
GRANT ALL ON public.schema_migrations TO authenticated;
GRANT ALL ON public.schema_migrations TO service_role;
GRANT SELECT ON public.schema_migrations TO anon;

-- Auto-increment sequence permission
GRANT USAGE, SELECT ON SEQUENCE schema_migrations_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE schema_migrations_id_seq TO service_role;
