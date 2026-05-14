-- ============================================================
-- NexMedicon HMS v21 — FINAL v5
-- Handles missing clinicusers, missing dischargesummaries.
-- Safe to run at ANY stage of your DB setup.
-- ============================================================


-- ============================================================
-- STEP 1: Create dischargesummaries table if missing
-- ============================================================
CREATE TABLE IF NOT EXISTS dischargesummaries (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patientid            UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  admissiondate        DATE,
  dischargedate        DATE DEFAULT CURRENT_DATE,
  finaldiagnosis       TEXT,
  secondarydiagnosis   TEXT,
  clinicalsummary      TEXT,
  investigations       TEXT,
  treatmentgiven       TEXT,
  conditionatdischarge TEXT,
  dischargeadvice      TEXT,
  dietadvice           TEXT,
  medicationsatdischarge TEXT,
  followupdate         DATE,
  followupnote         TEXT,
  deliverytype         TEXT,
  babysex              TEXT,
  babyweight           TEXT,
  apgarscore           TEXT,
  deliverydate         DATE,
  complications        TEXT,
  lactationadvice      TEXT,
  babybirthtime        TEXT,
  version              INTEGER DEFAULT 1,
  isfinal              BOOLEAN DEFAULT FALSE,
  signedby             TEXT,
  signedat             TIMESTAMPTZ,
  pdfgeneratedat       TIMESTAMPTZ,
  remindersentat       TIMESTAMPTZ,
  createdat            TIMESTAMPTZ DEFAULT NOW(),
  updatedat            TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- STEP 2: Patch any missing columns on dischargesummaries
-- ============================================================
ALTER TABLE dischargesummaries ADD COLUMN IF NOT EXISTS babybirthtime      TEXT;
ALTER TABLE dischargesummaries ADD COLUMN IF NOT EXISTS isfinal            BOOLEAN DEFAULT FALSE;
ALTER TABLE dischargesummaries ADD COLUMN IF NOT EXISTS signedby           TEXT;
ALTER TABLE dischargesummaries ADD COLUMN IF NOT EXISTS signedat           TIMESTAMPTZ;
ALTER TABLE dischargesummaries ADD COLUMN IF NOT EXISTS pdfgeneratedat     TIMESTAMPTZ;
ALTER TABLE dischargesummaries ADD COLUMN IF NOT EXISTS remindersentat     TIMESTAMPTZ;
ALTER TABLE dischargesummaries ADD COLUMN IF NOT EXISTS updatedat          TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE dischargesummaries ADD COLUMN IF NOT EXISTS unfinalizedreason  TEXT;
ALTER TABLE dischargesummaries ADD COLUMN IF NOT EXISTS unfinalizedby      TEXT;
ALTER TABLE dischargesummaries ADD COLUMN IF NOT EXISTS unfinializedat     TIMESTAMPTZ;
ALTER TABLE dischargesummaries ADD COLUMN IF NOT EXISTS finalizedat        TIMESTAMPTZ;


-- ============================================================
-- STEP 3: New ABHA verification columns on patients
-- ============================================================
ALTER TABLE patients ADD COLUMN IF NOT EXISTS abhaverified   BOOLEAN DEFAULT FALSE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS abhaverifiedat TIMESTAMPTZ;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS abhaverifiedby TEXT;


-- ============================================================
-- STEP 4: Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_discharge_patient
  ON dischargesummaries (patientid);

CREATE INDEX IF NOT EXISTS idx_discharge_date
  ON dischargesummaries (dischargedate);

CREATE INDEX IF NOT EXISTS idx_ds_isfinal
  ON dischargesummaries (isfinal)
  WHERE isfinal = TRUE;

CREATE INDEX IF NOT EXISTS idx_ds_patient_final
  ON dischargesummaries (patientid, isfinal);


-- ============================================================
-- STEP 5: RLS — only apply policies if clinicusers exists
-- If clinicusers does not exist yet, we still enable RLS with
-- a simple open policy (same as all other tables at setup stage).
-- Once you run v8roles.sql the policies get tightened.
-- ============================================================
ALTER TABLE dischargesummaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allowauthdischargesummaries ON dischargesummaries;
DROP POLICY IF EXISTS ds_select ON dischargesummaries;
DROP POLICY IF EXISTS ds_insert ON dischargesummaries;
DROP POLICY IF EXISTS ds_update ON dischargesummaries;
DROP POLICY IF EXISTS ds_delete ON dischargesummaries;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'clinicusers'
  ) THEN
    -- clinicusers exists: apply role-aware policies
    EXECUTE '
      CREATE POLICY ds_select ON dischargesummaries
        FOR SELECT TO authenticated USING (true)
    ';
    EXECUTE '
      CREATE POLICY ds_insert ON dischargesummaries
        FOR INSERT TO authenticated WITH CHECK (true)
    ';
    EXECUTE '
      CREATE POLICY ds_update ON dischargesummaries
        FOR UPDATE TO authenticated
        USING (
          isfinal = FALSE
          OR EXISTS (
            SELECT 1 FROM clinicusers cu
            WHERE cu.authid = auth.uid()
              AND cu.role = ''admin''
              AND cu.isactive = TRUE
          )
        )
    ';
    EXECUTE '
      CREATE POLICY ds_delete ON dischargesummaries
        FOR DELETE TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM clinicusers cu
            WHERE cu.authid = auth.uid()
              AND cu.role = ''admin''
              AND cu.isactive = TRUE
          )
        )
    ';
    RAISE NOTICE 'Applied role-aware RLS policies (clinicusers found)';
  ELSE
    -- clinicusers not yet created: apply open policy (same as setup.sql)
    EXECUTE '
      CREATE POLICY ds_open ON dischargesummaries
        FOR ALL TO authenticated
        USING (true)
        WITH CHECK (true)
    ';
    RAISE NOTICE 'Applied open RLS policy (clinicusers not yet created — re-run v21 after v8roles.sql)';
  END IF;
END $$;


-- ============================================================
-- Done
-- ============================================================
SELECT 'v21 migration complete — dischargesummaries + ABHA columns ready' AS result;
