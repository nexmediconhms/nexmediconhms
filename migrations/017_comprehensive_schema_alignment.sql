-- ============================================================
-- Migration 017: Comprehensive Schema Alignment
-- Created: 2026-06-03
--
-- PURPOSE:
--   The application code uses snake_case columns everywhere, but the
--   live database accumulated mismatches over time. This migration
--   ensures EVERY column referenced by the app actually exists.
--
-- WHAT THIS DOES:
--   §1  Portal tables: portal_tokens, portal_sessions, portal_otp
--   §2  Lab reports: ensure all columns the app reads exist
--   §3  Doctor alerts: ensure alert_data JSONB column exists
--   §4  OPD queue: ensure token_number column exists
--   §5  Patient policy fields: policy_tpa_name, policy_number
--   §6  Discharge summaries: ensure final_diagnosis, is_final, version
--   §7  RLS service-role grants for new portal tables
--
-- SAFE TO RUN MULTIPLE TIMES (uses IF NOT EXISTS / DO $$ guards).
-- WILL NOT DROP OR MODIFY ANY EXISTING DATA.
-- ============================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- §1  PORTAL TABLES
-- ═══════════════════════════════════════════════════════════════

-- portal_tokens — add missing columns the app uses
DO $$
BEGIN
  -- Create the table if it doesn't exist at all
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'portal_tokens') THEN
    CREATE TABLE portal_tokens (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id  UUID,
      mrn         TEXT,
      token       TEXT UNIQUE,
      expires_at  TIMESTAMPTZ,
      is_used     BOOLEAN DEFAULT FALSE,
      used        BOOLEAN DEFAULT FALSE,  -- legacy
      created_by  TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;
END $$;

ALTER TABLE portal_tokens ADD COLUMN IF NOT EXISTS mrn        TEXT;
ALTER TABLE portal_tokens ADD COLUMN IF NOT EXISTS is_used    BOOLEAN DEFAULT FALSE;
ALTER TABLE portal_tokens ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE portal_tokens ADD COLUMN IF NOT EXISTS patient_id UUID;
ALTER TABLE portal_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Back-fill is_used from legacy `used` column if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'portal_tokens' AND column_name = 'used')
  THEN
    UPDATE portal_tokens SET is_used = COALESCE(used, FALSE) WHERE is_used IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_portal_tokens_mrn ON portal_tokens (mrn) WHERE mrn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_portal_tokens_active ON portal_tokens (is_used) WHERE is_used = FALSE;

-- ───────────────────────────────────────────────────────────────
-- portal_sessions — add session_token and other columns
-- ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'portal_sessions') THEN
    CREATE TABLE portal_sessions (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id    UUID,
      mrn           TEXT,
      mobile        TEXT,
      session_token TEXT UNIQUE,
      token         TEXT UNIQUE,  -- legacy
      expires_at    TIMESTAMPTZ NOT NULL,
      is_active     BOOLEAN DEFAULT TRUE,
      last_used     TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;
END $$;

ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS session_token TEXT;
ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS mrn           TEXT;
ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS mobile        TEXT;
ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS is_active     BOOLEAN DEFAULT TRUE;
ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS last_used     TIMESTAMPTZ;
ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS patient_id    UUID;

-- Back-fill session_token from legacy `token` column
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'portal_sessions' AND column_name = 'token')
  THEN
    UPDATE portal_sessions SET session_token = token
      WHERE session_token IS NULL AND token IS NOT NULL;
  END IF;
END $$;

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

CREATE INDEX IF NOT EXISTS idx_portal_sessions_active
    ON portal_sessions (session_token, is_active) WHERE is_active = TRUE;

-- ───────────────────────────────────────────────────────────────
-- portal_otp — create from scratch (was never created)
-- ───────────────────────────────────────────────────────────────
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
-- §2  LAB REPORTS — patient portal compatibility columns
-- ═══════════════════════════════════════════════════════════════
-- The patient portal dashboard reads test_name, test_category,
-- result_text, result_data on lab_reports. The staff lab page
-- writes report_name and entries. We add the missing columns and
-- back-fill them so both flows work.
-- ───────────────────────────────────────────────────────────────

ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS test_name      TEXT;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS test_category  TEXT;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS result_text    TEXT;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS result_data    JSONB;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS file_url       TEXT;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS normal_range   TEXT;

