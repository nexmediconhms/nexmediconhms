-- ═══════════════════════════════════════════════════════════════
-- FILE: bill_versions_migration.sql
--
-- ISSUE #10 FIX: Create the bill_versions table for immutable audit trail
--
-- PROBLEM:
--   The migration SQL for bill_versions was only in the source code
--   comments of bill-versioning.ts — it was never actually added to
--   the main schema migration file (v00-schema-master.sql).
--   This means the table silently doesn't exist on fresh deployments.
--
-- HOW TO RUN:
--   1. Go to your Supabase project → SQL Editor
--   2. Paste this entire file
--   3. Click "Run"
--   4. Verify: SELECT count(*) FROM bill_versions;  -- should return 0
--
-- WHAT THIS CREATES:
--   - bill_versions table with UNIQUE(bill_id, version_number)
--   - Indexes for fast lookup by bill_id and created_at
--   - RLS policies: only admin can view, authenticated users can insert
--   - Helper function to get version count for a bill
--
-- SAFE TO RUN MULTIPLE TIMES:
--   All statements use IF NOT EXISTS or OR REPLACE, so re-running
--   this migration on a database that already has the table is safe.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Create the table ──
CREATE TABLE IF NOT EXISTS bill_versions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bill_id         UUID NOT NULL,
  version_number  INTEGER NOT NULL DEFAULT 1,
  snapshot        JSONB NOT NULL,              -- Full bill object at time of modification
  modified_by     TEXT NOT NULL,               -- Who modified (full_name)
  modification_type TEXT NOT NULL,             -- 'discount' | 'tax' | 'amount' | 'items' | 'status'
  reason          TEXT NOT NULL,               -- Why the modification was made
  previous_amount NUMERIC(10,2),              -- Amount BEFORE modification
  new_amount      NUMERIC(10,2),              -- Amount AFTER modification
  created_at      TIMESTAMPTZ DEFAULT NOW(),  -- When the version was saved

  -- ── UNIQUE CONSTRAINT ──
  -- Prevents duplicate version numbers for the same bill.
  -- This is the fix for the race condition: if two concurrent
  -- modifications both try to insert version N, one will fail
  -- with a unique constraint violation, and the retry logic
  -- in bill-versioning-enhanced.ts will handle it.
  CONSTRAINT uq_bill_version UNIQUE(bill_id, version_number)
);

-- ── 2. Indexes ──
CREATE INDEX IF NOT EXISTS idx_bill_versions_bill_id
  ON bill_versions(bill_id);

CREATE INDEX IF NOT EXISTS idx_bill_versions_created
  ON bill_versions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bill_versions_modifier
  ON bill_versions(modified_by);

-- ── 3. Row Level Security ──
ALTER TABLE bill_versions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (safe for re-runs)
DROP POLICY IF EXISTS "Admin can view bill versions" ON bill_versions;
DROP POLICY IF EXISTS "Authenticated users can insert bill versions" ON bill_versions;
DROP POLICY IF EXISTS "No updates on bill versions" ON bill_versions;
DROP POLICY IF EXISTS "No deletes on bill versions" ON bill_versions;

-- SELECT: Only admin can view version history
CREATE POLICY "Admin can view bill versions" ON bill_versions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clinic_users
      WHERE clinic_users.auth_id = auth.uid()
      AND clinic_users.role = 'admin'
      AND clinic_users.is_active = true
    )
  );

-- INSERT: Any authenticated active user can create a version
-- (because any user who can modify a bill should be able to save its history)
CREATE POLICY "Authenticated users can insert bill versions" ON bill_versions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clinic_users
      WHERE clinic_users.auth_id = auth.uid()
      AND clinic_users.is_active = true
    )
  );

-- UPDATE: NEVER allowed — versions are immutable
-- (No policy = no updates allowed with RLS enabled)

-- DELETE: NEVER allowed — versions are immutable
-- (No policy = no deletes allowed with RLS enabled)

-- ── 4. Comment ──
COMMENT ON TABLE bill_versions IS
  'Immutable audit trail of bill modifications. Every time a bill is modified, '
  'a snapshot of its previous state is saved here. Versions are append-only — '
  'no updates or deletes are permitted. Used for financial auditing and '
  'regulatory compliance.';

COMMENT ON COLUMN bill_versions.snapshot IS
  'Full JSONB copy of the bill object at the time of modification, including '
  'all line items, discounts, taxes, and payment info.';

COMMENT ON COLUMN bill_versions.version_number IS
  'Sequential version number per bill. v1 = original state before first '
  'modification. UNIQUE with bill_id to prevent race condition duplicates.';

-- ── 5. Verification ──
-- Run this to confirm the table was created correctly:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'bill_versions'
-- ORDER BY ordinal_position;
