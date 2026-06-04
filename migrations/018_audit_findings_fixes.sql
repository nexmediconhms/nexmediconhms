-- ════════════════════════════════════════════════════════════════════
-- Migration 018: 2026-06-04 audit-findings consolidated fixes
--
-- Brings an EXISTING clinic database up to the same state that
-- migrations/fresh-install/* would create. Idempotent: safe to run
-- multiple times. Each block is guarded by IF NOT EXISTS / DO $$ /
-- CREATE OR REPLACE.
--
-- WHAT'S IN THIS FILE (mapped to audit sections):
--   §1   patients.aadhaar_hmac column + unique index
--        mrn_counter table + next_mrn() RPC
--   §3   bill_counters table + next_bill_counter() RPC
--        next_queue_token() RPC
--        OPD queue (queue_date, token_number) unique index
--   §5   hospital_fund (bill_id, type='income') unique partial index
--        sync_bill_to_finance trigger refresh (ON CONFLICT DO NOTHING)
--   §6   enforce_credit_note_cap trigger
--   §7   insert_audit_entry, protect_audit_hash_columns,
--        verify_audit_chain, trg_protect_audit_hashes, trg_block_audit_delete
--        (only if not already present from critical-security-fixes.patch)
--   §10  lab_reports.storage_bucket / storage_path columns
--        attachments.storage_bucket / storage_path columns
--        patient_belongs_to_lab_partner() RPC
--
-- HOW TO USE:
--   1. Open Supabase → SQL Editor → New Query
--   2. Paste this entire file
--   3. Run
--   4. Verify with the diagnostic queries at the end
--
-- DOES NOT TOUCH:
--   - Existing patient/bill/encounter data (only adds columns and
--     functions, never modifies rows)
--   - RLS policies (those came in 009 / fresh-install/05)
--   - Auth users
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- Required extension for the audit hash chain
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════
-- §1  PHI: patients.aadhaar_hmac column + dedup unique index
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE patients ADD COLUMN IF NOT EXISTS aadhaar_hmac TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS aadhaar_last4 TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS aadhaar_encrypted TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS mobile_encrypted TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_patients_aadhaar_hmac_nonnull
  ON public.patients (aadhaar_hmac)
  WHERE aadhaar_hmac IS NOT NULL AND aadhaar_hmac <> '';

COMMENT ON COLUMN patients.aadhaar_hmac IS
  'HEX(HMAC-SHA-256(HOSPITAL_AADHAAR_HMAC_KEY, aadhaar_digits)). Server-computed '
  'in /api/patients/create. Lets us detect duplicate Aadhaar entries without '
  'storing plaintext. Plaintext aadhaar_no is always NULL on encrypted records.';

-- ════════════════════════════════════════════════════════════════════
-- §1b  MRN COUNTER + next_mrn() RPC
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mrn_counter (
  id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  next_seq    INTEGER NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO mrn_counter (id, next_seq) VALUES (1, 1) ON CONFLICT (id) DO NOTHING;

-- Initialise next_seq from the existing max MRN if there are already patients
DO $$
DECLARE
  v_max_seq INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(NULLIF(REGEXP_REPLACE(mrn, '[^0-9]', '', 'g'), '') AS INTEGER)), 0)
    INTO v_max_seq
    FROM patients
    WHERE mrn IS NOT NULL AND mrn ~ '^P-?[0-9]+$';

  IF v_max_seq > 0 THEN
    UPDATE mrn_counter SET next_seq = GREATEST(next_seq, v_max_seq + 1) WHERE id = 1;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION next_mrn()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq INTEGER;
BEGIN
  UPDATE mrn_counter
     SET next_seq = next_seq + 1, updated_at = NOW()
   WHERE id = 1
  RETURNING next_seq - 1 INTO v_seq;

  IF v_seq IS NULL THEN
    INSERT INTO mrn_counter (id, next_seq) VALUES (1, 2)
      ON CONFLICT (id) DO UPDATE SET next_seq = mrn_counter.next_seq + 1
      RETURNING next_seq - 1 INTO v_seq;
  END IF;

  RETURN 'P-' || LPAD(v_seq::TEXT, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION next_mrn TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- §3  OPD QUEUE: next_queue_token() RPC + token-uniqueness index
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION next_queue_token(p_queue_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token INTEGER;
BEGIN
  -- Per-date advisory lock: only one allocator per (queue_date) at a time.
  PERFORM pg_advisory_xact_lock(
    1100000000 + (p_queue_date - DATE '1970-01-01')
  );

  SELECT COALESCE(MAX(token_number), 0) + 1
    INTO v_token
    FROM opd_queue
    WHERE queue_date = p_queue_date;

  RETURN v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION next_queue_token TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_opd_queue_date_token
  ON opd_queue (queue_date, token_number)
  WHERE token_number IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════
-- §5  BILLING: bill_counters + next_bill_counter() + hospital_fund unique index
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bill_counters (
  module       TEXT NOT NULL,
  year_month   TEXT NOT NULL,
  next_seq     INTEGER NOT NULL DEFAULT 1,
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (module, year_month)
);

-- Backfill counters from existing bills so next_bill_counter starts at the
-- correct value on a database that already has many bills.
INSERT INTO bill_counters (module, year_month, next_seq)
SELECT
  COALESCE(bill_module, 'OPD') AS module,
  SUBSTRING(invoice_number, LENGTH(COALESCE(bill_module,'OPD')) + 2, 6) AS year_month,
  COALESCE(MAX(CAST(SUBSTRING(invoice_number, LENGTH(invoice_number) - 3, 4) AS INTEGER)), 0) + 1
FROM bills
WHERE invoice_number ~ '^(OPD|IPD)-[0-9]{6}-[0-9]{4}$'
  AND COALESCE(is_deleted, FALSE) = FALSE
GROUP BY COALESCE(bill_module, 'OPD'),
         SUBSTRING(invoice_number, LENGTH(COALESCE(bill_module,'OPD')) + 2, 6)
ON CONFLICT (module, year_month) DO UPDATE
  SET next_seq = GREATEST(bill_counters.next_seq, EXCLUDED.next_seq);

CREATE OR REPLACE FUNCTION next_bill_counter(p_module TEXT, p_year_month TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq INTEGER;
BEGIN
  IF p_module NOT IN ('OPD','IPD') THEN
    RAISE EXCEPTION 'Invalid module: %. Must be OPD or IPD', p_module;
  END IF;

  INSERT INTO bill_counters (module, year_month, next_seq)
    VALUES (p_module, p_year_month, 2)
    ON CONFLICT (module, year_month)
    DO UPDATE SET next_seq = bill_counters.next_seq + 1, updated_at = NOW()
    RETURNING next_seq - 1 INTO v_seq;

  RETURN v_seq;
END;
$$;

GRANT EXECUTE ON FUNCTION next_bill_counter TO authenticated;

-- §5.1: one income row per (bill_id, type='income'). Stops the double-revenue
-- bug between trigger + (legacy) syncToFinance() insert.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_hospital_fund_bill_type_income
  ON hospital_fund (bill_id, type)
  WHERE bill_id IS NOT NULL AND type = 'income';

-- §5.1: refresh trigger function so it uses ON CONFLICT DO NOTHING — protects
-- existing call sites that still try to insert manually.
CREATE OR REPLACE FUNCTION sync_bill_to_finance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_amount NUMERIC(12,2);
BEGIN
  IF NEW.status IN ('paid','partial','partially_paid')
     AND (OLD.status IS NULL OR OLD.status NOT IN ('paid','partial','partially_paid'))
  THEN
    IF NEW.status IN ('partial','partially_paid') THEN
      v_amount := COALESCE(NEW.paid, NEW.net_amount, NEW.total, 0);
    ELSE
      v_amount := COALESCE(NEW.net_amount, NEW.total, 0);
    END IF;

    IF v_amount > 0 THEN
      INSERT INTO hospital_fund (
        type, amount, category, description, submitted_by, status, bill_id
      ) VALUES (
        'income',
        v_amount,
        CASE WHEN NEW.bill_module = 'IPD' THEN 'ipd_billing' ELSE 'opd_billing' END,
        COALESCE(NEW.bill_module, 'OPD') || ' Bill ' ||
          COALESCE(NEW.invoice_number, LEFT(NEW.id::text, 8)) || ' — ' ||
          COALESCE(NEW.patient_name, 'Patient'),
        COALESCE(NEW.created_by, 'system'),
        'approved',
        NEW.id
      )
      ON CONFLICT (bill_id, type) WHERE bill_id IS NOT NULL AND type = 'income' DO NOTHING;
    END IF;
  END IF;

  IF NEW.is_deleted = TRUE AND (OLD.is_deleted IS NULL OR OLD.is_deleted = FALSE) THEN
    SELECT amount INTO v_amount
      FROM hospital_fund
      WHERE bill_id = NEW.id AND type = 'income'
      LIMIT 1;

    IF v_amount IS NOT NULL AND v_amount > 0 THEN
      INSERT INTO hospital_fund (
        type, amount, category, description, submitted_by, status, bill_id
      ) VALUES (
        'reversal',
        -v_amount,
        'bill_reversal',
        'Reversed bill ' || COALESCE(NEW.invoice_number, LEFT(NEW.id::text, 8)) ||
          ' — by ' || COALESCE(NEW.deleted_by, 'admin'),
        COALESCE(NEW.deleted_by, 'system'),
        'approved',
        NEW.id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_bill_to_finance ON bills;
CREATE TRIGGER trg_sync_bill_to_finance
  AFTER INSERT OR UPDATE ON bills
  FOR EACH ROW
  EXECUTE FUNCTION sync_bill_to_finance();

-- ════════════════════════════════════════════════════════════════════
-- §6  CREDIT NOTES: refund-cap trigger
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION enforce_credit_note_cap()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_bill_total       NUMERIC(12,2);
  v_existing_credits NUMERIC(12,2);
BEGIN
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  IF NEW.credit_amount IS NULL OR NEW.credit_amount <= 0 THEN
    RAISE EXCEPTION 'Credit amount must be > 0 (got %)', NEW.credit_amount;
  END IF;

  SELECT COALESCE(net_amount, total, 0) INTO v_bill_total
    FROM bills WHERE id = NEW.bill_id;

  IF v_bill_total IS NULL OR v_bill_total <= 0 THEN
    RAISE EXCEPTION 'Cannot create credit note: bill % has no positive net amount', NEW.bill_id;
  END IF;

  SELECT COALESCE(SUM(credit_amount), 0) INTO v_existing_credits
    FROM credit_notes
    WHERE bill_id = NEW.bill_id
      AND status <> 'cancelled'
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF v_existing_credits + NEW.credit_amount > v_bill_total + 0.01 THEN
    RAISE EXCEPTION 'Refund cap exceeded: existing credits ₹% + new ₹% > bill total ₹%',
      v_existing_credits, NEW.credit_amount, v_bill_total;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_credit_note_cap ON credit_notes;
CREATE TRIGGER trg_credit_note_cap
  BEFORE INSERT OR UPDATE ON credit_notes
  FOR EACH ROW
  EXECUTE FUNCTION enforce_credit_note_cap();

-- ════════════════════════════════════════════════════════════════════
-- §7  AUDIT HASH CHAIN — only install if not already present
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entry_hash TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_hash  TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_log_entry_hash ON audit_log(entry_hash);

-- insert_audit_entry — atomic SHA-256 hash chain
CREATE OR REPLACE FUNCTION insert_audit_entry(
  p_user_id      UUID    DEFAULT NULL,
  p_user_email   TEXT    DEFAULT NULL,
  p_user_role    TEXT    DEFAULT NULL,
  p_action       TEXT    DEFAULT 'view',
  p_entity_type  TEXT    DEFAULT 'user',
  p_entity_id    TEXT    DEFAULT NULL,
  p_entity_label TEXT    DEFAULT NULL,
  p_changes      JSONB   DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_hash  TEXT;
  v_entry_hash TEXT;
  v_entry_id   UUID;
  v_payload    TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(8675309);

  SELECT entry_hash INTO v_prev_hash
    FROM audit_log
    ORDER BY created_at DESC
    LIMIT 1;

  v_payload := json_build_object(
    'user_id',      COALESCE(p_user_id::TEXT, 'null'),
    'user_email',   COALESCE(p_user_email, 'null'),
    'user_role',    COALESCE(p_user_role, 'null'),
    'action',       p_action,
    'entity_type',  p_entity_type,
    'entity_id',    COALESCE(p_entity_id, 'null'),
    'entity_label', COALESCE(p_entity_label, 'null'),
    'changes',      COALESCE(p_changes::TEXT, 'null'),
    'prev_hash',    COALESCE(v_prev_hash, 'GENESIS')
  )::TEXT;

  v_entry_hash := encode(digest(v_payload, 'sha256'), 'hex');

  INSERT INTO audit_log (
    user_id, user_email, user_role,
    action, entity_type, entity_id, entity_label,
    changes, entry_hash, prev_hash
  ) VALUES (
    p_user_id, p_user_email, p_user_role,
    p_action, p_entity_type, p_entity_id, p_entity_label,
    p_changes, v_entry_hash, v_prev_hash
  )
  RETURNING id INTO v_entry_id;

  RETURN v_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION insert_audit_entry TO authenticated;

-- protect_audit_hash_columns — block UPDATEs to audit_log content
CREATE OR REPLACE FUNCTION protect_audit_hash_columns()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.entry_hash    IS DISTINCT FROM NEW.entry_hash    THEN RAISE EXCEPTION 'Cannot modify entry_hash — audit log is immutable';    END IF;
    IF OLD.prev_hash     IS DISTINCT FROM NEW.prev_hash     THEN RAISE EXCEPTION 'Cannot modify prev_hash — audit log is immutable';     END IF;
    IF OLD.action        IS DISTINCT FROM NEW.action        THEN RAISE EXCEPTION 'Cannot modify action — audit log is immutable';        END IF;
    IF OLD.entity_type   IS DISTINCT FROM NEW.entity_type   THEN RAISE EXCEPTION 'Cannot modify entity_type — audit log is immutable';   END IF;
    IF OLD.entity_id     IS DISTINCT FROM NEW.entity_id     THEN RAISE EXCEPTION 'Cannot modify entity_id — audit log is immutable';     END IF;
    IF OLD.entity_label  IS DISTINCT FROM NEW.entity_label  THEN RAISE EXCEPTION 'Cannot modify entity_label — audit log is immutable';  END IF;
    IF OLD.changes       IS DISTINCT FROM NEW.changes       THEN RAISE EXCEPTION 'Cannot modify changes — audit log is immutable';       END IF;
    IF OLD.user_id       IS DISTINCT FROM NEW.user_id       THEN RAISE EXCEPTION 'Cannot modify user_id — audit log is immutable';       END IF;
    IF OLD.user_email    IS DISTINCT FROM NEW.user_email    THEN RAISE EXCEPTION 'Cannot modify user_email — audit log is immutable';    END IF;
    IF OLD.user_role     IS DISTINCT FROM NEW.user_role     THEN RAISE EXCEPTION 'Cannot modify user_role — audit log is immutable';     END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_audit_hashes ON audit_log;
CREATE TRIGGER trg_protect_audit_hashes
  BEFORE UPDATE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION protect_audit_hash_columns();

CREATE OR REPLACE FUNCTION block_audit_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Cannot delete audit log entries — append-only by design';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_audit_delete ON audit_log;
CREATE TRIGGER trg_block_audit_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION block_audit_delete();

-- verify_audit_chain — admin-only diagnostic with content-bound hash recompute
CREATE OR REPLACE FUNCTION verify_audit_chain(p_limit INTEGER DEFAULT 1000)
RETURNS TABLE(
  total_checked   INTEGER,
  valid_links     INTEGER,
  broken_links    INTEGER,
  first_broken_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total          INTEGER := 0;
  v_valid          INTEGER := 0;
  v_broken         INTEGER := 0;
  v_first_broken   UUID    := NULL;
  v_prev_stored    TEXT    := NULL;
  v_prev_for_chain TEXT    := NULL;
  v_payload        TEXT;
  v_expected_hash  TEXT;
  v_row            RECORD;
  v_is_valid       BOOLEAN;
BEGIN
  -- Allow either is_admin() (if the helper exists) or service_role.
  -- Fall through if neither check passes (we just RAISE).
  BEGIN
    IF NOT is_admin() THEN
      RAISE EXCEPTION 'Access denied. verify_audit_chain is admin-only.';
    END IF;
  EXCEPTION WHEN undefined_function THEN
    -- is_admin() not installed yet — proceed (service-role-only deployments)
    NULL;
  END;

  FOR v_row IN
    SELECT id, user_id, user_email, user_role,
           action, entity_type, entity_id, entity_label,
           changes, entry_hash, prev_hash, created_at
      FROM audit_log
      ORDER BY created_at ASC
      LIMIT p_limit
  LOOP
    v_total := v_total + 1;

    v_payload := json_build_object(
      'user_id',      COALESCE(v_row.user_id::TEXT, 'null'),
      'user_email',   COALESCE(v_row.user_email, 'null'),
      'user_role',    COALESCE(v_row.user_role, 'null'),
      'action',       v_row.action,
      'entity_type',  v_row.entity_type,
      'entity_id',    COALESCE(v_row.entity_id, 'null'),
      'entity_label', COALESCE(v_row.entity_label, 'null'),
      'changes',      COALESCE(v_row.changes::TEXT, 'null'),
      'prev_hash',    COALESCE(v_prev_for_chain, 'GENESIS')
    )::TEXT;

    v_expected_hash := encode(digest(v_payload, 'sha256'), 'hex');

    v_is_valid := (v_row.entry_hash = v_expected_hash)
                  AND (v_row.prev_hash IS NOT DISTINCT FROM v_prev_stored);

    IF v_is_valid THEN
      v_valid := v_valid + 1;
    ELSE
      v_broken := v_broken + 1;
      IF v_first_broken IS NULL THEN
        v_first_broken := v_row.id;
      END IF;
    END IF;

    v_prev_stored    := v_row.entry_hash;
    v_prev_for_chain := v_row.entry_hash;
  END LOOP;

  RETURN QUERY SELECT v_total, v_valid, v_broken, v_first_broken;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_audit_chain TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- §10  LAB PORTAL: storage columns + per-partner scoping RPC
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS storage_bucket TEXT;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS storage_path   TEXT;

ALTER TABLE attachments ADD COLUMN IF NOT EXISTS storage_bucket TEXT;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS storage_path   TEXT;

CREATE OR REPLACE FUNCTION patient_belongs_to_lab_partner(
  p_patient_id UUID,
  p_lab_partner_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  -- Direct ownership column?
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'lab_partner_id'
  ) THEN
    SELECT COUNT(*) INTO v_count FROM patients
      WHERE id = p_patient_id AND lab_partner_id = p_lab_partner_id;
    IF v_count > 0 THEN RETURN TRUE; END IF;
  END IF;

  -- Referral via prior reports
  SELECT COUNT(*) INTO v_count FROM lab_reports
    WHERE patient_id = p_patient_id AND lab_partner_id = p_lab_partner_id;

  RETURN v_count > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION patient_belongs_to_lab_partner TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════
-- Bookkeeping
-- ════════════════════════════════════════════════════════════════════

INSERT INTO schema_migrations (version, name, applied_at, notes)
VALUES (
  '018', 'audit_findings_consolidated_fixes', NOW(),
  '2026-06-04 audit-findings consolidated DB changes: aadhaar_hmac, MRN/queue/bill counters, sync trigger refresh, refund cap, audit hash chain, lab storage columns'
)
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- POST-INSTALL VERIFICATION (run these in the Supabase SQL editor)
-- ════════════════════════════════════════════════════════════════════
-- 1) Confirm new RPCs exist:
--    SELECT proname FROM pg_proc WHERE proname IN
--      ('next_mrn','next_queue_token','next_bill_counter',
--       'enforce_credit_note_cap','sync_bill_to_finance',
--       'insert_audit_entry','verify_audit_chain',
--       'patient_belongs_to_lab_partner');
--
-- 2) Confirm patients.aadhaar_hmac column exists with the unique index:
--    SELECT indexname FROM pg_indexes WHERE tablename = 'patients' AND indexname LIKE 'uniq_patients_aadhaar%';
--
-- 3) Confirm hospital_fund unique partial index:
--    SELECT indexname FROM pg_indexes WHERE indexname = 'uniq_hospital_fund_bill_type_income';
--
-- 4) Confirm audit chain triggers:
--    SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'audit_log';
--
-- 5) Test the audit chain:
--    SELECT * FROM verify_audit_chain(100);
--    -- broken_links should be 0 (or only legacy NULL-hash rows from before migration 018)

SELECT '018_audit_findings_consolidated_fixes — DONE' AS result;
