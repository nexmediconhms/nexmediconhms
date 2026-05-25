-- ============================================================
-- Migration 012: Fix Critical Schema Issues
-- ============================================================
-- 
-- BUG #1 FIX: Add 'lab_partner' to clinicusers role CHECK constraint
-- ─────────────────────────────────────────────────────────────────────
-- PROBLEM: The auth.ts file defines UserRole = 'admin' | 'doctor' | 'staff' | 'lab_partner'
--          but the DB CHECK constraint only allows ('admin','doctor','staff','receptionist').
--          Any user with role='lab_partner' would fail INSERT/UPDATE at DB level.
--
-- EFFECT OF BUG: Lab partner accounts cannot be created. The lab-partner-portal
--   feature is completely broken because no user can ever have role='lab_partner'
--   in the database. Any attempt to create/invite a lab partner user results in
--   a Postgres constraint violation error.
--
-- AFTER FIX: Lab partner users can be created and stored in the database.
--   The lab-partner-portal (/lab-partner-portal) will work correctly.
--   Existing users with role='receptionist' continue to work (we keep it valid).
-- ============================================================

-- Step 1: Drop the existing CHECK constraint on the role column
ALTER TABLE clinicusers DROP CONSTRAINT IF EXISTS clinicusers_role_check;

-- Step 2: Add updated CHECK constraint that includes 'lab_partner'
-- We keep 'receptionist' for backward compatibility with any existing rows
ALTER TABLE clinicusers 
  ADD CONSTRAINT clinicusers_role_check 
  CHECK (role IN ('admin', 'doctor', 'staff', 'receptionist', 'lab_partner'));

-- ============================================================
-- BUG #2 FIX: Add computed/alias columns for snake_case compatibility
-- ─────────────────────────────────────────────────────────────────────
-- PROBLEM: The master schema uses camelCase columns (fullname, authid, isactive)
--          but multiple TypeScript files query snake_case names (full_name, auth_id, is_active).
--          Supabase client queries like .eq('auth_id', ...) return empty results
--          because the actual column is 'authid'.
--
-- EFFECT OF BUG: 
--   - loadClinicUser() in auth.ts queries 'auth_id' but column is 'authid' → login breaks
--   - Patient search queries 'full_name' but column is 'fullname' → search returns nothing
--   - booking-guards.ts queries 'patient_id', 'patient_name' on appointments table 
--     but actual columns are 'patientid', 'patientname' → double-booking guard is bypassed
--   - discharge-clearance.ts queries 'patient_id' on bills → clearance check always passes
--
-- AFTER FIX: Both naming conventions work. The alias columns are GENERATED ALWAYS
--   columns that mirror the original camelCase columns. Queries using either 
--   convention will work. No data duplication — generated columns are computed.
--
-- NOTE: PostgreSQL GENERATED ALWAYS AS (expression) STORED columns occupy storage
--   but ensure compatibility without changing any application code.
--   For columns that are already correct (e.g., 'id'), we skip them.
-- ============================================================

-- ── clinicusers: Add snake_case aliases ─────────────────────────────
-- Only add if they don't already exist (idempotent)
DO $$ 
BEGIN
  -- auth_id alias for authid
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'clinicusers' AND column_name = 'auth_id'
  ) THEN
    ALTER TABLE clinicusers ADD COLUMN auth_id UUID GENERATED ALWAYS AS (authid) STORED;
  END IF;

  -- full_name alias for fullname
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'clinicusers' AND column_name = 'full_name'
  ) THEN
    ALTER TABLE clinicusers ADD COLUMN full_name TEXT GENERATED ALWAYS AS (fullname) STORED;
  END IF;

  -- is_active alias for isactive
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'clinicusers' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE clinicusers ADD COLUMN is_active BOOLEAN GENERATED ALWAYS AS (isactive) STORED;
  END IF;

  -- created_at alias for createdat
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'clinicusers' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE clinicusers ADD COLUMN created_at TIMESTAMPTZ GENERATED ALWAYS AS (createdat) STORED;
  END IF;

  -- updated_at alias for updatedat
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'clinicusers' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE clinicusers ADD COLUMN updated_at TIMESTAMPTZ GENERATED ALWAYS AS (updatedat) STORED;
  END IF;
END $$;

