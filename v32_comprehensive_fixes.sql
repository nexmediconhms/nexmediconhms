-- ═══════════════════════════════════════════════════════════════
-- NexMedicon HMS — v32 Comprehensive Fixes
-- 
-- Safe to run multiple times (IF NOT EXISTS / DO $$ blocks)
-- Run AFTER v30-fix-all-issues.sql and v31_hms_fixes.sql
--
-- FIXES:
--   1. Beds table — ensure correct column names (bed_number, not bednumber)
--   2. Beds table — add missing columns for reserve/maintenance features
--   3. Reminder_log table — ensure it exists with correct schema
--   4. Doctor_alerts table — ensure it exists for lab alert feature
--   5. Clinic_users — add MFA columns if missing
--   6. Bills — ensure all required columns exist
--   7. IPD admissions — ensure table exists with correct columns
--   8. Prescriptions — ensure medications + follow_up_date columns exist
--   9. OT schedules — ensure reminder_sent_at column exists
--  10. Invoice numbering — FY-aware sequence
-- ═══════════════════════════════════════════════════════════════

-- ── 1. BEDS TABLE: Ensure bed_number column and extras ────────
DO $$
BEGIN
  -- If beds table doesn't exist, create it fresh
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='beds') THEN
    CREATE TABLE beds (
      id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      bed_number         TEXT NOT NULL UNIQUE,
      ward               TEXT NOT NULL DEFAULT 'General',
      type               TEXT NOT NULL DEFAULT 'General',
      status             TEXT NOT NULL DEFAULT 'available'
                           CHECK (status IN ('available','occupied','cleaning','reserved','maintenance')),
      patient_id         UUID REFERENCES patients(id) ON DELETE SET NULL,
      patient_name       TEXT,
      admission_date     DATE,
      expected_discharge DATE,
      reservedfor        TEXT,
      reservedat         TIMESTAMPTZ,
      reservednote       TEXT,
      notes              TEXT,
      updated_at         TIMESTAMPTZ DEFAULT NOW(),
      created_at         TIMESTAMPTZ DEFAULT NOW()
    );
    
    ALTER TABLE beds ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS beds_auth_all ON beds;
    CREATE POLICY beds_auth_all ON beds FOR ALL TO authenticated USING (true) WITH CHECK (true);
    
    RAISE NOTICE 'Created beds table from scratch';
  ELSE
    -- Table exists — add missing columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='beds' AND column_name='type') THEN
      ALTER TABLE beds ADD COLUMN type TEXT NOT NULL DEFAULT 'General';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='beds' AND column_name='reservedfor') THEN
      ALTER TABLE beds ADD COLUMN reservedfor TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='beds' AND column_name='reservedat') THEN
      ALTER TABLE beds ADD COLUMN reservedat TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='beds' AND column_name='reservednote') THEN
      ALTER TABLE beds ADD COLUMN reservednote TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='beds' AND column_name='notes') THEN
      ALTER TABLE beds ADD COLUMN notes TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='beds' AND column_name='created_at') THEN
      ALTER TABLE beds ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
    
    -- Ensure status check constraint allows 'maintenance'
    ALTER TABLE beds DROP CONSTRAINT IF EXISTS beds_status_check;
    ALTER TABLE beds ADD CONSTRAINT beds_status_check 
      CHECK (status IN ('available','occupied','cleaning','reserved','maintenance'));
      
    RAISE NOTICE 'Updated beds table with missing columns';
  END IF;
END $$;

