-- ============================================================
-- Migration 001: Fix Beds Table Schema Mismatch
-- 
-- PROBLEM: v00-schema-master.sql created the beds table with 
-- column named 'bednumber' (no underscore), but all application
-- code expects 'bed_number' (with underscore).
-- This causes the error: "Could not find the 'bednumber' column 
-- of 'beds' in the schema cache"
--
-- SOLUTION: Rename column if old schema was applied, add missing 
-- columns, and ensure proper constraints.
-- 
-- SAFE TO RUN: Uses IF EXISTS / IF NOT EXISTS — idempotent.
-- ============================================================

-- Step 1: If old schema was applied, rename 'bednumber' → 'bed_number'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'beds' AND column_name = 'bednumber'
  ) THEN
    -- Rename the column
    ALTER TABLE beds RENAME COLUMN bednumber TO bed_number;
    RAISE NOTICE 'Renamed bednumber → bed_number';
  END IF;
END $$;

-- Step 2: Ensure all required columns exist (handles both old and new schemas)
DO $$
BEGIN
  -- Add 'ward' as NOT NULL TEXT if missing (old schema has it nullable)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'beds' AND column_name = 'ward'
  ) THEN
    ALTER TABLE beds ADD COLUMN ward TEXT NOT NULL DEFAULT 'General Ward';
  END IF;

  -- Add 'type' column for bed type classification
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'beds' AND column_name = 'type'
  ) THEN
    ALTER TABLE beds ADD COLUMN type TEXT DEFAULT 'General';
  END IF;

  -- Add 'patient_id' FK column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'beds' AND column_name = 'patient_id'
  ) THEN
    ALTER TABLE beds ADD COLUMN patient_id UUID REFERENCES patients(id) ON DELETE SET NULL;
  END IF;

  -- Add 'patient_name' denormalized column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'beds' AND column_name = 'patient_name'
  ) THEN
    ALTER TABLE beds ADD COLUMN patient_name TEXT;
  END IF;

  -- Add 'admission_date' column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'beds' AND column_name = 'admission_date'
  ) THEN
    ALTER TABLE beds ADD COLUMN admission_date DATE;
  END IF;

  -- Add 'expected_discharge' column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'beds' AND column_name = 'expected_discharge'
  ) THEN
    ALTER TABLE beds ADD COLUMN expected_discharge DATE;
  END IF;

  -- Add 'updated_at' column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'beds' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE beds ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;

  -- Add 'reservedfor' column (for bed reservation feature)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'beds' AND column_name = 'reservedfor'
  ) THEN
    ALTER TABLE beds ADD COLUMN reservedfor TEXT;
  END IF;

  -- Add 'reservedat' column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'beds' AND column_name = 'reservedat'
  ) THEN
    ALTER TABLE beds ADD COLUMN reservedat TIMESTAMPTZ;
  END IF;

  -- Add 'reservednote' column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'beds' AND column_name = 'reservednote'
  ) THEN
    ALTER TABLE beds ADD COLUMN reservednote TEXT;
  END IF;

  -- Add 'notes' column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'beds' AND column_name = 'notes'
  ) THEN
    ALTER TABLE beds ADD COLUMN notes TEXT;
  END IF;
END $$;