-- ── patients: Add snake_case aliases ────────────────────────────────
DO $$
BEGIN
  -- full_name alias for fullname
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = 'full_name'
  ) THEN
    ALTER TABLE patients ADD COLUMN full_name TEXT GENERATED ALWAYS AS (fullname) STORED;
  END IF;

  -- is_active alias for isactive  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE patients ADD COLUMN is_active BOOLEAN GENERATED ALWAYS AS (isactive) STORED;
  END IF;

  -- created_at alias for createdat
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE patients ADD COLUMN created_at TIMESTAMPTZ GENERATED ALWAYS AS (createdat) STORED;
  END IF;

  -- updated_at alias for updatedat
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE patients ADD COLUMN updated_at TIMESTAMPTZ GENERATED ALWAYS AS (updatedat) STORED;
  END IF;

  -- aadhaar_no alias for aadhaar
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = 'aadhaar_no'
  ) THEN
    ALTER TABLE patients ADD COLUMN aadhaar_no TEXT GENERATED ALWAYS AS (aadhaar) STORED;
  END IF;

  -- abha_id alias for abhaid
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = 'abha_id'
  ) THEN
    ALTER TABLE patients ADD COLUMN abha_id TEXT GENERATED ALWAYS AS (abhaid) STORED;
  END IF;
END $$;

-- ── appointments: Add snake_case aliases ────────────────────────────
DO $$
BEGIN
  -- patient_id alias for patientid
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'appointments' AND column_name = 'patient_id'
  ) THEN
    ALTER TABLE appointments ADD COLUMN patient_id UUID GENERATED ALWAYS AS (patientid) STORED;
  END IF;

  -- patient_name alias for patientname
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'appointments' AND column_name = 'patient_name'
  ) THEN
    ALTER TABLE appointments ADD COLUMN patient_name TEXT GENERATED ALWAYS AS (patientname) STORED;
  END IF;

  -- created_at alias for createdat
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'appointments' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE appointments ADD COLUMN created_at TIMESTAMPTZ GENERATED ALWAYS AS (createdat) STORED;
  END IF;

  -- updated_at alias for updatedat
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'appointments' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE appointments ADD COLUMN updated_at TIMESTAMPTZ GENERATED ALWAYS AS (updatedat) STORED;
  END IF;
END $$;

-- ── encounters: Add snake_case aliases ──────────────────────────────
DO $$
BEGIN
  -- patient_id alias for patientid
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'encounters' AND column_name = 'patient_id'
  ) THEN
    ALTER TABLE encounters ADD COLUMN patient_id UUID GENERATED ALWAYS AS (patientid) STORED;
  END IF;

  -- doctor_id alias for doctorid
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'encounters' AND column_name = 'doctor_id'
  ) THEN
    ALTER TABLE encounters ADD COLUMN doctor_id UUID GENERATED ALWAYS AS (doctorid) STORED;
  END IF;

  -- doctor_name alias for doctorname
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'encounters' AND column_name = 'doctor_name'
  ) THEN
    ALTER TABLE encounters ADD COLUMN doctor_name TEXT GENERATED ALWAYS AS (doctorname) STORED;
  END IF;

  -- created_at alias for createdat
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'encounters' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE encounters ADD COLUMN created_at TIMESTAMPTZ GENERATED ALWAYS AS (createdat) STORED;
  END IF;
END $$;

-- ── bills: Add snake_case aliases ───────────────────────────────────
DO $$
BEGIN
  -- patient_id alias for patientid
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bills' AND column_name = 'patient_id'
  ) THEN
    ALTER TABLE bills ADD COLUMN patient_id UUID GENERATED ALWAYS AS (patientid) STORED;
  END IF;

  -- created_at alias for createdat
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bills' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE bills ADD COLUMN created_at TIMESTAMPTZ GENERATED ALWAYS AS (createdat) STORED;
  END IF;

  -- updated_at alias for updatedat
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bills' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE bills ADD COLUMN updated_at TIMESTAMPTZ GENERATED ALWAYS AS (updatedat) STORED;
  END IF;
END $$;

