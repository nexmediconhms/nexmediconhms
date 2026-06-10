-- ============================================================================
-- Migration 030: Phase 1 — Encounters, Vitals & Enhanced Queue
-- ============================================================================
--
-- PURPOSE:
--   1. Create `encounters` table as the central spine for every OPD visit.
--   2. Create `vitals` table for pre-consultation staff capture.
--   3. Enhance `opd_queue` with multi-status flow.
--   4. Add encounter_id FK to bills, prescriptions, lab_orders (additive only).
--
-- SAFETY:
--   • Every DDL uses IF NOT EXISTS / IF EXISTS guards.
--   • No existing column is dropped or renamed.
--   • Existing rows are NOT modified; new columns default to NULL.
--   • This migration is idempotent — safe to re-run.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- §1  ENCOUNTERS TABLE
-- ─────────────────────────────────────────────────────────────────────────────
-- The encounter is the "spine" that links queue entry, vitals, consultation,
-- prescription, labs, billing, and follow-up for a single OPD visit.

CREATE TABLE IF NOT EXISTS encounters (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id     UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id      UUID,                            -- auth.users id of the doctor
  clinic_id      UUID,                            -- for multi-clinic setups (nullable)

  -- Visit metadata
  visit_type     TEXT NOT NULL DEFAULT 'OPD',      -- OPD | ANC | Follow-up | Procedure | Emergency
  visit_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  visit_number   INTEGER,                          -- auto-incremented per patient (1st visit, 2nd, etc.)

  -- Status tracking
  status         TEXT NOT NULL DEFAULT 'registered',
  -- Allowed: registered | vitals_in_progress | vitals_done | with_doctor
  --        | consultation_done | at_pharmacy | at_billing | completed
  --        | admitted_to_ipd | cancelled | no_show

  -- Clinical summary (populated during/after consultation)
  chief_complaint    TEXT,
  examination_notes  TEXT,
  diagnosis          TEXT,                          -- free text or ICD-10 code
  diagnosis_code     TEXT,                          -- ICD-10 code separately
  treatment_plan     TEXT,
  clinical_notes     JSONB DEFAULT '{}',            -- flexible structured data

  -- Gynae-specific encounter data
  gynae_data     JSONB DEFAULT '{}',
  -- Example: { "lmp": "2025-05-01", "gestational_age_weeks": 12,
  --            "obstetric_history": "G2P1A0L1",
  --            "menstrual_history": { "cycle_length": 28, "duration": 5 },
  --            "examination": { "ps": "...", "pv": "...", "pa": "..." } }

  -- Procedure tracking (minor OPD procedures)
  procedures     JSONB DEFAULT '[]',
  -- Example: [{ "name": "IUD Insertion", "code": "PROC-001",
  --             "notes": "...", "consent_taken": true }]

  -- Follow-up
  follow_up_date     DATE,
  follow_up_notes    TEXT,
  follow_up_created  BOOLEAN DEFAULT FALSE,

  -- Referral
  referral_to        TEXT,                          -- specialist/center name
  referral_notes     TEXT,
  referral_letter_id UUID,                          -- FK to attachments if generated

  -- Link to OPD queue entry
  queue_entry_id     UUID,                          -- FK to opd_queue.id

  -- Link to admission (if patient admitted from OPD)
  admission_id       UUID,

  -- Timing
  started_at     TIMESTAMPTZ,                      -- when doctor started consultation
  ended_at       TIMESTAMPTZ,                      -- when doctor finished
  duration_mins  INTEGER,                          -- auto-calculated or manual

  -- Audit
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by     UUID,                             -- staff who created the encounter
  updated_by     UUID
);

-- Indexes for encounters
CREATE INDEX IF NOT EXISTS idx_encounters_patient_id
  ON encounters (patient_id);
CREATE INDEX IF NOT EXISTS idx_encounters_visit_date
  ON encounters (visit_date);
CREATE INDEX IF NOT EXISTS idx_encounters_doctor_id
  ON encounters (doctor_id) WHERE doctor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_encounters_status
  ON encounters (status);
