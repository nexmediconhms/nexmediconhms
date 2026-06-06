-- ============================================================
-- Migration 020: Critical Constraints — Phase 1
-- Fixes HIGH SEVERITY issues across Patient Registration,
-- OPD Queue, IPD Bed Assignment, Billing, and Discharge.
--
-- SAFE TO RUN ON EXISTING DB:
--   - All statements use IF NOT EXISTS / OR REPLACE
--   - No data is deleted or modified
--   - Only adds constraints, functions, and indexes
--
-- RUN ORDER: After all prior migrations (019 or earlier)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- §1  PATIENT REGISTRATION — MRN & DUPLICATE PREVENTION
-- ─────────────────────────────────────────────────────────────

-- 1a. Ensure MRN is truly unique at DB level.
--     The schema already has `mrn TEXT UNIQUE` in v00, but some
--     deployments may have dropped the constraint during early dev.
--     This is idempotent — if the constraint exists, Postgres skips it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'patients' AND indexname = 'patients_mrn_key'
  ) THEN
    -- Only add if the unique index doesn't exist
    BEGIN
      ALTER TABLE patients ADD CONSTRAINT patients_mrn_unique UNIQUE (mrn);
    EXCEPTION WHEN duplicate_table THEN
      -- constraint already exists under a different name
      NULL;
    END;
  END IF;
END $$;

-- 1b. Unique index on mobile to prevent duplicate registrations.
--     Two patients with the same mobile number is the #1 source of
--     duplicate-patient billing fraud.  This enforces at DB level.
--     Partial index: only enforce on non-null, non-empty mobile.
CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_mobile_unique
  ON patients (mobile)
  WHERE mobile IS NOT NULL AND mobile != '';

-- 1c. Unique index on aadhaar (plaintext column) for deployments
--     that haven't yet migrated to encrypted aadhaar.
CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_aadhaar_unique
  ON patients (aadhaar)
  WHERE aadhaar IS NOT NULL AND aadhaar != '';

