-- ============================================================
-- NexMedicon HMS v10 — Procedure Tracking
-- Run in Supabase → SQL Editor → New Query
-- Safe to run multiple times (IF NOT EXISTS)
-- ============================================================

-- Add procedures JSONB column to encounters table
-- Stores an array of procedure objects per encounter
-- Format: [{ name, indication, findings, complications, surgeon, anaesthesia, notes }]
ALTER TABLE encounters
  ADD COLUMN IF NOT EXISTS procedures JSONB DEFAULT '[]'::JSONB;

-- Index for searching procedures by name
CREATE INDEX IF NOT EXISTS idx_encounters_procedures
  ON encounters USING gin(procedures);

SELECT 'v10 procedure tracking migration complete ✓' AS result;
