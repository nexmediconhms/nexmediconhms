-- ============================================================
-- NexMedicon HMS v20 — Missing Features Migration
-- ============================================================
-- This migration adds tables and columns for:
--   1. Lab test pricing (per-test revenue sharing)
--   2. IPD structured charges (bed, nursing, OT, etc.)
--   3. Fund expense reporting columns
--
-- Run this ONCE in Supabase → SQL Editor → New Query.
-- Safe to re-run (uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- ============================================================

-- ═══════════════════════════════════════════════════════════════
-- 1. LAB TEST PRICING — Per-test revenue sharing percentages
-- ═══════════════════════════════════════════════════════════════
-- Allows configuring different % splits per test type.
-- Falls back to lab_partners.hospital_pct if no override exists.

CREATE TABLE IF NOT EXISTS lab_test_pricing (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id    UUID NOT NULL REFERENCES lab_partners(id) ON DELETE CASCADE,
  test_name     TEXT NOT NULL,
  test_amount   NUMERIC(10,2) NOT NULL DEFAULT 0,
  hospital_pct  NUMERIC(5,2) NOT NULL DEFAULT 60,
  lab_pct       NUMERIC(5,2) NOT NULL DEFAULT 40,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(partner_id, test_name)
);

CREATE INDEX IF NOT EXISTS idx_lab_test_pricing_partner ON lab_test_pricing(partner_id);
CREATE INDEX IF NOT EXISTS idx_lab_test_pricing_test ON lab_test_pricing(test_name);

-- RLS
ALTER TABLE lab_test_pricing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lab_test_pricing_select ON lab_test_pricing;
DROP POLICY IF EXISTS lab_test_pricing_insert ON lab_test_pricing;
DROP POLICY IF EXISTS lab_test_pricing_update ON lab_test_pricing;
DROP POLICY IF EXISTS lab_test_pricing_delete ON lab_test_pricing;

CREATE POLICY lab_test_pricing_select ON lab_test_pricing
  FOR SELECT TO authenticated USING (true);
CREATE POLICY lab_test_pricing_insert ON lab_test_pricing
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY lab_test_pricing_update ON lab_test_pricing
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY lab_test_pricing_delete ON lab_test_pricing
  FOR DELETE TO authenticated USING (true);

-- ═══════════════════════════════════════════════════════════════
-- 2. LAB REPORTS — Add partner & amount columns
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS lab_partner_id UUID REFERENCES lab_partners(id) ON DELETE SET NULL;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS total_amount NUMERIC(10,2) DEFAULT 0;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS hospital_amount NUMERIC(10,2) DEFAULT 0;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS lab_amount NUMERIC(10,2) DEFAULT 0;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS payment_mode TEXT DEFAULT 'cash' CHECK (payment_mode IN ('cash', 'upi', 'card'));
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'paid' CHECK (payment_status IN ('paid', 'pending'));

CREATE INDEX IF NOT EXISTS idx_lab_reports_partner ON lab_reports(lab_partner_id);
CREATE INDEX IF NOT EXISTS idx_lab_reports_payment ON lab_reports(payment_mode, payment_status);

-- ═══════════════════════════════════════════════════════════════
-- 3. IPD CHARGES — Structured indoor billing
-- ═══════════════════════════════════════════════════════════════
-- Each charge row belongs to an IPD admission.
-- Categories: bed, nursing, doctor_visit, surgical, ot, procedure, medicine, investigation, other

CREATE TABLE IF NOT EXISTS ipd_charges (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  admission_id    UUID NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  charge_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  category        TEXT NOT NULL CHECK (category IN (
    'bed', 'nursing', 'doctor_visit', 'surgical', 'ot',
    'procedure', 'medicine', 'investigation', 'other'
  )),
  description     TEXT NOT NULL,
  quantity        NUMERIC(6,2) NOT NULL DEFAULT 1,
  rate            NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount          NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes           TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ipd_charges_admission ON ipd_charges(admission_id);
CREATE INDEX IF NOT EXISTS idx_ipd_charges_patient ON ipd_charges(patient_id);
CREATE INDEX IF NOT EXISTS idx_ipd_charges_date ON ipd_charges(charge_date);
CREATE INDEX IF NOT EXISTS idx_ipd_charges_category ON ipd_charges(category);

-- RLS
ALTER TABLE ipd_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ipd_charges_select ON ipd_charges;
DROP POLICY IF EXISTS ipd_charges_insert ON ipd_charges;
DROP POLICY IF EXISTS ipd_charges_update ON ipd_charges;
DROP POLICY IF EXISTS ipd_charges_delete ON ipd_charges;

CREATE POLICY ipd_charges_select ON ipd_charges
  FOR SELECT TO authenticated USING (true);
CREATE POLICY ipd_charges_insert ON ipd_charges
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY ipd_charges_update ON ipd_charges
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY ipd_charges_delete ON ipd_charges
  FOR DELETE TO authenticated USING (true);

-- ═══════════════════════════════════════════════════════════════
-- 4. IPD CHARGE RATES — Default rates per category
-- ═══════════════════════════════════════════════════════════════
-- Stores hospital's default per-day rates for each charge type.

CREATE TABLE IF NOT EXISTS ipd_charge_rates (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category    TEXT NOT NULL,
  description TEXT NOT NULL,
  default_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  per_unit    TEXT DEFAULT 'per day',
  is_active   BOOLEAN DEFAULT TRUE,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(category, description)
);

ALTER TABLE ipd_charge_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ipd_charge_rates_select ON ipd_charge_rates;
DROP POLICY IF EXISTS ipd_charge_rates_insert ON ipd_charge_rates;
DROP POLICY IF EXISTS ipd_charge_rates_update ON ipd_charge_rates;
DROP POLICY IF EXISTS ipd_charge_rates_delete ON ipd_charge_rates;

CREATE POLICY ipd_charge_rates_select ON ipd_charge_rates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY ipd_charge_rates_insert ON ipd_charge_rates
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY ipd_charge_rates_update ON ipd_charge_rates
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY ipd_charge_rates_delete ON ipd_charge_rates
  FOR DELETE TO authenticated USING (true);

-- Seed default IPD charge rates
INSERT INTO ipd_charge_rates (category, description, default_rate, per_unit, sort_order) VALUES
  ('bed',           'General Ward Bed',        800,   'per day',     1),
  ('bed',           'Semi-Private Room',       1500,  'per day',     2),
  ('bed',           'Private Room',            2500,  'per day',     3),
  ('bed',           'ICU Bed',                 5000,  'per day',     4),
  ('nursing',       'Nursing Charges',         500,   'per day',     5),
  ('nursing',       'Special Nursing (ICU)',    1000,  'per day',     6),
  ('doctor_visit',  'Doctor Visit',            500,   'per visit',   7),
  ('doctor_visit',  'Specialist Consultation', 1000,  'per visit',   8),
  ('surgical',      'Minor Surgery',           5000,  'per procedure', 9),
  ('surgical',      'Major Surgery',           15000, 'per procedure', 10),
  ('ot',            'OT Charges (Minor)',       3000,  'per use',     11),
  ('ot',            'OT Charges (Major)',       8000,  'per use',     12),
  ('procedure',     'Dressing',                200,   'per procedure', 13),
  ('procedure',     'Catheterization',         500,   'per procedure', 14),
  ('procedure',     'IV Cannulation',          300,   'per procedure', 15),
  ('medicine',      'IV Fluids',               150,   'per unit',    16),
  ('medicine',      'Injection',               100,   'per unit',    17),
  ('investigation', 'Blood Test (CBC)',         300,   'per test',    18),
  ('investigation', 'USG',                     1200,  'per test',    19),
  ('other',         'Miscellaneous',           0,     'per unit',    20)
ON CONFLICT (category, description) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 5. IPD ADMISSIONS — Add discharge_date and billing columns
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS discharge_date TIMESTAMPTZ;
ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS total_charges NUMERIC(10,2) DEFAULT 0;
ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS discount NUMERIC(10,2) DEFAULT 0;
ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS net_bill NUMERIC(10,2) DEFAULT 0;
ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS bill_status TEXT DEFAULT 'pending' CHECK (bill_status IN ('pending', 'partial', 'paid'));
ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS payment_mode TEXT CHECK (payment_mode IN ('cash', 'upi', 'card', 'mixed'));

-- ═══════════════════════════════════════════════════════════════
-- 6. HOSPITAL FUND — Add date index for efficient filtering
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_hospital_fund_created ON hospital_fund(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hospital_fund_status ON hospital_fund(status);
CREATE INDEX IF NOT EXISTS idx_hospital_fund_type ON hospital_fund(type);

-- ═══════════════════════════════════════════════════════════════
-- 7. LAB PARTNERS — Ensure table exists with correct schema
-- ═══════════════════════════════════════════════════════════════

-- Add if missing (safe — IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS lab_partners (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name          TEXT NOT NULL,
  contact       TEXT,
  hospital_pct  NUMERIC(5,2) NOT NULL DEFAULT 60,
  lab_pct       NUMERIC(5,2) NOT NULL DEFAULT 40,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE lab_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lab_partners_select ON lab_partners;
DROP POLICY IF EXISTS lab_partners_insert ON lab_partners;
DROP POLICY IF EXISTS lab_partners_update ON lab_partners;
DROP POLICY IF EXISTS lab_partners_delete ON lab_partners;

CREATE POLICY lab_partners_select ON lab_partners
  FOR SELECT TO authenticated USING (true);
CREATE POLICY lab_partners_insert ON lab_partners
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY lab_partners_update ON lab_partners
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY lab_partners_delete ON lab_partners
  FOR DELETE TO authenticated USING (true);

-- ============================================================
-- DONE. Tables created:
--   - lab_test_pricing (per-test % overrides)
--   - ipd_charges (structured indoor billing charges)
--   - ipd_charge_rates (default rate templates)
--
-- Columns added:
--   - lab_reports: lab_partner_id, total_amount, hospital_amount, lab_amount, payment_mode, payment_status
--   - ipd_admissions: discharge_date, total_charges, discount, net_bill, bill_status, payment_mode
--
-- Indexes added:
--   - hospital_fund: created_at, status, type (for date filtering)
--   - lab_reports: partner, payment
--   - ipd_charges: admission, patient, date, category
-- ============================================================
