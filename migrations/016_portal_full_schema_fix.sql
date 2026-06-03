-- ============================================================
-- Migration 016: Fix Portal Tables Schema (Complete)
-- Created: 2026-06-03
--
-- ROOT CAUSE:
--   portal_tokens and portal_sessions were created with minimal columns.
--   The application code uses columns that never existed in the DB:
--     portal_tokens:   mrn, is_used, created_by
--     portal_sessions: session_token, mrn, mobile, is_active, last_used
--   portal_otp table was never created at all.
--
-- WHAT THIS MIGRATION DOES:
--   1. portal_tokens  — add mrn, is_used, created_by
--   2. portal_sessions — add session_token, mrn, mobile, is_active, last_used
--   3. portal_otp      — create table
--   4. RLS + grants for service_role
--   5. Indexes for fast lookups
--
-- SAFE TO RUN MULTIPLE TIMES (all IF NOT EXISTS / DO $$ guards)
-- ============================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- §1  portal_tokens — add missing columns
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE portal_tokens ADD COLUMN IF NOT EXISTS mrn        TEXT;
ALTER TABLE portal_tokens ADD COLUMN IF NOT EXISTS is_used    BOOLEAN DEFAULT FALSE;
ALTER TABLE portal_tokens ADD COLUMN IF NOT EXISTS created_by TEXT;

-- Back-fill is_used from the original `used` column
UPDATE portal_tokens SET is_used = COALESCE(used, FALSE) WHERE is_used IS NULL;

CREATE INDEX IF NOT EXISTS idx_portal_tokens_mrn ON portal_tokens (mrn) WHERE mrn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_portal_tokens_is_used ON portal_tokens (is_used) WHERE is_used = FALSE;

-- ═══════════════════════════════════════════════════════════════
-- §2  portal_sessions — add missing columns
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS session_token TEXT;
ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS mrn           TEXT;
ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS mobile        TEXT;
ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS is_active     BOOLEAN DEFAULT TRUE;
ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS last_used     TIMESTAMPTZ;

-- Back-fill session_token from existing token column
UPDATE portal_sessions SET session_token = token WHERE session_token IS NULL AND token IS NOT NULL;

-- Unique index on session_token
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'portal_sessions' AND indexname = 'uniq_portal_sessions_session_token'
  ) THEN
    CREATE UNIQUE INDEX uniq_portal_sessions_session_token
        ON portal_sessions (session_token) WHERE session_token IS NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_portal_sessions_token_active
    ON portal_sessions (session_token, is_active) WHERE is_active = TRUE;

-- ═══════════════════════════════════════════════════════════════
-- §3  portal_otp — create table (did not exist)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS portal_otp (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile      TEXT        NOT NULL,
  otp_code    TEXT        NOT NULL,
  token       TEXT        NOT NULL UNIQUE,
  patient_id  UUID,
  mrn         TEXT,
  attempts    INTEGER     NOT NULL DEFAULT 0,
  verified    BOOLEAN     NOT NULL DEFAULT FALSE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portal_otp_mobile_unverified
    ON portal_otp (mobile, verified, created_at DESC) WHERE verified = FALSE;

CREATE INDEX IF NOT EXISTS idx_portal_otp_token
    ON portal_otp (token) WHERE verified = FALSE;

-- ═══════════════════════════════════════════════════════════════
-- §4  RLS + Grants
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE portal_tokens   ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_otp      ENABLE ROW LEVEL SECURITY;

-- Service role policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='portal_tokens' AND policyname='portal_tokens_service_role') THEN
    CREATE POLICY portal_tokens_service_role ON portal_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='portal_sessions' AND policyname='portal_sessions_service_role') THEN
    CREATE POLICY portal_sessions_service_role ON portal_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='portal_otp' AND policyname='portal_otp_service_role') THEN
    CREATE POLICY portal_otp_service_role ON portal_otp FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT ALL ON portal_tokens   TO service_role;
GRANT ALL ON portal_sessions TO service_role;
GRANT ALL ON portal_otp      TO service_role;

COMMIT;

SELECT '016_portal_full_schema_fix: DONE' AS result;