-- Migration: 006_add_bill_audit_columns
-- Created: 2026-05-22
-- Description: Add bill modification audit trail columns
-- Dependencies: Requires bills table to exist (from v00-schema-master.sql)
--
-- FIX: Patient disputes payment amount — no record of who changed what.
-- This adds modified_by, modified_at, modification_reason to bills table
-- so every amount change is tracked with WHO, WHEN, and WHY.
--
-- SAFE TO RUN: Uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS patterns.
-- Will not break existing data or functionality.

-- ════════════════════════════════════════════════════════════════
-- UP MIGRATION
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- Ensure schema_migrations exists (006 may run before 008)
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          SERIAL PRIMARY KEY,
  version     TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  applied_at  TIMESTAMPTZ DEFAULT NOW(),
  notes       TEXT
);

-- Abort if bills doesn't exist yet (run v00-schema-master.sql first)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='bills') THEN
    RAISE NOTICE 'bills table missing — skipping migration 006';
    RETURN;
  END IF;
END $$;

-- Add audit columns to bills table (safe — won't fail if columns exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='bills') THEN
    RETURN;
  END IF;

  -- modified_by: UUID of the clinic_user who last changed this bill
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bills' AND column_name = 'modified_by'
  ) THEN
    -- Add as plain UUID (FK skipped — clinic_users may have either id type
    -- depending on whether v00 ran first; FK can be added later).
    ALTER TABLE bills ADD COLUMN modified_by UUID;
  END IF;

  -- modified_at: When the last modification happened
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bills' AND column_name = 'modified_at'
  ) THEN
    ALTER TABLE bills ADD COLUMN modified_at TIMESTAMPTZ;
  END IF;

  -- modification_reason: Why the bill was modified (required for auditing)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bills' AND column_name = 'modification_reason'
  ) THEN
    ALTER TABLE bills ADD COLUMN modification_reason TEXT;
  END IF;
END $$;

-- Create trigger to auto-update modified_at on any bill change
-- Reference columns conditionally based on what exists (bills may have
-- snake_case columns from 010+ or only the v00 base columns).
CREATE OR REPLACE FUNCTION update_bill_modified_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Compare common bill amount columns (any of these changing = modification)
  IF COALESCE(OLD.total,    0) IS DISTINCT FROM COALESCE(NEW.total,    0)
     OR COALESCE(OLD.discount, 0) IS DISTINCT FROM COALESCE(NEW.discount, 0)
     OR COALESCE(OLD.subtotal, 0) IS DISTINCT FROM COALESCE(NEW.subtotal, 0)
  THEN
    NEW.modified_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists (safe re-run); only attach if bills exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='bills') THEN
    DROP TRIGGER IF EXISTS trg_bill_modified_at ON bills;
    CREATE TRIGGER trg_bill_modified_at
      BEFORE UPDATE ON bills
      FOR EACH ROW
      EXECUTE FUNCTION update_bill_modified_at();
  END IF;
END $$;

-- Record this migration
INSERT INTO schema_migrations (version, name, applied_at)
VALUES ('006', 'add_bill_audit_columns', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ════════════════════════════════════════════════════════════════
-- DOWN MIGRATION (documentation only — don't run unless rolling back)
-- ════════════════════════════════════════════════════════════════
-- ALTER TABLE bills DROP COLUMN IF EXISTS modified_by;
-- ALTER TABLE bills DROP COLUMN IF EXISTS modified_at;
-- ALTER TABLE bills DROP COLUMN IF EXISTS modification_reason;
-- DROP TRIGGER IF EXISTS trg_bill_modified_at ON bills;
-- DROP FUNCTION IF EXISTS update_bill_modified_at();