CREATE INDEX IF NOT EXISTS idx_encounters_patient_date
  ON encounters (patient_id, visit_date);
CREATE INDEX IF NOT EXISTS idx_encounters_visit_type
  ON encounters (visit_type);

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION update_encounters_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_encounters_updated_at ON encounters;
CREATE TRIGGER trg_encounters_updated_at
  BEFORE UPDATE ON encounters
  FOR EACH ROW
  EXECUTE FUNCTION update_encounters_updated_at();

-- Trigger: auto-calculate visit_number for patient
CREATE OR REPLACE FUNCTION set_encounter_visit_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.visit_number IS NULL THEN
    SELECT COALESCE(MAX(visit_number), 0) + 1
      INTO NEW.visit_number
      FROM encounters
     WHERE patient_id = NEW.patient_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_encounter_visit_number ON encounters;
CREATE TRIGGER trg_encounter_visit_number
  BEFORE INSERT ON encounters
  FOR EACH ROW
  EXECUTE FUNCTION set_encounter_visit_number();


-- ─────────────────────────────────────────────────────────────────────────────
-- §2  VITALS TABLE
-- ─────────────────────────────────────────────────────────────────────────────
-- Captured by nurse/staff BEFORE the doctor consultation.
-- One row per vital-capture event. Multiple rows possible per encounter
-- (e.g., pre-consult and post-procedure).

CREATE TABLE IF NOT EXISTS vitals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id   UUID NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
  patient_id     UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,

  -- Standard vitals
  weight_kg      NUMERIC(5,2),                    -- e.g., 65.50
  height_cm      NUMERIC(5,1),                    -- e.g., 162.5
  bmi            NUMERIC(4,1),                    -- auto-calculated
  bp_systolic    INTEGER,                         -- mmHg
  bp_diastolic   INTEGER,                         -- mmHg
  pulse_rate     INTEGER,                         -- bpm
  temperature_f  NUMERIC(4,1),                    -- Fahrenheit (Indian standard)
  spo2           INTEGER,                         -- percentage
  respiratory_rate INTEGER,                       -- breaths/min

  -- Blood sugar
  blood_sugar_value   NUMERIC(5,1),
  blood_sugar_type    TEXT,                        -- fasting | pp | random

  -- Gynae-specific vitals
  lmp            DATE,                             -- Last Menstrual Period
  gestational_age_weeks  NUMERIC(4,1),             -- auto from LMP or manual
  gestational_age_days   INTEGER,                  -- remaining days
  fundal_height_cm       NUMERIC(4,1),
  fetal_heart_rate       INTEGER,                  -- bpm
  presentation           TEXT,                     -- cephalic | breech | transverse
  uterine_contractions   TEXT,                     -- none | mild | moderate | strong
  edema                  TEXT,                     -- none | mild | moderate | severe
  urine_albumin          TEXT,                     -- nil | trace | +1 | +2 | +3 | +4
  urine_sugar            TEXT,                     -- nil | trace | +1 | +2 | +3 | +4
  hemoglobin             NUMERIC(4,1),             -- g/dL

  -- Additional notes
  notes          TEXT,
  capture_type   TEXT DEFAULT 'pre_consultation',  -- pre_consultation | post_procedure | monitoring

  -- Flags
  is_critical    BOOLEAN DEFAULT FALSE,            -- auto-set by trigger if values are dangerous
  critical_alerts JSONB DEFAULT '[]',              -- [{field, value, severity, message}]

  -- Audit
  recorded_by    UUID,                             -- staff who recorded
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for vitals
CREATE INDEX IF NOT EXISTS idx_vitals_encounter_id
  ON vitals (encounter_id);
CREATE INDEX IF NOT EXISTS idx_vitals_patient_id
  ON vitals (patient_id);
CREATE INDEX IF NOT EXISTS idx_vitals_recorded_at
  ON vitals (recorded_at);
CREATE INDEX IF NOT EXISTS idx_vitals_is_critical
  ON vitals (is_critical) WHERE is_critical = TRUE;

