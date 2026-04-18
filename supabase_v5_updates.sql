-- ============================================================
-- NexMedicon HMS — v5 Database Updates
-- Run in Supabase → SQL Editor → New Query
-- Safe to run multiple times (IF NOT EXISTS everywhere)
-- ============================================================

-- Index for overdue follow-up queries (used heavily in dashboard + reports)
CREATE INDEX IF NOT EXISTS idx_prescriptions_followup
  ON prescriptions(follow_up_date)
  WHERE follow_up_date IS NOT NULL;

-- Index for ANC registry queries (ob_data->lmp lookups)
CREATE INDEX IF NOT EXISTS idx_encounters_ob_lmp
  ON encounters((ob_data->>'lmp'))
  WHERE ob_data IS NOT NULL AND ob_data->>'lmp' IS NOT NULL;

-- Index for encounter date range queries (OPD trend chart)
CREATE INDEX IF NOT EXISTS idx_encounters_date_range
  ON encounters(encounter_date, patient_id);

-- Index for patient search by name (trigram — already exists but ensure)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_patients_name_trgm
  ON patients USING gin(full_name gin_trgm_ops);

-- Ensure prescription → patient join is fast
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient
  ON prescriptions(patient_id);

SELECT 'v5 indexes created ✓' AS result;
