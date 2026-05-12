-- ═══════════════════════════════════════════════════════════════════════════
-- NexMedicon HMS — Bug Fix Migrations (v12)
-- ═══════════════════════════════════════════════════════════════════════════
-- Run this file in Supabase → SQL Editor.
--
-- Fixes:
--   BUG #1: Adds UNIQUE constraint on bills.razorpay_payment_id to prevent
--           duplicate bills if Razorpay fires the handler callback twice.
--
--   BUG #3: Adds gst_percent and gst_amount columns to bills so the GST
--           module can persist values from the billing form. Existing rows
--           default to 0 (no behaviour change for existing bills).
--
-- All operations are idempotent — safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── BUG #1 — Razorpay duplicate prevention ─────────────────────────────────
-- A UNIQUE constraint on razorpay_payment_id ensures that if Razorpay's
-- handler fires twice (network retry edge case), the second INSERT will fail
-- with a constraint violation rather than silently creating a duplicate bill.
--
-- NULL values are allowed and do NOT count as duplicates in PostgreSQL UNIQUE
-- constraints — so cash bills (which have NULL razorpay_payment_id) are not
-- affected.
--
-- We use a partial unique index instead of a table constraint so that:
--   1. It is conditional (only enforced where the id is NOT NULL)
--   2. It can be created with IF NOT EXISTS
--   3. It does not block existing rows that may have duplicate NULLs

CREATE UNIQUE INDEX IF NOT EXISTS bills_razorpay_payment_id_unique
  ON bills (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;


-- ─── BUG #3 — Wire GST into the bills table ─────────────────────────────────
-- The billing-gst.ts library and BillingExtras.tsx components were already
-- written but never connected to the live bills table. These columns let the
-- billing page persist the GST percentage and computed GST amount per bill.
--
-- Defaults are 0 so that:
--   - All existing bills (without GST) read back as gst_percent=0, gst_amount=0
--   - The receipt and CA report logic can safely use Number(b.gst_amount || 0)

ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS gst_percent NUMERIC(5, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_amount  NUMERIC(10, 2) DEFAULT 0;


-- ─── Verification ───────────────────────────────────────────────────────────
-- After running, you can confirm both fixes are in place with:
--
--   -- Check the unique index exists
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'bills' AND indexname = 'bills_razorpay_payment_id_unique';
--
--   -- Check the GST columns exist
--   SELECT column_name, data_type, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'bills' AND column_name IN ('gst_percent', 'gst_amount');
-- ═══════════════════════════════════════════════════════════════════════════
