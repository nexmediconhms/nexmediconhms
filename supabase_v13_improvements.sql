-- ══════════════════════════════════════════════════════════════════
-- NexMedicon HMS — v13 Schema Migration
-- Comprehensive feature improvements
-- ══════════════════════════════════════════════════════════════════

-- ─── 1. Lab Uploads table (Lab Partner Dashboard) ─────────────
CREATE TABLE IF NOT EXISTS lab_uploads (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id    UUID REFERENCES patients(id),
  patient_name  TEXT NOT NULL DEFAULT '',
  mrn           TEXT NOT NULL DEFAULT '',
  lab_partner_name TEXT NOT NULL DEFAULT 'External Lab',
  file_url      TEXT NOT NULL DEFAULT '',
  file_name     TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'uploaded'
                CHECK (status IN ('uploaded', 'processing', 'processed', 'error')),
  extracted_values JSONB,
  abnormal_values TEXT[] DEFAULT '{}',
  notification_sent BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lab_uploads_patient ON lab_uploads(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_uploads_status ON lab_uploads(status);
CREATE INDEX IF NOT EXISTS idx_lab_uploads_created ON lab_uploads(created_at DESC);

-- ─── 2. Doctor Alerts table (Abnormal value alerts) ──────────
CREATE TABLE IF NOT EXISTS doctor_alerts (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id    UUID REFERENCES patients(id),
  patient_name  TEXT NOT NULL DEFAULT '',
  mrn           TEXT NOT NULL DEFAULT '',
  alert_type    TEXT NOT NULL DEFAULT 'general',
  alert_data    JSONB,
  is_read       BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doctor_alerts_unread ON doctor_alerts(is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_doctor_alerts_created ON doctor_alerts(created_at DESC);

-- ─── 3. IPD Files table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS ipd_files (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ipd_admission_id  UUID REFERENCES ipd_admissions(id) ON DELETE CASCADE,
  file_url          TEXT NOT NULL DEFAULT '',
  file_name         TEXT NOT NULL DEFAULT '',
  file_type         TEXT NOT NULL DEFAULT 'image'
                    CHECK (file_type IN ('image', 'pdf', 'document')),
  description       TEXT DEFAULT '',
  uploaded_by       TEXT DEFAULT 'staff',
  ocr_data          JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ipd_files_admission ON ipd_files(ipd_admission_id);

-- ─── 4. Bill modification audit — add updated_at to bills ────
ALTER TABLE bills ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- ─── 5. Insurance claims — add CA share tracking ─────────────
ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS shared_with_ca BOOLEAN DEFAULT FALSE;
ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS ca_shared_at TIMESTAMPTZ;
ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS ca_notes TEXT;

-- ─── 6. Lab partners table ──────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_partners (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name          TEXT NOT NULL,
  contact_name  TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  commission_percent NUMERIC(5,2) DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 7. Ensure reminder_log exists (for reminder sync) ──────
CREATE TABLE IF NOT EXISTS reminder_log (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id    UUID,
  patient_name  TEXT,
  mobile        TEXT,
  reminder_type TEXT,
  source_table  TEXT,
  source_id     TEXT,
  message_preview TEXT,
  channel       TEXT DEFAULT 'whatsapp',
  status        TEXT DEFAULT 'sent',
  sent_at       TIMESTAMPTZ,
  sent_by       TEXT,
  batch_id      TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminder_log_sent ON reminder_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_reminder_log_patient ON reminder_log(patient_id);

-- ─── 8. OT Schedules — add appointment link ─────────────────
ALTER TABLE ot_schedules ADD COLUMN IF NOT EXISTS appointment_id UUID;
ALTER TABLE ot_schedules ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE ot_schedules ADD COLUMN IF NOT EXISTS mobile TEXT;

-- ─── 9. Appointments — ensure reminder_sent_at column exists ─
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

-- ─── 10. RLS Policies ────────────────────────────────────────
-- lab_uploads: authenticated users can read/write
ALTER TABLE lab_uploads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_uploads_rls ON lab_uploads;
CREATE POLICY lab_uploads_rls ON lab_uploads FOR ALL USING (true) WITH CHECK (true);

-- doctor_alerts: authenticated users can read/write
ALTER TABLE doctor_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doctor_alerts_rls ON doctor_alerts;
CREATE POLICY doctor_alerts_rls ON doctor_alerts FOR ALL USING (true) WITH CHECK (true);

-- ipd_files: authenticated users can read/write
ALTER TABLE ipd_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ipd_files_rls ON ipd_files;
CREATE POLICY ipd_files_rls ON ipd_files FOR ALL USING (true) WITH CHECK (true);

-- lab_partners: authenticated users can read/write
ALTER TABLE lab_partners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_partners_rls ON lab_partners;
CREATE POLICY lab_partners_rls ON lab_partners FOR ALL USING (true) WITH CHECK (true);

-- ─── 11. Supabase Realtime — enable for new tables ──────────
-- Run in Supabase Dashboard → Database → Replication:
-- Toggle ON: lab_uploads, doctor_alerts, ipd_files, opd_queue

-- ─── 12. Storage bucket for documents (if not exists) ────────
-- Run via Supabase Dashboard → Storage:
-- Create bucket "documents" with public access

-- Done! Run this script in Supabase SQL Editor.
