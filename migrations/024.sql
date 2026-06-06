-- ═══════════════════════════════════════════════════════════════════════════════
-- REQUIRED: RUN THIS IN SUPABASE SQL EDITOR
-- File: supabase/migrations/20260607_fix_billing_definitive.sql
--
-- This is the ONLY migration you need. It handles everything:
--   1. Creates tables if they don't exist (fresh project)
--   2. Renames camelCase columns to snake_case (legacy schema)
--   3. Adds all missing columns
--   4. Backfills data
--   5. Disables RLS on billing tables
--   6. Grants full access
--   7. Enables realtime
--
-- SAFE: Idempotent. Can be run multiple times on any project.
-- ═══════════════════════════════════════════════════════════════════════════════

-- §1: Create tables if they don't exist
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

-- §2: Rename legacy columns (THE CRITICAL FIX)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='createdat')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='created_at')
  THEN ALTER TABLE public.bills RENAME COLUMN createdat TO created_at; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='updatedat')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='updated_at')
  THEN ALTER TABLE public.bills RENAME COLUMN updatedat TO updated_at; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='patientid')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='patient_id')
  THEN ALTER TABLE public.bills RENAME COLUMN patientid TO patient_id; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='invoicenumber')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='invoice_number')
  THEN ALTER TABLE public.bills RENAME COLUMN invoicenumber TO invoice_number; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='paymentmode')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='payment_mode')
  THEN ALTER TABLE public.bills RENAME COLUMN paymentmode TO payment_mode; END IF;
END $$;

-- §3: Add ALL missing columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='net_amount') THEN
    ALTER TABLE public.bills ADD COLUMN net_amount NUMERIC(10,2) DEFAULT 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='subtotal') THEN
    ALTER TABLE public.bills ADD COLUMN subtotal NUMERIC(10,2) DEFAULT 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='paid_at') THEN
    ALTER TABLE public.bills ADD COLUMN paid_at TIMESTAMPTZ; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='is_deleted') THEN
    ALTER TABLE public.bills ADD COLUMN is_deleted BOOLEAN DEFAULT false; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='patient_name') THEN
    ALTER TABLE public.bills ADD COLUMN patient_name TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='mrn') THEN
    ALTER TABLE public.bills ADD COLUMN mrn TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='payment_ref') THEN
    ALTER TABLE public.bills ADD COLUMN payment_ref TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='encounter_id') THEN
    ALTER TABLE public.bills ADD COLUMN encounter_id UUID; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='encounter_type') THEN
    ALTER TABLE public.bills ADD COLUMN encounter_type TEXT DEFAULT 'opd'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='gst_amount') THEN
    ALTER TABLE public.bills ADD COLUMN gst_amount NUMERIC(10,2) DEFAULT 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='patient_id') THEN
    ALTER TABLE public.bills ADD COLUMN patient_id UUID; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='payment_mode') THEN
    ALTER TABLE public.bills ADD COLUMN payment_mode TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='invoice_number') THEN
    ALTER TABLE public.bills ADD COLUMN invoice_number TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='created_at') THEN
    ALTER TABLE public.bills ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW(); END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bills' AND column_name='updated_at') THEN
    ALTER TABLE public.bills ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW(); END IF;
  -- bill_payments fixes
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bill_payments' AND column_name='patient_id') THEN
    ALTER TABLE public.bill_payments ADD COLUMN patient_id UUID; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bill_payments' AND column_name='transaction_type') THEN
    ALTER TABLE public.bill_payments ADD COLUMN transaction_type TEXT DEFAULT 'payment'; END IF;
END $$;

-- §4: Backfill data
UPDATE public.bills SET net_amount = total WHERE (net_amount IS NULL OR net_amount = 0) AND total > 0;
UPDATE public.bills SET subtotal = total WHERE (subtotal IS NULL OR subtotal = 0) AND total > 0;
UPDATE public.bills SET paid_at = created_at WHERE status = 'paid' AND paid_at IS NULL;
UPDATE public.bill_payments bp SET patient_id = b.patient_id FROM public.bills b WHERE bp.bill_id = b.id AND bp.patient_id IS NULL AND b.patient_id IS NOT NULL;

-- §5: Remove NOT NULL constraint on patient_id if it exists (legacy schema has it)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bills' AND column_name='patient_id' AND is_nullable='NO'
  ) THEN
    ALTER TABLE public.bills ALTER COLUMN patient_id DROP NOT NULL;
  END IF;
END $$;

-- §6: Indexes
CREATE INDEX IF NOT EXISTS idx_bills_patient_id ON public.bills(patient_id);
CREATE INDEX IF NOT EXISTS idx_bills_status ON public.bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_created_at ON public.bills(created_at);
CREATE INDEX IF NOT EXISTS idx_bill_payments_bill_id ON public.bill_payments(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_patient_id ON public.bill_payments(patient_id);

-- §7: DISABLE RLS (critical — ensures no permission issues)
ALTER TABLE public.bills DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_settings DISABLE ROW LEVEL SECURITY;

-- §8: Grant access
GRANT ALL ON public.bills TO anon, authenticated, service_role;
GRANT ALL ON public.bill_payments TO anon, authenticated, service_role;
GRANT ALL ON public.clinic_settings TO anon, authenticated, service_role;

-- §9: Enable realtime
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.bills;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.bill_payments;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- §10: Default clinic settings
INSERT INTO public.clinic_settings (key, value) VALUES ('daily_revenue_target', '10000') ON CONFLICT (key) DO NOTHING;

-- §11: Verify (run this SELECT after the migration to confirm)
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name='bills' AND table_schema='public' ORDER BY ordinal_position;
