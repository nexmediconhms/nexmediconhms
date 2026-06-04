-- ════════════════════════════════════════════════════════════════════
-- 04_validation_constraints.sql
--
-- FRESH-INSTALL STEP 5 of 7 — Validation, race-prevention, and the
-- new Aadhaar HMAC dedup column.
--
-- Adds:
--   §1 Patient strict-identifier uniqueness (mobile / mrn / aadhaar_hmac)
--   §2 Appointment slot uniqueness (date + time, non-cancelled)
--   §3 Same-patient slot uniqueness (defence in depth)
--   §4 IPD bed single-occupancy, patient single-active-admission
--   §5 OT room non-overlap (EXCLUDE constraint)
--   §6 OPD queue: one active entry per patient per day (was migration 014)
--   §7 OPD queue: unique token per (queue_date, token_number)
--   §8 patients.aadhaar_hmac column (deterministic HMAC for dedup
--      WITHOUT exposing plaintext — see /api/patients/create route)
--
-- Re-runnable safely (CREATE INDEX IF NOT EXISTS, ADD COLUMN IF NOT
-- EXISTS, DO $$ guarded ALTER TABLE).
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- §0  Helper to test column existence (transient, drops at txn end)
-- ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION pg_temp.col_exists(p_table TEXT, p_col TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = p_table
      AND column_name  = p_col
  );
$$;

-- ────────────────────────────────────────────────────────────────────
-- §1  PATIENTS — strict-identifier uniqueness
-- ────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF pg_temp.col_exists('patients', 'mobile') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_patients_mobile_nonnull
      ON public.patients (mobile)
      WHERE mobile IS NOT NULL AND mobile <> '';
  END IF;

  IF pg_temp.col_exists('patients', 'mrn') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_patients_mrn_nonnull
      ON public.patients (mrn)
      WHERE mrn IS NOT NULL AND mrn <> '';
  END IF;

  -- aadhaar_no remains unique IF non-null (legacy support — fresh installs
  -- never store plaintext aadhaar_no, so this index is empty and harmless)
  IF pg_temp.col_exists('patients', 'aadhaar_no') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_patients_aadhaar_no_nonnull
      ON public.patients (aadhaar_no)
      WHERE aadhaar_no IS NOT NULL AND aadhaar_no <> '';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- §8  AADHAAR HMAC for race-free dedup WITHOUT exposing plaintext
-- ────────────────────────────────────────────────────────────────────
-- Why: we encrypt aadhaar_no with a random IV per row, so two rows for
-- the same Aadhaar have DIFFERENT ciphertexts. To detect duplicates,
-- we need a deterministic key derived from a server secret.
--
-- The application computes:
--   hmac = HEX( HMAC-SHA-256(HOSPITAL_AADHAAR_HMAC_KEY, aadhaar_12_digits) )
--
-- This is stored in patients.aadhaar_hmac and uniquely indexed. Two
-- inserts of the same Aadhaar collide on the unique index, even with
-- the encrypted ciphertext differing.
--
-- The HMAC key MUST be different from the AES encryption key. Both are
-- env vars on the server; neither is ever sent to the client.
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE patients ADD COLUMN IF NOT EXISTS aadhaar_hmac TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_patients_aadhaar_hmac_nonnull
  ON public.patients (aadhaar_hmac)
  WHERE aadhaar_hmac IS NOT NULL AND aadhaar_hmac <> '';

COMMENT ON COLUMN patients.aadhaar_hmac IS
  'HEX(HMAC-SHA-256(HOSPITAL_AADHAAR_HMAC_KEY, aadhaar_digits)). Deterministic, '
  'so duplicate Aadhaar entries collide on the unique index. Plaintext Aadhaar '
  'is never stored. Computed server-side in /api/patients/create.';

-- ────────────────────────────────────────────────────────────────────
-- §2 + §3  APPOINTMENTS — slot uniqueness
-- ────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF pg_temp.col_exists('appointments', 'date')
     AND pg_temp.col_exists('appointments', 'time')
     AND pg_temp.col_exists('appointments', 'status') THEN

    -- Clinic-wide slot uniqueness (single-doctor model)
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_appointments_slot_active
      ON public.appointments (date, time)
      WHERE status NOT IN ('cancelled', 'completed', 'no_show');

    -- Same-patient at same slot uniqueness (defence in depth)
    IF pg_temp.col_exists('appointments', 'patient_id') THEN
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_appointments_patient_slot_active
        ON public.appointments (patient_id, date, time)
        WHERE status NOT IN ('cancelled', 'completed', 'no_show')
          AND patient_id IS NOT NULL;
    END IF;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- §4  IPD ADMISSIONS — bed single-occupancy + patient single-admission
-- ────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF pg_temp.col_exists('ipd_admissions', 'bed_id')
     AND pg_temp.col_exists('ipd_admissions', 'status') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_ipd_bed_active
      ON public.ipd_admissions (bed_id)
      WHERE status IN ('active','admitted')
        AND bed_id IS NOT NULL;
  END IF;

  IF pg_temp.col_exists('ipd_admissions', 'patient_id')
     AND pg_temp.col_exists('ipd_admissions', 'status') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_ipd_patient_active
      ON public.ipd_admissions (patient_id)
      WHERE status IN ('active','admitted')
        AND patient_id IS NOT NULL;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- §5  OT SCHEDULES — no overlapping bookings in the same room
-- ────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF pg_temp.col_exists('ot_schedules', 'surgery_date')
     AND pg_temp.col_exists('ot_schedules', 'start_time')
     AND pg_temp.col_exists('ot_schedules', 'end_time')
     AND pg_temp.col_exists('ot_schedules', 'ot_room')
     AND pg_temp.col_exists('ot_schedules', 'status') THEN

    ALTER TABLE public.ot_schedules
      DROP CONSTRAINT IF EXISTS ot_schedules_no_overlap_per_room;

    ALTER TABLE public.ot_schedules
      ADD CONSTRAINT ot_schedules_no_overlap_per_room
      EXCLUDE USING gist (
        ot_room      WITH =,
        surgery_date WITH =,
        tsrange(
          (surgery_date::text || ' ' || start_time)::timestamp,
          (surgery_date::text || ' ' || end_time  )::timestamp,
          '[)'
        ) WITH &&
      )
      WHERE (status NOT IN ('cancelled','completed'));
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- §6  OPD QUEUE — one active entry per patient per day
-- ────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_opd_queue_patient_day_active
  ON opd_queue (patient_id, queue_date)
  WHERE status NOT IN ('done','completed','cancelled','skipped');

-- ────────────────────────────────────────────────────────────────────
-- §7  OPD QUEUE — unique token per (queue_date, token_number)
-- ────────────────────────────────────────────────────────────────────
-- Hard guard against the read-then-insert race that could allow two
-- patients to share a token number on the same day. next_queue_token()
-- already serialises via advisory lock; this index catches any stray
-- direct insert as well.
-- ────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS uniq_opd_queue_date_token
  ON opd_queue (queue_date, token_number)
  WHERE token_number IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────
-- DONE
-- ────────────────────────────────────────────────────────────────────

INSERT INTO schema_migrations (version, name, applied_at, notes)
VALUES ('FI-04', 'fresh_install_validation_constraints', NOW(),
        'Strict-identifier uniqueness, slot uniqueness, OT EXCLUDE, queue token uniqueness, aadhaar_hmac')
ON CONFLICT (version) DO NOTHING;

COMMIT;

SELECT 'Fresh-install 04/07: Validation constraints — DONE' AS result;
