-- ============================================================
-- Migration 010: Sequential Bill Numbers + Finance Auto-Sync
--
-- This migration adds:
--   1. bill_module column to bills (OPD/IPD)
--   2. is_deleted / deleted_at / deleted_by for soft-delete
--   3. idempotency_key for duplicate prevention
--   4. bill_id FK on hospital_fund for cross-module sync
--   5. Advisory lock helper functions
--   6. Unique constraint on invoice_number (non-deleted bills only)
--   7. Bill counter sequence view for gap recovery
--   8. Trigger to auto-sync paid bills to hospital_fund
--   9. insurance_patient_list view for desync fix
--  10. payment_history_view for date-range queries
--  11. lab_partner enhancements (test list, commission config)
-- ============================================================

-- ── §1 Bills table enhancements ──────────────────────────────────

-- Module identifier (OPD or IPD)
ALTER TABLE bills ADD COLUMN IF NOT EXISTS bill_module TEXT DEFAULT 'OPD';

-- Soft-delete columns
ALTER TABLE bills ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS deleted_by TEXT;

-- Idempotency key for duplicate prevention
ALTER TABLE bills ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- IPD admission reference
ALTER TABLE bills ADD COLUMN IF NOT EXISTS admission_id UUID;

-- Created by (user who generated the bill)
ALTER TABLE bills ADD COLUMN IF NOT EXISTS created_by TEXT;

-- Paid at timestamp
ALTER TABLE bills ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- GST fields (may already exist from earlier migrations)
ALTER TABLE bills ADD COLUMN IF NOT EXISTS gst_percent NUMERIC(5,2) DEFAULT 0;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(10,2) DEFAULT 0;

-- Net amount (after discount + GST)
ALTER TABLE bills ADD COLUMN IF NOT EXISTS net_amount NUMERIC(10,2) DEFAULT 0;

-- Encounter reference
ALTER TABLE bills ADD COLUMN IF NOT EXISTS encounter_id UUID;

-- Razorpay payment ID
ALTER TABLE bills ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT;

-- Patient name & MRN denormalized for performance
ALTER TABLE bills ADD COLUMN IF NOT EXISTS patient_name TEXT;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS mrn TEXT;

-- ── §2 Unique partial index on invoice_number (non-deleted only) ─

-- Drop existing unique constraint if it exists (may conflict)
-- We use a partial unique index so deleted bills don't block reuse
DROP INDEX IF EXISTS idx_bills_invoice_number_unique;
CREATE UNIQUE INDEX idx_bills_invoice_number_unique
  ON bills (invoice_number)
  WHERE is_deleted = FALSE AND invoice_number IS NOT NULL;

