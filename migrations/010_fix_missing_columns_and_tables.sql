-- Migration: 010_fix_missing_columns_and_tables
-- Created: 2026-05-23
-- Description: Fix schema mismatches causing runtime errors
--
-- ERRORS FIXED:
--   1. "Could not find the 'bucket' column of 'consultation_attachments'"
--   2. "Could not find the 'anesthesia_type' column of 'ot_schedules'"
--   3. "Could not find the 'submitted_by' column of 'hospital_fund'"
--   4. Bed delete fails with FK constraint violation
--
-- FOR FRESH PROJECT: Run AFTER v00-schema-master.sql
-- SAFE TO RUN MULTIPLE TIMES: Uses IF NOT EXISTS patterns.

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- FIX #1: consultation_attachments table
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS consultation_attachments (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id   UUID REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id UUID,
  file_name    TEXT NOT NULL,
  file_type    TEXT,
  file_size    INTEGER,
  bucket       TEXT DEFAULT 'consultation-files',
  storage_key  TEXT,
  storage_path TEXT,
  notes        TEXT,
  uploaded_by  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- If table already exists but bucket/storage_key columns are missing, add them.
-- This handles the case where the table was created by an older migration
-- (e.g., fix-all-permissions.sql) without these columns.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'consultation_attachments')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'consultation_attachments' AND column_name = 'bucket')
  THEN
    ALTER TABLE consultation_attachments ADD COLUMN bucket TEXT DEFAULT 'consultation-files';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'consultation_attachments')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'consultation_attachments' AND column_name = 'storage_key')
  THEN
    ALTER TABLE consultation_attachments ADD COLUMN storage_key TEXT;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'consultation_attachments')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'consultation_attachments' AND column_name = 'storage_path')
  THEN
    ALTER TABLE consultation_attachments ADD COLUMN storage_path TEXT;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'consultation_attachments')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'consultation_attachments' AND column_name = 'file_size')
  THEN
    ALTER TABLE consultation_attachments ADD COLUMN file_size INTEGER;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- FIX #2: ot_schedules table with anesthesia_type column
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ot_schedules (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id      UUID REFERENCES patients(id) ON DELETE CASCADE,
  patient_name    TEXT,
  mrn             TEXT,
  surgery_name    TEXT,
  surgery_date    DATE,
  start_time      TEXT,
  end_time        TEXT,
  surgeon         TEXT,
  assistant       TEXT,
  anesthesia_type TEXT,
  anesthetist     TEXT,
  ot_room         TEXT DEFAULT 'OT-1',
  priority        TEXT DEFAULT 'elective',
  status          TEXT DEFAULT 'scheduled',
  pre_op_notes    TEXT,
  post_op_notes   TEXT,
  complications   TEXT,
  instruments     JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- If table already exists but anesthesia_type column missing, add it
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ot_schedules')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ot_schedules' AND column_name = 'anesthesia_type')
  THEN
    ALTER TABLE ot_schedules ADD COLUMN anesthesia_type TEXT;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- FIX #3: hospital_fund table with submitted_by column
-- v00-schema-master.sql creates 'hospitalfund' (no underscore, minimal columns)
-- App code uses 'hospital_fund' (with underscore) and expects: submitted_by, category, status
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hospital_fund (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type          TEXT NOT NULL,
  category      TEXT,
  amount        NUMERIC(10,2) NOT NULL,
  description   TEXT,
  date          DATE DEFAULT CURRENT_DATE,
  submitted_by  TEXT,
  approved_by   TEXT,
  status        TEXT DEFAULT 'pending',
  receipt_url   TEXT,
  receipt_note  TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Add missing columns if table already exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hospital_fund' AND column_name = 'submitted_by') THEN
    ALTER TABLE hospital_fund ADD COLUMN submitted_by TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hospital_fund' AND column_name = 'approved_by') THEN
    ALTER TABLE hospital_fund ADD COLUMN approved_by TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hospital_fund' AND column_name = 'category') THEN
    ALTER TABLE hospital_fund ADD COLUMN category TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hospital_fund' AND column_name = 'status') THEN
    ALTER TABLE hospital_fund ADD COLUMN status TEXT DEFAULT 'pending';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hospital_fund' AND column_name = 'receipt_note') THEN
    ALTER TABLE hospital_fund ADD COLUMN receipt_note TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hospital_fund' AND column_name = 'updated_at') THEN
    ALTER TABLE hospital_fund ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- Also fix 'hospitalfund' (no underscore) from v00 schema if it exists.
--
-- BUG FIX: The previous version had a single outer guard on `submitted_by`
-- and then unconditionally ran 5 ALTER TABLEs. If even one of the other
-- columns (e.g. `category`) already existed — which happens when this
-- migration is re-run, or when 000_canonical_schema_alignment.sql ran
-- first and pre-created some columns — you got
-- "column \"category\" of relation \"hospitalfund\" already exists".
-- Each ADD must be guarded independently. Postgres ≥ 9.6 supports
-- `ADD COLUMN IF NOT EXISTS`, so we just use that.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='hospitalfund') THEN
    ALTER TABLE public.hospitalfund ADD COLUMN IF NOT EXISTS submitted_by TEXT;
    ALTER TABLE public.hospitalfund ADD COLUMN IF NOT EXISTS category     TEXT;
    ALTER TABLE public.hospitalfund ADD COLUMN IF NOT EXISTS status       TEXT DEFAULT 'pending';
    ALTER TABLE public.hospitalfund ADD COLUMN IF NOT EXISTS receipt_note TEXT;
    ALTER TABLE public.hospitalfund ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- FIX #4: Beds table — ensure bed_number column exists
-- v00 uses 'bednumber', app code uses 'bed_number'
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'beds' AND column_name = 'bednumber')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'beds' AND column_name = 'bed_number')
  THEN
    ALTER TABLE beds ADD COLUMN bed_number TEXT;
    UPDATE beds SET bed_number = bednumber WHERE bed_number IS NULL;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- NOTE ON BED DELETE FK ERROR:
-- The error "violates foreign key constraint ipd_admissions_bed_id_fkey"
-- is CORRECT BEHAVIOR. You cannot delete a bed that has past/current admissions.
-- The code fix below (in beds/page.tsx) handles this gracefully with a user message.
-- ═══════════════════════════════════════════════════════════════

COMMIT;
