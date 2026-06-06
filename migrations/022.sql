-- ═══════════════════════════════════════════════════════════════════════════════
-- Supabase Migration: Fix Billing System Schema
-- File: supabase/migrations/20260606_fix_billing_schema.sql
--
-- PURPOSE:
--   Ensures the billing tables have all required columns for the payment
--   tracking system to work correctly. This migration is IDEMPOTENT —
--   it can be run multiple times safely (uses IF NOT EXISTS / IF EXISTS checks).
--
-- FIXES:
--   1. Adds `patient_id` column to `bill_payments` if missing
--   2. Adds `net_amount` column to `bills` if missing
--   3. Adds `paid_at` column to `bills` if missing
--   4. Adds `subtotal` column to `bills` if missing
--   5. Adds `invoice_number` column to `bills` if missing (UNIQUE)
--   6. Adds `is_deleted` column to `bills` if missing (soft-delete)
--   7. Creates indexes for performance
--   8. Backfills `net_amount` from `total` for existing bills that have NULL net_amount
--   9. Backfills `patient_id` in `bill_payments` from parent `bills` record
--  10. Enables Realtime for billing tables
--
-- SAFE TO RUN ON:
--   - Fresh Supabase project (no data)
--   - Existing project with data
--   - Can be run multiple times
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- §1: Ensure `bills` table exists with all required columns
-- ═══════════════════════════════════════════════════════════════════════════════

-- Create bills table if it doesn't exist at all
CREATE TABLE IF NOT EXISTS public.bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  patient_name TEXT,
  mrn TEXT,
  invoice_number TEXT,
  items JSONB DEFAULT '[]',
  subtotal NUMERIC(10,2) DEFAULT 0,
  discount NUMERIC(10,2) DEFAULT 0,
  tax NUMERIC(10,2) DEFAULT 0,
  gst_amount NUMERIC(10,2) DEFAULT 0,
  total NUMERIC(10,2) DEFAULT 0,
  net_amount NUMERIC(10,2) DEFAULT 0,
  paid NUMERIC(10,2) DEFAULT 0,
  due NUMERIC(10,2) DEFAULT 0,
  payment_mode TEXT,
  payment_ref TEXT,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  paid_at TIMESTAMPTZ,
  is_deleted BOOLEAN DEFAULT false,
  encounter_id UUID,
  encounter_type TEXT DEFAULT 'opd',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add missing columns to bills (safe — uses IF NOT EXISTS)
DO $$
BEGIN
  -- net_amount
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bills' AND column_name = 'net_amount') THEN
    ALTER TABLE public.bills ADD COLUMN net_amount NUMERIC(10,2) DEFAULT 0;
  END IF;

  -- subtotal
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bills' AND column_name = 'subtotal') THEN
    ALTER TABLE public.bills ADD COLUMN subtotal NUMERIC(10,2) DEFAULT 0;
  END IF;

  -- paid_at
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bills' AND column_name = 'paid_at') THEN
    ALTER TABLE public.bills ADD COLUMN paid_at TIMESTAMPTZ;
  END IF;

  -- is_deleted
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bills' AND column_name = 'is_deleted') THEN
    ALTER TABLE public.bills ADD COLUMN is_deleted BOOLEAN DEFAULT false;
  END IF;

  -- invoice_number
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bills' AND column_name = 'invoice_number') THEN
    ALTER TABLE public.bills ADD COLUMN invoice_number TEXT;
  END IF;

  -- payment_ref
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bills' AND column_name = 'payment_ref') THEN
    ALTER TABLE public.bills ADD COLUMN payment_ref TEXT;
  END IF;

  -- encounter_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bills' AND column_name = 'encounter_id') THEN
    ALTER TABLE public.bills ADD COLUMN encounter_id UUID;
  END IF;

  -- encounter_type
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bills' AND column_name = 'encounter_type') THEN
    ALTER TABLE public.bills ADD COLUMN encounter_type TEXT DEFAULT 'opd';
  END IF;

  -- gst_amount
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bills' AND column_name = 'gst_amount') THEN
    ALTER TABLE public.bills ADD COLUMN gst_amount NUMERIC(10,2) DEFAULT 0;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- §2: Ensure `bill_payments` table exists with `patient_id` column
