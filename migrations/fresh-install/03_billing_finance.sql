-- ════════════════════════════════════════════════════════════════════
-- 03_billing_finance.sql
--
-- FRESH-INSTALL STEP 4 of 7 — Billing sequencing, queue tokens, MRN,
-- finance auto-sync, payment attempts, lab-partner extras.
--
-- Includes the FIX for the double-revenue bug (one source of truth:
-- the trigger inserts the income row; the API route NO LONGER does).
-- The unique index on hospital_fund(bill_id, type='income') guards
-- against any accidental double insert from existing call sites.
--
-- Re-runnable safely.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- §1  ATOMIC SEQUENCE COUNTERS (replaces racy SELECT MAX + INSERT)
-- ════════════════════════════════════════════════════════════════════

-- Bill counter — sequential per (module, year-month). Race-free.
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

  -- UPSERT-with-RETURNING is atomic: even with 1000 concurrent calls,
  -- each gets a distinct seq.
  INSERT INTO bill_counters (module, year_month, next_seq)
    VALUES (p_module, p_year_month, 2)
    ON CONFLICT (module, year_month)
    DO UPDATE SET next_seq = bill_counters.next_seq + 1,
                  updated_at = NOW()
    RETURNING next_seq - 1 INTO v_seq;

  RETURN v_seq;
END;
$$;

GRANT EXECUTE ON FUNCTION next_bill_counter TO authenticated;

-- Queue token counter — sequential per queue_date. Race-free.
CREATE OR REPLACE FUNCTION next_queue_token(p_queue_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token INTEGER;
BEGIN
  -- Acquire an advisory lock keyed by date (date as int = days since epoch)
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

-- MRN generator — single global sequence. Race-free.
-- Format: P-NNNN (zero-padded, 4 digits, then natural growth)
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
     SET next_seq = next_seq + 1,
         updated_at = NOW()
   WHERE id = 1
   RETURNING next_seq - 1 INTO v_seq;

  -- If row doesn't exist (shouldn't happen — created in 01_core_schema.sql),
  -- bootstrap it.
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
-- §2  ADVISORY-LOCK HELPERS (Supabase RPC convenience wrappers)
-- ════════════════════════════════════════════════════════════════════

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

