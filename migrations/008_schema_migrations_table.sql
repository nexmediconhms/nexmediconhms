-- Migration: 008_schema_migrations_table
-- Created: 2026-05-22
-- Description: Create the migration tracking system
-- Dependencies: None — this should be the FIRST migration run on any new database
--
-- FIX: No migration system — 15+ loose SQL files with no ordering.
-- This creates a schema_migrations table that tracks:
--   - Which migrations have been applied
--   - When they were applied
--   - Whether they succeeded
--   - Checksums for integrity verification
--
-- RUN THIS FIRST on any new or existing database.
-- SAFE TO RUN MULTIPLE TIMES: Uses IF NOT EXISTS.

-- ════════════════════════════════════════════════════════════════
-- UP MIGRATION
-- ════════════════════════════════════════════════════════════════

-- Migration tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          SERIAL PRIMARY KEY,
  version     TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  applied_at  TIMESTAMPTZ DEFAULT NOW(),
  checksum    TEXT,            -- MD5 of the migration file (for integrity checks)
  applied_by  TEXT,            -- Who ran this migration
  success     BOOLEAN DEFAULT TRUE,
  notes       TEXT             -- Any notes about this migration run
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_schema_migrations_version
  ON schema_migrations(version);

-- No RLS needed on schema_migrations (it's metadata, not patient data)
-- But restrict to service_role and authenticated users only
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read migrations (for admin dashboard)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'schema_migrations_select' AND tablename = 'schema_migrations'
  ) THEN
    CREATE POLICY schema_migrations_select ON schema_migrations
      FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;

-- Only service_role can insert/update (migrations run server-side)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'schema_migrations_insert' AND tablename = 'schema_migrations'
  ) THEN
    CREATE POLICY schema_migrations_insert ON schema_migrations
      FOR INSERT TO service_role
      WITH CHECK (true);
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════
-- RECORD EXISTING MIGRATIONS (best-effort retroactive tracking)
-- ════════════════════════════════════════════════════════════════
-- Record migrations that we KNOW were applied based on existing schema

INSERT INTO schema_migrations (version, name, applied_at, notes) VALUES
  ('000', 'initial_schema_v00', NOW(), 'Retroactively recorded — v00-schema-master.sql'),
  ('001', 'validation_constraints_v01', NOW(), 'Retroactively recorded — v01_validation_constraints.sql'),
  ('008', 'schema_migrations_table', NOW(), 'This migration — creates tracking system')
ON CONFLICT (version) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- MIGRATION ORDER DOCUMENTATION
-- ════════════════════════════════════════════════════════════════
--
-- Canonical migration order for fresh database setup:
--
--   1. 008_schema_migrations_table.sql  (this file — run FIRST)
--   2. v00-schema-master.sql            (full schema bootstrap)
--   3. v01_validation_constraints.sql   (validation rules)
--   4. 006_add_bill_audit_columns.sql   (bill modification tracking)
--   5. 007_payment_attempts_table.sql   (payment attempt history)
--   6. 009_enable_rls_policies.sql      (security — RLS on all tables)
--
-- For EXISTING databases (already has v00 schema):
--   1. Run this file (008) to create tracking table
--   2. Run 006 (bill audit columns)
--   3. Run 007 (payment attempts)
--   4. Run 009 (RLS policies) — CAREFULLY, test afterward
--
-- ════════════════════════════════════════════════════════════════

-- Helper function: Check if a specific migration has been applied
CREATE OR REPLACE FUNCTION migration_applied(p_version TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM schema_migrations
    WHERE version = p_version AND success = TRUE
  );
$$ LANGUAGE sql STABLE;

-- ════════════════════════════════════════════════════════════════
-- DOWN MIGRATION (documentation only)
-- ════════════════════════════════════════════════════════════════
-- DROP TABLE IF EXISTS schema_migrations;
-- DROP FUNCTION IF EXISTS migration_applied(TEXT);
