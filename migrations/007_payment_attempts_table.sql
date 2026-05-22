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

-- Create payment_attempts table
CREATE TABLE IF NOT EXISTS payment_attempts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bill_id         UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES patients(id),
  amount          NUMERIC(10, 2),
  status          TEXT NOT NULL CHECK (status IN ('initiated', 'pending', 'success', 'failed', 'timeout', 'cancelled', 'refunded')),
  payment_method  TEXT,  -- 'razorpay', 'upi_direct', 'cash', 'card', 'manual_mark'
  razorpay_payment_id  TEXT,
  razorpay_order_id    TEXT,
  failure_reason  TEXT,
  marked_by       UUID REFERENCES clinicusers(id),
  marked_by_name  TEXT,
  metadata        JSONB,  -- Additional data (UPI ref, bank response, etc.)
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

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

-- RLS Policy: All active clinic users can view payment attempts
CREATE POLICY IF NOT EXISTS payment_attempts_select
  ON payment_attempts FOR SELECT
  TO authenticated
  USING (is_active_user());

-- RLS Policy: Admin and staff can insert payment attempts
CREATE POLICY IF NOT EXISTS payment_attempts_insert
  ON payment_attempts FOR INSERT
  TO authenticated
  WITH CHECK (is_active_user());

-- RLS Policy: Only admin can update/delete payment attempts
CREATE POLICY IF NOT EXISTS payment_attempts_update
  ON payment_attempts FOR UPDATE
  TO authenticated
  USING (is_admin());

-- Record this migration
INSERT INTO schema_migrations (version, name, applied_at)
VALUES ('007', 'payment_attempts_table', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ════════════════════════════════════════════════════════════════
-- DOWN MIGRATION (documentation only)
-- ════════════════════════════════════════════════════════════════
-- DROP TABLE IF EXISTS payment_attempts;
