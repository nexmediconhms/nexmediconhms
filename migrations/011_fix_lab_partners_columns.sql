-- ============================================================
-- Migration 011: Fix lab_partners table columns
--
-- Ensures the lab_partners table has all columns that the
-- application code references. This handles the case where:
--   - Original schema used 'hospitalshare'/'labshare'
--   - Application code uses 'hospital_pct'/'lab_pct'
--   - Settings page needs 'phone' column (not 'contact')
-- ============================================================

-- Add hospital_pct / lab_pct columns if they don't exist
-- These are what the application code actually queries
ALTER TABLE lab_partners ADD COLUMN IF NOT EXISTS hospital_pct NUMERIC(5,2) DEFAULT 30;
ALTER TABLE lab_partners ADD COLUMN IF NOT EXISTS lab_pct NUMERIC(5,2) DEFAULT 70;

-- Migrate data from old column names if they exist
DO $$
BEGIN
  -- If hospitalshare exists (from master schema), copy values to hospital_pct
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lab_partners' AND column_name = 'hospitalshare'
  ) THEN
    UPDATE lab_partners SET hospital_pct = hospitalshare WHERE hospital_pct IS NULL OR hospital_pct = 30;
    UPDATE lab_partners SET lab_pct = labshare WHERE lab_pct IS NULL OR lab_pct = 70;
  END IF;
END $$;

-- Ensure phone column exists (the code uses 'phone', not 'contact')
ALTER TABLE lab_partners ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE lab_partners ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE lab_partners ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE lab_partners ADD COLUMN IF NOT EXISTS contact_person TEXT;

-- Ensure is_active column exists (some schema versions use 'isactive')
ALTER TABLE lab_partners ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Copy from isactive if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lab_partners' AND column_name = 'isactive'
  ) THEN
    UPDATE lab_partners SET is_active = isactive WHERE is_active IS NULL;
  END IF;
END $$;

-- Ensure created_at exists
ALTER TABLE lab_partners ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- ── Done ─────────────────────────────────────────────────────────