-- Step 3: Ensure the status CHECK constraint includes all valid statuses
-- Drop old constraint if it exists and recreate with all values
DO $$
BEGIN
  -- Remove the old constraint (may not exist in all environments)
  BEGIN
    ALTER TABLE beds DROP CONSTRAINT IF EXISTS beds_status_check;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  
  -- Add updated constraint including 'maintenance'
  ALTER TABLE beds ADD CONSTRAINT beds_status_check 
    CHECK (status IN ('available', 'occupied', 'cleaning', 'reserved', 'maintenance'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Step 4: Ensure bed_number has a UNIQUE constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'beds' AND indexname = 'beds_bed_number_key'
  ) THEN
    -- Check if uniqueness exists from old schema (beds_bednumber_key)
    IF EXISTS (
      SELECT 1 FROM pg_indexes 
      WHERE tablename = 'beds' AND indexname = 'beds_bednumber_key'
    ) THEN
      ALTER INDEX beds_bednumber_key RENAME TO beds_bed_number_key;
    ELSE
      ALTER TABLE beds ADD CONSTRAINT beds_bed_number_key UNIQUE (bed_number);
    END IF;
  END IF;
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- Step 5: Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_beds_status ON beds(status);
CREATE INDEX IF NOT EXISTS idx_beds_ward ON beds(ward);
CREATE INDEX IF NOT EXISTS idx_beds_patient_id ON beds(patient_id);

-- Step 6: Ensure RLS is enabled
ALTER TABLE beds ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  DROP POLICY IF EXISTS allow_auth_beds ON beds;
  CREATE POLICY allow_auth_beds ON beds
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Step 7: Also fix ipdadmissions table if old schema was used
DO $$
BEGIN
  -- If old 'ipdadmissions' table exists but new 'ipd_admissions' doesn't
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'ipdadmissions'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'ipd_admissions'
  ) THEN
    ALTER TABLE ipdadmissions RENAME TO ipd_admissions;
    RAISE NOTICE 'Renamed ipdadmissions → ipd_admissions';
  END IF;
END $$;

