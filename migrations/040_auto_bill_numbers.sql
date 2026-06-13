-- Migration 040: Auto-generate Bill Numbers
-- Backfills existing bills without an invoice_number
-- and creates a trigger to auto-generate for new inserts.
-- SAFE: Fully idempotent.

-- Create a sequence for bill numbers (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bill_number_seq') THEN
    CREATE SEQUENCE bill_number_seq START WITH 1001;
  END IF;
END $$;

-- Backfill existing bills that have no invoice_number
DO $$
DECLARE
  rec RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='bills' AND column_name='invoice_number') THEN
    FOR rec IN
      SELECT id FROM public.bills
      WHERE invoice_number IS NULL OR invoice_number = ''
      ORDER BY created_at ASC
    LOOP
      UPDATE public.bills
      SET invoice_number = 'BILL-' || LPAD(nextval('bill_number_seq')::TEXT, 6, '0')
      WHERE id = rec.id;
    END LOOP;
  END IF;
END $$;

-- Create a trigger function to auto-assign bill number on insert
CREATE OR REPLACE FUNCTION public.auto_assign_bill_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    NEW.invoice_number := 'BILL-' || LPAD(nextval('bill_number_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Attach trigger (create or replace)
DROP TRIGGER IF EXISTS trg_auto_bill_number ON public.bills;
CREATE TRIGGER trg_auto_bill_number
  BEFORE INSERT ON public.bills
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_bill_number();

-- Reload schema cache
NOTIFY pgrst, 'reload schema';

SELECT 'Migration 040: Bill number auto-generation complete' AS result;