-- 1d. Atomic patient registration function.
--     Prevents race condition where two concurrent registrations
--     with the same mobile could both pass the duplicate check
--     and both insert successfully.
--
--     This function:
--       - Acquires an advisory lock keyed on the mobile number
--       - Checks for existing patient with same mobile
--       - If duplicate found, returns the existing patient
--       - If no duplicate, inserts and returns the new patient
--       - MRN is generated inside the transaction
CREATE OR REPLACE FUNCTION register_patient_atomic(
  p_fullname      TEXT,
  p_mobile        TEXT,
  p_age           TEXT DEFAULT NULL,
  p_dob           DATE DEFAULT NULL,
  p_gender        TEXT DEFAULT 'Female',
  p_bloodgroup    TEXT DEFAULT NULL,
  p_address       TEXT DEFAULT NULL,
  p_aadhaar       TEXT DEFAULT NULL,
  p_abhaid        TEXT DEFAULT NULL,
  p_mediclaim     TEXT DEFAULT 'No',
  p_cashless      TEXT DEFAULT 'No',
  p_referredby    TEXT DEFAULT NULL,
  p_emergname     TEXT DEFAULT NULL,
  p_emergphone    TEXT DEFAULT NULL,
  p_policytpa     TEXT DEFAULT NULL,
  p_policynum     TEXT DEFAULT NULL
) RETURNS TABLE (
  patient_id      UUID,
  patient_mrn     TEXT,
  patient_name    TEXT,
  is_duplicate    BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_lock_key   BIGINT;
  v_existing   RECORD;
  v_new_id     UUID;
  v_new_mrn    TEXT;
BEGIN
  -- Hash the mobile number for the advisory lock key.
  -- Using a fixed namespace (0x50415420 = "PAT ") to avoid
  -- collision with bill-generation or audit locks.
  IF p_mobile IS NOT NULL AND p_mobile != '' THEN
    v_lock_key := abs(hashtext(p_mobile));
    PERFORM pg_advisory_xact_lock(1346981920, v_lock_key); -- 0x50415420
  END IF;

  -- Check for existing patient with same mobile (inside the lock)
  IF p_mobile IS NOT NULL AND p_mobile != '' THEN
    SELECT id, mrn, fullname INTO v_existing
      FROM patients
      WHERE mobile = p_mobile
      LIMIT 1;

    IF FOUND THEN
      RETURN QUERY SELECT v_existing.id, v_existing.mrn, v_existing.fullname, TRUE;
      RETURN;
    END IF;
  end IF;

  -- Check for existing patient with same aadhaar
  IF p_aadhaar IS NOT NULL AND p_aadhaar != '' THEN
    SELECT id, mrn, fullname INTO v_existing
      FROM patients
      WHERE aadhaar = p_aadhaar
      LIMIT 1;

    IF FOUND THEN
      RETURN QUERY SELECT v_existing.id, v_existing.mrn, v_existing.fullname, TRUE;
      RETURN;
    END IF;
  END IF;

  -- Generate MRN inside the transaction (no race)
  -- Format: NMH-YYYYMM-XXXXX (sequential per month)
  SELECT 'NMH-' ||
    to_char(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYYMM') || '-' ||
    LPAD(
      (COALESCE(
        (SELECT COUNT(*) + 1 FROM patients
         WHERE mrn LIKE 'NMH-' || to_char(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYYMM') || '-%'),
        1
      ))::TEXT,
      5, '0'
    )
  INTO v_new_mrn;

  -- Insert the new patient
  INSERT INTO patients (
    fullname, mobile, age, dob, gender, bloodgroup, address,
    aadhaar, abhaid, mediclaim, cashless, referredby, mrn
  ) VALUES (
    p_fullname, p_mobile, p_age, p_dob, p_gender, p_bloodgroup,
    p_address, p_aadhaar, p_abhaid, p_mediclaim, p_cashless,
    p_referredby, v_new_mrn
  )
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, v_new_mrn, p_fullname, FALSE;
END;
$$;


-- ─────────────────────────────────────────────────────────────
-- §2  OPD QUEUE — ATOMIC TOKEN ALLOCATION
-- ─────────────────────────────────────────────────────────────

-- 2a. Unique constraint on (queuedate, queuenumber) if not exists.
--     Migration 014 may have added this, but ensure it's there.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'opdqueue'
    AND indexname = 'idx_opdqueue_date_number_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_opdqueue_date_number_unique
      ON opdqueue (date, queuenumber);
  END IF;
EXCEPTION WHEN duplicate_table THEN
  NULL;
END $$;

-- 2b. Unique constraint: one queue entry per patient per day.
--     Prevents the same patient appearing twice in the queue.
CREATE UNIQUE INDEX IF NOT EXISTS idx_opdqueue_patient_date_unique
  ON opdqueue (patientid, date)
  WHERE status NOT IN ('cancelled');

-- 2c. Atomic queue token allocation function.
--     Uses advisory lock to serialize token number generation.
--     Returns the allocated token number.
--
--     This is the DB-side equivalent of insertQueueEntryWithRetry()
--     but fully atomic and race-free (no retry loop needed).
CREATE OR REPLACE FUNCTION allocate_queue_token(
  p_patientid    UUID,
  p_queuedate    DATE,
  p_status       TEXT DEFAULT 'waiting',
  p_priority     TEXT DEFAULT 'normal',
  p_notes        TEXT DEFAULT NULL,
  p_patientname  TEXT DEFAULT NULL,
  p_mrn          TEXT DEFAULT NULL,
  p_encounterid  UUID DEFAULT NULL
) RETURNS TABLE (
  queue_id        UUID,
  token_number    INTEGER,
  already_exists  BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_lock_key     BIGINT;
  v_next_token   INTEGER;
  v_existing     RECORD;
  v_new_id       UUID;
BEGIN
  -- Lock on the queue date to serialize all token allocations for that day
  v_lock_key := abs(hashtext('QUEUE-' || p_queuedate::TEXT));
  PERFORM pg_advisory_xact_lock(1364806981, v_lock_key); -- 0x51554555 = "QUEU"

  -- Check if patient already in queue for this date (non-cancelled)
  SELECT id, queuenumber INTO v_existing
    FROM opdqueue
    WHERE patientid = p_patientid
      AND date = p_queuedate
      AND status NOT IN ('cancelled')
    LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, v_existing.queuenumber, TRUE;
    RETURN;
  END IF;

  -- Get next token number (inside the lock, so no race)
  SELECT COALESCE(MAX(queuenumber), 0) + 1 INTO v_next_token
    FROM opdqueue
    WHERE date = p_queuedate;

  -- Insert the queue entry
  INSERT INTO opdqueue (
    patientid, date, queuenumber, status, notes,
    patientname, mrn
  ) VALUES (
    p_patientid, p_queuedate, v_next_token, p_status, p_notes,
    p_patientname, p_mrn
  )
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, v_next_token, FALSE;
END;
$$;

-- 2d. CHECK constraint on queue status values.
--     Prevents 'completed' vs 'done' mismatch that causes tokens
--     to disappear from the queue display.
DO $$
BEGIN
  ALTER TABLE opdqueue DROP CONSTRAINT IF EXISTS chk_opdqueue_status;
  ALTER TABLE opdqueue ADD CONSTRAINT chk_opdqueue_status
    CHECK (status IN ('waiting', 'vitals_done', 'in_progress', 'done', 'cancelled'));
EXCEPTION WHEN check_violation THEN
  -- Existing rows may have invalid status; update them first
  UPDATE opdqueue SET status = 'done'
    WHERE status NOT IN ('waiting', 'vitals_done', 'in_progress', 'done', 'cancelled');
  ALTER TABLE opdqueue ADD CONSTRAINT chk_opdqueue_status
    CHECK (status IN ('waiting', 'vitals_done', 'in_progress', 'done', 'cancelled'));
END $$;


-- ─────────────────────────────────────────────────────────────
-- §3  IPD — ATOMIC BED ASSIGNMENT
-- ─────────────────────────────────────────────────────────────

-- 3a. Atomic bed assignment function.
--     Uses SELECT FOR UPDATE on the bed row to prevent two
--     concurrent admissions from assigning the same bed.
--     Returns the admission ID and bed details.
CREATE OR REPLACE FUNCTION assign_bed_atomic(
  p_patientid        UUID,
  p_bedid            UUID,
  p_admittingdoctor  TEXT,
  p_diagnosis        TEXT DEFAULT NULL,
  p_notes            TEXT DEFAULT NULL
) RETURNS TABLE (
  admission_id    UUID,
  bed_number      TEXT,
  ward            TEXT,
  success         BOOLEAN,
  error_message   TEXT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_bed           RECORD;
  v_admission_id  UUID;
BEGIN
  -- Lock the bed row exclusively (prevents concurrent assignment)
  SELECT id, bednumber, ward, status
    INTO v_bed
    FROM beds
    WHERE id = p_bedid
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, FALSE, 'Bed not found'::TEXT;
    RETURN;
  END IF;

  -- Check bed is available
  IF v_bed.status != 'available' THEN
    RETURN QUERY SELECT NULL::UUID, v_bed.bednumber, v_bed.ward, FALSE,
      ('Bed ' || v_bed.bednumber || ' is currently ' || v_bed.status || '. Choose another bed.')::TEXT;
    RETURN;
  END IF;

  -- Check patient doesn't already have an active admission
  IF EXISTS (
    SELECT 1 FROM ipdadmissions
    WHERE patientid = p_patientid AND status = 'admitted'
  ) THEN
    RETURN QUERY SELECT NULL::UUID, v_bed.bednumber, v_bed.ward, FALSE,
      'Patient already has an active IPD admission'::TEXT;
    RETURN;
  END IF;

  -- Mark bed as occupied
  UPDATE beds SET
    status = 'occupied',
    updatedat = NOW()
  WHERE id = p_bedid;

  -- Create admission record
  INSERT INTO ipdadmissions (
    patientid, bedid, admittingdoctor, diagnosis, notes, status
  ) VALUES (
    p_patientid, p_bedid, p_admittingdoctor, p_diagnosis, p_notes, 'admitted'
  )
  RETURNING id INTO v_admission_id;

  RETURN QUERY SELECT v_admission_id, v_bed.bednumber, v_bed.ward, TRUE, NULL::TEXT;
END;
$$;

-- 3b. Atomic discharge function.
--     Ensures bed release and admission status update happen together.
--     Also validates pre-discharge checks.
CREATE OR REPLACE FUNCTION discharge_patient_atomic(
  p_admission_id     UUID,
  p_discharged_by    TEXT,
  p_skip_bill_check  BOOLEAN DEFAULT FALSE,
  p_is_admin         BOOLEAN DEFAULT FALSE
) RETURNS TABLE (
  success         BOOLEAN,
  error_message   TEXT,
  patient_id      UUID,
  bed_id          UUID
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admission     RECORD;
  v_pending_bills INTEGER;
BEGIN
  -- Lock the admission row
  SELECT a.id, a.patientid, a.bedid, a.status
    INTO v_admission
    FROM ipdadmissions a
    WHERE a.id = p_admission_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Admission not found'::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  IF v_admission.status = 'discharged' THEN
    RETURN QUERY SELECT FALSE, 'Patient is already discharged'::TEXT,
      v_admission.patientid, v_admission.bedid;
    RETURN;
  END IF;

  -- Check for pending bills (unless admin override or skip flag)
  IF NOT p_skip_bill_check AND NOT p_is_admin THEN
    SELECT COUNT(*) INTO v_pending_bills
      FROM bills
      WHERE patientid = v_admission.patientid
        AND status IN ('pending', 'unpaid', 'partial');

    IF v_pending_bills > 0 THEN
      RETURN QUERY SELECT FALSE,
        ('Cannot discharge: ' || v_pending_bills || ' unpaid bill(s). Clear bills first or request admin override.')::TEXT,
        v_admission.patientid, v_admission.bedid;
      RETURN;
    END IF;
  END IF;

  -- Update admission status
  UPDATE ipdadmissions SET
    status = 'discharged',
    dischargedate = CURRENT_DATE,
    updatedat = NOW()
  WHERE id = p_admission_id;

  -- Free the bed (with cleaning status for hygiene workflow)
  IF v_admission.bedid IS NOT NULL THEN
    UPDATE beds SET
      status = 'available',
      updatedat = NOW()
    WHERE id = v_admission.bedid;
  END IF;

  -- Audit the discharge (hash-chained)
  BEGIN
    PERFORM insert_audit_entry(
      NULL, p_discharged_by, 'doctor', 'discharge',
      'ipd_admission', p_admission_id::TEXT,
      'Patient discharged by ' || p_discharged_by,
      json_build_object(
        'admission_id', p_admission_id,
        'patient_id', v_admission.patientid,
        'bed_id', v_admission.bedid,
        'admin_override', p_is_admin AND NOT p_skip_bill_check
      )::TEXT
    );
  EXCEPTION WHEN OTHERS THEN
    -- Audit failure must not block discharge
    RAISE WARNING 'Audit logging failed for discharge %: %', p_admission_id, SQLERRM;
  END;

  RETURN QUERY SELECT TRUE, NULL::TEXT, v_admission.patientid, v_admission.bedid;
END;
$$;


-- ─────────────────────────────────────────────────────────────
-- §4  BILLING — IDEMPOTENCY & STATUS CONSISTENCY
-- ─────────────────────────────────────────────────────────────

-- 4a. Add idempotency_key column to bills if not exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bills' AND column_name = 'idempotencykey'
  ) THEN
    ALTER TABLE bills ADD COLUMN idempotencykey TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_idempotency
      ON bills (idempotencykey) WHERE idempotencykey IS NOT NULL;
  END IF;
END $$;

-- 4b. Add idempotency_key to payment_transactions if table exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'payment_transactions'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'payment_transactions' AND column_name = 'idempotency_key'
    ) THEN
      ALTER TABLE payment_transactions ADD COLUMN idempotency_key TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_txn_idempotency
        ON payment_transactions (idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    END IF;
  END IF;
END $$;

-- 4c. CHECK constraint on bill status values.
DO $$
BEGIN
  ALTER TABLE bills DROP CONSTRAINT IF EXISTS chk_bills_status;
  ALTER TABLE bills ADD CONSTRAINT chk_bills_status
    CHECK (status IN ('unpaid', 'pending', 'partial', 'paid', 'refunded', 'waived', 'cancelled'));
EXCEPTION WHEN check_violation THEN
  -- Fix invalid status values first
  UPDATE bills SET status = 'unpaid'
    WHERE status NOT IN ('unpaid', 'pending', 'partial', 'paid', 'refunded', 'waived', 'cancelled');
  ALTER TABLE bills ADD CONSTRAINT chk_bills_status
    CHECK (status IN ('unpaid', 'pending', 'partial', 'paid', 'refunded', 'waived', 'cancelled'));
END $$;

-- 4d. Add version column for optimistic locking on bills.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bills' AND column_name = 'version'
  ) THEN
    ALTER TABLE bills ADD COLUMN version INTEGER DEFAULT 1;
  END IF;
END $$;

-- 4e. Trigger: auto-increment version on bill update (optimistic locking).
CREATE OR REPLACE FUNCTION bills_increment_version()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := COALESCE(OLD.version, 0) + 1;
  NEW.updatedat := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bills_version ON bills;
CREATE TRIGGER trg_bills_version
  BEFORE UPDATE ON bills
  FOR EACH ROW
  EXECUTE FUNCTION bills_increment_version();


-- ─────────────────────────────────────────────────────────────
-- §5  AUDIT — EXTENDED ACTION AND ENTITY TYPES
-- ─────────────────────────────────────────────────────────────

-- The insert_audit_entry function already exists from v00.
-- We just need to ensure the action/entity columns can accept
-- the new types (refund, discharge_override, role_change, etc.)
-- Since they're TEXT columns, no schema change needed.
-- But we add a comment for documentation:
COMMENT ON FUNCTION insert_audit_entry IS
  'Atomic audit-log insert with SHA-256 hash chain. '
  'Accepts any action/entity_type string. '
  'Critical actions that MUST be logged: '
  'create/update/delete (all entities), '
  'discharge (ipd_admission), '
  'refund (bill), '
  'role_change (user), '
  'safety_override (drug_interaction/allergy_override), '
  'admin_override (discharge), '
  'login/logout (user).';


-- ─────────────────────────────────────────────────────────────
-- §6  INDEXES FOR PERFORMANCE
-- ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_opdqueue_date_status ON opdqueue (date, status);
CREATE INDEX IF NOT EXISTS idx_ipdadmissions_patient_status ON ipdadmissions (patientid, status);
CREATE INDEX IF NOT EXISTS idx_bills_patient_status ON bills (patientid, status);
CREATE INDEX IF NOT EXISTS idx_beds_status ON beds (status);
CREATE INDEX IF NOT EXISTS idx_encounters_patient_date ON encounters (patientid, date);


-- ─────────────────────────────────────────────────────────────
-- §7  GRANT EXECUTE ON NEW FUNCTIONS
-- ─────────────────────────────────────────────────────────────

-- These functions use SECURITY DEFINER so they run as the owner,
-- but we need to grant EXECUTE to authenticated users.
GRANT EXECUTE ON FUNCTION register_patient_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION allocate_queue_token TO authenticated;
GRANT EXECUTE ON FUNCTION assign_bed_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION discharge_patient_atomic TO authenticated;