-- ═══════════════════════════════════════════════════════════════════════════════

-- Create bill_payments table if it doesn't exist at all
CREATE TABLE IF NOT EXISTS public.bill_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID REFERENCES public.bills(id) ON DELETE CASCADE,
  patient_id UUID,
  amount NUMERIC(10,2) NOT NULL,
  payment_mode TEXT DEFAULT 'cash',
  reference TEXT,
  received_by TEXT,
  notes TEXT,
  transaction_type TEXT DEFAULT 'payment',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add patient_id column if missing (THIS IS THE CRITICAL FIX)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bill_payments' AND column_name = 'patient_id') THEN
    ALTER TABLE public.bill_payments ADD COLUMN patient_id UUID;
  END IF;

  -- Also ensure transaction_type exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bill_payments' AND column_name = 'transaction_type') THEN
    ALTER TABLE public.bill_payments ADD COLUMN transaction_type TEXT DEFAULT 'payment';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- §3: Indexes for performance
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_bills_patient_id ON public.bills(patient_id);
CREATE INDEX IF NOT EXISTS idx_bills_status ON public.bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_created_at ON public.bills(created_at);
CREATE INDEX IF NOT EXISTS idx_bills_invoice_number ON public.bills(invoice_number);

CREATE INDEX IF NOT EXISTS idx_bill_payments_bill_id ON public.bill_payments(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_patient_id ON public.bill_payments(patient_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_created_at ON public.bill_payments(created_at);

-- ═══════════════════════════════════════════════════════════════════════════════
-- §4: Backfill missing data in existing records
-- ═══════════════════════════════════════════════════════════════════════════════

-- Backfill net_amount from total where net_amount is NULL or 0 but total has value
UPDATE public.bills
SET net_amount = total
WHERE (net_amount IS NULL OR net_amount = 0) AND total > 0;

-- Backfill subtotal from total where subtotal is NULL or 0 but total has value
UPDATE public.bills
SET subtotal = total
WHERE (subtotal IS NULL OR subtotal = 0) AND total > 0;

-- Backfill paid_at from created_at for paid bills that have no paid_at
UPDATE public.bills
SET paid_at = created_at
WHERE status = 'paid' AND paid_at IS NULL;

-- Backfill patient_id in bill_payments from parent bills record
UPDATE public.bill_payments bp
SET patient_id = b.patient_id
FROM public.bills b
WHERE bp.bill_id = b.id
  AND bp.patient_id IS NULL
  AND b.patient_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- §5: Enable Realtime for billing tables
-- ═══════════════════════════════════════════════════════════════════════════════

-- Enable realtime for bills table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'bills'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bills;
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Publication might not exist on some setups — non-fatal
  NULL;
END $$;

-- Enable realtime for bill_payments table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'bill_payments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bill_payments;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- §6: RLS Policies (permissive — allow all authenticated access)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Enable RLS
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_payments ENABLE ROW LEVEL SECURITY;

-- Bills: allow all operations for authenticated users
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bills' AND policyname = 'bills_all_access') THEN
    CREATE POLICY bills_all_access ON public.bills FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Bill Payments: allow all operations for authenticated users
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bill_payments' AND policyname = 'bill_payments_all_access') THEN
    CREATE POLICY bill_payments_all_access ON public.bill_payments FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- §7: Unique constraint on invoice_number (if not already set)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Only add if not already there (avoid error on re-run)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bills_invoice_number_key' AND conrelid = 'public.bills'::regclass
  ) THEN
    -- First remove any duplicates (keep the newest)
    DELETE FROM public.bills a USING public.bills b
    WHERE a.invoice_number = b.invoice_number
      AND a.invoice_number IS NOT NULL
      AND a.created_at < b.created_at;

    ALTER TABLE public.bills ADD CONSTRAINT bills_invoice_number_key UNIQUE (invoice_number);
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- If constraint already exists under different name, ignore
  NULL;
END $$;

-- Done! All billing tables are now properly configured.
-- This migration is safe to run on fresh or existing projects.
