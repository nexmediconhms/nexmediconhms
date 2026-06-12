-- ============================================================================
-- Migration 033: Billing Workflow — Consultation Fee Tracking
-- ============================================================================
--
-- PURPOSE:
--   Prevents double-billing of OPD consultation/registration fees by
--   tracking payment status at the encounter level.
--
-- ADDS TO encounters:
--   - registration_fee_paid (BOOLEAN)
--   - registration_fee_amount (NUMERIC)
--   - registration_fee_receipt (TEXT)
--   - registration_fee_paid_at (TIMESTAMPTZ)
--   - registration_fee_mode (TEXT)
--   - billing_model (TEXT) — 'upfront' or 'post_consultation'
--
-- ADDS TO opd_queue:
--   - fee_collected (BOOLEAN)
--   - fee_amount (NUMERIC)
--   - fee_receipt_number (TEXT)
--
-- CREATES:
--   - billing_guard_log — audit trail for fee payment decisions
--
-- SAFE: fully idempotent, no drops/renames.
-- ============================================================================

-- §1 ENCOUNTERS — fee tracking columns
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='encounters') THEN
    ALTER TABLE encounters ADD COLUMN IF NOT EXISTS registration_fee_paid     BOOLEAN DEFAULT FALSE;
    ALTER TABLE encounters ADD COLUMN IF NOT EXISTS registration_fee_amount   NUMERIC(10,2);
    ALTER TABLE encounters ADD COLUMN IF NOT EXISTS registration_fee_receipt  TEXT;
    ALTER TABLE encounters ADD COLUMN IF NOT EXISTS registration_fee_paid_at  TIMESTAMPTZ;
    ALTER TABLE encounters ADD COLUMN IF NOT EXISTS registration_fee_mode     TEXT;
    ALTER TABLE encounters ADD COLUMN IF NOT EXISTS billing_model             TEXT DEFAULT 'upfront';
    ALTER TABLE encounters ADD COLUMN IF NOT EXISTS additional_services_only  BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- §2 OPD_QUEUE — fee collection at registration
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='opd_queue') THEN
    ALTER TABLE opd_queue ADD COLUMN IF NOT EXISTS fee_collected       BOOLEAN DEFAULT FALSE;
    ALTER TABLE opd_queue ADD COLUMN IF NOT EXISTS fee_amount          NUMERIC(10,2);
    ALTER TABLE opd_queue ADD COLUMN IF NOT EXISTS fee_receipt_number  TEXT;
  END IF;
END $$;

-- §3 BILLS — flag to distinguish consultation fee vs additional services
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='bills') THEN
    ALTER TABLE bills ADD COLUMN IF NOT EXISTS is_registration_fee   BOOLEAN DEFAULT FALSE;
    ALTER TABLE bills ADD COLUMN IF NOT EXISTS is_additional_service BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- §4 BILLING_GUARD_LOG — audit trail for payment decisions
CREATE TABLE IF NOT EXISTS billing_guard_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id    UUID,
  patient_id      UUID NOT NULL,
  action          TEXT NOT NULL,
  reason          TEXT,
  amount          NUMERIC(10,2),
  receipt_number  TEXT,
  payment_mode    TEXT,
  performed_by    UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE billing_guard_log ADD COLUMN IF NOT EXISTS queue_entry_id  UUID;
ALTER TABLE billing_guard_log ADD COLUMN IF NOT EXISTS bill_id         UUID;

CREATE INDEX IF NOT EXISTS idx_billing_guard_encounter ON billing_guard_log (encounter_id) WHERE encounter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_billing_guard_patient   ON billing_guard_log (patient_id);

-- RLS
ALTER TABLE billing_guard_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_guard_log_all ON billing_guard_log;
CREATE POLICY billing_guard_log_all ON billing_guard_log FOR ALL TO authenticated USING (true) WITH CHECK (true);


SELECT 'Migration 033: Billing Fee Tracking — COMPLETE' AS result;
