-- migrations/v01_validation_constraints.sql
--
-- Phase 1 - Validation & race-condition constraints (additive, idempotent,
-- schema-tolerant).
--
-- This version inspects information_schema before adding each constraint,
-- so it runs cleanly against either:
--   (a) the fix-all-permissions.sql schema (legacy, no doctor_id on
--       appointments, no surgery_date/ot_room on ot_schedules), or
--   (b) the live drift schema (no doctor_id on appointments, but
--       ot_schedules DOES have surgery_date/start_time/end_time/ot_room).
--
-- WHAT EACH SECTION DOES
--   1. Patient strict-identifier uniqueness: mobile / aadhaar_no / mrn.
--   2. Appointment slot uniqueness: (date, time) for non-cancelled rows
--      (matches the single-doctor-clinic model your appointments table
--      already implements: no doctor_id column exists).
--   3. Same-patient slot uniqueness: (date, time, patient_id) for non-
--      cancelled rows (defence-in-depth).
--   4. IPD bed single-occupancy.
--   5. IPD patient single-active-admission.
--   6. OT room non-overlap (only added if ot_schedules has the time/room
--      columns the app uses).
--
-- WHAT THIS DOES NOT TOUCH
--   - No data rewrites; no existing row is modified.
--   - No RLS changes (that is Phase 6).
--   - No triggers.
--
-- HOW TO ROLL BACK
--   See the ROLLBACK section at the bottom (commented).
--
-- HOW TO RUN
--   Paste the entire file into Supabase SQL editor and Run. Re-running is
--   safe. Sections that don't apply emit a NOTICE and skip.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: function to test whether a column exists.
-- (Created in a temporary scope; dropped at end. Idempotent CREATE OR REPLACE.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.col_exists(p_table TEXT, p_col TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = p_table
      AND column_name  = p_col
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. patients - strict-identifier uniqueness
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF pg_temp.col_exists('patients', 'mobile') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_patients_mobile_nonnull
      ON public.patients (mobile)
      WHERE mobile IS NOT NULL AND mobile <> '';
    RAISE NOTICE 'Created/verified uniq_patients_mobile_nonnull';
  ELSE
    RAISE NOTICE 'SKIP: patients.mobile column missing';
  END IF;

  IF pg_temp.col_exists('patients', 'aadhaar_no') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_patients_aadhaar_no_nonnull
      ON public.patients (aadhaar_no)
      WHERE aadhaar_no IS NOT NULL AND aadhaar_no <> '';
    RAISE NOTICE 'Created/verified uniq_patients_aadhaar_no_nonnull';
  ELSE
    RAISE NOTICE 'SKIP: patients.aadhaar_no column missing';
  END IF;

  IF pg_temp.col_exists('patients', 'mrn') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_patients_mrn_nonnull
      ON public.patients (mrn)
      WHERE mrn IS NOT NULL AND mrn <> '';
    RAISE NOTICE 'Created/verified uniq_patients_mrn_nonnull';
  ELSE
    RAISE NOTICE 'SKIP: patients.mrn column missing';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 + 3. appointments - slot uniqueness
--   Your appointments table has NO doctor_id column (single-doctor-clinic
--   model). The right constraint is "no two non-cancelled rows at the
--   same (date, time)".
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF pg_temp.col_exists('appointments', 'date')
     AND pg_temp.col_exists('appointments', 'time')
     AND pg_temp.col_exists('appointments', 'status') THEN

    -- (2) Clinic-wide slot uniqueness for non-cancelled rows.
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_appointments_slot_active
      ON public.appointments (date, time)
      WHERE status NOT IN ('cancelled', 'completed', 'no_show');
    RAISE NOTICE 'Created/verified uniq_appointments_slot_active';

    -- (3) Same-patient at same slot uniqueness (defence-in-depth).
    IF pg_temp.col_exists('appointments', 'patient_id') THEN
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_appointments_patient_slot_active
        ON public.appointments (patient_id, date, time)
        WHERE status NOT IN ('cancelled', 'completed', 'no_show')
          AND patient_id IS NOT NULL;
      RAISE NOTICE 'Created/verified uniq_appointments_patient_slot_active';
    END IF;

  ELSE
    RAISE NOTICE 'SKIP: appointments table missing required columns';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ipd_admissions - bed single-occupancy
--   Your live status default is 'admitted'; older records use 'active'.
--   We block both as "open" states.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF pg_temp.col_exists('ipd_admissions', 'bed_id')
     AND pg_temp.col_exists('ipd_admissions', 'status') THEN

    CREATE UNIQUE INDEX IF NOT EXISTS uniq_ipd_bed_active
      ON public.ipd_admissions (bed_id)
      WHERE status IN ('active', 'admitted')
        AND bed_id IS NOT NULL;
    RAISE NOTICE 'Created/verified uniq_ipd_bed_active';
  ELSE
    RAISE NOTICE 'SKIP: ipd_admissions table missing bed_id or status';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ipd_admissions - patient single-active-admission
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF pg_temp.col_exists('ipd_admissions', 'patient_id')
     AND pg_temp.col_exists('ipd_admissions', 'status') THEN

    CREATE UNIQUE INDEX IF NOT EXISTS uniq_ipd_patient_active
      ON public.ipd_admissions (patient_id)
      WHERE status IN ('active', 'admitted')
        AND patient_id IS NOT NULL;
    RAISE NOTICE 'Created/verified uniq_ipd_patient_active';
  ELSE
    RAISE NOTICE 'SKIP: ipd_admissions table missing patient_id or status';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ot_schedules - no overlapping bookings in the same OT room
--   Only applied if the live schema has surgery_date / start_time /
--   end_time / ot_room (your app code uses these names; the legacy SQL
--   file uses scheduled_date / scheduled_time which we do NOT touch).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF pg_temp.col_exists('ot_schedules', 'surgery_date')
     AND pg_temp.col_exists('ot_schedules', 'start_time')
     AND pg_temp.col_exists('ot_schedules', 'end_time')
     AND pg_temp.col_exists('ot_schedules', 'ot_room')
     AND pg_temp.col_exists('ot_schedules', 'status') THEN

    -- Required extension for EXCLUDE on equality + range.
    CREATE EXTENSION IF NOT EXISTS btree_gist;

    -- Drop any prior version of the constraint so re-runs are clean.
    ALTER TABLE public.ot_schedules
      DROP CONSTRAINT IF EXISTS ot_schedules_no_overlap_per_room;

    ALTER TABLE public.ot_schedules
      ADD CONSTRAINT ot_schedules_no_overlap_per_room
      EXCLUDE USING gist (
        ot_room      WITH =,
        surgery_date WITH =,
        tsrange(
          (surgery_date::text || ' ' || start_time)::timestamp,
          (surgery_date::text || ' ' || end_time)::timestamp,
          '[)'
        ) WITH &&
      )
      WHERE (status NOT IN ('cancelled', 'completed'));

    RAISE NOTICE 'Created/verified ot_schedules_no_overlap_per_room';
  ELSE
    RAISE NOTICE 'SKIP: ot_schedules missing surgery_date/start_time/end_time/ot_room/status';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- ROLLBACK (uncomment and run if you want to remove everything above)
-- ============================================================================
-- BEGIN;
--   DROP INDEX IF EXISTS public.uniq_patients_mobile_nonnull;
--   DROP INDEX IF EXISTS public.uniq_patients_aadhaar_no_nonnull;
--   DROP INDEX IF EXISTS public.uniq_patients_mrn_nonnull;
--   DROP INDEX IF EXISTS public.uniq_appointments_slot_active;
--   DROP INDEX IF EXISTS public.uniq_appointments_patient_slot_active;
--   DROP INDEX IF EXISTS public.uniq_ipd_bed_active;
--   DROP INDEX IF EXISTS public.uniq_ipd_patient_active;
--   ALTER TABLE public.ot_schedules DROP CONSTRAINT IF EXISTS ot_schedules_no_overlap_per_room;
-- COMMIT;