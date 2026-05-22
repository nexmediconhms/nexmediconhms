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

-- Add audit columns to bills table (safe — won't fail if columns exist)
DO $$
BEGIN
  -- modified_by: UUID of the clinic_user who last changed this bill
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bills' AND column_name = 'modified_by'
  ) THEN
    ALTER TABLE bills ADD COLUMN modified_by UUID REFERENCES clinic_users(id);
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
CREATE OR REPLACE FUNCTION update_bill_modified_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Only set modified_at if the bill content actually changed
  -- (not just status updates from webhooks)
  IF OLD.net_amount IS DISTINCT FROM NEW.net_amount
     OR OLD.discount IS DISTINCT FROM NEW.discount
     OR OLD.subtotal IS DISTINCT FROM NEW.subtotal
  THEN
    NEW.modified_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists (safe re-run)
DROP TRIGGER IF EXISTS trg_bill_modified_at ON bills;

-- Create trigger
CREATE TRIGGER trg_bill_modified_at
  BEFORE UPDATE ON bills
  FOR EACH ROW
  EXECUTE FUNCTION update_bill_modified_at();

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
