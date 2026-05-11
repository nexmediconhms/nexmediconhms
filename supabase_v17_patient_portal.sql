-- ============================================================
-- NexMedicon HMS — v17: Full Patient Portal
-- Run in Supabase → SQL Editor → New Query
-- Safe to run multiple times
--
-- PREREQUISITE: Run supabase_setup.sql first (creates patients table).
--
-- SECURITY NOTE: Portal API routes use the SERVICE ROLE KEY which
-- bypasses RLS. We do NOT add anon policies to patient data tables.
-- This prevents data leakage via direct Supabase client queries.
-- ============================================================

-- ─── 1. Portal OTP (magic link / OTP login) ──────────────────
CREATE TABLE IF NOT EXISTS portal_otp (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mobile      TEXT NOT NULL,
  otp_code    TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  patient_id  UUID REFERENCES patients(id) ON DELETE CASCADE,
  mrn         TEXT,
  expires_at  TIMESTAMPTZ NOT NULL,
  verified    BOOLEAN DEFAULT FALSE,
  attempts    INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE portal_otp ENABLE ROW LEVEL SECURITY;

-- Only authenticated clinic staff and service role can manage OTPs
DROP POLICY IF EXISTS portal_otp_service ON portal_otp;
CREATE POLICY portal_otp_service ON portal_otp
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- NO anon policy — service role bypasses RLS for portal API routes

CREATE INDEX IF NOT EXISTS idx_portal_otp_mobile   ON portal_otp(mobile);
CREATE INDEX IF NOT EXISTS idx_portal_otp_token    ON portal_otp(token);
CREATE INDEX IF NOT EXISTS idx_portal_otp_expires  ON portal_otp(expires_at);

-- ─── 2. Portal Sessions (persistent login for patients) ──────
CREATE TABLE IF NOT EXISTS portal_sessions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  mrn             TEXT NOT NULL,
  mobile          TEXT NOT NULL,
  session_token   TEXT NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  last_used       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE portal_sessions ENABLE ROW LEVEL SECURITY;

-- Only authenticated clinic staff and service role can manage sessions
DROP POLICY IF EXISTS portal_sessions_service ON portal_sessions;
CREATE POLICY portal_sessions_service ON portal_sessions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- NO anon policy — prevents direct session enumeration attacks

CREATE INDEX IF NOT EXISTS idx_portal_sessions_token   ON portal_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_patient ON portal_sessions(patient_id);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_expires ON portal_sessions(expires_at);

-- ─── 3. Lab Reports table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_reports (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id    UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id  UUID,
  test_name     TEXT NOT NULL DEFAULT 'Unknown Test',
  test_category TEXT DEFAULT 'General',
  result_data   JSONB DEFAULT '{}'::jsonb,
  result_text   TEXT,
  normal_range  TEXT,
  status        TEXT DEFAULT 'pending',
  report_date   DATE DEFAULT CURRENT_DATE,
  reported_by   TEXT,
  reviewed_by   TEXT,
  file_url      TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Add missing columns if table already existed
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS test_name TEXT DEFAULT 'Unknown Test';
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS test_category TEXT DEFAULT 'General';
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS result_data JSONB DEFAULT '{}'::jsonb;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS result_text TEXT;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS normal_range TEXT;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS report_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS reported_by TEXT;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS encounter_id UUID;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE lab_reports ENABLE ROW LEVEL SECURITY;

-- Only authenticated users can access lab reports (no anon access)
DROP POLICY IF EXISTS lab_reports_auth ON lab_reports;
CREATE POLICY lab_reports_auth ON lab_reports
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_lab_reports_patient  ON lab_reports(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_reports_date     ON lab_reports(report_date DESC);

-- ─── 4. Appointments modifications (safe) ────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'appointments' AND table_schema = 'public') THEN
    EXECUTE 'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS doctor_name TEXT';
    EXECUTE 'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS video_link TEXT';
    -- NO anon policies on appointments — service role handles portal access
  END IF;
END $$;

-- ─── 5. REMOVE any previously-added anon policies (security fix) ─
-- If you ran an earlier version of this migration that added anon policies,
-- this section removes them to prevent data leakage.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bills' AND table_schema = 'public') THEN
    EXECUTE 'DROP POLICY IF EXISTS bills_anon_read ON bills';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'prescriptions' AND table_schema = 'public') THEN
    EXECUTE 'DROP POLICY IF EXISTS prescriptions_anon_read ON prescriptions';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'appointments' AND table_schema = 'public') THEN
    EXECUTE 'DROP POLICY IF EXISTS appointments_anon_read ON appointments';
    EXECUTE 'DROP POLICY IF EXISTS appointments_anon_update ON appointments';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'encounters' AND table_schema = 'public') THEN
    EXECUTE 'DROP POLICY IF EXISTS encounters_anon_read ON encounters';
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS portal_otp_anon_read ON portal_otp';
  EXECUTE 'DROP POLICY IF EXISTS portal_sessions_anon ON portal_sessions';
  EXECUTE 'DROP POLICY IF EXISTS lab_reports_anon_read ON lab_reports';
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT 'v17 patient portal migration complete (secure) ✓' AS result;
