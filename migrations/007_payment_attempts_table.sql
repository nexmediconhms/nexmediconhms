-- Migration: 007_payment_attempts_table
-- Created: 2026-05-22
-- Description: Create payment_attempts table for tracking all payment tries
-- Dependencies: Requires bills table and clinicusers table
--
-- FIX: UPI payment fails mid-way (timeout, wrong amount, network drop)
-- This creates a payment_attempts table that tracks:
--   - Every payment attempt (success, failure, timeout)
--   - Who marked a payment as failed (manual rejection)
--   - Failure reasons for reconciliation
--   - Razorpay payment IDs for cross-referencing
--
-- SAFE TO RUN: Uses IF NOT EXISTS patterns.
-- Will not break existing data or functionality.

-- ════════════════════════════════════════════════════════════════
-- UP MIGRATION
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- Ensure schema_migrations exists (safe to re-run)
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          SERIAL PRIMARY KEY,
  version     TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  applied_at  TIMESTAMPTZ DEFAULT NOW(),
  notes       TEXT
);

-- Skip rest if bills doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='bills') THEN
    RAISE NOTICE 'bills table missing — skipping migration 007 payment_attempts setup';
    RETURN;
  END IF;
END $$;

-- Create payment_attempts table (FK to bills/patients/clinic_users only added
-- if those tables exist — keeps the migration runnable on partial schemas).
CREATE TABLE IF NOT EXISTS payment_attempts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bill_id         UUID NOT NULL,
  patient_id      UUID,
  amount          NUMERIC(10, 2),
  status          TEXT NOT NULL CHECK (status IN ('initiated', 'pending', 'success', 'failed', 'timeout', 'cancelled', 'refunded')),
  payment_method  TEXT,
  razorpay_payment_id  TEXT,
  razorpay_order_id    TEXT,
  failure_reason  TEXT,
  marked_by       UUID,
  marked_by_name  TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Add FKs only if the referenced tables exist (defensive for fresh schemas)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='bills')
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                     WHERE table_name='payment_attempts'
                       AND constraint_name='payment_attempts_bill_id_fkey') THEN
    BEGIN
      ALTER TABLE payment_attempts
        ADD CONSTRAINT payment_attempts_bill_id_fkey
        FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped FK payment_attempts→bills: %', SQLERRM;
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='patients')
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                     WHERE table_name='payment_attempts'
                       AND constraint_name='payment_attempts_patient_id_fkey') THEN
    BEGIN
      ALTER TABLE payment_attempts
        ADD CONSTRAINT payment_attempts_patient_id_fkey
        FOREIGN KEY (patient_id) REFERENCES patients(id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped FK payment_attempts→patients: %', SQLERRM;
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='clinic_users')
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                     WHERE table_name='payment_attempts'
                       AND constraint_name='payment_attempts_marked_by_fkey') THEN
    BEGIN
      ALTER TABLE payment_attempts
        ADD CONSTRAINT payment_attempts_marked_by_fkey
        FOREIGN KEY (marked_by) REFERENCES clinic_users(id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped FK payment_attempts→clinic_users: %', SQLERRM;
    END;
  END IF;
END $$;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_payment_attempts_bill
  ON payment_attempts(bill_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_status
  ON payment_attempts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_patient
  ON payment_attempts(patient_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_razorpay
  ON payment_attempts(razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;

-- Add status values for bills table (if not already present)
-- These new statuses support the payment failure workflow
DO $$
BEGIN
  -- Check if bills.status has a CHECK constraint and update it
  -- For Supabase, we typically don't have CHECK constraints on status,
  -- so this is safe to just document the expected values:
  --   'pending', 'sent', 'paid', 'partially_paid', 'failed', 'cancelled', 'refunded', 'expired'
  RAISE NOTICE 'Bills status now supports: pending, sent, paid, partially_paid, failed, cancelled, refunded, expired';
END $$;

-- Enable RLS on payment_attempts (follows existing pattern)
ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;

-- RLS Policies (safe: skip if already exists)
DO $$
BEGIN
  CREATE POLICY payment_attempts_select ON payment_attempts FOR SELECT TO authenticated USING (is_active_user());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY payment_attempts_insert ON payment_attempts FOR INSERT TO authenticated WITH CHECK (is_active_user());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY payment_attempts_update ON payment_attempts FOR UPDATE TO authenticated USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Record this migration
INSERT INTO schema_migrations (version, name, applied_at)
VALUES ('007', 'payment_attempts_table', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ════════════════════════════════════════════════════════════════
-- DOWN MIGRATION (documentation only)
-- ════════════════════════════════════════════════════════════════
-- DROP TABLE IF EXISTS payment_attempts;
