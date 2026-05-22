-- ============================================================
-- Migration 001: Add audit columns to bills table
-- Addresses: Payment disputes (modified_by, modified_at tracking)
--            Payment failure handling (payment_failure_reason)
-- ============================================================
-- SAFE TO RUN MULTIPLE TIMES (uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)

-- Add modification tracking columns
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS modified_by TEXT;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS modified_at TIMESTAMPTZ;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS modification_reason TEXT;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS original_amount NUMERIC(10,2);

-- Add payment failure tracking
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS payment_failure_reason TEXT;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS payment_failed_at TIMESTAMPTZ;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS payment_retry_count INTEGER DEFAULT 0;

-- Add bill_payments failure columns
ALTER TABLE public.bill_payments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'success';
ALTER TABLE public.bill_payments ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE public.bill_payments ADD COLUMN IF NOT EXISTS marked_failed_by TEXT;
ALTER TABLE public.bill_payments ADD COLUMN IF NOT EXISTS marked_failed_at TIMESTAMPTZ;

-- Index for quick audit lookups
CREATE INDEX IF NOT EXISTS idx_bills_modified_at ON public.bills(modified_at) WHERE modified_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bill_payments_status ON public.bill_payments(status);

-- ============================================================
-- Trigger: Auto-set modified_at on any UPDATE to bills
-- ============================================================
CREATE OR REPLACE FUNCTION update_bill_modified_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.modified_at = NOW();
  -- Preserve original amount on first modification
  IF OLD.original_amount IS NULL AND NEW.total != OLD.total THEN
    NEW.original_amount = OLD.total;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bills_modified_at ON public.bills;
CREATE TRIGGER trg_bills_modified_at
  BEFORE UPDATE ON public.bills
  FOR EACH ROW
  EXECUTE FUNCTION update_bill_modified_at();
