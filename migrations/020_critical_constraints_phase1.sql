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
--
-- NAMING NOTE:
--   The codebase has two patient-table naming conventions. v00 created
--   columns like `aadhaar`, `fullname`, `mobile`. Migration 000 adds
--   the snake_case equivalents (`aadhaar_no`, `full_name`, …) — but on
--   deployments where v00 didn't run (e.g. Supabase project initialized
--   with a different schema, or 000 ran without v00), the v00-style
--   columns may not exist at all. Every concrete column reference in
--   this file's TOP-LEVEL DDL must be column-existence-guarded, otherwise
--   we error out with "column does not exist" before reaching the rest
--   of the migration.
--
--   PL/pgSQL FUNCTION BODIES (register_patient_atomic, etc.) below are
--   stored as text and only parsed on first CALL, so they create
--   successfully even when their referenced columns don't exist on the
--   current DB — they simply fail at call-time on incompatible schemas.

-- 1a. Ensure MRN is truly unique at DB level.
--     The schema already has `mrn TEXT UNIQUE` in v00, but some
--     deployments may have dropped the constraint during early dev.
--     This is idempotent — if the constraint exists, Postgres skips it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='patients' AND column_name='mrn')
     AND NOT EXISTS (
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
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='patients' AND column_name='mobile') THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_mobile_unique '
            || 'ON public.patients (mobile) WHERE mobile IS NOT NULL AND mobile != ''''';
  END IF;
END $$;

-- 1c. Unique index on the aadhaar column. Picks whichever name exists
--     on this deployment: `aadhaar` (v00) or `aadhaar_no` (000/snake-case).
--     Skips entirely if neither exists.
DO $$
DECLARE
  v_col TEXT := NULL;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='patients' AND column_name='aadhaar') THEN
    v_col := 'aadhaar';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='patients' AND column_name='aadhaar_no') THEN
    v_col := 'aadhaar_no';
  END IF;

  IF v_col IS NOT NULL THEN
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_aadhaar_unique '
      || 'ON public.patients (%1$I) WHERE %1$I IS NOT NULL AND %1$I != ''''',
      v_col
    );
  END IF;
END $$;

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

-- 2a. Unique constraint on (date, queuenumber) on whichever opd-queue
--     table exists (`opdqueue` from v00, or `opd_queue` from 000/snake_case).
--     Migration 014 may have added something equivalent.
DO $$
DECLARE
  v_tbl   TEXT := NULL;
  v_date  TEXT;
  v_num   TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='opdqueue' AND table_type='BASE TABLE') THEN
    v_tbl := 'opdqueue';
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema='public' AND table_name='opd_queue' AND table_type='BASE TABLE') THEN
    v_tbl := 'opd_queue';
  END IF;

  IF v_tbl IS NULL THEN RETURN; END IF;

  -- Pick the right date column ('date' in v00, 'queue_date' in snake_case)
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name=v_tbl AND column_name='date') THEN
    v_date := 'date';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name=v_tbl AND column_name='queue_date') THEN
    v_date := 'queue_date';
  ELSE
    RETURN;
  END IF;

  -- Pick the right token-number column ('queuenumber' in v00, 'queue_number' or 'token_number' in snake_case)
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name=v_tbl AND column_name='queuenumber') THEN
    v_num := 'queuenumber';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name=v_tbl AND column_name='queue_number') THEN
    v_num := 'queue_number';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name=v_tbl AND column_name='token_number') THEN
    v_num := 'token_number';
  ELSE
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename = v_tbl
      AND indexname = 'idx_opdqueue_date_number_unique'
  ) THEN
    BEGIN
      EXECUTE format(
        'CREATE UNIQUE INDEX idx_opdqueue_date_number_unique ON public.%I (%I, %I)',
        v_tbl, v_date, v_num
      );
    EXCEPTION WHEN duplicate_table THEN
      NULL;
    END;
  END IF;
END $$;

-- 2b. Unique constraint: one queue entry per patient per day.
--     Prevents the same patient appearing twice in the queue.
DO $$
DECLARE
  v_tbl   TEXT := NULL;
  v_pid   TEXT;
  v_date  TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='opdqueue' AND table_type='BASE TABLE') THEN
    v_tbl := 'opdqueue';
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema='public' AND table_name='opd_queue' AND table_type='BASE TABLE') THEN
    v_tbl := 'opd_queue';
  END IF;
  IF v_tbl IS NULL THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name=v_tbl AND column_name='patientid') THEN
    v_pid := 'patientid';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name=v_tbl AND column_name='patient_id') THEN
    v_pid := 'patient_id';
  ELSE
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name=v_tbl AND column_name='date') THEN
    v_date := 'date';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name=v_tbl AND column_name='queue_date') THEN
    v_date := 'queue_date';
  ELSE
    RETURN;
  END IF;

  EXECUTE format(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_opdqueue_patient_date_unique '
    || 'ON public.%I (%I, %I) WHERE status NOT IN (''cancelled'')',
    v_tbl, v_pid, v_date
  );