-- Index for idempotency lookups
CREATE INDEX IF NOT EXISTS idx_bills_idempotency_key
  ON bills (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Index for module+month sequential queries
CREATE INDEX IF NOT EXISTS idx_bills_module_invoice
  ON bills (bill_module, invoice_number DESC)
  WHERE is_deleted = FALSE;

-- ── §3 Hospital Fund enhancements ────────────────────────────────

-- Link fund entries back to their source bill
ALTER TABLE hospital_fund ADD COLUMN IF NOT EXISTS bill_id UUID;
ALTER TABLE hospital_fund ADD COLUMN IF NOT EXISTS submitted_by TEXT;

-- Index for bill-linked fund entries
CREATE INDEX IF NOT EXISTS idx_hospital_fund_bill_id
  ON hospital_fund (bill_id)
  WHERE bill_id IS NOT NULL;

-- ── §4 Advisory Lock Helper Functions ────────────────────────────

-- Wrapper for pg_advisory_lock that can be called via Supabase RPC
CREATE OR REPLACE FUNCTION pg_advisory_lock(lock_key BIGINT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM pg_advisory_lock(lock_key);
END;
$$;

CREATE OR REPLACE FUNCTION pg_advisory_unlock(lock_key BIGINT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM pg_advisory_unlock(lock_key);
END;
$$;

-- ── §5 Finance Auto-Sync Trigger ─────────────────────────────────
-- Automatically creates a hospital_fund entry when a bill is marked paid

CREATE OR REPLACE FUNCTION sync_bill_to_finance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only fire when status changes to 'paid'
  IF NEW.status = 'paid' AND (OLD.status IS NULL OR OLD.status != 'paid') THEN
    -- Check if a fund entry already exists for this bill (prevent duplicates)
    IF NOT EXISTS (
      SELECT 1 FROM hospital_fund WHERE bill_id = NEW.id AND type = 'income'
    ) THEN
      INSERT INTO hospital_fund (type, amount, category, description, submitted_by, status, bill_id)
      VALUES (
        'income',
        COALESCE(NEW.net_amount, NEW.total, 0),
        CASE WHEN NEW.bill_module = 'IPD' THEN 'ipd_billing' ELSE 'opd_billing' END,
        COALESCE(NEW.bill_module, 'OPD') || ' Bill ' ||
          COALESCE(NEW.invoice_number, LEFT(NEW.id::text, 8)) || ' — ' ||
          COALESCE(NEW.patient_name, 'Patient'),
        COALESCE(NEW.created_by, 'system'),
        'approved',
        NEW.id
      );
    END IF;
  END IF;

  -- Handle soft-delete reversal
  IF NEW.is_deleted = TRUE AND (OLD.is_deleted IS NULL OR OLD.is_deleted = FALSE) THEN
    INSERT INTO hospital_fund (type, amount, category, description, submitted_by, status, bill_id)
    VALUES (
      'reversal',
      -(COALESCE(NEW.net_amount, NEW.total, 0)),
      'bill_reversal',
      'Reversed: ' || COALESCE(NEW.invoice_number, LEFT(NEW.id::text, 8)) ||
        ' — ' || COALESCE(NEW.deleted_by, 'admin'),
      COALESCE(NEW.deleted_by, 'system'),
      'approved',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger (drop first to be idempotent)
DROP TRIGGER IF EXISTS trg_sync_bill_to_finance ON bills;
CREATE TRIGGER trg_sync_bill_to_finance
  AFTER INSERT OR UPDATE ON bills
  FOR EACH ROW
  EXECUTE FUNCTION sync_bill_to_finance();

-- ── §6 Insurance Patient List View ──────────────────────────────
-- Materialized view joining patients with insurance flags to claims

CREATE OR REPLACE VIEW insured_patients_list AS
SELECT
  p.id AS patient_id,
  p.full_name AS patient_name,
  p.mrn,
  p.mobile,
  p.mediclaim,
  p.cashless,
  p.insurance_name,
  p.insurance_id,
  p.policy_tpa_name,
  p.policy_number,
  p.created_at AS registered_at,
  CASE
    WHEN p.mediclaim IN ('Yes', 'true', 'TRUE') THEN TRUE
    WHEN p.cashless IN ('Yes', 'true', 'TRUE') THEN TRUE
    WHEN p.policy_tpa_name IS NOT NULL AND p.policy_tpa_name != '' THEN TRUE
    WHEN p.insurance_name IS NOT NULL AND p.insurance_name != '' THEN TRUE
    ELSE FALSE
  END AS is_insured,
  ic.id AS latest_claim_id,
  ic.status AS latest_claim_status,
  ic.claim_amount AS latest_claim_amount,
  ic.approved_amount AS latest_approved_amount,
  (SELECT COUNT(*) FROM insurance_claims WHERE patient_id = p.id) AS total_claims
FROM patients p
LEFT JOIN LATERAL (
  SELECT id, status, claim_amount, approved_amount
  FROM insurance_claims
  WHERE patient_id = p.id
  ORDER BY created_at DESC
  LIMIT 1
) ic ON TRUE
WHERE
  p.is_active = TRUE
  AND (
    p.mediclaim IN ('Yes', 'true', 'TRUE')
    OR p.cashless IN ('Yes', 'true', 'TRUE')
    OR (p.policy_tpa_name IS NOT NULL AND p.policy_tpa_name != '')
    OR (p.insurance_name IS NOT NULL AND p.insurance_name != '')
    OR (p.insurance_id IS NOT NULL AND p.insurance_id != '')
  );

-- ── §7 Payment History Function (with date range) ───────────────
-- Returns all payments for a patient within a date range, properly
-- handling timezone normalization (IST → UTC boundaries)

CREATE OR REPLACE FUNCTION get_patient_payment_history(
  p_patient_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
  payment_id UUID,
  bill_id UUID,
  invoice_number TEXT,
  amount NUMERIC,
  payment_mode TEXT,
  payment_date TIMESTAMPTZ,
  bill_total NUMERIC,
  bill_status TEXT,
  patient_name TEXT,
  mrn TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    bp.id AS payment_id,
    bp.bill_id,
    b.invoice_number,
    bp.amount,
    bp.payment_mode,
    bp.created_at AS payment_date,
    COALESCE(b.net_amount, b.total) AS bill_total,
    b.status AS bill_status,
    b.patient_name,
    b.mrn
  FROM bill_payments bp
  JOIN bills b ON b.id = bp.bill_id
  WHERE bp.patient_id = p_patient_id
    AND (p_start_date IS NULL OR bp.created_at >= (p_start_date::TIMESTAMP AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC')
    AND (p_end_date IS NULL OR bp.created_at < ((p_end_date + INTERVAL '1 day')::TIMESTAMP AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC')
    AND (b.is_deleted IS NULL OR b.is_deleted = FALSE)
  ORDER BY bp.created_at DESC;
END;
$$;

-- ── §8 Lab Partner Enhancements ─────────────────────────────────

-- Test-level commission configuration
ALTER TABLE lab_partners ADD COLUMN IF NOT EXISTS test_commissions JSONB DEFAULT '[]';
-- Format: [{ "test_name": "CBC", "hospital_pct": 40, "lab_pct": 60, "base_price": 300 }]

-- Default commission when test-specific not found
ALTER TABLE lab_partners ADD COLUMN IF NOT EXISTS default_hospital_pct NUMERIC(5,2) DEFAULT 30;
ALTER TABLE lab_partners ADD COLUMN IF NOT EXISTS default_lab_pct NUMERIC(5,2) DEFAULT 70;

-- Portal access fields
ALTER TABLE lab_partners ADD COLUMN IF NOT EXISTS portal_token TEXT;
ALTER TABLE lab_partners ADD COLUMN IF NOT EXISTS portal_enabled BOOLEAN DEFAULT FALSE;

-- ── §9 Bill Payments table (ensure exists) ───────────────────────

CREATE TABLE IF NOT EXISTS bill_payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id),
  amount NUMERIC(10,2) NOT NULL,
  payment_mode TEXT DEFAULT 'cash',
  reference TEXT,
  received_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bill_payments_bill_id ON bill_payments(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_patient_id ON bill_payments(patient_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_created_at ON bill_payments(created_at);

-- ── §10 Insurance Claims table (ensure exists) ──────────────────

CREATE TABLE IF NOT EXISTS insurance_claims (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  patient_name TEXT,
  mrn TEXT,
  policy_number TEXT,
  tpa_name TEXT,
  insurance_company TEXT,
  claim_amount NUMERIC(12,2) DEFAULT 0,
  approved_amount NUMERIC(12,2),
  status TEXT DEFAULT 'pre_auth_pending',
  diagnosis TEXT,
  surgery_name TEXT,
  admission_date DATE,
  discharge_date DATE,
  pre_auth_number TEXT,
  claim_number TEXT,
  settlement_utr TEXT,
  settlement_date DATE,
  documents_sent BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_by TEXT DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS insurance_claim_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id UUID NOT NULL REFERENCES insurance_claims(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT,
  notes TEXT,
  done_by TEXT DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── §11 Trigger: Auto-update insured patient registry on patient save ─

CREATE OR REPLACE FUNCTION notify_insurance_on_patient_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- When a patient's insurance fields change, notify the insurance module
  -- via pg_notify so real-time subscribers can refresh
  IF (
    COALESCE(NEW.mediclaim, '') != COALESCE(OLD.mediclaim, '') OR
    COALESCE(NEW.cashless, '') != COALESCE(OLD.cashless, '') OR
    COALESCE(NEW.policy_tpa_name, '') != COALESCE(OLD.policy_tpa_name, '') OR
    COALESCE(NEW.insurance_name, '') != COALESCE(OLD.insurance_name, '') OR
    COALESCE(NEW.insurance_id, '') != COALESCE(OLD.insurance_id, '')
  ) THEN
    PERFORM pg_notify('insurance_patient_update', json_build_object(
      'patient_id', NEW.id,
      'patient_name', NEW.full_name,
      'mediclaim', NEW.mediclaim,
      'cashless', NEW.cashless,
      'policy_tpa_name', NEW.policy_tpa_name,
      'event', 'patient_insurance_updated'
    )::text);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_patient_insurance_notify ON patients;
CREATE TRIGGER trg_patient_insurance_notify
  AFTER UPDATE ON patients
  FOR EACH ROW
  EXECUTE FUNCTION notify_insurance_on_patient_update();

-- ── §12 Pharmacy medicines table for Excel/CSV import ────────────

CREATE TABLE IF NOT EXISTS pharmacy_medicines (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  generic_name TEXT,
  brand_name TEXT,
  sku_code TEXT,
  form TEXT DEFAULT 'tablet',
  strength TEXT,
  category TEXT,
  manufacturer TEXT,
  mrp NUMERIC(10,2),
  selling_price NUMERIC(10,2),
  current_stock INTEGER DEFAULT 0,
  min_stock INTEGER DEFAULT 10,
  unit TEXT DEFAULT 'strip',
  batch_number TEXT,
  expiry_date DATE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint for upsert by sku_code or name+strength
CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacy_medicines_sku
  ON pharmacy_medicines (sku_code)
  WHERE sku_code IS NOT NULL AND sku_code != '';

CREATE INDEX IF NOT EXISTS idx_pharmacy_medicines_name
  ON pharmacy_medicines (lower(name));

-- ── Done ─────────────────────────────────────────────────────────