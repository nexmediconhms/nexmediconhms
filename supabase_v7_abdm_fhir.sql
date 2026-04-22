-- ============================================================
-- NexMedicon HMS v7 — ABDM/ABHA & FHIR Integration
-- Run in Supabase → SQL Editor → New Query
-- Safe to run multiple times (IF NOT EXISTS / DO blocks)
-- ============================================================

-- 1. Add ABDM-specific columns to patients table
DO $$
BEGIN
  -- ABHA number (14-digit, formatted XX-XXXX-XXXX-XXXX)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'abha_number'
  ) THEN
    ALTER TABLE patients ADD COLUMN abha_number TEXT;
    RAISE NOTICE 'Column abha_number added to patients table.';
  ELSE
    RAISE NOTICE 'Column abha_number already exists — skipping.';
  END IF;

  -- ABHA address (user@abdm)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'abha_address'
  ) THEN
    ALTER TABLE patients ADD COLUMN abha_address TEXT;
    RAISE NOTICE 'Column abha_address added to patients table.';
  ELSE
    RAISE NOTICE 'Column abha_address already exists — skipping.';
  END IF;

  -- ABDM KYC verified flag
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'abdm_kyc_verified'
  ) THEN
    ALTER TABLE patients ADD COLUMN abdm_kyc_verified BOOLEAN DEFAULT FALSE;
    RAISE NOTICE 'Column abdm_kyc_verified added to patients table.';
  ELSE
    RAISE NOTICE 'Column abdm_kyc_verified already exists — skipping.';
  END IF;

  -- ABDM profile data (JSON blob for full ABDM profile)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'abdm_profile'
  ) THEN
    ALTER TABLE patients ADD COLUMN abdm_profile JSONB DEFAULT '{}'::JSONB;
    RAISE NOTICE 'Column abdm_profile added to patients table.';
  ELSE
    RAISE NOTICE 'Column abdm_profile already exists — skipping.';
  END IF;

  -- FHIR resource ID (for external FHIR server sync)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'fhir_resource_id'
  ) THEN
    ALTER TABLE patients ADD COLUMN fhir_resource_id TEXT;
    RAISE NOTICE 'Column fhir_resource_id added to patients table.';
  ELSE
    RAISE NOTICE 'Column fhir_resource_id already exists — skipping.';
  END IF;
END
$$;

-- 2. Add FHIR-related columns to encounters
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'encounters' AND column_name = 'fhir_resource_id'
  ) THEN
    ALTER TABLE encounters ADD COLUMN fhir_resource_id TEXT;
    RAISE NOTICE 'Column fhir_resource_id added to encounters table.';
  ELSE
    RAISE NOTICE 'Column fhir_resource_id already exists — skipping.';
  END IF;
END
$$;

-- 3. ABDM consent artifacts table (for health information exchange)
CREATE TABLE IF NOT EXISTS abdm_consents (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id      UUID REFERENCES patients(id) ON DELETE CASCADE,
  consent_id      TEXT,           -- ABDM consent artifact ID
  request_id      TEXT,           -- ABDM consent request ID
  status          TEXT DEFAULT 'REQUESTED'
                    CHECK (status IN ('REQUESTED','GRANTED','DENIED','EXPIRED','REVOKED')),
  purpose         TEXT,           -- Purpose of consent (e.g., 'CAREMGT', 'BTG')
  hi_types        TEXT[],         -- Health info types (e.g., {'Prescription','DiagnosticReport'})
  date_range_from DATE,
  date_range_to   DATE,
  expiry_date     TIMESTAMPTZ,
  granted_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  raw_artifact    JSONB,          -- Full ABDM consent artifact JSON
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE abdm_consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_abdm_consents ON abdm_consents;
CREATE POLICY allow_auth_abdm_consents ON abdm_consents
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_abdm_consents_patient ON abdm_consents(patient_id);
CREATE INDEX IF NOT EXISTS idx_abdm_consents_status  ON abdm_consents(status);

-- 4. ABDM health information exchange log
CREATE TABLE IF NOT EXISTS abdm_hi_exchange (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id      UUID REFERENCES patients(id) ON DELETE CASCADE,
  consent_id      TEXT,
  transaction_id  TEXT,
  direction       TEXT CHECK (direction IN ('PUSH','PULL')),
  hi_type         TEXT,           -- e.g., 'Prescription', 'OPConsultation'
  fhir_bundle     JSONB,          -- The FHIR bundle exchanged
  status          TEXT DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','SUCCESS','FAILED')),
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE abdm_hi_exchange ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_abdm_hi ON abdm_hi_exchange;
CREATE POLICY allow_auth_abdm_hi ON abdm_hi_exchange
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_abdm_hi_patient ON abdm_hi_exchange(patient_id);

-- 5. Indexes for ABHA lookups
CREATE INDEX IF NOT EXISTS idx_patients_abha_number  ON patients(abha_number)  WHERE abha_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patients_abha_address ON patients(abha_address) WHERE abha_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patients_abha_id      ON patients(abha_id)      WHERE abha_id IS NOT NULL;

SELECT 'v7 ABDM/FHIR migration complete ✓' AS result;