-- ── labreports: Add snake_case aliases ──────────────────────────────
DO $$
BEGIN
  -- patient_id alias for patientid
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'labreports' AND column_name = 'patient_id'
  ) THEN
    ALTER TABLE labreports ADD COLUMN patient_id UUID GENERATED ALWAYS AS (patientid) STORED;
  END IF;

  -- test_name alias for reportname  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'labreports' AND column_name = 'test_name'
  ) THEN
    ALTER TABLE labreports ADD COLUMN test_name TEXT GENERATED ALWAYS AS (reportname) STORED;
  END IF;

  -- created_at alias for createdat
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'labreports' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE labreports ADD COLUMN created_at TIMESTAMPTZ GENERATED ALWAYS AS (createdat) STORED;
  END IF;
END $$;

-- ── ipdadmissions: Add snake_case aliases ───────────────────────────
DO $$
BEGIN
  -- patient_id alias for patientid
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ipdadmissions' AND column_name = 'patient_id'
  ) THEN
    ALTER TABLE ipdadmissions ADD COLUMN patient_id UUID GENERATED ALWAYS AS (patientid) STORED;
  END IF;

  -- bed_id alias for bedid
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ipdadmissions' AND column_name = 'bed_id'
  ) THEN
    ALTER TABLE ipdadmissions ADD COLUMN bed_id UUID GENERATED ALWAYS AS (bedid) STORED;
  END IF;

  -- admission_date alias for admissiondate
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ipdadmissions' AND column_name = 'admission_date'
  ) THEN
    ALTER TABLE ipdadmissions ADD COLUMN admission_date DATE GENERATED ALWAYS AS (admissiondate) STORED;
  END IF;
END $$;

-- ── beds: Add snake_case aliases ────────────────────────────────────
DO $$
BEGIN
  -- bed_number alias for bednumber
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'beds' AND column_name = 'bed_number'
  ) THEN
    ALTER TABLE beds ADD COLUMN bed_number TEXT GENERATED ALWAYS AS (bednumber) STORED;
  END IF;
END $$;

-- ── Create a view 'clinic_users' that maps to 'clinicusers' for code compatibility ──
-- The auth.ts code queries 'clinic_users' table but schema has 'clinicusers'
CREATE OR REPLACE VIEW clinic_users AS
  SELECT 
    id,
    authid AS auth_id,
    email,
    fullname AS full_name,
    role,
    phone,
    isactive AS is_active,
    createdat AS created_at,
    updatedat AS updated_at
  FROM clinicusers;

-- ── Create a view 'clinic_settings' that maps to 'clinicsettings' ───
CREATE OR REPLACE VIEW clinic_settings AS
  SELECT 
    key,
    value,
    updatedat AS updated_at
  FROM clinicsettings;

-- ── Create a view 'lab_reports' that maps to 'labreports' ───────────
-- discharge-clearance.ts queries 'lab_reports' but schema has 'labreports'
CREATE OR REPLACE VIEW lab_reports AS
  SELECT 
    id,
    patientid AS patient_id,
    encounterid AS encounter_id,
    reportname AS test_name,
    reportdate AS report_date,
    result,
    normalrange AS normal_range,
    unit,
    status,
    notes,
    attachmenturl AS attachment_url,
    labpartnerid AS lab_partner_id,
    createdat AS created_at,
    updatedat AS updated_at
  FROM labreports;

-- ── Create a view 'ipd_admissions' that maps to 'ipdadmissions' ─────
-- discharge-clearance.ts and booking-guards.ts query 'ipd_admissions'
CREATE OR REPLACE VIEW ipd_admissions AS
  SELECT 
    id,
    patientid AS patient_id,
    bedid AS bed_id,
    admissiondate AS admission_date,
    dischargedate AS discharge_date,
    admittingdoctor AS admitting_doctor,
    diagnosis,
    notes,
    status,
    createdat AS created_at,
    updatedat AS updated_at
  FROM ipdadmissions;

-- ── Create view 'audit_log' that maps to 'auditlog' ────────────────
-- audit.ts queries 'audit_log' but schema has 'auditlog'
CREATE OR REPLACE VIEW audit_log AS
  SELECT
    id,
    userid AS user_id,
    useremail AS user_email,
    userrole AS user_role,
    action,
    entitytype AS entity_type,
    entityid AS entity_id,
    entitylabel AS entity_label,
    changes,
    entryhash AS entry_hash,
    prevhash AS prev_hash,
    createdat AS created_at
  FROM auditlog;

