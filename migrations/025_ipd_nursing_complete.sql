-- ============================================================
-- Migration 025: Ensure ipd_nursing table has ALL columns
-- used by the application code (src/app/ipd/[bedId]/page.tsx
-- and src/app/ipd/page.tsx).
--
-- ROOT CAUSE: The ipd_nursing table was either:
--   1. Never created (migration 013 wasn't applied)
--   2. Created with an incomplete schema missing columns like
--      bed_id, vital_note, io_label, io_amount_ml, rr, weight
--
-- This migration is fully idempotent (safe to run multiple times).
-- ============================================================

-- Step 1: Create the table if it doesn't exist at all
CREATE TABLE IF NOT EXISTS public.ipd_nursing (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ipd_admission_id    UUID,
  bed_id              TEXT,
  patient_id          UUID,
  entry_type          TEXT DEFAULT 'note',
  recorded_time       TEXT,

  -- Vitals
  pulse               TEXT,
  bp_systolic         TEXT,
  bp_diastolic        TEXT,
  temperature         TEXT,
  spo2                TEXT,
  respiratory_rate    TEXT,
  rr                  TEXT,
  weight              TEXT,
  vital_note          TEXT,

  -- I/O
  io_type             TEXT,
  io_label            TEXT,
  io_amount           TEXT,
  io_amount_ml        NUMERIC,
  io_description      TEXT,

  -- Notes
  nurse_name          TEXT,
  note_text           TEXT,
  note_type           TEXT,

  -- Medications
  medication_name     TEXT,
  medication_dose     TEXT,
  medication_route    TEXT,
  medication_given_by TEXT,

  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2: Add any columns that might be missing if table already existed
-- (uses ADD COLUMN IF NOT EXISTS so it's safe to run repeatedly)
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS ipd_admission_id UUID;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS bed_id TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS patient_id UUID;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS entry_type TEXT DEFAULT 'note';
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS recorded_time TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS pulse TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS bp_systolic TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS bp_diastolic TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS temperature TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS spo2 TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS respiratory_rate TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS rr TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS weight TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS vital_note TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS io_type TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS io_label TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS io_amount TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS io_amount_ml NUMERIC;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS io_description TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS nurse_name TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS note_text TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS note_type TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS medication_name TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS medication_dose TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS medication_route TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS medication_given_by TEXT;
ALTER TABLE public.ipd_nursing ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Step 3: Enable RLS
ALTER TABLE public.ipd_nursing ENABLE ROW LEVEL SECURITY;

-- Step 4: Create RLS policy (allow all authenticated users)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ipd_nursing'
      AND policyname = 'ipd_nursing_authenticated_all'
  ) THEN
    CREATE POLICY ipd_nursing_authenticated_all ON public.ipd_nursing
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Step 5: Grant permissions
GRANT ALL ON public.ipd_nursing TO authenticated;
GRANT ALL ON public.ipd_nursing TO service_role;

-- Step 6: Reload PostgREST schema cache so new columns are immediately visible
NOTIFY pgrst, 'reload schema';

SELECT 'Migration 025: ipd_nursing table fully ensured with all required columns — COMPLETE' AS result;
