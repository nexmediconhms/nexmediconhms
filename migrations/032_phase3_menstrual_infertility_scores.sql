-- ============================================================================
-- Migration 032: Phase 3 — Menstrual Tracking, Infertility Workups & Scores
-- ============================================================================
-- TABLES:
--   1. menstrual_cycles   — period logging and cycle analysis
--   2. infertility_workups — step-by-step infertility investigation tracker
--   3. clinical_scores    — MRS, Bishop, etc. scoring results
--   4. patient_education_logs — tracks which handouts were given
-- ============================================================================

-- §1 MENSTRUAL CYCLES
CREATE TABLE IF NOT EXISTS menstrual_cycles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE menstrual_cycles ADD COLUMN IF NOT EXISTS period_start_date     DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE menstrual_cycles ADD COLUMN IF NOT EXISTS period_end_date       DATE;
ALTER TABLE menstrual_cycles ADD COLUMN IF NOT EXISTS duration_days         INTEGER;
ALTER TABLE menstrual_cycles ADD COLUMN IF NOT EXISTS cycle_length          INTEGER;
ALTER TABLE menstrual_cycles ADD COLUMN IF NOT EXISTS flow_intensity        TEXT DEFAULT 'moderate';
ALTER TABLE menstrual_cycles ADD COLUMN IF NOT EXISTS pad_count_per_day     INTEGER;
ALTER TABLE menstrual_cycles ADD COLUMN IF NOT EXISTS clots                 BOOLEAN DEFAULT FALSE;
ALTER TABLE menstrual_cycles ADD COLUMN IF NOT EXISTS pain_level            INTEGER;
ALTER TABLE menstrual_cycles ADD COLUMN IF NOT EXISTS pain_type             TEXT;
ALTER TABLE menstrual_cycles ADD COLUMN IF NOT EXISTS symptoms              JSONB DEFAULT '[]';
ALTER TABLE menstrual_cycles ADD COLUMN IF NOT EXISTS medications_taken     JSONB DEFAULT '[]';
ALTER TABLE menstrual_cycles ADD COLUMN IF NOT EXISTS spotting_before       BOOLEAN DEFAULT FALSE;
ALTER TABLE menstrual_cycles ADD COLUMN IF NOT EXISTS spotting_after        BOOLEAN DEFAULT FALSE;
ALTER TABLE menstrual_cycles ADD COLUMN IF NOT EXISTS is_irregular          BOOLEAN DEFAULT FALSE;
ALTER TABLE menstrual_cycles ADD COLUMN IF NOT EXISTS notes                 TEXT;
ALTER TABLE menstrual_cycles ADD COLUMN IF NOT EXISTS encounter_id         UUID;
ALTER TABLE menstrual_cycles ADD COLUMN IF NOT EXISTS recorded_by          UUID;
ALTER TABLE menstrual_cycles ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name='menstrual_cycles' AND constraint_name='menstrual_cycles_patient_id_fkey') THEN
    BEGIN ALTER TABLE menstrual_cycles ADD CONSTRAINT menstrual_cycles_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FK skipped: %', SQLERRM; END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_menstrual_patient    ON menstrual_cycles (patient_id);
CREATE INDEX IF NOT EXISTS idx_menstrual_start_date ON menstrual_cycles (period_start_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_menstrual_unique_period ON menstrual_cycles (patient_id, period_start_date);


-- §2 INFERTILITY WORKUPS
CREATE TABLE IF NOT EXISTS infertility_workups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS partner_id          UUID;
ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS encounter_id        UUID;
ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS infertility_type    TEXT DEFAULT 'primary';
ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS duration_months     INTEGER;
ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS status             TEXT DEFAULT 'in_progress';
ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS female_age         INTEGER;
ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS male_age           INTEGER;

-- Step tracking as JSONB (flexible per step)
ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS history_complete    BOOLEAN DEFAULT FALSE;
ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS history_data        JSONB DEFAULT '{}';
ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS female_hormonal     JSONB DEFAULT '{}';
ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS female_imaging      JSONB DEFAULT '{}';
ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS female_tubal        JSONB DEFAULT '{}';
ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS male_semen          JSONB DEFAULT '{}';
ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS male_hormonal       JSONB DEFAULT '{}';
ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS additional_tests    JSONB DEFAULT '{}';
ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS diagnosis           JSONB DEFAULT '[]';
ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS treatment_plan      TEXT;
ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS treatment_type      TEXT;
ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS treatment_cycles    JSONB DEFAULT '[]';
ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS notes              TEXT;
ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS doctor_id          UUID;
ALTER TABLE infertility_workups ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name='infertility_workups' AND constraint_name='infertility_workups_patient_id_fkey') THEN
    BEGIN ALTER TABLE infertility_workups ADD CONSTRAINT infertility_workups_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FK skipped: %', SQLERRM; END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_infertility_patient ON infertility_workups (patient_id);