-- Back-fill test_name from report_name where missing
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'lab_reports' AND column_name = 'report_name')
  THEN
    UPDATE lab_reports
       SET test_name = report_name
     WHERE test_name IS NULL AND report_name IS NOT NULL;
  END IF;

  -- Back-fill file_url from attachment_url if both columns exist
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'lab_reports' AND column_name = 'attachment_url')
  THEN
    UPDATE lab_reports
       SET file_url = attachment_url
     WHERE file_url IS NULL AND attachment_url IS NOT NULL;
  END IF;

  -- Back-fill result_data from entries JSONB if it exists
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'lab_reports' AND column_name = 'entries')
  THEN
    UPDATE lab_reports
       SET result_data = entries
     WHERE result_data IS NULL AND entries IS NOT NULL;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- §3  DOCTOR ALERTS — ensure alert_data JSONB column exists
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'doctor_alerts') THEN
    CREATE TABLE doctor_alerts (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id    UUID,
      patient_name  TEXT,
      mrn           TEXT,
      alert_type    TEXT,
      message       TEXT,
      severity      TEXT DEFAULT 'normal',
      alert_data    JSONB,
      source        TEXT,
      is_read       BOOLEAN DEFAULT FALSE,
      read_at       TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;
END $$;

ALTER TABLE doctor_alerts ADD COLUMN IF NOT EXISTS alert_data   JSONB;
ALTER TABLE doctor_alerts ADD COLUMN IF NOT EXISTS mrn          TEXT;
ALTER TABLE doctor_alerts ADD COLUMN IF NOT EXISTS source       TEXT;
ALTER TABLE doctor_alerts ADD COLUMN IF NOT EXISTS read_at      TIMESTAMPTZ;
ALTER TABLE doctor_alerts ADD COLUMN IF NOT EXISTS patient_name TEXT;

CREATE INDEX IF NOT EXISTS idx_doctor_alerts_unread
    ON doctor_alerts (is_read, created_at DESC) WHERE is_read = FALSE;

-- ═══════════════════════════════════════════════════════════════
-- §4  OPD QUEUE — ensure token_number column exists
-- ═══════════════════════════════════════════════════════════════
-- App code consistently uses token_number. Some legacy schemas
-- may have queue_number. We add token_number and back-fill from
-- queue_number if it exists.
-- ───────────────────────────────────────────────────────────────

ALTER TABLE opd_queue ADD COLUMN IF NOT EXISTS token_number INTEGER;
ALTER TABLE opd_queue ADD COLUMN IF NOT EXISTS queue_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE opd_queue ADD COLUMN IF NOT EXISTS encounter_id UUID;
ALTER TABLE opd_queue ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal';
ALTER TABLE opd_queue ADD COLUMN IF NOT EXISTS called_at TIMESTAMPTZ;
ALTER TABLE opd_queue ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ;

DO $$
BEGIN
  -- Back-fill token_number from queue_number if it exists
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'opd_queue' AND column_name = 'queue_number')
  THEN
    UPDATE opd_queue
       SET token_number = queue_number
     WHERE token_number IS NULL AND queue_number IS NOT NULL;
  END IF;

  -- Back-fill queue_date from `date` column if it exists
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'opd_queue' AND column_name = 'date')
  THEN
    UPDATE opd_queue
       SET queue_date = date
     WHERE queue_date IS NULL AND date IS NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_opd_queue_date_token
    ON opd_queue (queue_date, token_number);

-- ═══════════════════════════════════════════════════════════════
-- §5  PATIENTS — add policy fields if missing
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE patients ADD COLUMN IF NOT EXISTS policy_tpa_name      TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS policy_number        TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS reference_source     TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS reference_detail     TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS aadhaar_no           TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS abha_id              TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS emergency_contact_name  TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS date_of_birth        DATE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS blood_group          TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS doctor_id            UUID;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_name       TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_id         TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS mediclaim            TEXT DEFAULT 'No';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS cashless             TEXT DEFAULT 'No';

-- ═══════════════════════════════════════════════════════════════
-- §6  DISCHARGE SUMMARIES — ensure all columns the app uses
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS final_diagnosis        TEXT;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS secondary_diagnosis    TEXT;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS clinical_summary       TEXT;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS investigations         TEXT;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS treatment_given        TEXT;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS condition_at_discharge TEXT;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS discharge_advice       TEXT;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS diet_advice            TEXT;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS medications_at_discharge TEXT;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS follow_up_date         DATE;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS follow_up_note         TEXT;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS is_final               BOOLEAN DEFAULT FALSE;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS version                INTEGER DEFAULT 1;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS signed_by              TEXT;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS signed_at              TIMESTAMPTZ;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS finalized_at           TIMESTAMPTZ;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS unfinalized_reason     TEXT;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS unfinalized_by         TEXT;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS unfinalized_at         TIMESTAMPTZ;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS reminder_sent_at       TIMESTAMPTZ;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS delivery_type          TEXT;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS baby_sex               TEXT;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS baby_weight            TEXT;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS baby_birth_time        TEXT;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS apgar_score            TEXT;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS delivery_date          DATE;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS complications          TEXT;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS lactation_advice       TEXT;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS admission_date         DATE;
ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS discharge_date         DATE DEFAULT CURRENT_DATE;

