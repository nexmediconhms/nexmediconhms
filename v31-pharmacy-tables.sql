-- ============================================================
-- NexMedicon HMS — v31 Pharmacy/Inventory Tables
--
-- Creates all tables required by the Pharmacy module:
--   1. pharmacy_medicines — master medicine catalog
--   2. pharmacy_batches — batch/expiry tracking
--   3. pharmacy_stock_log — audit trail for all stock changes
--
-- Safe to run multiple times (IF NOT EXISTS).
-- Run AFTER v30-fix-all-issues.sql
-- ============================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. PHARMACY MEDICINES (Master Catalog)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pharmacy_medicines (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,
  generic_name    TEXT,
  brand_name      TEXT,
  form            TEXT NOT NULL DEFAULT 'tablet',
  strength        TEXT,
  category        TEXT DEFAULT 'Other',
  manufacturer    TEXT,
  mrp             NUMERIC(10,2),
  purchase_price  NUMERIC(10,2),
  selling_price   NUMERIC(10,2),
  current_stock   INTEGER NOT NULL DEFAULT 0,
  min_stock       INTEGER NOT NULL DEFAULT 10,
  unit            TEXT NOT NULL DEFAULT 'strip',
  hsn_code        TEXT,              -- GST HSN code
  gst_percent     NUMERIC(4,2) DEFAULT 0,
  rack_location   TEXT,              -- e.g. "Shelf A, Row 3"
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast search
CREATE INDEX IF NOT EXISTS idx_pharmacy_med_name
  ON pharmacy_medicines USING gin(to_tsvector('simple', name));
CREATE INDEX IF NOT EXISTS idx_pharmacy_med_generic
  ON pharmacy_medicines(generic_name);
CREATE INDEX IF NOT EXISTS idx_pharmacy_med_active
  ON pharmacy_medicines(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_pharmacy_med_stock
  ON pharmacy_medicines(current_stock) WHERE is_active = TRUE;

-- RLS
ALTER TABLE pharmacy_medicines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_pharmacy_medicines ON pharmacy_medicines;
CREATE POLICY allow_auth_pharmacy_medicines ON pharmacy_medicines
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ═══════════════════════════════════════════════════════════════
-- 2. PHARMACY BATCHES (Batch & Expiry Tracking)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pharmacy_batches (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  medicine_id     UUID NOT NULL REFERENCES pharmacy_medicines(id) ON DELETE CASCADE,
  batch_number    TEXT NOT NULL,
  expiry_date     DATE NOT NULL,
  quantity        INTEGER NOT NULL DEFAULT 0,
  purchase_price  NUMERIC(10,2),
  supplier        TEXT,
  received_date   DATE DEFAULT CURRENT_DATE,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_batch_med
  ON pharmacy_batches(medicine_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_batch_expiry
  ON pharmacy_batches(expiry_date);
CREATE INDEX IF NOT EXISTS idx_pharmacy_batch_active
  ON pharmacy_batches(is_active, expiry_date)
  WHERE is_active = TRUE;

-- RLS
ALTER TABLE pharmacy_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_pharmacy_batches ON pharmacy_batches;
CREATE POLICY allow_auth_pharmacy_batches ON pharmacy_batches
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ═══════════════════════════════════════════════════════════════
-- 3. PHARMACY STOCK LOG (Audit Trail)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pharmacy_stock_log (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  medicine_id     UUID NOT NULL REFERENCES pharmacy_medicines(id) ON DELETE CASCADE,
  batch_id        UUID REFERENCES pharmacy_batches(id) ON DELETE SET NULL,
  type            TEXT NOT NULL CHECK (type IN ('purchase', 'dispense', 'adjustment', 'return', 'expired', 'damage')),
  quantity        INTEGER NOT NULL,          -- positive for IN, negative for OUT
  reference_id    TEXT,                      -- prescription ID, bill ID, etc.
  notes           TEXT,
  done_by         TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_log_med
  ON pharmacy_stock_log(medicine_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_log_type
  ON pharmacy_stock_log(type);
CREATE INDEX IF NOT EXISTS idx_pharmacy_log_date
  ON pharmacy_stock_log(created_at);

-- RLS
ALTER TABLE pharmacy_stock_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_pharmacy_stock_log ON pharmacy_stock_log;
CREATE POLICY allow_auth_pharmacy_stock_log ON pharmacy_stock_log
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ═══════════════════════════════════════════════════════════════
-- 4. ADD lab_reports COLUMNS (for auto-import feature)
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lab_reports') THEN
    EXECUTE 'ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS source TEXT DEFAULT ''manual''';
    EXECUTE 'ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS lab_partner_name TEXT';
    EXECUTE 'ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS attachment_url TEXT';
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- DONE
-- ═══════════════════════════════════════════════════════════════
SELECT 'v31 Pharmacy tables + lab_reports columns created successfully' AS result;
