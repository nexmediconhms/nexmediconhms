-- ============================================================
-- NexMedicon HMS v9 — Appointments Table (replaces localStorage)
-- Run in Supabase → SQL Editor → New Query
-- Safe to run multiple times (IF NOT EXISTS everywhere)
-- ============================================================

-- ─── APPOINTMENTS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  patient_name    TEXT NOT NULL,          -- denormalized for fast display
  mrn             TEXT,                   -- denormalized
  mobile          TEXT,                   -- denormalized for WhatsApp reminders
  date            DATE NOT NULL,
  time            TEXT NOT NULL,          -- HH:MM format
  type            TEXT NOT NULL DEFAULT 'OPD Consultation',
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled','confirmed','completed','cancelled','no-show')),
  reminder_sent   BOOLEAN DEFAULT FALSE,
  created_by      UUID REFERENCES clinic_users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_appts_date     ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appts_patient  ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appts_status   ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appts_date_status ON appointments(date, status);

-- RLS
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read appointments
DROP POLICY IF EXISTS appts_read ON appointments;
CREATE POLICY appts_read ON appointments
  FOR SELECT TO authenticated USING (true);

-- All authenticated users can insert appointments
DROP POLICY IF EXISTS appts_insert ON appointments;
CREATE POLICY appts_insert ON appointments
  FOR INSERT TO authenticated WITH CHECK (true);

-- All authenticated users can update appointments (status changes, etc.)
DROP POLICY IF EXISTS appts_update ON appointments;
CREATE POLICY appts_update ON appointments
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Only admin can delete appointments
DROP POLICY IF EXISTS appts_delete ON appointments;
CREATE POLICY appts_delete ON appointments
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM clinic_users cu
      WHERE cu.auth_id = auth.uid() AND cu.role IN ('admin', 'doctor')
    )
  );

-- ─── MIGRATE EXISTING localStorage DATA ──────────────────────
-- If you have appointments in localStorage, you can export them
-- as JSON and insert them using the Supabase dashboard or API.
-- The app will automatically use the database going forward.

SELECT 'v9 appointments migration complete ✓' AS result;
