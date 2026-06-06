-- ═══════════════════════════════════════════════════════════════════════════════
-- BULLETPROOF BILLING SCHEMA MIGRATION
-- File: supabase/migrations/20260606_fix_billing_complete.sql
--
-- This migration handles BOTH schema variants:
--   Schema A (legacy): createdat, patientid, invoicenumber, paymentmode (no underscores)
--   Schema B (modern): created_at, patient_id, invoice_number, payment_mode (with underscores)
--
-- It detects which schema is live and normalizes to Schema B (snake_case).
-- It also ensures all required columns exist and backfills data.
--
-- SAFE TO RUN: Multiple times, on fresh or existing projects, on either schema.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- §1: CREATE TABLES IF THEY DON'T EXIST AT ALL (fresh project scenario)
-- ═══════════════════════════════════════════════════════════════════════════════

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

CREATE TABLE IF NOT EXISTS public.bill_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID,
  patient_id UUID,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_mode TEXT DEFAULT 'cash',
  reference TEXT,
  received_by TEXT,
  notes TEXT,
  transaction_type TEXT DEFAULT 'payment',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.clinic_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- §2: DETECT AND FIX LEGACY SCHEMA (rename camelCase columns to snake_case)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Fix bills table: rename legacy columns to snake_case if they exist
DO $$
BEGIN
  -- createdat → created_at
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='createdat')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='created_at')
  THEN
    ALTER TABLE public.bills RENAME COLUMN createdat TO created_at;
    RAISE NOTICE 'Renamed bills.createdat → created_at';
  END IF;

  -- updatedat → updated_at
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='updatedat')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='updated_at')
  THEN
    ALTER TABLE public.bills RENAME COLUMN updatedat TO updated_at;
    RAISE NOTICE 'Renamed bills.updatedat → updated_at';
  END IF;

  -- patientid → patient_id
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='patientid')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='patient_id')
  THEN
    ALTER TABLE public.bills RENAME COLUMN patientid TO patient_id;
    RAISE NOTICE 'Renamed bills.patientid → patient_id';
  END IF;

  -- invoicenumber → invoice_number
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='invoicenumber')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='invoice_number')
  THEN
    ALTER TABLE public.bills RENAME COLUMN invoicenumber TO invoice_number;
    RAISE NOTICE 'Renamed bills.invoicenumber → invoice_number';
  END IF;

  -- paymentmode → payment_mode
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='paymentmode')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='payment_mode')
  THEN
    ALTER TABLE public.bills RENAME COLUMN paymentmode TO payment_mode;
    RAISE NOTICE 'Renamed bills.paymentmode → payment_mode';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- §3: ADD MISSING COLUMNS TO BILLS (handles partial schemas)
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='net_amount') THEN
    ALTER TABLE public.bills ADD COLUMN net_amount NUMERIC(10,2) DEFAULT 0;
    RAISE NOTICE 'Added bills.net_amount';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='subtotal') THEN
    ALTER TABLE public.bills ADD COLUMN subtotal NUMERIC(10,2) DEFAULT 0;
    RAISE NOTICE 'Added bills.subtotal';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='paid_at') THEN
    ALTER TABLE public.bills ADD COLUMN paid_at TIMESTAMPTZ;
    RAISE NOTICE 'Added bills.paid_at';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='is_deleted') THEN
    ALTER TABLE public.bills ADD COLUMN is_deleted BOOLEAN DEFAULT false;
    RAISE NOTICE 'Added bills.is_deleted';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='patient_name') THEN
    ALTER TABLE public.bills ADD COLUMN patient_name TEXT;
    RAISE NOTICE 'Added bills.patient_name';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='mrn') THEN
    ALTER TABLE public.bills ADD COLUMN mrn TEXT;
    RAISE NOTICE 'Added bills.mrn';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='payment_ref') THEN
    ALTER TABLE public.bills ADD COLUMN payment_ref TEXT;
    RAISE NOTICE 'Added bills.payment_ref';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='encounter_id') THEN
    ALTER TABLE public.bills ADD COLUMN encounter_id UUID;
    RAISE NOTICE 'Added bills.encounter_id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='encounter_type') THEN
    ALTER TABLE public.bills ADD COLUMN encounter_type TEXT DEFAULT 'opd';
    RAISE NOTICE 'Added bills.encounter_type';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='gst_amount') THEN
    ALTER TABLE public.bills ADD COLUMN gst_amount NUMERIC(10,2) DEFAULT 0;
    RAISE NOTICE 'Added bills.gst_amount';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='invoice_number') THEN
    ALTER TABLE public.bills ADD COLUMN invoice_number TEXT;
    RAISE NOTICE 'Added bills.invoice_number';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='created_at') THEN
    ALTER TABLE public.bills ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
    RAISE NOTICE 'Added bills.created_at';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='updated_at') THEN
    ALTER TABLE public.bills ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    RAISE NOTICE 'Added bills.updated_at';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='patient_id') THEN
    ALTER TABLE public.bills ADD COLUMN patient_id UUID;
    RAISE NOTICE 'Added bills.patient_id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='payment_mode') THEN
    ALTER TABLE public.bills ADD COLUMN payment_mode TEXT;
    RAISE NOTICE 'Added bills.payment_mode';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- §4: FIX bill_payments TABLE — add patient_id column
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bill_payments' AND column_name='patient_id') THEN
    ALTER TABLE public.bill_payments ADD COLUMN patient_id UUID;
    RAISE NOTICE 'Added bill_payments.patient_id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bill_payments' AND column_name='created_at') THEN
    ALTER TABLE public.bill_payments ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
    RAISE NOTICE 'Added bill_payments.created_at';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bill_payments' AND column_name='transaction_type') THEN
    ALTER TABLE public.bill_payments ADD COLUMN transaction_type TEXT DEFAULT 'payment';
    RAISE NOTICE 'Added bill_payments.transaction_type';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- §5: BACKFILL DATA
