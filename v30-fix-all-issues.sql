-- ============================================================
-- NexMedicon HMS — v30 FIX ALL ISSUES
-- 
-- Run this in Supabase → SQL Editor → New Query
-- Safe to run multiple times (IF NOT EXISTS / DO $$ blocks)
--
-- FIXES:
--   1. "relation ipdadmissions does not exist" — creates alias view
--   2. Storage bucket mime type fix — adds text/plain + more types
--   3. Adds missing columns for partial payments, refunds, daily closing
--   4. Adds doctor earnings columns (share_pct, earning_model)
--   5. Adds reminder_log table if missing
--   6. Adds follow_ups table if missing
--   7. Adds billing_packages table if missing
--   8. Adds daily_closing table for end-of-day reports
--   9. Adds payment_transactions table for partial/refund tracking
-- ============================================================


-- ═══════════════════════════════════════════════════════════════
-- FIX #1: "relation ipdadmissions does not exist"
--
-- Your DB has the table as `ipd_admissions` (snake_case, created by
-- supabase_v11_features.sql). But some code references `ipdadmissions`.
-- Solution: Create a VIEW alias so both names work.
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- Only create the view if ipd_admissions exists but ipdadmissions doesn't
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ipd_admissions')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ipdadmissions')
     AND NOT EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'ipdadmissions')
  THEN
    EXECUTE '
      CREATE VIEW ipdadmissions AS
      SELECT
        id,
        patient_id AS patientid,
        bed_id AS bedid,
        admission_date AS admissiondate,
        admitting_doctor AS admittingdoctor,
        status,
        created_at AS createdat,
        updated_at AS updatedat
      FROM ipd_admissions
    ';
    RAISE NOTICE 'Created ipdadmissions view alias for ipd_admissions table';
  END IF;

  -- If neither exists, create ipd_admissions from scratch
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ipd_admissions')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ipdadmissions')
  THEN
    EXECUTE '
      CREATE TABLE ipd_admissions (
        id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        patient_id              UUID REFERENCES patients(id) ON DELETE SET NULL,
        patient_name            TEXT NOT NULL DEFAULT '''',
        mrn                     TEXT NOT NULL DEFAULT '''',
        mobile                  TEXT,
        age                     INTEGER,
        gender                  TEXT,
        bed_id                  UUID REFERENCES beds(id) ON DELETE SET NULL,
        bed_number              TEXT,
        ward                    TEXT,
        admission_date          DATE NOT NULL DEFAULT CURRENT_DATE,
        admission_time          TEXT DEFAULT ''00:00'',
        admitting_doctor        TEXT NOT NULL DEFAULT '''',
        consulting_doctors      JSONB DEFAULT ''[]''::jsonb,
        diagnosis_on_admission  TEXT,
        chief_complaint         TEXT,
        diet_type               TEXT DEFAULT ''Normal'',
        allergies               TEXT,
        comorbidities           TEXT,
        insurance_details       TEXT,
        relative_name           TEXT,
        relative_contact        TEXT,
        relative_relation       TEXT,
        discharge_date          TIMESTAMPTZ,
        total_charges           NUMERIC(10,2) DEFAULT 0,
        discount                NUMERIC(10,2) DEFAULT 0,
        net_bill                NUMERIC(10,2) DEFAULT 0,
        bill_status             TEXT DEFAULT ''pending'',
        payment_mode            TEXT,
        status                  TEXT NOT NULL DEFAULT ''active''
                                  CHECK (status IN (''active'', ''discharged'', ''transferred'')),
        created_at              TIMESTAMPTZ DEFAULT NOW(),
        updated_at              TIMESTAMPTZ DEFAULT NOW()
      )
    ';
    EXECUTE 'ALTER TABLE ipd_admissions ENABLE ROW LEVEL SECURITY';
    EXECUTE '
      CREATE POLICY allow_auth_ipd_admissions ON ipd_admissions
        FOR ALL TO authenticated USING (true) WITH CHECK (true)
    ';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ipd_adm_patient ON ipd_admissions(patient_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ipd_adm_status ON ipd_admissions(status)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ipd_adm_bed ON ipd_admissions(bed_id)';
    RAISE NOTICE 'Created ipd_admissions table from scratch';
  END IF;
END $$;

-- Add doctorid column to ipd_admissions for earnings queries
ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS doctorid UUID;


-- ═══════════════════════════════════════════════════════════════
-- FIX #2: Storage bucket — add more allowed mime types
-- ═══════════════════════════════════════════════════════════════

-- Update the consultation-attachments bucket
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'application/octet-stream'
],
file_size_limit = 52428800
WHERE id = 'consultation-attachments';

-- Also create/update the consultation-files bucket (used in code)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'consultation-files',
  'consultation-files',
  false,
  52428800,
  ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/bmp',
    'image/heic',
    'image/heif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- RLS policies for consultation-files bucket
DROP POLICY IF EXISTS "auth can upload consultation-files" ON storage.objects;
DROP POLICY IF EXISTS "auth can read consultation-files" ON storage.objects;
DROP POLICY IF EXISTS "auth can delete consultation-files" ON storage.objects;
DROP POLICY IF EXISTS "auth can update consultation-files" ON storage.objects;

CREATE POLICY "auth can upload consultation-files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'consultation-files');

CREATE POLICY "auth can read consultation-files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'consultation-files');

CREATE POLICY "auth can delete consultation-files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'consultation-files');

CREATE POLICY "auth can update consultation-files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'consultation-files');


-- ═══════════════════════════════════════════════════════════════
-- FIX #3: Missing tables for appointments & reminders
-- ═══════════════════════════════════════════════════════════════

-- follow_ups table
CREATE TABLE IF NOT EXISTS follow_ups (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id              UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  created_from_visit_id   UUID REFERENCES encounters(id) ON DELETE SET NULL,
  recommended_date        DATE NOT NULL,
  status                  TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'fulfilled', 'cancelled', 'missed')),
  linked_appointment_id   UUID,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_follow_ups ON follow_ups;
CREATE POLICY allow_auth_follow_ups ON follow_ups
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_follow_ups_patient ON follow_ups(patient_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_status ON follow_ups(status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_date ON follow_ups(recommended_date);

-- reminder_log table
CREATE TABLE IF NOT EXISTS reminder_log (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id      UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_name    TEXT,
  mobile          TEXT,
  reminder_type   TEXT NOT NULL,
  source_table    TEXT,
  source_id       TEXT,
  message_preview TEXT,
  channel         TEXT DEFAULT 'whatsapp',
  status          TEXT DEFAULT 'sent',
  sent_at         TIMESTAMPTZ DEFAULT NOW(),
  sent_by         TEXT,
  batch_id        TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE reminder_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_reminder_log ON reminder_log;
CREATE POLICY allow_auth_reminder_log ON reminder_log
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_reminder_log_patient ON reminder_log(patient_id);
CREATE INDEX IF NOT EXISTS idx_reminder_log_sent ON reminder_log(sent_at);

-- Add missing columns to appointments
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS follow_up_id UUID;

-- Add missing columns to prescriptions for reminder tracking
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS patient_name TEXT;
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS mrn TEXT;
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS mobile TEXT;
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS follow_up_date DATE;
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS diagnosis TEXT;
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS lab_tests TEXT;
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;


-- ═══════════════════════════════════════════════════════════════
-- FIX #4: Doctor earnings — add share_pct + earning_model
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'clinic_users') THEN
    EXECUTE 'ALTER TABLE clinic_users ADD COLUMN IF NOT EXISTS share_pct NUMERIC(5,2) DEFAULT 40';
    EXECUTE 'ALTER TABLE clinic_users ADD COLUMN IF NOT EXISTS earning_model TEXT DEFAULT ''percentage''';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'clinicusers') THEN
    EXECUTE 'ALTER TABLE clinicusers ADD COLUMN IF NOT EXISTS share_pct NUMERIC(5,2) DEFAULT 40';
    EXECUTE 'ALTER TABLE clinicusers ADD COLUMN IF NOT EXISTS earning_model TEXT DEFAULT ''percentage''';
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- FIX #5: Daily Closing table
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS daily_closings (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  closing_date    DATE NOT NULL UNIQUE,
  total_opd       INTEGER DEFAULT 0,
  total_ipd       INTEGER DEFAULT 0,
  total_bills     INTEGER DEFAULT 0,
  cash_collected  NUMERIC(10,2) DEFAULT 0,
  upi_collected   NUMERIC(10,2) DEFAULT 0,
  card_collected  NUMERIC(10,2) DEFAULT 0,
  total_collected NUMERIC(10,2) DEFAULT 0,
  total_discount  NUMERIC(10,2) DEFAULT 0,
  total_pending   NUMERIC(10,2) DEFAULT 0,
  total_refunds   NUMERIC(10,2) DEFAULT 0,
  notes           TEXT,
  closed_by       TEXT,
  closed_at       TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE daily_closings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_daily_closings ON daily_closings;
CREATE POLICY allow_auth_daily_closings ON daily_closings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ═══════════════════════════════════════════════════════════════
-- FIX #6: Payment Transactions (partial payments + refunds)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS payment_transactions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bill_id         UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES patients(id) ON DELETE SET NULL,
  amount          NUMERIC(10,2) NOT NULL,
  payment_mode    TEXT NOT NULL CHECK (payment_mode IN ('cash', 'upi', 'card', 'cheque', 'insurance', 'advance', 'other')),
  transaction_type TEXT NOT NULL DEFAULT 'payment' CHECK (transaction_type IN ('payment', 'refund', 'advance', 'adjustment')),
  reference_no    TEXT,
  notes           TEXT,
  recorded_by     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_payment_transactions ON payment_transactions;
CREATE POLICY allow_auth_payment_transactions ON payment_transactions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_payment_txn_bill ON payment_transactions(bill_id);
CREATE INDEX IF NOT EXISTS idx_payment_txn_patient ON payment_transactions(patient_id);
CREATE INDEX IF NOT EXISTS idx_payment_txn_date ON payment_transactions(created_at);

-- Add refund tracking columns to bills
ALTER TABLE bills ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10,2) DEFAULT 0;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS refund_reason TEXT;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS refunded_by TEXT;