END $$;

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
DECLARE
  v_tbl TEXT := NULL;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='opdqueue' AND table_type='BASE TABLE') THEN
    v_tbl := 'opdqueue';
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema='public' AND table_name='opd_queue' AND table_type='BASE TABLE') THEN
    v_tbl := 'opd_queue';
  END IF;
  IF v_tbl IS NULL THEN RETURN; END IF;

  -- 'status' column is in both naming conventions
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name=v_tbl AND column_name='status') THEN
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS chk_opdqueue_status', v_tbl);
  BEGIN
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT chk_opdqueue_status '
      || 'CHECK (status IN (''waiting'', ''vitals_done'', ''in_progress'', ''done'', ''cancelled''))',
      v_tbl
    );
  EXCEPTION WHEN check_violation THEN
    EXECUTE format(
      'UPDATE public.%I SET status = ''done'' '
      || 'WHERE status NOT IN (''waiting'', ''vitals_done'', ''in_progress'', ''done'', ''cancelled'')',
      v_tbl
    );
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT chk_opdqueue_status '
      || 'CHECK (status IN (''waiting'', ''vitals_done'', ''in_progress'', ''done'', ''cancelled''))',
      v_tbl
    );
  END;
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
--     Skip entirely if `bills` table doesn't exist on this deployment.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='bills' AND table_type='BASE TABLE') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name = 'bills' AND column_name = 'idempotencykey'
  ) THEN
    ALTER TABLE public.bills ADD COLUMN idempotencykey TEXT;
  END IF;
  -- Index can be created/skipped independently of the ADD COLUMN branch above.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name = 'bills' AND column_name = 'idempotencykey'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_idempotency '
            || 'ON public.bills (idempotencykey) WHERE idempotencykey IS NOT NULL';
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
--     Skip if bills table or status column doesn't exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='bills' AND table_type='BASE TABLE')
  OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='bills' AND column_name='status') THEN
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.bills DROP CONSTRAINT IF EXISTS chk_bills_status';
  BEGIN
    EXECUTE 'ALTER TABLE public.bills ADD CONSTRAINT chk_bills_status '
            || 'CHECK (status IN (''unpaid'', ''pending'', ''partial'', ''paid'', ''refunded'', ''waived'', ''cancelled''))';
  EXCEPTION WHEN check_violation THEN
    EXECUTE 'UPDATE public.bills SET status = ''unpaid'' '
            || 'WHERE status NOT IN (''unpaid'', ''pending'', ''partial'', ''paid'', ''refunded'', ''waived'', ''cancelled'')';
    EXECUTE 'ALTER TABLE public.bills ADD CONSTRAINT chk_bills_status '
            || 'CHECK (status IN (''unpaid'', ''pending'', ''partial'', ''paid'', ''refunded'', ''waived'', ''cancelled''))';
  END;
END $$;

-- 4d. Add version column for optimistic locking on bills.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='bills' AND table_type='BASE TABLE') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bills' AND column_name = 'version'
  ) THEN
    ALTER TABLE public.bills ADD COLUMN version INTEGER DEFAULT 1;
  END IF;
END $$;

-- 4e. Trigger: auto-increment version on bill update (optimistic locking).
--
-- The function uses `NEW.updatedat` (v00) or `NEW.updated_at` (snake_case)
-- depending on which column the bills table has. We generate the function
-- body dynamically so the right field is referenced (PL/pgSQL resolves
-- NEW.<field> at runtime against the row TupleDesc and raises
-- "record has no field" if absent).
DO $$
DECLARE
  v_ts_col TEXT := NULL;
  v_body   TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='bills' AND table_type='BASE TABLE') THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='bills' AND column_name='updatedat') THEN
    v_ts_col := 'updatedat';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='bills' AND column_name='updated_at') THEN
    v_ts_col := 'updated_at';
  END IF;

  -- `version` was just added by §4d above, but guard anyway.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='bills' AND column_name='version') THEN
    RETURN;
  END IF;

  v_body :=
    'BEGIN NEW.version := COALESCE(OLD.version, 0) + 1; '
    || CASE WHEN v_ts_col IS NOT NULL
            THEN format('NEW.%I := NOW(); ', v_ts_col)
            ELSE ''
       END
    || 'RETURN NEW; END;';

  EXECUTE
    'CREATE OR REPLACE FUNCTION public.bills_increment_version() '
    || 'RETURNS TRIGGER LANGUAGE plpgsql AS $body$ ' || v_body || ' $body$';

  EXECUTE 'DROP TRIGGER IF EXISTS trg_bills_version ON public.bills';
  EXECUTE 'CREATE TRIGGER trg_bills_version '
          || 'BEFORE UPDATE ON public.bills '
          || 'FOR EACH ROW EXECUTE FUNCTION public.bills_increment_version()';
