-- ═══════════════════════════════════════════════════════════════
-- v41: IPD Consolidated Billing — Finalize to bills table
-- 
-- Adds bill_id FK to ipd_admissions so finalized IPD bills
-- get a proper invoice number and appear in billing reports.
-- ═══════════════════════════════════════════════════════════════

-- Link IPD admission to formal bill record
ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS bill_id UUID REFERENCES bills(id);

-- Index for quick lookup
CREATE INDEX IF NOT EXISTS idx_ipd_admissions_bill_id ON ipd_admissions(bill_id);

-- Ensure the invoice_number trigger exists (from v11 migration)
-- This is idempotent — won't fail if already exists
CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1001;

CREATE OR REPLACE FUNCTION set_invoice_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.invoice_number IS NULL THEN
    NEW.invoice_number := 'INV-' || TO_CHAR(NOW(), 'YYYYMM') || '-' || LPAD(nextval('invoice_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger (CREATE OR REPLACE not available for triggers, so drop first)
DROP TRIGGER IF EXISTS trg_invoice_number ON bills;
CREATE TRIGGER trg_invoice_number
  BEFORE INSERT ON bills
  FOR EACH ROW EXECUTE FUNCTION set_invoice_number();