-- ═══════════════════════════════════════════════════════════════
-- FIX #7: Billing packages table
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS billing_packages (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  items       JSONB NOT NULL DEFAULT '[]',
  total       NUMERIC(10,2) DEFAULT 0,
  category    TEXT DEFAULT 'general',
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE billing_packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_billing_packages ON billing_packages;
CREATE POLICY allow_auth_billing_packages ON billing_packages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ═══════════════════════════════════════════════════════════════
-- FIX #8: OPD Queue — add date index for date filter
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'opd_queue') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_opd_queue_date ON opd_queue(queue_date)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_opd_queue_status ON opd_queue(status)';
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- FIX #9: IPD Nursing table (if missing)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ipd_nursing (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ipd_admission_id    UUID REFERENCES ipd_admissions(id) ON DELETE CASCADE,
  patient_id          UUID REFERENCES patients(id) ON DELETE CASCADE,
  entry_type          TEXT NOT NULL DEFAULT 'vital',
  recorded_time       TEXT,
  pulse               TEXT,
  bp_systolic         TEXT,
  bp_diastolic        TEXT,
  temperature         TEXT,
  spo2                TEXT,
  weight              TEXT,
  rr                  TEXT,
  vital_note          TEXT,
  io_type             TEXT,
  io_label            TEXT,
  io_amount_ml        INTEGER,
  medication_name     TEXT,
  medication_dose     TEXT,
  medication_route    TEXT,
  medication_given_by TEXT,
  nurse_name          TEXT,
  note_text           TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ipd_nursing ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_ipd_nursing ON ipd_nursing;
CREATE POLICY allow_auth_ipd_nursing ON ipd_nursing
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ipd_nursing_adm ON ipd_nursing(ipd_admission_id);


-- ═══════════════════════════════════════════════════════════════
-- FIX #10: Clinic settings table (both names)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS clinic_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE clinic_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_clinic_settings ON clinic_settings;
CREATE POLICY allow_auth_clinic_settings ON clinic_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ═══════════════════════════════════════════════════════════════
-- Done!
-- ═══════════════════════════════════════════════════════════════
SELECT 'v30 migration complete — all issues fixed' AS result;