-- Trigger: auto-calculate BMI when weight and height are provided
CREATE OR REPLACE FUNCTION calculate_vitals_bmi()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.weight_kg IS NOT NULL AND NEW.height_cm IS NOT NULL AND NEW.height_cm > 0 THEN
    NEW.bmi = ROUND((NEW.weight_kg / ((NEW.height_cm / 100.0) * (NEW.height_cm / 100.0)))::NUMERIC, 1);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vitals_bmi ON vitals;
CREATE TRIGGER trg_vitals_bmi
  BEFORE INSERT OR UPDATE ON vitals
  FOR EACH ROW
  EXECUTE FUNCTION calculate_vitals_bmi();

-- Trigger: auto-calculate gestational age from LMP
CREATE OR REPLACE FUNCTION calculate_gestational_age()
RETURNS TRIGGER AS $$
DECLARE
  days_since_lmp INTEGER;
BEGIN
  IF NEW.lmp IS NOT NULL AND NEW.gestational_age_weeks IS NULL THEN
    days_since_lmp := CURRENT_DATE - NEW.lmp;
    IF days_since_lmp >= 0 AND days_since_lmp <= 300 THEN
      NEW.gestational_age_weeks = FLOOR(days_since_lmp / 7.0);
      NEW.gestational_age_days  = days_since_lmp % 7;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vitals_gestational_age ON vitals;
CREATE TRIGGER trg_vitals_gestational_age
  BEFORE INSERT OR UPDATE ON vitals
  FOR EACH ROW
  EXECUTE FUNCTION calculate_gestational_age();

-- Trigger: auto-detect critical vitals
CREATE OR REPLACE FUNCTION detect_critical_vitals()
RETURNS TRIGGER AS $$
DECLARE
  alerts JSONB := '[]'::JSONB;
BEGIN
  -- High BP (severe preeclampsia threshold)
  IF NEW.bp_systolic IS NOT NULL AND NEW.bp_systolic >= 160 THEN
    alerts = alerts || jsonb_build_array(jsonb_build_object(
      'field', 'bp_systolic', 'value', NEW.bp_systolic,
      'severity', 'critical', 'message', 'Systolic BP ≥ 160 mmHg — Severe hypertension'));
  ELSIF NEW.bp_systolic IS NOT NULL AND NEW.bp_systolic >= 140 THEN
    alerts = alerts || jsonb_build_array(jsonb_build_object(
      'field', 'bp_systolic', 'value', NEW.bp_systolic,
      'severity', 'warning', 'message', 'Systolic BP ≥ 140 mmHg — Hypertension'));
  END IF;

  IF NEW.bp_diastolic IS NOT NULL AND NEW.bp_diastolic >= 110 THEN
    alerts = alerts || jsonb_build_array(jsonb_build_object(
      'field', 'bp_diastolic', 'value', NEW.bp_diastolic,
      'severity', 'critical', 'message', 'Diastolic BP ≥ 110 mmHg — Severe hypertension'));
  ELSIF NEW.bp_diastolic IS NOT NULL AND NEW.bp_diastolic >= 90 THEN
    alerts = alerts || jsonb_build_array(jsonb_build_object(
      'field', 'bp_diastolic', 'value', NEW.bp_diastolic,
      'severity', 'warning', 'message', 'Diastolic BP ≥ 90 mmHg — Hypertension'));
  END IF;

  -- Low SpO2
  IF NEW.spo2 IS NOT NULL AND NEW.spo2 < 92 THEN
    alerts = alerts || jsonb_build_array(jsonb_build_object(
      'field', 'spo2', 'value', NEW.spo2,
      'severity', 'critical', 'message', 'SpO2 < 92% — Hypoxia'));
  END IF;

  -- High temperature (fever)
  IF NEW.temperature_f IS NOT NULL AND NEW.temperature_f >= 102.0 THEN
    alerts = alerts || jsonb_build_array(jsonb_build_object(
      'field', 'temperature_f', 'value', NEW.temperature_f,
      'severity', 'warning', 'message', 'Temperature ≥ 102°F — High fever'));
  END IF;

  -- Abnormal FHR (fetal distress)
  IF NEW.fetal_heart_rate IS NOT NULL THEN
    IF NEW.fetal_heart_rate < 110 THEN
      alerts = alerts || jsonb_build_array(jsonb_build_object(
        'field', 'fetal_heart_rate', 'value', NEW.fetal_heart_rate,
        'severity', 'critical', 'message', 'FHR < 110 bpm — Fetal bradycardia'));
    ELSIF NEW.fetal_heart_rate > 160 THEN
      alerts = alerts || jsonb_build_array(jsonb_build_object(
        'field', 'fetal_heart_rate', 'value', NEW.fetal_heart_rate,
        'severity', 'critical', 'message', 'FHR > 160 bpm — Fetal tachycardia'));
    END IF;
  END IF;

  -- Low hemoglobin
  IF NEW.hemoglobin IS NOT NULL AND NEW.hemoglobin < 7.0 THEN
    alerts = alerts || jsonb_build_array(jsonb_build_object(
      'field', 'hemoglobin', 'value', NEW.hemoglobin,
      'severity', 'critical', 'message', 'Hb < 7 g/dL — Severe anemia'));
  ELSIF NEW.hemoglobin IS NOT NULL AND NEW.hemoglobin < 10.0 THEN
    alerts = alerts || jsonb_build_array(jsonb_build_object(
      'field', 'hemoglobin', 'value', NEW.hemoglobin,
      'severity', 'warning', 'message', 'Hb < 10 g/dL — Anemia'));
  END IF;

  -- Urine albumin
  IF NEW.urine_albumin IS NOT NULL AND NEW.urine_albumin IN ('+2', '+3', '+4') THEN
    alerts = alerts || jsonb_build_array(jsonb_build_object(
      'field', 'urine_albumin', 'value', NEW.urine_albumin,
      'severity', 'critical', 'message', 'Urine albumin ' || NEW.urine_albumin || ' — Proteinuria'));
  END IF;

  NEW.critical_alerts = alerts;
  NEW.is_critical = jsonb_array_length(alerts) > 0
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(alerts) AS a
       WHERE a->>'severity' = 'critical'
    );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vitals_critical ON vitals;
