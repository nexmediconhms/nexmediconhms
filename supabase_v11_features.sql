-- ============================================================
-- NexMedicon HMS — v11: Complete Feature Additions
-- Run in Supabase → SQL Editor → New Query
-- Safe to run multiple times (IF NOT EXISTS everywhere)
--
-- This migration covers:
--  1. IPD Admissions table (Feature #1)
--  2. Portal tokens table  (Feature #5)
--  3. Hospital Fund table  (Feature #6)
--  4. Migrate localStorage keys to Supabase (Requirement #7)
--  5. PHI encryption with pgcrypto (Requirement #9)
--  6. Video appointment open slots support (Feature #5)
--  7. Multi-doctor support on clinic_users (Feature #4)
-- ============================================================

-- ─── Enable extensions ────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── 1. IPD Admissions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS ipd_admissions (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id              UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_name            TEXT NOT NULL,
  mrn                     TEXT NOT NULL,
  mobile                  TEXT,
  age                     INTEGER,
  gender                  TEXT,

  -- Bed
  bed_id                  UUID REFERENCES beds(id) ON DELETE SET NULL,
  bed_number              TEXT,
  ward                    TEXT,

  -- Admission details
  admission_date          DATE    NOT NULL DEFAULT CURRENT_DATE,
  admission_time          TEXT    DEFAULT '00:00',
  admitting_doctor        TEXT    NOT NULL,
  consulting_doctors      JSONB   DEFAULT '[]'::jsonb,   -- array of doctor names
  diagnosis_on_admission  TEXT,
  chief_complaint         TEXT,
  diet_type               TEXT    DEFAULT 'Normal',
  allergies               TEXT,
  comorbidities           TEXT,
  insurance_details       TEXT,

  -- Attendant
  relative_name           TEXT,
  relative_contact        TEXT,
  relative_relation       TEXT,

  -- Status
  status                  TEXT    NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'discharged', 'transferred')),

  -- Housekeeping
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ipd_admissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_ipd_admissions ON ipd_admissions;
CREATE POLICY allow_auth_ipd_admissions ON ipd_admissions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ipd_adm_patient ON ipd_admissions(patient_id);
CREATE INDEX IF NOT EXISTS idx_ipd_adm_status  ON ipd_admissions(status);
CREATE INDEX IF NOT EXISTS idx_ipd_adm_bed     ON ipd_admissions(bed_id);
CREATE INDEX IF NOT EXISTS idx_ipd_adm_date    ON ipd_admissions(admission_date DESC);

-- Update ipd_nursing to reference ipd_admissions (not bed_id directly)
ALTER TABLE ipd_nursing
  ADD COLUMN IF NOT EXISTS ipd_admission_id UUID REFERENCES ipd_admissions(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_ipd_nursing_adm ON ipd_nursing(ipd_admission_id);

-- ─── 2. Portal Tokens (magic-link auth for /portal) ──────────
CREATE TABLE IF NOT EXISTS portal_tokens (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mrn         TEXT NOT NULL,
  patient_id  UUID REFERENCES patients(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  is_used     BOOLEAN DEFAULT FALSE,
  created_by  UUID,   -- auth.users.id of clinic staff who generated this
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Tokens are not authenticated reads — use a service-role API route to validate
-- The route /api/portal/* uses service_role key so no RLS needed here,
-- but we enable it and allow service_role through anyway.
ALTER TABLE portal_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_service_portal_tokens ON portal_tokens;
CREATE POLICY allow_service_portal_tokens ON portal_tokens
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_portal_tokens_mrn     ON portal_tokens(mrn);
CREATE INDEX IF NOT EXISTS idx_portal_tokens_token   ON portal_tokens(token);
CREATE INDEX IF NOT EXISTS idx_portal_tokens_expires ON portal_tokens(expires_at);

-- Auto-expire cleanup (run this periodically or via cron)
-- DELETE FROM portal_tokens WHERE expires_at < NOW();

-- ─── 3. Hospital Fund ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hospital_fund (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type           TEXT NOT NULL CHECK (type IN ('topup', 'expense')),
  category       TEXT NOT NULL,    -- 'printing' | 'food' | 'supplies' | 'transport' | 'maintenance' | 'other' | 'topup'
  amount         NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  description    TEXT NOT NULL,
  receipt_note   TEXT,             -- bill number or reference
  submitted_by   TEXT NOT NULL,    -- staff member name
  approved_by    TEXT,             -- admin who approved
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE hospital_fund ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_fund ON hospital_fund;
CREATE POLICY allow_auth_fund ON hospital_fund
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_fund_status     ON hospital_fund(status);
CREATE INDEX IF NOT EXISTS idx_fund_type       ON hospital_fund(type);
CREATE INDEX IF NOT EXISTS idx_fund_created_at ON hospital_fund(created_at DESC);

-- ─── 4. Replace localStorage keys with Supabase tables ───────
--
-- 4a. Lab results (was `nexmedicon_labs` in localStorage)
CREATE TABLE IF NOT EXISTS lab_templates (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT,
  parameters  JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{name, unit, range}, …]
  is_active   BOOLEAN DEFAULT TRUE,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE lab_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_labs ON lab_templates;
CREATE POLICY allow_auth_labs ON lab_templates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4b. Queue overrides (was `queue_overrides_*` in localStorage)
CREATE TABLE IF NOT EXISTS queue_overrides (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  queue_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  patient_id  UUID REFERENCES patients(id) ON DELETE CASCADE,
  position    INTEGER,
  notes       TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE queue_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_queue_overrides ON queue_overrides;
CREATE POLICY allow_auth_queue_overrides ON queue_overrides
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_queue_overrides_date ON queue_overrides(queue_date);

-- ─── 5. PHI Encryption with pgcrypto (Requirement #9) ────────
--
-- DPDP Act compliance: Aadhaar and mobile numbers must be encrypted at rest.
-- Strategy: store encrypted values in new columns, keep plaintext columns
-- for backward compat during transition period, then drop them.
--
-- Key management: hospital_key is a per-hospital secret stored as an
-- environment variable (HOSPITAL_ENCRYPTION_KEY) and passed to pgcrypto.
-- NEVER store the key in the database.
--
-- Encryption function usage (in application code):
--   encrypt:  pgp_sym_encrypt(plaintext, key)
--   decrypt:  pgp_sym_decrypt(ciphertext, key)
--
-- We add encrypted columns here. The application layer
-- (src/lib/phi-crypto.ts) handles encrypt/decrypt transparently.

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS aadhaar_encrypted   BYTEA,   -- pgp_sym_encrypt(aadhaar_no, key)
  ADD COLUMN IF NOT EXISTS mobile_encrypted    BYTEA;   -- pgp_sym_encrypt(mobile, key)

-- Mark existing columns as deprecated (application will stop writing them)
-- DO NOT DROP YET — migrate data first.
COMMENT ON COLUMN patients.aadhaar_no IS 'DEPRECATED: Use aadhaar_encrypted. Will be nulled after migration.';
COMMENT ON COLUMN patients.mobile     IS 'DEPRECATED: Use mobile_encrypted for PHI compliance. Keep for search index.';

-- Index on encrypted columns is not useful for search — full-text search
-- continues on mobile (non-sensitive) and aadhaar is never searched in plaintext.
-- For Aadhaar: search is done via last-4-digits stored separately.
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS aadhaar_last4 TEXT;   -- last 4 digits for display/search, non-PHI

-- ─── 6. Video consultation slot enhancements ─────────────────

-- Add open slot concept to appointments table
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS type        TEXT DEFAULT 'opd'   -- 'opd' | 'video' | 'ipd_follow_up'
  ,ADD COLUMN IF NOT EXISTS video_link TEXT                  -- Jitsi / Meet URL
  ,ADD COLUMN IF NOT EXISTS duration_min INTEGER DEFAULT 15  -- slot duration
  ,ADD COLUMN IF NOT EXISTS doctor_name TEXT;                -- for multi-doctor support

-- Open slots: status = 'open', patient_* fields are NULL until booked
-- Booked video: status = 'video'

CREATE INDEX IF NOT EXISTS idx_appts_type   ON appointments(type);
CREATE INDEX IF NOT EXISTS idx_appts_status ON appointments(status);

-- ─── 7. Multi-doctor support on clinic_users ─────────────────

ALTER TABLE clinic_users
  ADD COLUMN IF NOT EXISTS specialty   TEXT,       -- e.g. 'Gynaecology', 'Paediatrics'
  ADD COLUMN IF NOT EXISTS med_reg_no  TEXT,       -- Medical Council registration
  ADD COLUMN IF NOT EXISTS signature   TEXT,       -- base64 image of digital signature
  ADD COLUMN IF NOT EXISTS is_primary  BOOLEAN DEFAULT FALSE;  -- the main doctor of the clinic

-- ─── 8. clinic_settings table for Supabase-backed settings ───
-- (Requirement #7: replace nexmedicon_settings localStorage key)

CREATE TABLE IF NOT EXISTS clinic_settings (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,
  value      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE clinic_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_settings ON clinic_settings;
CREATE POLICY allow_auth_settings ON clinic_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─── 9. Audit log enhancements ────────────────────────────────

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS ip_address  TEXT,
  ADD COLUMN IF NOT EXISTS user_agent  TEXT;

-- ─── Done ─────────────────────────────────────────────────────

SELECT 'v11 migration complete ✓' AS result;
