-- ============================================================
-- Migration 013: REAL Bug Fixes (Pharmacy Race Condition + IPD Nursing Setup)
-- ============================================================
--
-- This migration addresses TWO confirmed real issues:
--
-- 1. PHARMACY RACE CONDITION (Bug #3):
--    dispenseMedicine() in pharmacy.ts does a non-atomic read-check-update.
--    Two concurrent dispense requests can both pass the stock check and
--    both decrement, taking stock below zero.
--
-- 2. IPD_NURSING TABLE (Setup Issue):
--    The ipd_nursing table is referenced by discharge-clearance.ts and
--    the IPD page (ipd/page.tsx, ipd/[bedId]/page.tsx) but may not exist
--    on all instances. This ensures it exists.
--
-- SAFE TO RUN MULTIPLE TIMES: Uses IF NOT EXISTS and CREATE OR REPLACE.
-- ============================================================

-- ── 1. ATOMIC PHARMACY DISPENSING ─────────────────────────────────────
--
-- PROBLEM:
--   pharmacy.ts reads current_stock, checks >= quantity, then updates.
--   Between the read and update, another request can also read the same
--   stock value, pass the check, and decrement. Stock goes negative.
--
-- FIX:
--   SELECT ... FOR UPDATE locks the row during the transaction.
--   Only one dispense proceeds at a time for the same medicine.
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

  -- Decrement stock atomically (row is locked)
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

-- ── 2. EFFECTIVE STOCK (excluding expired batches) ────────────────────
--
-- PROBLEM:
--   hasStock() in pharmacy.ts only checks current_stock field which
--   doesn't distinguish valid vs expired inventory.
--
-- FIX:
--   This function calculates stock minus expired batch quantities.
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

-- ── 3. IPD_NURSING TABLE (ensure exists) ──────────────────────────────
--
-- This table is used by:
--   - src/app/ipd/page.tsx (save vitals, I/O, nursing notes)
--   - src/app/ipd/[bedId]/page.tsx (bed-level nursing)
--   - src/lib/discharge-clearance.ts (check last vitals before discharge)
--   - src/app/search/page.tsx (search nursing notes)
--
-- If this table doesn't exist, discharge clearance nursing check
-- silently fails and IPD vital/IO recording throws errors.
-- ============================================================

CREATE TABLE IF NOT EXISTS ipd_nursing (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ipd_admission_id  UUID,
  bed_id            UUID,
  patient_id        UUID,
  entry_type        TEXT DEFAULT 'note',
  recorded_time     TEXT,

  -- Vitals
  pulse             TEXT,
  bp_systolic       TEXT,
  bp_diastolic      TEXT,
  temperature       TEXT,
  spo2              TEXT,
  respiratory_rate  TEXT,

  -- I/O
  io_type           TEXT,
  io_amount         TEXT,
  io_description    TEXT,

  -- Notes
  nurse_name        TEXT,
  note_text         TEXT,
  note_type         TEXT,

  -- Medications
  medication_name   TEXT,
  medication_dose   TEXT,
  medication_route  TEXT,
  medication_given_by TEXT,

  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE ipd_nursing ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users full access (nursing staff = authenticated users)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ipd_nursing' AND policyname = 'nursing_authenticated_access'
  ) THEN
    CREATE POLICY nursing_authenticated_access ON ipd_nursing
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Grant permissions
GRANT ALL ON ipd_nursing TO authenticated;
GRANT ALL ON ipd_nursing TO service_role;

-- ============================================================
-- DONE
-- ============================================================
SELECT 'Migration 013: Atomic pharmacy dispense + ipd_nursing table — COMPLETE' AS result;