-- ============================================================
-- BUG #3 FIX (Partial): Atomic pharmacy dispensing function
-- ─────────────────────────────────────────────────────────────
-- PROBLEM: pharmacy.ts reads current_stock, checks if sufficient,
--   then does a separate UPDATE. Between the read and update, another
--   concurrent request could also read the same stock value and both
--   proceed to decrement — taking stock below zero.
--
-- EFFECT OF BUG: In a busy pharmacy with 2+ staff dispensing the same
--   medicine simultaneously, stock can go negative. This causes incorrect
--   inventory counts, wrong financial reports, and potential dispensing
--   of medicines that don't actually exist.
--
-- AFTER FIX: The DB function uses SELECT ... FOR UPDATE which locks the
--   row during the transaction. Only one dispense can proceed at a time
--   for the same medicine. The second concurrent request will wait until
--   the first completes, then see the updated stock and correctly reject
--   if insufficient.
-- ============================================================

CREATE OR REPLACE FUNCTION atomic_dispense_medicine(
  p_medicine_id UUID,
  p_quantity INTEGER,
  p_patient_name TEXT DEFAULT NULL,
  p_prescription_id UUID DEFAULT NULL,
  p_done_by TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_stock INTEGER;
  v_medicine_name TEXT;
BEGIN
  -- Lock the row for update (prevents concurrent reads from seeing stale stock)
  SELECT current_stock, name INTO v_current_stock, v_medicine_name
    FROM pharmacy_medicines
    WHERE id = p_medicine_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Medicine not found');
  END IF;

  IF p_quantity <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Quantity must be positive');
  END IF;

  IF v_current_stock < p_quantity THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', format('Insufficient stock for %s. Available: %s, Requested: %s', 
                      v_medicine_name, v_current_stock, p_quantity)
    );
  END IF;

  -- Decrement stock (safe — row is locked)
  UPDATE pharmacy_medicines
    SET current_stock = current_stock - p_quantity,
        updated_at = NOW()
    WHERE id = p_medicine_id;

  -- Log the dispense transaction
  INSERT INTO pharmacy_stock_log (medicine_id, type, quantity, reference_id, notes, done_by)
  VALUES (
    p_medicine_id,
    'dispense',
    -p_quantity,
    p_prescription_id,
    CASE WHEN p_patient_name IS NOT NULL 
         THEN 'Dispensed to ' || p_patient_name 
         ELSE 'Dispensed' END,
    p_done_by
  );

  RETURN jsonb_build_object(
    'success', true, 
    'remaining_stock', v_current_stock - p_quantity,
    'medicine_name', v_medicine_name
  );
END;
$$;

-- ============================================================
-- BUG #11 FIX (Partial): Function to get effective stock excluding expired batches
-- ─────────────────────────────────────────────────────────────
-- PROBLEM: hasStock() in pharmacy.ts only checks current_stock field
--   which doesn't account for expired batches. If 50 out of 100 units
--   are from an expired batch, the system still shows 100 available.
--
-- EFFECT OF BUG: Staff may dispense medicines that are expired because
--   the stock count doesn't distinguish valid vs expired inventory.
--   This is a patient safety and regulatory compliance issue.
--
-- AFTER FIX: This function provides "effective stock" by subtracting
--   expired batch quantities from the total. The application can call
--   this to show accurate dispensable stock.
-- ============================================================

CREATE OR REPLACE FUNCTION get_effective_stock(p_medicine_id UUID)
RETURNS TABLE(
  total_stock INTEGER,
  expired_quantity INTEGER,
  effective_stock INTEGER,
  earliest_expiry DATE
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pm.current_stock AS total_stock,
    COALESCE(exp.expired_qty, 0)::INTEGER AS expired_quantity,
    GREATEST(0, pm.current_stock - COALESCE(exp.expired_qty, 0))::INTEGER AS effective_stock,
    exp.earliest_expiry
  FROM pharmacy_medicines pm
  LEFT JOIN LATERAL (
    SELECT 
      SUM(pb.quantity)::INTEGER AS expired_qty,
      MIN(pb.expiry_date) AS earliest_expiry
    FROM pharmacy_batches pb
    WHERE pb.medicine_id = p_medicine_id
      AND pb.expiry_date < CURRENT_DATE
      AND pb.quantity > 0
  ) exp ON TRUE
  WHERE pm.id = p_medicine_id;
END;
$$;

-- ============================================================
-- DONE
-- ============================================================
SELECT 'Migration 012: Role constraint fix, column aliases, atomic dispense, effective stock — COMPLETE' AS result;
