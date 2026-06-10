-- ═══════════════════════════════════════════════════════════════════════
-- MEDICATION ADMINISTRATION RECORD (MAR) TABLE
-- For Indian Gynaecologist IPD
-- ═══════════════════════════════════════════════════════════════════════
-- Run in Supabase SQL Editor. Safe to run multiple times.
--
-- Tracks when each prescribed dose was actually given, by whom.
-- Critical for medico-legal documentation and nursing accountability.

CREATE TABLE IF NOT EXISTS public.medication_administrations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ipd_admission_id    UUID,
  patient_id          UUID,
  prescription_id     UUID,

  -- Medication details (denormalized for fast reads)
  drug_name           TEXT NOT NULL,
  dose                TEXT,
  route               TEXT,           -- Oral / IV / IM / SC / Topical / PR / Nebulization / Eye / Ear
  frequency           TEXT,           -- OD / BD / TDS / QID / SOS / Stat / HS / Q4H / Q6H / Q8H

  -- Administration
  scheduled_date      DATE NOT NULL,
  scheduled_time      TEXT,           -- HH:MM (24hr)
  status              TEXT NOT NULL DEFAULT 'scheduled',
                                      -- scheduled / given / missed / held / refused / discontinued
  administered_at     TIMESTAMPTZ,
  administered_by     TEXT,           -- Nurse name
  administered_dose   TEXT,           -- Actual dose given (may differ from prescribed)
  administered_route  TEXT,           -- Actual route (may differ)

  -- Reason for non-administration
  reason_not_given    TEXT,           -- Required if status = missed/held/refused
  hold_order_by       TEXT,           -- Doctor who ordered hold

  -- Vitals at time of administration (for critical drugs)
  vitals_before       JSONB,          -- { bp, pulse, temp, spo2 }

  -- Notes
  notes               TEXT,
  site                TEXT,           -- Injection site: left arm, right deltoid, etc.

  -- Metadata
  created_by          TEXT,
  updated_by          TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.medication_administrations ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'medication_administrations' AND policyname = 'medication_admin_auth') THEN
    CREATE POLICY medication_admin_auth ON public.medication_administrations FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_med_admin_admission ON public.medication_administrations (ipd_admission_id);
CREATE INDEX IF NOT EXISTS idx_med_admin_patient ON public.medication_administrations (patient_id);
CREATE INDEX IF NOT EXISTS idx_med_admin_date ON public.medication_administrations (scheduled_date);
CREATE INDEX IF NOT EXISTS idx_med_admin_status ON public.medication_administrations (status);
