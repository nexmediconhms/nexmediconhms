-- ═══════════════════════════════════════════════════════════════
-- v42: Invoice Numbering — Indian Tax Compliance
--
-- Indian GST/Income Tax requirements for invoice numbering:
-- 1. Sequential (no gaps allowed per financial year)
-- 2. Unique per financial year
-- 3. Financial year runs April 1 → March 31
-- 4. Format should include: Prefix + FY + Sequential number
-- 5. Must be clearly visible on receipt/invoice
--
-- New format: NMH/2526/0001 (Hospital prefix / FY / sequence)
-- Where:
--   NMH = Hospital code (configurable via clinic_settings)
--   2526 = Financial Year 2025-26 (Apr 2025 – Mar 2026)
--   0001 = Sequential within that FY (resets each April 1)
--
-- This replaces the old format: INV-YYYYMM-NNNN
-- ═══════════════════════════════════════════════════════════════

-- Table to track invoice sequences per financial year
CREATE TABLE IF NOT EXISTS invoice_sequences (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fy_code     TEXT NOT NULL UNIQUE,  -- e.g. '2526' for FY 2025-26
  fy_start    DATE NOT NULL,         -- e.g. '2025-04-01'
  fy_end      DATE NOT NULL,         -- e.g. '2026-03-31'
  last_number INTEGER NOT NULL DEFAULT 0,
  prefix      TEXT NOT NULL DEFAULT 'NMH',  -- configurable hospital code
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE invoice_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_sequences_all ON invoice_sequences FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Function to get current Indian Financial Year code
-- e.g. if today is Jan 2026, FY is 2025-26, code = '2526'
-- if today is May 2025, FY is 2025-26, code = '2526'
CREATE OR REPLACE FUNCTION get_current_fy_code()
RETURNS TEXT AS $$
DECLARE
  today DATE := CURRENT_DATE;
  fy_start_year INTEGER;
BEGIN
  -- Indian FY starts April 1
  IF EXTRACT(MONTH FROM today) >= 4 THEN
    fy_start_year := EXTRACT(YEAR FROM today);
  ELSE
    fy_start_year := EXTRACT(YEAR FROM today) - 1;
  END IF;
  -- Return format: '2526' for FY 2025-26
  RETURN SUBSTRING(fy_start_year::TEXT FROM 3) || SUBSTRING((fy_start_year + 1)::TEXT FROM 3);
END;
$$ LANGUAGE plpgsql;

-- Function to generate next invoice number (atomic, gap-free)
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TEXT AS $$
DECLARE
  fy TEXT;
  fy_start DATE;
  fy_end DATE;
  next_num INTEGER;
  prefix TEXT;
  fy_start_year INTEGER;
BEGIN
  -- Get current FY
  IF EXTRACT(MONTH FROM CURRENT_DATE) >= 4 THEN
    fy_start_year := EXTRACT(YEAR FROM CURRENT_DATE);
  ELSE
    fy_start_year := EXTRACT(YEAR FROM CURRENT_DATE) - 1;
  END IF;
  
  fy := SUBSTRING(fy_start_year::TEXT FROM 3) || SUBSTRING((fy_start_year + 1)::TEXT FROM 3);
  fy_start := (fy_start_year || '-04-01')::DATE;
  fy_end := ((fy_start_year + 1) || '-03-31')::DATE;

  -- Get or create sequence for this FY (with row lock for concurrency)
  INSERT INTO invoice_sequences (fy_code, fy_start, fy_end, last_number, prefix)
  VALUES (fy, fy_start, fy_end, 0, 'NMH')
  ON CONFLICT (fy_code) DO NOTHING;

  -- Atomically increment and get next number
  UPDATE invoice_sequences
  SET last_number = last_number + 1,
      updated_at = NOW()
  WHERE fy_code = fy
  RETURNING last_number, invoice_sequences.prefix INTO next_num, prefix;

  -- Format: NMH/2526/0001
  RETURN prefix || '/' || fy || '/' || LPAD(next_num::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- Replace the old invoice number trigger with FY-aware version
CREATE OR REPLACE FUNCTION set_invoice_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    NEW.invoice_number := generate_invoice_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-create trigger (idempotent)
DROP TRIGGER IF EXISTS trg_invoice_number ON bills;
CREATE TRIGGER trg_invoice_number
  BEFORE INSERT ON bills
  FOR EACH ROW EXECUTE FUNCTION set_invoice_number();

-- Seed the current FY sequence (so first invoice starts from 1)
-- This is safe to run multiple times due to ON CONFLICT DO NOTHING
DO $$
DECLARE
  fy TEXT;
  fy_start DATE;
  fy_end DATE;
  fy_start_year INTEGER;
BEGIN
  IF EXTRACT(MONTH FROM CURRENT_DATE) >= 4 THEN
    fy_start_year := EXTRACT(YEAR FROM CURRENT_DATE);
  ELSE
    fy_start_year := EXTRACT(YEAR FROM CURRENT_DATE) - 1;
  END IF;
  
  fy := SUBSTRING(fy_start_year::TEXT FROM 3) || SUBSTRING((fy_start_year + 1)::TEXT FROM 3);
  fy_start := (fy_start_year || '-04-01')::DATE;
  fy_end := ((fy_start_year + 1) || '-03-31')::DATE;

  INSERT INTO invoice_sequences (fy_code, fy_start, fy_end, last_number, prefix)
  VALUES (fy, fy_start, fy_end, 0, 'NMH')
  ON CONFLICT (fy_code) DO NOTHING;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- VERIFICATION QUERY (run this to test):
-- SELECT generate_invoice_number();
-- Expected: 'NMH/2526/0001' (first run), 'NMH/2526/0002' (second), etc.
--
-- To check for gaps:
-- SELECT invoice_number, created_at FROM bills 
-- WHERE invoice_number LIKE 'NMH/2526/%' 
-- ORDER BY invoice_number;
--
-- To change hospital prefix:
-- UPDATE invoice_sequences SET prefix = 'YourCode' WHERE fy_code = '2526';
-- ═══════════════════════════════════════════════════════════════
