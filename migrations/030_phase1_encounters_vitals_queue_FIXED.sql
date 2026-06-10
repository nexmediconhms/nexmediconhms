-- ============================================================================
-- Migration 030: Phase 1 — Encounters, Vitals & Enhanced Queue (FIXED)
-- ============================================================================
--
-- FIX: If the table already exists from a previous partial run,
--      CREATE TABLE IF NOT EXISTS skips everything (including columns).
--      This version uses ALTER TABLE ADD COLUMN IF NOT EXISTS as a
--      safety net after every CREATE TABLE.
--
-- SAFE TO RE-RUN: fully idempotent.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- §1  ENCOUNTERS TABLE
-- ─────────────────────────────────────────────────────────────────────────────

-- Step A: create the table with minimal columns (id + patient_id)
CREATE TABLE IF NOT EXISTS encounters (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id     UUID NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Step B: add every column individually (safe if table already existed)
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS doctor_id          UUID;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS clinic_id          UUID;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS visit_type         TEXT NOT NULL DEFAULT 'OPD';
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS visit_date         DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS visit_number       INTEGER;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS status             TEXT NOT NULL DEFAULT 'registered';
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS chief_complaint    TEXT;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS examination_notes  TEXT;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS diagnosis          TEXT;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS diagnosis_code     TEXT;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS treatment_plan     TEXT;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS clinical_notes     JSONB DEFAULT '{}';
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS gynae_data         JSONB DEFAULT '{}';
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS procedures         JSONB DEFAULT '[]';
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS follow_up_date     DATE;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS follow_up_notes    TEXT;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS follow_up_created  BOOLEAN DEFAULT FALSE;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS referral_to        TEXT;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS referral_notes     TEXT;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS referral_letter_id UUID;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS queue_entry_id     UUID;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS admission_id       UUID;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS started_at         TIMESTAMPTZ;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS ended_at           TIMESTAMPTZ;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS duration_mins      INTEGER;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS created_by         UUID;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS updated_by         UUID;

-- Step C: add FK constraint if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'encounters'
       AND constraint_type = 'FOREIGN KEY'
       AND constraint_name = 'encounters_patient_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE encounters
        ADD CONSTRAINT encounters_patient_id_fkey
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'FK encounters_patient_id_fkey skipped: %', SQLERRM;
    END;
  END IF;
END $$;

-- Step D: indexes
CREATE INDEX IF NOT EXISTS idx_encounters_patient_id    ON encounters (patient_id);
CREATE INDEX IF NOT EXISTS idx_encounters_visit_date    ON encounters (visit_date);
CREATE INDEX IF NOT EXISTS idx_encounters_doctor_id     ON encounters (doctor_id) WHERE doctor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_encounters_status        ON encounters (status);
CREATE INDEX IF NOT EXISTS idx_encounters_patient_date  ON encounters (patient_id, visit_date);
CREATE INDEX IF NOT EXISTS idx_encounters_visit_type    ON encounters (visit_type);

-- Step E: triggers
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

CREATE TABLE IF NOT EXISTS vitals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id   UUID NOT NULL,
  patient_id     UUID NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add every column individually
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS weight_kg              NUMERIC(5,2);
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS height_cm              NUMERIC(5,1);
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS bmi                    NUMERIC(4,1);
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS bp_systolic            INTEGER;
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS bp_diastolic           INTEGER;
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS pulse_rate             INTEGER;
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS temperature_f          NUMERIC(4,1);
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS spo2                   INTEGER;
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS respiratory_rate       INTEGER;
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS blood_sugar_value      NUMERIC(5,1);
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS blood_sugar_type       TEXT;
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS lmp                    DATE;
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS gestational_age_weeks  NUMERIC(4,1);
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS gestational_age_days   INTEGER;
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS fundal_height_cm       NUMERIC(4,1);
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS fetal_heart_rate       INTEGER;
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS presentation           TEXT;
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS uterine_contractions   TEXT;
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS edema                  TEXT;
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS urine_albumin          TEXT;
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS urine_sugar            TEXT;
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS hemoglobin             NUMERIC(4,1);
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS notes                  TEXT;
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS capture_type           TEXT DEFAULT 'pre_consultation';
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS is_critical            BOOLEAN DEFAULT FALSE;
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS critical_alerts        JSONB DEFAULT '[]';
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS recorded_by            UUID;
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS recorded_at            TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- FK constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'vitals'
       AND constraint_name = 'vitals_encounter_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE vitals
        ADD CONSTRAINT vitals_encounter_id_fkey
        FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'FK vitals_encounter_id_fkey skipped: %', SQLERRM;
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'vitals'
       AND constraint_name = 'vitals_patient_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE vitals
        ADD CONSTRAINT vitals_patient_id_fkey
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'FK vitals_patient_id_fkey skipped: %', SQLERRM;
    END;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vitals_encounter_id  ON vitals (encounter_id);
CREATE INDEX IF NOT EXISTS idx_vitals_patient_id    ON vitals (patient_id);
CREATE INDEX IF NOT EXISTS idx_vitals_recorded_at   ON vitals (recorded_at);
CREATE INDEX IF NOT EXISTS idx_vitals_is_critical   ON vitals (is_critical) WHERE is_critical = TRUE;

-- Trigger: auto-calculate BMI
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
  IF NEW.bp_systolic IS NOT NULL AND NEW.bp_systolic >= 160 THEN
    alerts = alerts || jsonb_build_array(jsonb_build_object(
      'field', 'bp_systolic', 'value', NEW.bp_systolic,
      'severity', 'critical', 'message', 'Systolic BP >= 160 mmHg — Severe hypertension'));
  ELSIF NEW.bp_systolic IS NOT NULL AND NEW.bp_systolic >= 140 THEN
    alerts = alerts || jsonb_build_array(jsonb_build_object(
      'field', 'bp_systolic', 'value', NEW.bp_systolic,
      'severity', 'warning', 'message', 'Systolic BP >= 140 mmHg — Hypertension'));
  END IF;

  IF NEW.bp_diastolic IS NOT NULL AND NEW.bp_diastolic >= 110 THEN
    alerts = alerts || jsonb_build_array(jsonb_build_object(
      'field', 'bp_diastolic', 'value', NEW.bp_diastolic,
      'severity', 'critical', 'message', 'Diastolic BP >= 110 mmHg — Severe hypertension'));
  ELSIF NEW.bp_diastolic IS NOT NULL AND NEW.bp_diastolic >= 90 THEN
    alerts = alerts || jsonb_build_array(jsonb_build_object(
      'field', 'bp_diastolic', 'value', NEW.bp_diastolic,
      'severity', 'warning', 'message', 'Diastolic BP >= 90 mmHg — Hypertension'));
  END IF;

  IF NEW.spo2 IS NOT NULL AND NEW.spo2 < 92 THEN
    alerts = alerts || jsonb_build_array(jsonb_build_object(
      'field', 'spo2', 'value', NEW.spo2,
      'severity', 'critical', 'message', 'SpO2 < 92% — Hypoxia'));
  END IF;

  IF NEW.temperature_f IS NOT NULL AND NEW.temperature_f >= 102.0 THEN
    alerts = alerts || jsonb_build_array(jsonb_build_object(
      'field', 'temperature_f', 'value', NEW.temperature_f,
      'severity', 'warning', 'message', 'Temperature >= 102 F — High fever'));
  END IF;

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

  IF NEW.hemoglobin IS NOT NULL AND NEW.hemoglobin < 7.0 THEN
    alerts = alerts || jsonb_build_array(jsonb_build_object(
      'field', 'hemoglobin', 'value', NEW.hemoglobin,
      'severity', 'critical', 'message', 'Hb < 7 g/dL — Severe anemia'));
  ELSIF NEW.hemoglobin IS NOT NULL AND NEW.hemoglobin < 10.0 THEN
    alerts = alerts || jsonb_build_array(jsonb_build_object(
      'field', 'hemoglobin', 'value', NEW.hemoglobin,
      'severity', 'warning', 'message', 'Hb < 10 g/dL — Anemia'));
  END IF;

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
-- §3  ENHANCE OPD_QUEUE
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'opd_queue' AND column_name = 'encounter_id') THEN
    ALTER TABLE opd_queue ADD COLUMN encounter_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'opd_queue' AND column_name = 'visit_type') THEN
    ALTER TABLE opd_queue ADD COLUMN visit_type TEXT DEFAULT 'OPD';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'opd_queue' AND column_name = 'vitals_done') THEN
    ALTER TABLE opd_queue ADD COLUMN vitals_done BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'opd_queue' AND column_name = 'vitals_done_at') THEN
    ALTER TABLE opd_queue ADD COLUMN vitals_done_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'opd_queue' AND column_name = 'skipped_count') THEN
    ALTER TABLE opd_queue ADD COLUMN skipped_count INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'opd_queue' AND column_name = 'recalled_at') THEN
    ALTER TABLE opd_queue ADD COLUMN recalled_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'opd_queue' AND column_name = 'doctor_id') THEN
    ALTER TABLE opd_queue ADD COLUMN doctor_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'opd_queue' AND column_name = 'notes') THEN
    ALTER TABLE opd_queue ADD COLUMN notes TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_opd_queue_encounter_id
  ON opd_queue (encounter_id) WHERE encounter_id IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- §4  ADD encounter_id TO EXISTING TABLES
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- bills
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bills')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bills' AND column_name = 'encounter_id')
  THEN
    ALTER TABLE bills ADD COLUMN encounter_id UUID;
  END IF;

  -- consultation_attachments
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'consultation_attachments')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'consultation_attachments' AND column_name = 'encounter_id')
  THEN
    ALTER TABLE consultation_attachments ADD COLUMN encounter_id UUID;
  END IF;

  -- prescriptions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'prescriptions')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'prescriptions' AND column_name = 'encounter_id')
  THEN
    ALTER TABLE prescriptions ADD COLUMN encounter_id UUID;
  END IF;

  -- lab_orders
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lab_orders')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lab_orders' AND column_name = 'encounter_id')
  THEN
    ALTER TABLE lab_orders ADD COLUMN encounter_id UUID;
  END IF;

  -- lab_results
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lab_results')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lab_results' AND column_name = 'encounter_id')
  THEN
    ALTER TABLE lab_results ADD COLUMN encounter_id UUID;
  END IF;