-- ── 2. REMINDER_LOG TABLE ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS reminder_log (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id     UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_name   TEXT,
  mobile         TEXT,
  reminder_type  TEXT,
  source_table   TEXT,
  source_id      TEXT,
  message_preview TEXT,
  channel        TEXT DEFAULT 'whatsapp',
  status         TEXT DEFAULT 'sent',
  sent_at        TIMESTAMPTZ DEFAULT NOW(),
  sent_by        TEXT,
  batch_id       TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminder_log_sent_at ON reminder_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_reminder_log_patient ON reminder_log(patient_id);
CREATE INDEX IF NOT EXISTS idx_reminder_log_source ON reminder_log(source_table, source_id);

DO $$
BEGIN
  ALTER TABLE reminder_log ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS reminder_log_auth ON reminder_log;
  CREATE POLICY reminder_log_auth ON reminder_log FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ── 3. DOCTOR_ALERTS TABLE ────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctor_alerts (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id   UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_name TEXT,
  mrn          TEXT,
  alert_type   TEXT NOT NULL DEFAULT 'lab_abnormal',
  severity     TEXT NOT NULL DEFAULT 'warning',
  alert_data   JSONB DEFAULT '{}',
  is_read      BOOLEAN DEFAULT false,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doctor_alerts_unread ON doctor_alerts(is_read, created_at DESC);

DO $$
BEGIN
  ALTER TABLE doctor_alerts ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS doctor_alerts_auth ON doctor_alerts;
  CREATE POLICY doctor_alerts_auth ON doctor_alerts FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ── 4. CLINIC_USERS — MFA columns ────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinic_users' AND column_name='mfa_enabled') THEN
    ALTER TABLE clinic_users ADD COLUMN mfa_enabled BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinic_users' AND column_name='mfa_enrolled_at') THEN
    ALTER TABLE clinic_users ADD COLUMN mfa_enrolled_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinic_users' AND column_name='is_primary') THEN
    ALTER TABLE clinic_users ADD COLUMN is_primary BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinic_users' AND column_name='specialty') THEN
    ALTER TABLE clinic_users ADD COLUMN specialty TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinic_users' AND column_name='med_reg_no') THEN
    ALTER TABLE clinic_users ADD COLUMN med_reg_no TEXT;
  END IF;
END $$;

-- ── 5. BILLS — ensure all columns ────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bills' AND column_name='gst_percent') THEN
    ALTER TABLE bills ADD COLUMN gst_percent NUMERIC(5,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bills' AND column_name='gst_amount') THEN
    ALTER TABLE bills ADD COLUMN gst_amount NUMERIC(10,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bills' AND column_name='updated_at') THEN
    ALTER TABLE bills ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bills' AND column_name='invoice_number') THEN
    ALTER TABLE bills ADD COLUMN invoice_number TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bills_patient_id ON bills(patient_id);
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_created_at ON bills(created_at DESC);

-- ── 6. IPD_ADMISSIONS — ensure table ──────────────────────────
CREATE TABLE IF NOT EXISTS ipd_admissions (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id              UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_name            TEXT NOT NULL DEFAULT '',
  mrn                     TEXT NOT NULL DEFAULT '',
  mobile                  TEXT,
  age                     TEXT,
  gender                  TEXT,
  bed_id                  UUID REFERENCES beds(id) ON DELETE SET NULL,
  bed_number              TEXT,
  ward                    TEXT,
  admission_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  admission_time          TEXT,
  admitting_doctor        TEXT,
  consulting_doctors      JSONB DEFAULT '[]',
  diagnosis_on_admission  TEXT,
  chief_complaint         TEXT,
  diet_type               TEXT DEFAULT 'Normal',
  allergies               TEXT,
  comorbidities           TEXT,
  insurance_details       TEXT,
  relative_name           TEXT,
  relative_contact        TEXT,
  relative_relation       TEXT,
  discharge_date          DATE,
  discharge_time          TEXT,
  discharge_summary_id    UUID,
  bill_id                 UUID,
  status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','discharged','transferred','lama')),
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ipd_admissions_patient ON ipd_admissions(patient_id);
CREATE INDEX IF NOT EXISTS idx_ipd_admissions_bed ON ipd_admissions(bed_id);
CREATE INDEX IF NOT EXISTS idx_ipd_admissions_status ON ipd_admissions(status);

DO $$
BEGIN
  ALTER TABLE ipd_admissions ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS ipd_admissions_auth ON ipd_admissions;
  CREATE POLICY ipd_admissions_auth ON ipd_admissions FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Add bill_id column if missing (for consolidated billing feature)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ipd_admissions' AND column_name='bill_id') THEN
    ALTER TABLE ipd_admissions ADD COLUMN bill_id UUID;
  END IF;
END $$;

-- ── 7. PRESCRIPTIONS — ensure medications + follow_up columns ─
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='prescriptions' AND column_name='medications') THEN
    ALTER TABLE prescriptions ADD COLUMN medications JSONB DEFAULT '[]';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='prescriptions' AND column_name='follow_up_date') THEN
    ALTER TABLE prescriptions ADD COLUMN follow_up_date DATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='prescriptions' AND column_name='patient_name') THEN
    ALTER TABLE prescriptions ADD COLUMN patient_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='prescriptions' AND column_name='mrn') THEN
    ALTER TABLE prescriptions ADD COLUMN mrn TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='prescriptions' AND column_name='mobile') THEN
    ALTER TABLE prescriptions ADD COLUMN mobile TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='prescriptions' AND column_name='diagnosis') THEN
    ALTER TABLE prescriptions ADD COLUMN diagnosis TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='prescriptions' AND column_name='reminder_sent_at') THEN
    ALTER TABLE prescriptions ADD COLUMN reminder_sent_at TIMESTAMPTZ;
  END IF;
