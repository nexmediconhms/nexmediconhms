-- ============================================================
-- NexMedicon HMS — Billing & Payments Table
-- Run in Supabase → SQL Editor → New Query
-- ============================================================

CREATE TABLE IF NOT EXISTS bills (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id            UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_name          TEXT NOT NULL,
  mrn                   TEXT NOT NULL,

  -- Bill items as JSONB array: [{label, amount}]
  items                 JSONB NOT NULL DEFAULT '[]'::JSONB,

  -- Amounts
  subtotal              NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount              NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_amount            NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Payment
  payment_mode          TEXT CHECK (payment_mode IN ('cash','upi','card','pending')),
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')),
  razorpay_payment_id   TEXT,
  razorpay_order_id     TEXT,

  -- Meta
  notes                 TEXT,
  created_by            TEXT,          -- doctor/staff name
  encounter_id          UUID,          -- optional link to OPD encounter

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  paid_at               TIMESTAMPTZ
);

-- RLS
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_bills ON bills;
CREATE POLICY allow_auth_bills ON bills
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bills_patient    ON bills(patient_id);
CREATE INDEX IF NOT EXISTS idx_bills_status     ON bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_created_at ON bills(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bills_encounter  ON bills(encounter_id) WHERE encounter_id IS NOT NULL;

SELECT 'bills table created ✓' AS result;

-- ── Add payment link columns (run if table already exists) ──────
ALTER TABLE bills ADD COLUMN IF NOT EXISTS payment_link_url   TEXT;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS payment_link_type  TEXT;  -- 'razorpay' | 'upi' | 'manual'
ALTER TABLE bills ADD COLUMN IF NOT EXISTS whatsapp_sent_at   TIMESTAMPTZ;