-- Back-fill final_diagnosis from `diagnosis` column if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'discharge_summaries' AND column_name = 'diagnosis')
  THEN
    UPDATE discharge_summaries
       SET final_diagnosis = diagnosis
     WHERE final_diagnosis IS NULL AND diagnosis IS NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ds_isfinal ON discharge_summaries (is_final) WHERE is_final = TRUE;

-- ═══════════════════════════════════════════════════════════════
-- §7  CLINIC NOTIFICATIONS — used by Lab portal and discharge
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS clinic_notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  message       TEXT,
  type          TEXT,
  severity      TEXT DEFAULT 'normal',
  source        TEXT,
  entity_type   TEXT,
  entity_id     UUID,
  patient_id    UUID,
  patient_name  TEXT,
  mrn           TEXT,
  target_roles  TEXT[],
  is_read       BOOLEAN DEFAULT FALSE,
  metadata      JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clinic_notif_unread
    ON clinic_notifications (is_read, created_at DESC) WHERE is_read = FALSE;

-- ═══════════════════════════════════════════════════════════════
-- §8  CRON JOB LOG — used by /api/cron/reminders
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cron_job_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name     TEXT NOT NULL,
  status       TEXT DEFAULT 'running',
  started_at   TIMESTAMPTZ DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  result       JSONB,
  error        TEXT
);

-- ═══════════════════════════════════════════════════════════════
-- §9  INSURANCE CLAIMS — ensure all columns
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'insurance_claims') THEN
    CREATE TABLE insurance_claims (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id         UUID,
      patient_name       TEXT,
      mrn                TEXT,
      policy_number      TEXT,
      tpa_name           TEXT,
      insurance_company  TEXT,
      claim_amount       NUMERIC(12,2) DEFAULT 0,
      approved_amount    NUMERIC(12,2),
      status             TEXT DEFAULT 'pre_auth_pending',
      diagnosis          TEXT,
      surgery_name       TEXT,
      admission_date     DATE,
      discharge_date     DATE,
      settlement_date    DATE,
      notes              TEXT,
      created_by         TEXT,
      cashless           BOOLEAN DEFAULT FALSE,
      documents_sent     BOOLEAN DEFAULT FALSE,
      created_at         TIMESTAMPTZ DEFAULT NOW(),
      updated_at         TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS insurance_claim_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id     UUID,
  old_status   TEXT,
  new_status   TEXT,
  notes        TEXT,
  done_by      TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- §10 RLS POLICIES — service role access on portal & notification tables
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE portal_tokens          ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_otp             ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_notifications   ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_alerts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE cron_job_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_claims       ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_claim_history ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS by default in Supabase, but we add
-- explicit policies for clarity and as belt-and-suspenders.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='portal_tokens' AND policyname='portal_tokens_service_role') THEN
    CREATE POLICY portal_tokens_service_role ON portal_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='portal_sessions' AND policyname='portal_sessions_service_role') THEN
    CREATE POLICY portal_sessions_service_role ON portal_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='portal_otp' AND policyname='portal_otp_service_role') THEN
    CREATE POLICY portal_otp_service_role ON portal_otp FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='clinic_notifications' AND policyname='clinic_notif_all') THEN
    CREATE POLICY clinic_notif_all ON clinic_notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='doctor_alerts' AND policyname='doctor_alerts_all') THEN
    CREATE POLICY doctor_alerts_all ON doctor_alerts FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='insurance_claims' AND policyname='ic_all') THEN
    CREATE POLICY ic_all ON insurance_claims FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='insurance_claim_history' AND policyname='ich_all') THEN
    CREATE POLICY ich_all ON insurance_claim_history FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT ALL ON portal_tokens          TO service_role;
GRANT ALL ON portal_sessions        TO service_role;
GRANT ALL ON portal_otp             TO service_role;
GRANT ALL ON clinic_notifications   TO service_role, authenticated;
GRANT ALL ON doctor_alerts          TO service_role, authenticated;
GRANT ALL ON cron_job_log           TO service_role;
GRANT ALL ON insurance_claims       TO service_role, authenticated;
GRANT ALL ON insurance_claim_history TO service_role, authenticated;

COMMIT;

SELECT '017_comprehensive_schema_alignment: ALL columns and tables aligned with app code' AS result;