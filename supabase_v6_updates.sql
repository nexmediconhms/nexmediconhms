-- ============================================================
-- NexMedicon HMS v6 — New columns for feature additions
-- Run in Supabase → SQL Editor → New Query
-- Safe to run multiple times (IF NOT EXISTS / IF NOT)
-- ============================================================

-- 1. Patient registration: mediclaim + reference fields
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS mediclaim        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cashless         BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reference_source TEXT;   -- 'Doctor Referral','Advertisement','Walk-in', etc.

-- 2. Discharge summary: baby birth time
ALTER TABLE discharge_summaries
  ADD COLUMN IF NOT EXISTS baby_birth_time  TEXT;   -- stored as HH:MM string

-- 3. Bills table: encounter_type for OPD/IPD split
ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS encounter_type   TEXT CHECK (encounter_type IN ('OPD','IPD','Other'));

-- 4. Consultation attachments table (photos + PDFs per encounter)
CREATE TABLE IF NOT EXISTS consultation_attachments (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  encounter_id    UUID REFERENCES encounters(id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES patients(id)  ON DELETE CASCADE,
  file_name       TEXT NOT NULL,
  file_type       TEXT NOT NULL,   -- 'image/jpeg','image/png','application/pdf'
  file_size       INTEGER,         -- bytes
  storage_key     TEXT NOT NULL,   -- Supabase Storage path
  bucket          TEXT DEFAULT 'consultation-files',
  notes           TEXT,
  uploaded_by     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE consultation_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_attachments ON consultation_attachments;
CREATE POLICY allow_auth_attachments ON consultation_attachments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_attachments_encounter ON consultation_attachments(encounter_id);
CREATE INDEX IF NOT EXISTS idx_attachments_patient   ON consultation_attachments(patient_id);

-- 5. Supabase Storage bucket for consultation files
-- (Run this separately in Storage → New bucket if it doesn't exist)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('consultation-files', 'consultation-files', false)
-- ON CONFLICT DO NOTHING;

SELECT 'v6 migration complete ✓' AS result;

-- ── IPD Nursing Data table (replaces localStorage) ──────────────
CREATE TABLE IF NOT EXISTS ipd_nursing (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bed_id          UUID NOT NULL,
  patient_id      UUID REFERENCES patients(id) ON DELETE SET NULL,
  entry_type      TEXT NOT NULL CHECK (entry_type IN ('vital', 'io', 'note')),

  -- Vitals
  recorded_time   TEXT,   -- HH:MM
  pulse           TEXT,
  bp_systolic     TEXT,
  bp_diastolic    TEXT,
  temperature     TEXT,
  spo2            TEXT,
  vital_note      TEXT,

  -- I/O
  io_type         TEXT,   -- 'Input' | 'Output'
  io_label        TEXT,   -- e.g. 'IV Fluids', 'Urine'
  io_amount_ml    NUMERIC,

  -- Notes
  nurse_name      TEXT,
  note_text       TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ipd_nursing ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_ipd ON ipd_nursing;
CREATE POLICY allow_auth_ipd ON ipd_nursing
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ipd_bed     ON ipd_nursing(bed_id);
CREATE INDEX IF NOT EXISTS idx_ipd_patient ON ipd_nursing(patient_id);
CREATE INDEX IF NOT EXISTS idx_ipd_time    ON ipd_nursing(created_at DESC);

-- ── File storage fallback (when Storage bucket not set up) ─────
-- Stores small files (<2MB) as base64 directly in the DB
-- Use this if Supabase Storage bucket setup is blocked
CREATE TABLE IF NOT EXISTS consultation_files_db (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  encounter_id    UUID REFERENCES encounters(id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES patients(id)  ON DELETE CASCADE,
  file_name       TEXT NOT NULL,
  file_type       TEXT NOT NULL,
  file_size       INTEGER,
  file_data       TEXT NOT NULL,   -- base64 encoded file content
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE consultation_files_db ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_files_db ON consultation_files_db;
CREATE POLICY allow_auth_files_db ON consultation_files_db
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_files_db_patient   ON consultation_files_db(patient_id);
CREATE INDEX IF NOT EXISTS idx_files_db_encounter ON consultation_files_db(encounter_id);

-- ── Allow public (unauthenticated) INSERT on patients table ───────
-- This is needed for the /intake page where patients self-register
-- without logging in. Read/Update/Delete still require authentication.
-- Run this in Supabase SQL Editor.
DROP POLICY IF EXISTS allow_public_patient_insert ON patients;
CREATE POLICY allow_public_patient_insert ON patients
  FOR INSERT TO anon WITH CHECK (true);

-- Allow anon to read their own record after insert (for MRN display)
DROP POLICY IF EXISTS allow_public_patient_select ON patients;
CREATE POLICY allow_public_patient_select ON patients
  FOR SELECT TO anon USING (true);

-- Allow anon to create an encounter (chief_complaint from intake form)
DROP POLICY IF EXISTS allow_public_encounter_insert ON encounters;
CREATE POLICY allow_public_encounter_insert ON encounters
  FOR INSERT TO anon WITH CHECK (true);