GRANT EXECUTE ON FUNCTION pg_advisory_lock(BIGINT)   TO authenticated;
GRANT EXECUTE ON FUNCTION pg_advisory_unlock(BIGINT) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- §3  FINANCE AUTO-SYNC TRIGGER (single source of truth for revenue)
-- ════════════════════════════════════════════════════════════════════
-- When a bill flips to 'paid' or 'partial' or 'partially_paid', insert
-- ONE matching income row in hospital_fund. The unique partial index on
-- (bill_id, type='income') (defined in 01_core_schema.sql) PREVENTS
-- duplicates even if the trigger and the API route both try to insert.
--
-- The trigger is the canonical writer; the API route's syncToFinance()
-- helper has been removed. If a deployment still has it, the unique
-- index makes the second insert a no-op via ON CONFLICT DO NOTHING.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION sync_bill_to_finance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_amount NUMERIC(12,2);
BEGIN
  -- Only fire when status transitions to a money-received state
  IF NEW.status IN ('paid','partial','partially_paid')
     AND (OLD.status IS NULL OR OLD.status NOT IN ('paid','partial','partially_paid'))
  THEN
    -- Use paid amount if partial, else net_amount/total
    IF NEW.status IN ('partial','partially_paid') THEN
      v_amount := COALESCE(NEW.paid, NEW.net_amount, NEW.total, 0);
    ELSE
      v_amount := COALESCE(NEW.net_amount, NEW.total, 0);
    END IF;

    IF v_amount > 0 THEN
      -- ON CONFLICT DO NOTHING is the second line of defence: even if
      -- the API route ALSO tries to insert (legacy code), we never
      -- double-count revenue.
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

  -- Soft-delete reversal — fires when is_deleted flips to TRUE
  IF NEW.is_deleted = TRUE AND (OLD.is_deleted IS NULL OR OLD.is_deleted = FALSE) THEN
    -- Determine what was previously credited
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
-- §4  PAYMENT ATTEMPTS TABLE  (replaces broken migration 007)
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS payment_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id         UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES patients(id),
  amount          NUMERIC(10,2),
  status          TEXT NOT NULL CHECK (status IN ('initiated','pending','success','failed','timeout','cancelled','refunded')),
  payment_method  TEXT,
  razorpay_payment_id  TEXT,
  razorpay_order_id    TEXT,
  failure_reason  TEXT,
  marked_by       UUID REFERENCES clinic_users(id),  -- ← fixed: was `clinicusers` in original migration 007
  marked_by_name  TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_bill     ON payment_attempts(bill_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_status   ON payment_attempts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_patient  ON payment_attempts(patient_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_razorpay ON payment_attempts(razorpay_payment_id)
    WHERE razorpay_payment_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════
-- §5  CREDIT NOTE REFUND CAP (server-enforced — rejects over-refund)
-- ════════════════════════════════════════════════════════════════════
-- Even if the application code forgets to validate, the DB will refuse
-- a credit note whose cumulative refund exceeds the original bill total.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION enforce_credit_note_cap()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_bill_total       NUMERIC(12,2);
  v_existing_credits NUMERIC(12,2);
BEGIN
  IF NEW.status = 'cancelled' THEN
    RETURN NEW; -- Cancellation is fine
  END IF;

  IF NEW.credit_amount IS NULL OR NEW.credit_amount <= 0 THEN
    RAISE EXCEPTION 'Credit amount must be > 0 (got %)', NEW.credit_amount;
  END IF;

  -- Fetch the original bill's net amount
  SELECT COALESCE(net_amount, total, 0) INTO v_bill_total
    FROM bills WHERE id = NEW.bill_id;

  IF v_bill_total IS NULL OR v_bill_total <= 0 THEN
    RAISE EXCEPTION 'Cannot create credit note: bill % has no positive net amount', NEW.bill_id;
  END IF;

  -- Sum existing non-cancelled credit notes for this bill
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
-- §6  LAB PARTNER WHITELIST CHECK (per-partner patient scoping)
-- ════════════════════════════════════════════════════════════════════
-- Confirms a given patient was referred by / belongs to a given lab
-- partner. Used by the lab portal to enforce that one lab cannot upload
-- reports against arbitrary patients.
--
-- Logic:
--   - If the patients table has a `lab_partner_id` column (added by 04),
--     check it.
--   - Else, check whether that patient has any prior lab_reports row
--     linked to this partner (organic referral chain).
-- ════════════════════════════════════════════════════════════════════

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
-- §7  PHARMACY ATOMIC DISPENSE (carried over from migration 013)
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION atomic_dispense_medicine(
  p_medicine_id UUID,
  p_quantity INTEGER,
  p_patient_name TEXT DEFAULT NULL,
  p_prescription_id UUID DEFAULT NULL,
  p_done_by TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_current_stock INTEGER;
  v_medicine_name TEXT;
BEGIN
  SELECT current_stock, name INTO v_current_stock, v_medicine_name
    FROM pharmacy_medicines WHERE id = p_medicine_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Medicine not found');
  END IF;
  IF p_quantity <= 0 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Quantity must be positive');
  END IF;
  IF v_current_stock < p_quantity THEN
    RETURN jsonb_build_object('success', FALSE,
      'error', format('Insufficient stock for %s. Available: %s, Requested: %s',
                      v_medicine_name, v_current_stock, p_quantity));
  END IF;

  UPDATE pharmacy_medicines
    SET current_stock = current_stock - p_quantity, updated_at = NOW()
    WHERE id = p_medicine_id;

  INSERT INTO pharmacy_stock_log (medicine_id, type, quantity, reference_id, notes, done_by)
  VALUES (p_medicine_id, 'dispense', -p_quantity, p_prescription_id,
          CASE WHEN p_patient_name IS NOT NULL THEN 'Dispensed to ' || p_patient_name ELSE 'Dispensed' END,
          p_done_by);

  RETURN jsonb_build_object('success', TRUE,
    'remaining_stock', v_current_stock - p_quantity,
    'medicine_name', v_medicine_name);
END;
$$;

GRANT EXECUTE ON FUNCTION atomic_dispense_medicine TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- DONE
-- ════════════════════════════════════════════════════════════════════

INSERT INTO schema_migrations (version, name, applied_at, notes)
VALUES ('FI-03', 'fresh_install_billing_finance', NOW(),
        'Bill/queue/MRN counters, finance trigger, refund cap, pharmacy atomic')
ON CONFLICT (version) DO NOTHING;

COMMIT;

SELECT 'Fresh-install 03/07: Billing & finance — DONE' AS result;