CREATE INDEX IF NOT EXISTS idx_infertility_status  ON infertility_workups (status);


-- §3 CLINICAL SCORES (MRS, Bishop, etc.)
CREATE TABLE IF NOT EXISTS clinical_scores (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE clinical_scores ADD COLUMN IF NOT EXISTS encounter_id    UUID;
ALTER TABLE clinical_scores ADD COLUMN IF NOT EXISTS score_type      TEXT NOT NULL DEFAULT '';
ALTER TABLE clinical_scores ADD COLUMN IF NOT EXISTS score_name      TEXT NOT NULL DEFAULT '';
ALTER TABLE clinical_scores ADD COLUMN IF NOT EXISTS total_score     NUMERIC(6,2);
ALTER TABLE clinical_scores ADD COLUMN IF NOT EXISTS max_score       NUMERIC(6,2);
ALTER TABLE clinical_scores ADD COLUMN IF NOT EXISTS severity        TEXT;
ALTER TABLE clinical_scores ADD COLUMN IF NOT EXISTS subscores       JSONB DEFAULT '{}';
ALTER TABLE clinical_scores ADD COLUMN IF NOT EXISTS interpretation  TEXT;
ALTER TABLE clinical_scores ADD COLUMN IF NOT EXISTS recommendations JSONB DEFAULT '[]';
ALTER TABLE clinical_scores ADD COLUMN IF NOT EXISTS scored_by       UUID;
ALTER TABLE clinical_scores ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name='clinical_scores' AND constraint_name='clinical_scores_patient_id_fkey') THEN
    BEGIN ALTER TABLE clinical_scores ADD CONSTRAINT clinical_scores_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FK skipped: %', SQLERRM; END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clinical_scores_patient ON clinical_scores (patient_id);
CREATE INDEX IF NOT EXISTS idx_clinical_scores_type    ON clinical_scores (score_type);


-- §4 PATIENT EDUCATION LOGS
CREATE TABLE IF NOT EXISTS patient_education_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE patient_education_logs ADD COLUMN IF NOT EXISTS encounter_id     UUID;
ALTER TABLE patient_education_logs ADD COLUMN IF NOT EXISTS handout_code     TEXT NOT NULL DEFAULT '';
ALTER TABLE patient_education_logs ADD COLUMN IF NOT EXISTS handout_title    TEXT;
ALTER TABLE patient_education_logs ADD COLUMN IF NOT EXISTS language         TEXT DEFAULT 'en';
ALTER TABLE patient_education_logs ADD COLUMN IF NOT EXISTS delivery_method  TEXT DEFAULT 'print';
ALTER TABLE patient_education_logs ADD COLUMN IF NOT EXISTS given_by        UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name='patient_education_logs' AND constraint_name='patient_education_logs_patient_id_fkey') THEN
    BEGIN ALTER TABLE patient_education_logs ADD CONSTRAINT patient_education_logs_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FK skipped: %', SQLERRM; END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_education_logs_patient ON patient_education_logs (patient_id);


-- §5 RLS
ALTER TABLE menstrual_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE infertility_workups ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_education_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS menstrual_cycles_all ON menstrual_cycles;
CREATE POLICY menstrual_cycles_all ON menstrual_cycles FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS infertility_workups_all ON infertility_workups;
CREATE POLICY infertility_workups_all ON infertility_workups FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS clinical_scores_all ON clinical_scores;
CREATE POLICY clinical_scores_all ON clinical_scores FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS patient_education_logs_all ON patient_education_logs;
CREATE POLICY patient_education_logs_all ON patient_education_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- §6 UPDATED_AT TRIGGERS
CREATE OR REPLACE FUNCTION update_generic_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_menstrual_updated ON menstrual_cycles;
CREATE TRIGGER trg_menstrual_updated BEFORE UPDATE ON menstrual_cycles FOR EACH ROW EXECUTE FUNCTION update_generic_updated_at();
DROP TRIGGER IF EXISTS trg_infertility_updated ON infertility_workups;
CREATE TRIGGER trg_infertility_updated BEFORE UPDATE ON infertility_workups FOR EACH ROW EXECUTE FUNCTION update_generic_updated_at();
DROP TRIGGER IF EXISTS trg_scores_updated ON clinical_scores;
CREATE TRIGGER trg_scores_updated BEFORE UPDATE ON clinical_scores FOR EACH ROW EXECUTE FUNCTION update_generic_updated_at();

SELECT 'Migration 032: Phase 3 — COMPLETE' AS result;
