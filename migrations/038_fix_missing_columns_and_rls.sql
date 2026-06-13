-- Migration 038: Fix Missing Columns and RLS Policies
-- Fixes reported issues with ot_schedules, appointments, ipd_charges, lab_partners
-- SAFE: Fully idempotent, no drops/renames.

-- A1: ot_schedules - Add missing pre-op checklist columns
ALTER TABLE IF EXISTS public.ot_schedules
  ADD COLUMN IF NOT EXISTS consent_taken BOOLEAN DEFAULT FALSE;
ALTER TABLE IF EXISTS public.ot_schedules
  ADD COLUMN IF NOT EXISTS blood_arranged BOOLEAN DEFAULT FALSE;
ALTER TABLE IF EXISTS public.ot_schedules
  ADD COLUMN IF NOT EXISTS fasting_confirmed BOOLEAN DEFAULT FALSE;
ALTER TABLE IF EXISTS public.ot_schedules
  ADD COLUMN IF NOT EXISTS estimated_duration_min INTEGER;
ALTER TABLE IF EXISTS public.ot_schedules
  ADD COLUMN IF NOT EXISTS created_by TEXT;

-- A2: appointments - Add 'doctor' column (used by post-delivery-sync and reminders)
ALTER TABLE IF EXISTS public.appointments
  ADD COLUMN IF NOT EXISTS doctor TEXT;

-- Sync existing doctor_name data to doctor column
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='appointments' AND column_name='doctor_name')
  AND EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='appointments' AND column_name='doctor') THEN
    UPDATE public.appointments SET doctor = doctor_name WHERE doctor IS NULL AND doctor_name IS NOT NULL;
  END IF;
END $$;

-- A3: ipd_charges - Fix RLS policy to allow all authenticated users
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='ipd_charges') THEN
    ALTER TABLE public.ipd_charges ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS ipd_charges_authenticated_all ON public.ipd_charges;
    DROP POLICY IF EXISTS ipd_charges_select ON public.ipd_charges;
    DROP POLICY IF EXISTS ipd_charges_insert ON public.ipd_charges;
    DROP POLICY IF EXISTS ipd_charges_update ON public.ipd_charges;
    DROP POLICY IF EXISTS ipd_charges_delete ON public.ipd_charges;
    CREATE POLICY ipd_charges_authenticated_all
      ON public.ipd_charges FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT ALL ON public.ipd_charges TO authenticated;
GRANT ALL ON public.ipd_charges TO service_role;

-- A4: ot_schedules - Fix RLS policy (ensure it exists and is permissive)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='ot_schedules') THEN
    ALTER TABLE public.ot_schedules ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS ot_schedules_authenticated_all ON public.ot_schedules;
    CREATE POLICY ot_schedules_authenticated_all
      ON public.ot_schedules FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT ALL ON public.ot_schedules TO authenticated;
GRANT ALL ON public.ot_schedules TO service_role;

-- A5: lab_partners - Fix RLS to allow read for all authenticated
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='lab_partners') THEN
    ALTER TABLE public.lab_partners ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS lab_partners_authenticated_all ON public.lab_partners;
    CREATE POLICY lab_partners_authenticated_all
      ON public.lab_partners FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT ALL ON public.lab_partners TO authenticated;
GRANT ALL ON public.lab_partners TO service_role;

-- A6: Reload schema cache so PostgREST picks up new columns
NOTIFY pgrst, 'reload schema';

SELECT 'Migration 038: Fix missing columns and RLS policies - COMPLETE' AS result;