END $$;

-- Index on bills.encounter_id
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bills' AND column_name = 'encounter_id') THEN
    CREATE INDEX IF NOT EXISTS idx_bills_encounter_id ON bills (encounter_id) WHERE encounter_id IS NOT NULL;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- §5  ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE encounters ENABLE ROW LEVEL SECURITY;
ALTER TABLE vitals     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS encounters_select ON encounters;
CREATE POLICY encounters_select ON encounters FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS encounters_insert ON encounters;
CREATE POLICY encounters_insert ON encounters FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS encounters_update ON encounters;
CREATE POLICY encounters_update ON encounters FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS encounters_delete ON encounters;
CREATE POLICY encounters_delete ON encounters FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS vitals_select ON vitals;
CREATE POLICY vitals_select ON vitals FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS vitals_insert ON vitals;
CREATE POLICY vitals_insert ON vitals FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS vitals_update ON vitals;
CREATE POLICY vitals_update ON vitals FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS vitals_delete ON vitals;
CREATE POLICY vitals_delete ON vitals FOR DELETE TO authenticated USING (true);


-- ─────────────────────────────────────────────────────────────────────────────
-- §6  REALTIME
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND tablename = 'encounters'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE encounters;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND tablename = 'vitals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE vitals;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Realtime publication update skipped: %', SQLERRM;
END $$;


SELECT 'Migration 030: Phase 1 — COMPLETE' AS result;
