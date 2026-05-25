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

-- Unique index: one active queue entry per patient per day
-- Uses a partial index so 'done'/'cancelled' entries don't block re-queuing
CREATE UNIQUE INDEX IF NOT EXISTS idx_opd_queue_patient_day_active
  ON opd_queue (patient_id, queue_date)
  WHERE status NOT IN ('done', 'completed', 'cancelled', 'skipped');

-- ============================================================
-- DONE
-- ============================================================
SELECT 'Migration 014: Prevent duplicate queue entries — COMPLETE' AS result;