-- Step 8: Create ipd_admissions table if it doesn't exist at all
CREATE TABLE IF NOT EXISTS ipd_admissions (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id            UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  patient_name          TEXT,
  mrn                   TEXT,
  mobile                TEXT,
  age                   INTEGER,
  gender                TEXT,
  bed_id                UUID REFERENCES beds(id),
  bed_number            TEXT,
  ward                  TEXT,
  admission_date        DATE DEFAULT CURRENT_DATE,
  admission_time        TEXT,
  admitting_doctor      TEXT,
  consulting_doctors    TEXT[] DEFAULT '{}',
  diagnosis_on_admission TEXT,
  chief_complaint       TEXT,
  status                TEXT DEFAULT 'active' CHECK (status IN ('active', 'discharged', 'transferred')),
  diet_type             TEXT DEFAULT 'Normal',
  allergies             TEXT,
  comorbidities         TEXT,
  insurance_details     TEXT,
  relative_name         TEXT,
  relative_contact      TEXT,
  relative_relation     TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Step 9: Create ipd_nursing table if not exists
CREATE TABLE IF NOT EXISTS ipd_nursing (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ipd_admission_id    UUID NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,
  patient_id          UUID REFERENCES patients(id),
  entry_type          TEXT NOT NULL CHECK (entry_type IN ('vital', 'io', 'note', 'medication')),
  recorded_time       TEXT,
  pulse               TEXT,
  bp_systolic         TEXT,
  bp_diastolic        TEXT,
  temperature         TEXT,
  spo2                TEXT,
  weight              TEXT,
  rr                  TEXT,
  vital_note          TEXT,
  io_type             TEXT CHECK (io_type IN ('Input', 'Output')),
  io_label            TEXT,
  io_amount_ml        NUMERIC(10,2),
  medication_name     TEXT,
  medication_dose     TEXT,
  medication_route    TEXT,
  medication_given_by TEXT,
  nurse_name          TEXT NOT NULL DEFAULT 'Nurse',
  note_text           TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Step 10: Create ipd_files table for photo/document storage (Feature #1)
CREATE TABLE IF NOT EXISTS ipd_files (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ipd_admission_id  UUID NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,
  patient_id        UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  file_name         TEXT NOT NULL,
  file_type         TEXT NOT NULL,           -- 'image/jpeg', 'application/pdf', etc.
  file_size         INTEGER,                 -- bytes
  storage_key       TEXT,                    -- Supabase storage key
  file_url          TEXT,                    -- Public/signed URL
  file_data         TEXT,                    -- Base64 fallback for small files
  category          TEXT DEFAULT 'general',  -- 'wound', 'report', 'xray', 'consent', 'prescription', 'nursing', 'general'
  description       TEXT,
  ai_extracted_data JSONB DEFAULT '{}'::JSONB,  -- AI-extracted fields from the image/document
  uploaded_by       TEXT NOT NULL DEFAULT 'Staff',
  uploaded_by_role  TEXT DEFAULT 'nurse',    -- 'doctor', 'nurse', 'staff'
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ipd_files_admission ON ipd_files(ipd_admission_id);
CREATE INDEX IF NOT EXISTS idx_ipd_files_patient ON ipd_files(patient_id);

-- Step 11: Create lab_reports table if not exists
CREATE TABLE IF NOT EXISTS lab_reports (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id        UUID REFERENCES patients(id) ON DELETE CASCADE,
  report_name       TEXT NOT NULL,
  report_date       DATE DEFAULT CURRENT_DATE,
  lab_name          TEXT,
  lab_partner_id    UUID,
  lab_partner_name  TEXT,
  status            TEXT DEFAULT 'pending',
  notes             TEXT,
  attachment_url    TEXT,
  storage_key       TEXT,
  file_data         TEXT,
  results_data      JSONB DEFAULT '[]'::JSONB,  -- parsed lab values
  ai_extracted_data JSONB DEFAULT '{}'::JSONB,
  source            TEXT DEFAULT 'manual',       -- 'manual', 'portal', 'ai'
  portal_upload     BOOLEAN DEFAULT FALSE,
  portal_patient_mrn TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lab_reports_patient ON lab_reports(patient_id);

-- Step 12: Create reminder_log table if not exists
CREATE TABLE IF NOT EXISTS reminder_log (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id      UUID REFERENCES patients(id),
  patient_name    TEXT,
  mobile          TEXT,
  reminder_type   TEXT,
  source_table    TEXT,
  source_id       UUID,
  message_preview TEXT,
  channel         TEXT DEFAULT 'whatsapp',
  status          TEXT DEFAULT 'sent',
  sent_at         TIMESTAMPTZ DEFAULT NOW(),
  sent_by         TEXT DEFAULT 'staff',
  batch_id        TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Step 13: Create doctor_alerts table if not exists
CREATE TABLE IF NOT EXISTS doctor_alerts (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id    UUID REFERENCES patients(id),
  patient_name  TEXT,
  mrn           TEXT,
  alert_type    TEXT,
  alert_data    JSONB DEFAULT '{}'::JSONB,
  severity      TEXT DEFAULT 'warning',
  source        TEXT,
  is_read       BOOLEAN DEFAULT FALSE,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Step 14: Create whatsapp_notifications table for cron tracking
CREATE TABLE IF NOT EXISTS whatsapp_notifications (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id        UUID REFERENCES patients(id),
  patient_name      TEXT,
  mobile            TEXT,
  notification_type TEXT NOT NULL,
  message_preview   TEXT,
  recipient_type    TEXT DEFAULT 'patient',   -- 'patient', 'doctor', 'staff'
  status            TEXT DEFAULT 'queued',    -- 'queued', 'sent', 'failed', 'delivered'
  metadata          JSONB DEFAULT '{}'::JSONB,
  scheduled_for     TIMESTAMPTZ,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_notif_status ON whatsapp_notifications(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_notif_scheduled ON whatsapp_notifications(scheduled_for);

-- Step 15: Create cron_job_log table for tracking automated tasks
CREATE TABLE IF NOT EXISTS cron_job_log (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_name    TEXT NOT NULL,
  status      TEXT DEFAULT 'running',   -- 'running', 'completed', 'failed'
  started_at  TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  result      JSONB DEFAULT '{}'::JSONB,
  error       TEXT
);

-- Done!
SELECT 'Migration 001 complete — beds schema fixed, all tables ensured ✓' AS result;