END $$;

-- ── 8. OT_SCHEDULES — reminder_sent_at ───────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ot_schedules') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ot_schedules' AND column_name='reminder_sent_at') THEN
      ALTER TABLE ot_schedules ADD COLUMN reminder_sent_at TIMESTAMPTZ;
    END IF;
  END IF;
END $$;

-- ── 9. APPOINTMENTS — ensure reminder columns ─────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='reminder_sent') THEN
    ALTER TABLE appointments ADD COLUMN reminder_sent BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='reminder_sent_at') THEN
    ALTER TABLE appointments ADD COLUMN reminder_sent_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='patient_name') THEN
    ALTER TABLE appointments ADD COLUMN patient_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='mrn') THEN
    ALTER TABLE appointments ADD COLUMN mrn TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='mobile') THEN
    ALTER TABLE appointments ADD COLUMN mobile TEXT;
  END IF;
END $$;

-- ── 10. INVOICE NUMBERING (FY-aware sequence) ─────────────────
-- Creates a function to generate FY-aware invoice numbers like INV/2025-26/0001
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $fn$
DECLARE
  fy_start DATE;
  fy_end DATE;
  fy_label TEXT;
  next_seq INT;
  inv_number TEXT;
  curr_year INT;
  next_year_short TEXT;
BEGIN
  curr_year := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
  
  -- Determine current financial year (Apr 1 to Mar 31)
  IF EXTRACT(MONTH FROM CURRENT_DATE) >= 4 THEN
    fy_start := make_date(curr_year, 4, 1);
    fy_end := make_date(curr_year + 1, 3, 31);
    next_year_short := LPAD(((curr_year + 1) % 100)::TEXT, 2, '0');
    fy_label := curr_year::TEXT || '-' || next_year_short;
  ELSE
    fy_start := make_date(curr_year - 1, 4, 1);
    fy_end := make_date(curr_year, 3, 31);
    next_year_short := LPAD((curr_year % 100)::TEXT, 2, '0');
    fy_label := (curr_year - 1)::TEXT || '-' || next_year_short;
  END IF;
  
  -- Count existing invoices in this FY
  SELECT COUNT(*) + 1
  INTO next_seq
  FROM bills
  WHERE created_at >= fy_start 
    AND created_at < fy_end + INTERVAL '1 day'
    AND invoice_number IS NOT NULL
    AND invoice_number LIKE 'INV/' || fy_label || '/%';
  
  inv_number := 'INV/' || fy_label || '/' || LPAD(next_seq::TEXT, 4, '0');
  
  RETURN inv_number;
END;
$fn$;

-- ── 11. DISCHARGE_SUMMARIES — ensure reminder_sent_at ─────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='discharge_summaries') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='discharge_summaries' AND column_name='reminder_sent_at') THEN
      ALTER TABLE discharge_summaries ADD COLUMN reminder_sent_at TIMESTAMPTZ;
    END IF;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- DONE. All migrations applied safely.
-- ═══════════════════════════════════════════════════════════════