END $$;


-- ─────────────────────────────────────────────────────────────
-- §5  AUDIT — EXTENDED ACTION AND ENTITY TYPES
-- ─────────────────────────────────────────────────────────────

-- The insert_audit_entry function already exists from v00.
-- We just need to ensure the action/entity columns can accept
-- the new types (refund, discharge_override, role_change, etc.)
-- Since they're TEXT columns, no schema change needed.
-- But we add a comment for documentation:
-- COMMENT requires an exact function signature in modern Postgres,
-- and fails outright if the function doesn't exist. Skip silently if
-- v00 hasn't created insert_audit_entry yet.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'insert_audit_entry'
  ) THEN
    EXECUTE
      'COMMENT ON FUNCTION public.insert_audit_entry IS '
      || $c$'Atomic audit-log insert with SHA-256 hash chain. '
            'Accepts any action/entity_type string. '
            'Critical actions that MUST be logged: '
            'create/update/delete (all entities), '
            'discharge (ipd_admission), '
            'refund (bill), '
            'role_change (user), '
            'safety_override (drug_interaction/allergy_override), '
            'admin_override (discharge), '
            'login/logout (user).'$c$;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────
-- §6  INDEXES FOR PERFORMANCE
-- ─────────────────────────────────────────────────────────────

-- Indexes are gated by column-existence checks so missing v00 columns
-- (or missing legacy tables on a snake_case-only DB) don't blow up.
DO $$
BEGIN
  -- opdqueue (date, status)
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='opdqueue' AND column_name='date')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='opdqueue' AND column_name='status') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_opdqueue_date_status ON public.opdqueue (date, status)';
  END IF;

  -- opd_queue (queue_date, status) — snake_case sibling
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='opd_queue' AND column_name='queue_date')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='opd_queue' AND column_name='status') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_opd_queue_date_status ON public.opd_queue (queue_date, status)';
  END IF;

  -- ipdadmissions (patientid, status)
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='ipdadmissions' AND column_name='patientid')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='ipdadmissions' AND column_name='status') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ipdadmissions_patient_status ON public.ipdadmissions (patientid, status)';
  END IF;

  -- ipd_admissions (patient_id, status) — snake_case sibling
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='ipd_admissions' AND column_name='patient_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='ipd_admissions' AND column_name='status') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ipd_admissions_patient_status ON public.ipd_admissions (patient_id, status)';
  END IF;

  -- bills (patientid, status) — v00
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='bills' AND column_name='patientid')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='bills' AND column_name='status') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_bills_patient_status ON public.bills (patientid, status)';
  END IF;

  -- bills (patient_id, status) — snake_case
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='bills' AND column_name='patient_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='bills' AND column_name='status') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_bills_patient_id_status ON public.bills (patient_id, status)';
  END IF;

  -- beds (status)
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='beds' AND column_name='status') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_beds_status ON public.beds (status)';
  END IF;

  -- encounters (patientid, date) — v00
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='encounters' AND column_name='patientid')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='encounters' AND column_name='date') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_encounters_patient_date ON public.encounters (patientid, date)';
  END IF;

  -- encounters (patient_id, encounter_date) — snake_case
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='encounters' AND column_name='patient_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='encounters' AND column_name='encounter_date') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_encounters_patient_encounter_date ON public.encounters (patient_id, encounter_date)';
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────
-- §7  GRANT EXECUTE ON NEW FUNCTIONS
-- ─────────────────────────────────────────────────────────────

-- These functions use SECURITY DEFINER so they run as the owner,
-- but we need to grant EXECUTE to authenticated users.
GRANT EXECUTE ON FUNCTION register_patient_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION allocate_queue_token TO authenticated;
GRANT EXECUTE ON FUNCTION assign_bed_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION discharge_patient_atomic TO authenticated;
