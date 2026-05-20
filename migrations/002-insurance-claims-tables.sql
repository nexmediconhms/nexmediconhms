-- ============================================================
-- Migration 002: Insurance Claims Tables
--
-- Creates tables for the insurance claims module:
--   - insurance_claims: Main claims tracking
--   - insurance_claim_history: Status change audit trail
--   - insurance_ca_shares: Log of documents shared with CA
--
-- Safe to re-run (uses IF NOT EXISTS).
-- ============================================================

-- ── Insurance Claims ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insurance_claims (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id        UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  patient_name      TEXT NOT NULL,
  mrn               TEXT,
  policy_number     TEXT,
  tpa_name          TEXT,
  insurance_company TEXT,
  claim_amount      NUMERIC(12,2) DEFAULT 0,
  approved_amount   NUMERIC(12,2),
  status            TEXT DEFAULT 'pre_auth_pending'
                      CHECK (status IN (
                        'pre_auth_pending', 'pre_auth_approved', 'pre_auth_rejected',
                        'claim_submitted', 'under_review', 'query_raised', 'query_resolved',
                        'approved', 'partially_approved', 'rejected', 'settled'
                      )),
  admission_date    DATE,
  discharge_date    DATE,
  surgery_name      TEXT,
  diagnosis         TEXT,
  pre_auth_number   TEXT,
  claim_number      TEXT,
  settlement_utr    TEXT,
  settlement_date   DATE,
  deduction_reason  TEXT,
  documents_sent    BOOLEAN DEFAULT FALSE,
  notes             TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_insurance_claims_patient ON insurance_claims(patient_id);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_status ON insurance_claims(status);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_updated ON insurance_claims(updated_at DESC);

-- ── Insurance Claim History (Audit Trail) ─────────────────────
CREATE TABLE IF NOT EXISTS insurance_claim_history (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id    UUID NOT NULL REFERENCES insurance_claims(id) ON DELETE CASCADE,
  old_status  TEXT,
  new_status  TEXT NOT NULL,
  notes       TEXT,
  done_by     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claim_history_claim ON insurance_claim_history(claim_id);

-- ── Insurance CA Shares (Chartered Accountant shares) ─────────
CREATE TABLE IF NOT EXISTS insurance_ca_shares (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id     UUID REFERENCES insurance_claims(id) ON DELETE SET NULL,
  shared_to    TEXT NOT NULL,
  shared_by    TEXT,
  share_method TEXT DEFAULT 'whatsapp',
  documents    JSONB DEFAULT '{}'::JSONB,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE insurance_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_claim_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_ca_shares ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to manage insurance claims
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['insurance_claims', 'insurance_claim_history', 'insurance_ca_shares']
  LOOP
    EXECUTE format('
      DROP POLICY IF EXISTS allow_auth_%1$s ON %1$s;
      CREATE POLICY allow_auth_%1$s ON %1$s
        FOR ALL TO authenticated USING (true) WITH CHECK (true);
    ', tbl);
  END LOOP;
END;
$$;

-- ── Auto-update updated_at trigger ────────────────────────────
CREATE OR REPLACE FUNCTION update_insurance_claims_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_insurance_claims_updated ON insurance_claims;
CREATE TRIGGER trg_insurance_claims_updated
  BEFORE UPDATE ON insurance_claims
  FOR EACH ROW EXECUTE FUNCTION update_insurance_claims_timestamp();

-- Done!
SELECT 'Migration 002: Insurance claims tables created ✓' AS result;
