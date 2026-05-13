-- ═══════════════════════════════════════════════════════════════════════════
-- NexMedicon HMS — Critical Bug Fix Migrations (v14)
-- ═══════════════════════════════════════════════════════════════════════════
-- Run this file in Supabase → SQL Editor.
--
-- Fixes:
--   1. Adds local_storage_id column to lab_reports so localStorage→Supabase
--      migration is idempotent (safe to run multiple times without duplicates).
--
--   2. Adds migrated_from column to track data provenance.
--
--   3. Adds payment_notes and paid_at columns to bills table for the
--      Razorpay webhook to store payment metadata (method, timestamp, etc.)
--
--   4. Adds razorpay_order_id column if not already present (needed by
--      the webhook to find the matching bill for a payment).
--
-- All operations are idempotent — safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 1. lab_reports: localStorage migration support ─────────────────────────

-- local_storage_id stores the original localStorage record UUID.
-- UNIQUE ensures re-running the migration never creates duplicates.
ALTER TABLE lab_reports
  ADD COLUMN IF NOT EXISTS local_storage_id TEXT,
  ADD COLUMN IF NOT EXISTS migrated_from    TEXT;

-- Unique index on local_storage_id (nullable — NULL values are not unique in PG,
-- so existing Supabase-native records with NULL are unaffected)
CREATE UNIQUE INDEX IF NOT EXISTS lab_reports_local_storage_id_unique
  ON lab_reports (local_storage_id)
  WHERE local_storage_id IS NOT NULL;


-- ─── 2. bills: Razorpay webhook metadata ────────────────────────────────────

-- razorpay_order_id: set when the bill is created and a Razorpay order is initiated.
-- Webhook uses this to find the matching bill.
ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS razorpay_order_id  TEXT,
  ADD COLUMN IF NOT EXISTS paid_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_method     TEXT,
  ADD COLUMN IF NOT EXISTS payment_notes      TEXT;

-- Index for fast lookup by order_id in the webhook handler
CREATE INDEX IF NOT EXISTS bills_razorpay_order_id_idx
  ON bills (razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;


-- ─── 3. Verification ─────────────────────────────────────────────────────────
-- After running, verify with:
--
--   SELECT column_name, data_type
--     FROM information_schema.columns
--    WHERE table_name = 'lab_reports'
--      AND column_name IN ('local_storage_id', 'migrated_from');
--
--   SELECT column_name, data_type
--     FROM information_schema.columns
--    WHERE table_name = 'bills'
--      AND column_name IN ('razorpay_order_id', 'paid_at', 'payment_method', 'payment_notes');
--
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'lab_reports' AND indexname = 'lab_reports_local_storage_id_unique';
--
-- ═══════════════════════════════════════════════════════════════════════════
