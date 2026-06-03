-- ============================================================
-- Migration 015: Fix Portal Tables Schema
-- Created: 2026-06-03
--
-- ROOT CAUSE:
--   The v00-schema-master.sql created portal_tokens and portal_sessions
--   with minimal columns. The application code evolved to use additional
--   columns (mrn, is_used, created_by on portal_tokens; session_token,
--   mrn, mobile, is_active, last_used on portal_sessions) and a brand-new
--   portal_otp table — but no migration was ever written to add them.
--   This caused every /api/portal/send-link call to fail with
--   "Failed to generate portal link" (INSERT referencing non-existent cols).
--
-- WHAT THIS MIGRATION DOES:
--   1. portal_tokens  — add mrn, is_used (alias for `used`), created_by
--   2. portal_sessions — add session_token (unique), mrn, mobile,
--                        is_active, last_used; back-fill existing rows
--   3. portal_otp      — create table (did not exist at all)
--   4. RLS policies    — grant service_role full access on all three tables
--   5. Indexes         — for fast token lookups
--
-- SAFE TO RUN MULTIPLE TIMES: all statements use IF NOT EXISTS / DO $$ guards.
-- ============================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- §1  portal_tokens  — add missing columns
--
-- Original schema (fix-all-permissions.sql):
--   id, patient_id, token, expires_at, used, created_at
--
-- App code also needs:
--   mrn        TEXT   — MRN of the patient (used for lookup)
--   is_used    BOOL   — alias for `used` (app code uses this name)
--   created_by TEXT   — auth_id of the staff member who generated it
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE portal_tokens ADD COLUMN IF NOT EXISTS mrn        TEXT;
ALTER TABLE portal_tokens ADD COLUMN IF NOT EXISTS is_used    BOOLEAN DEFAULT FALSE;
ALTER TABLE portal_tokens ADD COLUMN IF NOT EXISTS created_by TEXT;

-- Back-fill is_used from the original `used` column so existing rows
-- remain consistent (both columns stay in sync via the app code).
UPDATE portal_tokens
SET is_used = COALESCE(used, FALSE)
WHERE is_used IS NULL;

-- Index for the lookup pattern used by legacy-verify
CREATE INDEX IF NOT EXISTS idx_portal_tokens_mrn
    ON portal_tokens (mrn)
    WHERE mrn IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_portal_tokens_is_used
    ON portal_tokens (is_used)
    WHERE is_used = FALSE;

-- ═══════════════════════════════════════════════════════════════
-- §2  portal_sessions  — add missing columns
--
-- Original schema (v00-schema-master.sql / fix-all-permissions.sql):
--   id, patient_id, token, expires_at, created_at
--
-- App code also needs:
--   session_token TEXT UNIQUE — the value the app reads/writes
--   mrn           TEXT
--   mobile        TEXT
--   is_active     BOOLEAN DEFAULT TRUE
--   last_used     TIMESTAMPTZ
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS session_token TEXT;
ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS mrn           TEXT;
ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS mobile        TEXT;
ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS is_active     BOOLEAN DEFAULT TRUE;
ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS last_used     TIMESTAMPTZ;

-- Back-fill session_token from the original `token` column so any
-- existing sessions keep working under the new column name.
UPDATE portal_sessions
SET session_token = token
WHERE session_token IS NULL AND token IS NOT NULL;

-- Add unique constraint on session_token (needed for eq() lookups to
-- use index scan, and to match the UNIQUE constraint on the old `token`).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'portal_sessions'
      AND indexname  = 'uniq_portal_sessions_session_token'
  ) THEN
    CREATE UNIQUE INDEX uniq_portal_sessions_session_token
        ON portal_sessions (session_token)
        WHERE session_token IS NOT NULL;
  END IF;
END $$;

-- Index for fast active-session validation
CREATE INDEX IF NOT EXISTS idx_portal_sessions_token_active
    ON portal_sessions (session_token, is_active)
    WHERE is_active = TRUE;

-- ═══════════════════════════════════════════════════════════════
-- §3  portal_otp  — create table (did not exist)
--
-- Used by:
--   /api/portal/send-link         (INSERT)
--   /api/portal/auth/send-otp     (INSERT, rate-limit SELECT)
--   /api/portal/auth/verify-otp   (SELECT, UPDATE)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS portal_otp (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile      TEXT        NOT NULL,
  otp_code    TEXT        NOT NULL,
  token       TEXT        NOT NULL UNIQUE,   -- magic-link token
  patient_id  UUID        REFERENCES patients(id) ON DELETE CASCADE,
  mrn         TEXT,
  attempts    INTEGER     NOT NULL DEFAULT 0,
  verified    BOOLEAN     NOT NULL DEFAULT FALSE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for the exact query patterns used by the app
CREATE INDEX IF NOT EXISTS idx_portal_otp_mobile_unverified
    ON portal_otp (mobile, verified, created_at DESC)
    WHERE verified = FALSE;

CREATE INDEX IF NOT EXISTS idx_portal_otp_token
    ON portal_otp (token)
    WHERE verified = FALSE;

-- ═══════════════════════════════════════════════════════════════
-- §4  RLS — grant service_role access on all three tables
--
-- The API routes all use the service-role client (bypasses RLS),
-- so these grants ensure the service role can INSERT/UPDATE/SELECT
-- even if RLS is enabled and no matching policy exists.
-- ═══════════════════════════════════════════════════════════════

-- Enable RLS (idempotent — safe if already enabled)
ALTER TABLE portal_tokens   ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_otp      ENABLE ROW LEVEL SECURITY;

-- Drop old "deny all authenticated" policies from v00 schema if they exist
-- (those policies blocked authenticated users but not service_role, which is fine —
--  but we also add a permissive service-role policy for clarity)
DROP POLICY IF EXISTS pp_none ON portal_tokens;
DROP POLICY IF EXISTS ps_none ON portal_sessions;

-- Allow service_role full access (the API routes use this key)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'portal_tokens' AND policyname = 'portal_tokens_service_role'
  ) THEN
    CREATE POLICY portal_tokens_service_role ON portal_tokens
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'portal_sessions' AND policyname = 'portal_sessions_service_role'
  ) THEN
    CREATE POLICY portal_sessions_service_role ON portal_sessions
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'portal_otp' AND policyname = 'portal_otp_service_role'
  ) THEN
    CREATE POLICY portal_otp_service_role ON portal_otp
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Explicit grants (belt-and-suspenders for hosted Supabase projects)
GRANT ALL ON portal_tokens   TO service_role;
GRANT ALL ON portal_sessions TO service_role;
GRANT ALL ON portal_otp      TO service_role;

COMMIT;

-- ── DONE ──────────────────────────────────────────────────────────────────────
SELECT '015_portal_schema_fix: portal_tokens + portal_sessions + portal_otp fixed' AS result;
