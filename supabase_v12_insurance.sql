-- ============================================================
-- NexMedicon HMS — v12: Insurance policy fields on patients
-- Run in Supabase → SQL Editor → New Query
-- Safe to re-run (IF NOT EXISTS pattern).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'policy_tpa_name'
  ) THEN
    ALTER TABLE patients ADD COLUMN policy_tpa_name TEXT;
    RAISE NOTICE 'Column policy_tpa_name added to patients.';
  ELSE
    RAISE NOTICE 'Column policy_tpa_name already exists — skipping.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'policy_number'
  ) THEN
    ALTER TABLE patients ADD COLUMN policy_number TEXT;
    RAISE NOTICE 'Column policy_number added to patients.';
  ELSE
    RAISE NOTICE 'Column policy_number already exists — skipping.';
  END IF;
END $$;