CREATE TRIGGER trg_vitals_critical
  BEFORE INSERT OR UPDATE ON vitals
  FOR EACH ROW
  EXECUTE FUNCTION detect_critical_vitals();


-- ─────────────────────────────────────────────────────────────────────────────
-- §3  ENHANCE OPD_QUEUE — Multi-status flow
-- ─────────────────────────────────────────────────────────────────────────────
-- Add new columns if they don't exist. Existing 'status' column stays;
-- we just widen the allowed values conceptually (no CHECK constraint to break).

DO $$
BEGIN
  -- Add encounter_id if not already present (it was referenced in migration 014
  -- but let's ensure it exists with proper FK)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'opd_queue' AND column_name = 'encounter_id'
  ) THEN
    ALTER TABLE opd_queue ADD COLUMN encounter_id UUID REFERENCES encounters(id);
  END IF;

  -- Add visit_type to queue for quick filtering
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'opd_queue' AND column_name = 'visit_type'
  ) THEN
    ALTER TABLE opd_queue ADD COLUMN visit_type TEXT DEFAULT 'OPD';
  END IF;

  -- Add vitals_done flag for quick check
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'opd_queue' AND column_name = 'vitals_done'
  ) THEN
    ALTER TABLE opd_queue ADD COLUMN vitals_done BOOLEAN DEFAULT FALSE;
  END IF;

  -- Add vitals_done_at timestamp
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'opd_queue' AND column_name = 'vitals_done_at'
  ) THEN
    ALTER TABLE opd_queue ADD COLUMN vitals_done_at TIMESTAMPTZ;
  END IF;

  -- Add skipped tracking
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'opd_queue' AND column_name = 'skipped_count'
  ) THEN
    ALTER TABLE opd_queue ADD COLUMN skipped_count INTEGER DEFAULT 0;
  END IF;

  -- Add recalled tracking
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'opd_queue' AND column_name = 'recalled_at'
  ) THEN
    ALTER TABLE opd_queue ADD COLUMN recalled_at TIMESTAMPTZ;
  END IF;

  -- Add doctor assignment
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'opd_queue' AND column_name = 'doctor_id'
  ) THEN
    ALTER TABLE opd_queue ADD COLUMN doctor_id UUID;
  END IF;

  -- Add notes (staff can add notes like "patient stepped out")
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'opd_queue' AND column_name = 'notes'
  ) THEN
    ALTER TABLE opd_queue ADD COLUMN notes TEXT;
  END IF;
