-- ============================================================
-- HMS MVP — Add Aadhaar Card Number to patients table
-- Run this in Supabase → SQL Editor → New Query
-- Safe to re-run (uses IF NOT EXISTS pattern via DO block).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'aadhaar_no'
  ) THEN
    ALTER TABLE patients ADD COLUMN aadhaar_no TEXT;
    RAISE NOTICE 'Column aadhaar_no added to patients table.';
  ELSE
    RAISE NOTICE 'Column aadhaar_no already exists — skipping.';
  END IF;
END
$$;
