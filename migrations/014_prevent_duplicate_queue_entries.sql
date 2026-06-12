-- ============================================================
-- Migration 014: Prevent Duplicate OPD Queue Entries
-- ============================================================
--
-- PROBLEM:
--   When a patient is registered with "Auto-add to OPD Queue" checked,
--   the code inserts into opd_queue during handlePaymentConfirm/handleSkipPayment.
--   If the user then navigates to /queue and clicks "Add to Queue" again,
--   a SECOND entry is created for the same patient on the same day.
--   This results in the patient having two token numbers and appearing
--   twice in the doctor's queue view.
--
-- FIX:
--   Add a unique partial index on (patient_id, queue_date) WHERE status != 'done'.
--   This allows a patient to appear only ONCE per day in the active queue,
--   but does NOT prevent them from appearing again on a different day
--   or from having a 'done' entry from an earlier visit the same day
--   (e.g., they come for a morning appointment AND an evening follow-up).
--
-- SAFE TO RUN MULTIPLE TIMES: Uses IF NOT EXISTS pattern.
-- ============================================================

-- Unique index: one active queue entry per patient per day.
-- Apply to whichever queue table actually exists in this database
-- (opd_queue from 000_canonical_alignment.sql, OR the v00 opdqueue legacy table).
DO $$
BEGIN
  -- snake_case version
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='opd_queue'
               AND column_name='patient_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='opd_queue'
                   AND column_name='queue_date') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_opd_queue_patient_day_active
      ON public.opd_queue (patient_id, queue_date)
      WHERE status NOT IN ('done', 'completed', 'cancelled', 'skipped');
  END IF;

  -- v00 legacy version (column names: patientid, date)
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='opdqueue'
               AND column_name='patientid')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='opdqueue'
                   AND column_name='date') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_opdqueue_patient_day_active
      ON public.opdqueue (patientid, date)
      WHERE status NOT IN ('done', 'completed', 'cancelled', 'skipped');
  END IF;
END $$;

-- ============================================================
-- DONE
-- ============================================================
SELECT 'Migration 014: Prevent duplicate queue entries — COMPLETE' AS result;