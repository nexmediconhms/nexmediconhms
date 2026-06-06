-- Migration: 021_fix_consultation_attachments_columns
-- Created: 2026-06-06
-- Description: COMPREHENSIVE fix for consultation_attachments schema
--
-- ROOT CAUSE:
--   The consultation_attachments table was created by an older migration
--   (e.g., fix-all-permissions.sql) with only basic columns (id, patient_id,
--   encounter_id, file_name, file_type, file_url, notes, uploaded_by, created_at).
--   The app code expects additional columns: bucket, storage_key, storage_path, file_size.
--
-- THIS MIGRATION:
--   1. Creates the exec_sql helper function (needed by app's self-healing API)
--   2. Drops and recreates consultation_attachments with ALL required columns
--      (safe because the table has no data on a fresh project, and uses
--       a safe pattern that preserves data if rows exist)
--   3. Ensures consultation_files_db exists with all columns
--   4. Sets up RLS policies
--   5. Reloads PostgREST schema cache
--
-- SAFE TO RUN MULTIPLE TIMES: Uses IF NOT EXISTS and conditional patterns.
-- RUN THIS IN: Supabase Dashboard → SQL Editor → New Query → Paste → Run

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- STEP 0: Create exec_sql helper function (used by app's auto-fix API)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.exec_sql(sql TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE sql;
END;
$$;

-- Grant execute to service_role (used by API routes)
GRANT EXECUTE ON FUNCTION public.exec_sql(TEXT) TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- STEP 1: Fix consultation_attachments table
-- Strategy: Add all missing columns individually (preserves existing data)
-- ═══════════════════════════════════════════════════════════════

-- Create table if it doesn't exist at all
CREATE TABLE IF NOT EXISTS public.consultation_attachments (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id   UUID,
  encounter_id UUID,
  file_name    TEXT NOT NULL DEFAULT '',
  file_type    TEXT,
  file_size    INTEGER,
  bucket       TEXT DEFAULT 'consultation-files',
  storage_key  TEXT,
  storage_path TEXT,
  notes        TEXT,
  uploaded_by  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Add each column individually if missing (handles case where table exists with partial schema)
DO $$
BEGIN
  -- patient_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='consultation_attachments' AND column_name='patient_id') THEN
    ALTER TABLE public.consultation_attachments ADD COLUMN patient_id UUID;
  END IF;
  -- encounter_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='consultation_attachments' AND column_name='encounter_id') THEN
    ALTER TABLE public.consultation_attachments ADD COLUMN encounter_id UUID;
  END IF;
  -- file_name
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='consultation_attachments' AND column_name='file_name') THEN
    ALTER TABLE public.consultation_attachments ADD COLUMN file_name TEXT NOT NULL DEFAULT '';
  END IF;
  -- file_type
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='consultation_attachments' AND column_name='file_type') THEN
    ALTER TABLE public.consultation_attachments ADD COLUMN file_type TEXT;
  END IF;
  -- file_size
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='consultation_attachments' AND column_name='file_size') THEN
    ALTER TABLE public.consultation_attachments ADD COLUMN file_size INTEGER;
  END IF;
  -- bucket
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='consultation_attachments' AND column_name='bucket') THEN
    ALTER TABLE public.consultation_attachments ADD COLUMN bucket TEXT DEFAULT 'consultation-files';
  END IF;
  -- storage_key
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='consultation_attachments' AND column_name='storage_key') THEN
    ALTER TABLE public.consultation_attachments ADD COLUMN storage_key TEXT;
  END IF;
  -- storage_path
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='consultation_attachments' AND column_name='storage_path') THEN
    ALTER TABLE public.consultation_attachments ADD COLUMN storage_path TEXT;
  END IF;
  -- notes
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='consultation_attachments' AND column_name='notes') THEN
    ALTER TABLE public.consultation_attachments ADD COLUMN notes TEXT;
  END IF;
  -- uploaded_by
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='consultation_attachments' AND column_name='uploaded_by') THEN
    ALTER TABLE public.consultation_attachments ADD COLUMN uploaded_by TEXT;
  END IF;
  -- created_at
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='consultation_attachments' AND column_name='created_at') THEN
    ALTER TABLE public.consultation_attachments ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- STEP 2: Fix consultation_files_db table (DB-fallback storage)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.consultation_files_db (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id   UUID,
  encounter_id UUID,
  file_name    TEXT NOT NULL DEFAULT '',
  file_type    TEXT,
  file_size    INTEGER,
  file_data    TEXT,
  notes        TEXT,
  uploaded_by  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='consultation_files_db' AND column_name='file_size') THEN
    ALTER TABLE public.consultation_files_db ADD COLUMN file_size INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='consultation_files_db' AND column_name='notes') THEN
    ALTER TABLE public.consultation_files_db ADD COLUMN notes TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='consultation_files_db' AND column_name='uploaded_by') THEN
    ALTER TABLE public.consultation_files_db ADD COLUMN uploaded_by TEXT;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- STEP 3: Fix ipd_files table (IPD file uploads)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ipd_files (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id       UUID,
  bed_id           TEXT,
  file_name        TEXT,
  file_type        TEXT,
  file_size        INTEGER,
  file_url         TEXT,
  storage_path     TEXT,
  uploaded_by      TEXT,
  uploaded_by_role TEXT,
  category         TEXT,
  notes            TEXT,
  ocr_extracted    BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ipd_files' AND column_name='storage_path') THEN
    ALTER TABLE public.ipd_files ADD COLUMN storage_path TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ipd_files' AND column_name='uploaded_by_role') THEN
    ALTER TABLE public.ipd_files ADD COLUMN uploaded_by_role TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ipd_files' AND column_name='category') THEN
    ALTER TABLE public.ipd_files ADD COLUMN category TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ipd_files' AND column_name='ocr_extracted') THEN
    ALTER TABLE public.ipd_files ADD COLUMN ocr_extracted BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ipd_files' AND column_name='notes') THEN
    ALTER TABLE public.ipd_files ADD COLUMN notes TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ipd_files' AND column_name='file_size') THEN
    ALTER TABLE public.ipd_files ADD COLUMN file_size INTEGER;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- STEP 4: Indexes
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_ca_patient ON public.consultation_attachments (patient_id);
CREATE INDEX IF NOT EXISTS idx_ca_encounter ON public.consultation_attachments (encounter_id);
CREATE INDEX IF NOT EXISTS idx_cfdb_patient ON public.consultation_files_db (patient_id);
CREATE INDEX IF NOT EXISTS idx_ipdf_patient ON public.ipd_files (patient_id);

-- ═══════════════════════════════════════════════════════════════
-- STEP 5: RLS policies
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.consultation_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_files_db ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_files ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid "already exists" errors)
DROP POLICY IF EXISTS ca_authenticated_all ON public.consultation_attachments;
DROP POLICY IF EXISTS cfdb_authenticated_all ON public.consultation_files_db;
DROP POLICY IF EXISTS ipdf_authenticated_all ON public.ipd_files;
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.consultation_attachments;
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.consultation_files_db;
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.ipd_files;

-- Create permissive policies for authenticated users
CREATE POLICY ca_authenticated_all ON public.consultation_attachments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY cfdb_authenticated_all ON public.consultation_files_db
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY ipdf_authenticated_all ON public.ipd_files
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Grant access for service_role operations
GRANT ALL ON public.consultation_attachments TO authenticated;
GRANT ALL ON public.consultation_attachments TO service_role;
GRANT ALL ON public.consultation_files_db TO authenticated;
GRANT ALL ON public.consultation_files_db TO service_role;
GRANT ALL ON public.ipd_files TO authenticated;
GRANT ALL ON public.ipd_files TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- STEP 6: Reload PostgREST schema cache
-- ═══════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

COMMIT;