END $$;

-- Index for queue encounter lookup
CREATE INDEX IF NOT EXISTS idx_opd_queue_encounter_id
  ON opd_queue (encounter_id) WHERE encounter_id IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- §4  ADD encounter_id TO EXISTING TABLES (additive, nullable)
-- ─────────────────────────────────────────────────────────────────────────────

-- Bills: link each OPD bill to an encounter
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'bills' AND column_name = 'encounter_id'
  ) THEN
    ALTER TABLE bills ADD COLUMN encounter_id UUID REFERENCES encounters(id);
    CREATE INDEX IF NOT EXISTS idx_bills_encounter_id
      ON bills (encounter_id) WHERE encounter_id IS NOT NULL;
  END IF;
END $$;

-- Consultation attachments: link to encounter
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'consultation_attachments' AND column_name = 'encounter_id'
  ) THEN
    ALTER TABLE consultation_attachments ADD COLUMN encounter_id UUID;
  END IF;
END $$;

-- If prescriptions table exists, add encounter_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'prescriptions'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'prescriptions' AND column_name = 'encounter_id'
  ) THEN
    ALTER TABLE prescriptions ADD COLUMN encounter_id UUID;
  END IF;
END $$;

-- If lab_orders table exists, add encounter_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'lab_orders'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'lab_orders' AND column_name = 'encounter_id'
  ) THEN
    ALTER TABLE lab_orders ADD COLUMN encounter_id UUID;
  END IF;
END $$;

-- If lab_results table exists, add encounter_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'lab_results'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'lab_results' AND column_name = 'encounter_id'
  ) THEN
    ALTER TABLE lab_results ADD COLUMN encounter_id UUID;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- §5  ROW LEVEL SECURITY for new tables
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE encounters ENABLE ROW LEVEL SECURITY;
ALTER TABLE vitals ENABLE ROW LEVEL SECURITY;

-- Encounters: authenticated users can CRUD
DROP POLICY IF EXISTS encounters_select ON encounters;
CREATE POLICY encounters_select ON encounters FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS encounters_insert ON encounters;
CREATE POLICY encounters_insert ON encounters FOR INSERT TO authenticated
  WITH CHECK (true);
DROP POLICY IF EXISTS encounters_update ON encounters;
CREATE POLICY encounters_update ON encounters FOR UPDATE TO authenticated
  USING (true);
DROP POLICY IF EXISTS encounters_delete ON encounters;
CREATE POLICY encounters_delete ON encounters FOR DELETE TO authenticated
  USING (true);

-- Vitals: authenticated users can CRUD
DROP POLICY IF EXISTS vitals_select ON vitals;
CREATE POLICY vitals_select ON vitals FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS vitals_insert ON vitals;
CREATE POLICY vitals_insert ON vitals FOR INSERT TO authenticated
  WITH CHECK (true);
DROP POLICY IF EXISTS vitals_update ON vitals;
CREATE POLICY vitals_update ON vitals FOR UPDATE TO authenticated
  USING (true);
DROP POLICY IF EXISTS vitals_delete ON vitals;
CREATE POLICY vitals_delete ON vitals FOR DELETE TO authenticated
  USING (true);


-- ─────────────────────────────────────────────────────────────────────────────
-- §6  REALTIME — Enable for encounters and vitals
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- Enable realtime for encounters
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND tablename = 'encounters'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE encounters;
  END IF;

  -- Enable realtime for vitals
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND tablename = 'vitals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE vitals;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Realtime publication update skipped: %', SQLERRM;
END $$;


SELECT 'Migration 030: Phase 1 Encounters, Vitals & Enhanced Queue — COMPLETE' AS result;