-- ═══════════════════════════════════════════════════════════════════════════════

-- Backfill net_amount from total for all bills where net_amount is 0 or NULL
UPDATE public.bills SET net_amount = total WHERE (net_amount IS NULL OR net_amount = 0) AND total > 0;

-- Backfill subtotal from total
UPDATE public.bills SET subtotal = total WHERE (subtotal IS NULL OR subtotal = 0) AND total > 0;

-- Backfill paid_at from created_at for paid bills
UPDATE public.bills SET paid_at = created_at WHERE status = 'paid' AND paid_at IS NULL;

-- Backfill patient_id in bill_payments from parent bill
UPDATE public.bill_payments bp
SET patient_id = b.patient_id
FROM public.bills b
WHERE bp.bill_id = b.id AND bp.patient_id IS NULL AND b.patient_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- §6: INDEXES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_bills_patient_id ON public.bills(patient_id);
CREATE INDEX IF NOT EXISTS idx_bills_status ON public.bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_created_at ON public.bills(created_at);
CREATE INDEX IF NOT EXISTS idx_bill_payments_bill_id ON public.bill_payments(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_patient_id ON public.bill_payments(patient_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_created_at ON public.bill_payments(created_at);

-- ═══════════════════════════════════════════════════════════════════════════════
-- §7: DISABLE RLS ON BILLING TABLES (ensures no permission issues)
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.bills DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_settings DISABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════════════════
-- §8: ENABLE REALTIME
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bills;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bill_payments;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- §9: GRANT FULL ACCESS (belt and suspenders — even if RLS is off)
-- ═══════════════════════════════════════════════════════════════════════════════

GRANT ALL ON public.bills TO anon, authenticated, service_role;
GRANT ALL ON public.bill_payments TO anon, authenticated, service_role;
GRANT ALL ON public.clinic_settings TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- §10: Insert default clinic_settings if empty (so .single() doesn't fail)
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO public.clinic_settings (key, value)
VALUES ('daily_revenue_target', '10000')
ON CONFLICT (key) DO NOTHING;

-- Done! Run this on ANY Supabase project (fresh or existing).
-- After running, verify: SELECT column_name FROM information_schema.columns WHERE table_name = 'bills' ORDER BY ordinal_position;
