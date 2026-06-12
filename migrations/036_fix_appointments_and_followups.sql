-- ═══════════════════════════════════════════════════════════════════════
-- Migration 036: Fix Appointments Table & Create follow_ups Table
-- ═══════════════════════════════════════════════════════════════════════
-- 
-- PROBLEM: After reset-seed deleted all data, the appointments table
-- may only have the old v00-schema-master columns (patientid, patientname,
-- remindersent, etc.) but the application code expects snake_case columns
-- (patient_id, patient_name, reminder_sent, source, follow_up_id, etc.)
--
-- Additionally, the follow_ups table was never created in any migration
-- but is required by appointmentService.ts for follow-up tracking.
--
-- SAFE TO RE-RUN: fully idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- ═══════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- §1  APPOINTMENTS TABLE — Ensure all required columns exist
-- ─────────────────────────────────────────────────────────────────────────────

-- Create table if it doesn't exist at all (unlikely but defensive)
CREATE TABLE IF NOT EXISTS appointments (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id      UUID,
  patient_name    TEXT,
  mrn             TEXT,
  mobile          TEXT,
  date            DATE NOT NULL DEFAULT CURRENT_DATE,
  time            TEXT NOT NULL DEFAULT '10:00',
  type            TEXT,
  notes           TEXT,
  status          TEXT DEFAULT 'scheduled',
  reminder_sent   BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Add all columns the application code expects (safe if they already exist)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS patient_id       UUID;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS patient_name     TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS mrn              TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS mobile           TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS date             DATE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS time             TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS type             TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS notes            TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS status           TEXT DEFAULT 'scheduled';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent    BOOLEAN DEFAULT FALSE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS created_at       TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS source           TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS follow_up_id     UUID;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS doctor_id        UUID;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS doctor_name      TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS video_link       TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS visit_status     TEXT DEFAULT 'scheduled';

-- Also ensure old-style columns exist for backward compatibility (convergence)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS patientid        UUID;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS patientname      TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS remindersent     BOOLEAN DEFAULT FALSE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS createdat        TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updatedat        TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS videolink        TEXT;

-- Sync data between dual columns (if one has data and the other doesn't)
UPDATE appointments SET patient_id = patientid WHERE patient_id IS NULL AND patientid IS NOT NULL;
UPDATE appointments SET patientid = patient_id WHERE patientid IS NULL AND patient_id IS NOT NULL;
UPDATE appointments SET patient_name = patientname WHERE patient_name IS NULL AND patientname IS NOT NULL;
UPDATE appointments SET patientname = patient_name WHERE patientname IS NULL AND patient_name IS NOT NULL;
UPDATE appointments SET reminder_sent = remindersent WHERE reminder_sent IS NULL AND remindersent IS NOT NULL;
UPDATE appointments SET remindersent = reminder_sent WHERE remindersent IS NULL AND reminder_sent IS NOT NULL;
UPDATE appointments SET created_at = createdat WHERE created_at IS NULL AND createdat IS NOT NULL;
UPDATE appointments SET createdat = created_at WHERE createdat IS NULL AND created_at IS NOT NULL;
UPDATE appointments SET updated_at = updatedat WHERE updated_at IS NULL AND updatedat IS NOT NULL;
UPDATE appointments SET updatedat = updated_at WHERE updatedat IS NULL AND updated_at IS NOT NULL;
UPDATE appointments SET video_link = videolink WHERE video_link IS NULL AND videolink IS NOT NULL;
UPDATE appointments SET videolink = video_link WHERE videolink IS NULL AND video_link IS NOT NULL;

-- Create sync trigger for patient_id <-> patientid
CREATE OR REPLACE FUNCTION fn_sync_appointments_patient_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.patient_id IS NULL AND NEW.patientid IS NOT NULL THEN
    NEW.patient_id := NEW.patientid;
  ELSIF NEW.patientid IS NULL AND NEW.patient_id IS NOT NULL THEN
    NEW.patientid := NEW.patient_id;
  END IF;
  IF NEW.patient_name IS NULL AND NEW.patientname IS NOT NULL THEN
    NEW.patient_name := NEW.patientname;
  ELSIF NEW.patientname IS NULL AND NEW.patient_name IS NOT NULL THEN
    NEW.patientname := NEW.patient_name;
  END IF;
  IF NEW.reminder_sent IS NULL AND NEW.remindersent IS NOT NULL THEN
    NEW.reminder_sent := NEW.remindersent;
  ELSIF NEW.remindersent IS NULL AND NEW.reminder_sent IS NOT NULL THEN
    NEW.remindersent := NEW.reminder_sent;
  END IF;
  IF NEW.created_at IS NULL AND NEW.createdat IS NOT NULL THEN
    NEW.created_at := NEW.createdat;
  ELSIF NEW.createdat IS NULL AND NEW.created_at IS NOT NULL THEN
    NEW.createdat := NEW.created_at;
  END IF;
  IF NEW.updated_at IS NULL AND NEW.updatedat IS NOT NULL THEN
    NEW.updated_at := NEW.updatedat;
  ELSIF NEW.updatedat IS NULL AND NEW.updated_at IS NOT NULL THEN
    NEW.updatedat := NEW.updated_at;
  END IF;
  IF NEW.video_link IS NULL AND NEW.videolink IS NOT NULL THEN
    NEW.video_link := NEW.videolink;
  ELSIF NEW.videolink IS NULL AND NEW.video_link IS NOT NULL THEN
    NEW.videolink := NEW.video_link;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_appointments_columns ON appointments;
CREATE TRIGGER trg_sync_appointments_columns
  BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_appointments_patient_id();

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_appointments_patient_id ON appointments (patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments (date);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments (status);
CREATE INDEX IF NOT EXISTS idx_appointments_type ON appointments (type);
CREATE INDEX IF NOT EXISTS idx_appointments_date_status ON appointments (date, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- §2  FOLLOW_UPS TABLE — Required by appointmentService.ts
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS follow_ups (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id              UUID NOT NULL,
  created_from_visit_id   UUID,
  recommended_date        DATE NOT NULL,
  status                  TEXT DEFAULT 'pending',
  linked_appointment_id   UUID,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Add columns individually in case table exists with partial schema
ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS patient_id            UUID;
ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS created_from_visit_id UUID;
ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS recommended_date      DATE;
ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS status                TEXT DEFAULT 'pending';
ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS linked_appointment_id UUID;
ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS created_at            TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS updated_at            TIMESTAMPTZ DEFAULT NOW();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_follow_ups_patient_id ON follow_ups (patient_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_status ON follow_ups (status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_recommended_date ON follow_ups (recommended_date);
CREATE INDEX IF NOT EXISTS idx_follow_ups_visit_id ON follow_ups (created_from_visit_id);

-- Unique index: only one pending follow-up per encounter
CREATE UNIQUE INDEX IF NOT EXISTS uniq_follow_ups_pending_per_encounter
  ON follow_ups (patient_id, created_from_visit_id)
  WHERE status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- §3  RLS POLICIES — Ensure authenticated users can access both tables
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;

-- Appointments RLS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'appointments' AND policyname = 'appointments_authenticated_all'
  ) THEN
    CREATE POLICY appointments_authenticated_all 
      ON public.appointments FOR ALL TO authenticated 
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Follow-ups RLS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'follow_ups' AND policyname = 'follow_ups_authenticated_all'
  ) THEN
    CREATE POLICY follow_ups_authenticated_all 
      ON public.follow_ups FOR ALL TO authenticated 
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Grant access
GRANT ALL ON public.appointments TO authenticated;
GRANT ALL ON public.appointments TO service_role;
GRANT ALL ON public.follow_ups TO authenticated;
GRANT ALL ON public.follow_ups TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- §4  RELOAD SCHEMA CACHE
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
