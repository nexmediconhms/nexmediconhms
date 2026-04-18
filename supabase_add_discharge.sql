-- ============================================================
-- HMS MVP — Add Discharge Summaries Table
-- Run in Supabase → SQL Editor → New Query
-- ============================================================

CREATE TABLE IF NOT EXISTS discharge_summaries (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,

  -- Admission details
  admission_date      DATE,
  discharge_date      DATE DEFAULT CURRENT_DATE,

  -- Diagnosis at discharge
  final_diagnosis     TEXT,
  secondary_diagnosis TEXT,

  -- AI-generated sections (all editable by doctor)
  clinical_summary    TEXT,    -- summary of stay: complaints, findings, procedures
  investigations      TEXT,    -- lab and radiology results during stay
  treatment_given     TEXT,    -- medications and procedures administered
  condition_at_discharge TEXT, -- e.g. "Stable, afebrile, ambulant"
  discharge_advice    TEXT,    -- what patient should do at home
  diet_advice         TEXT,    -- dietary instructions
  medications_at_discharge TEXT, -- drugs to continue at home
  follow_up_date      DATE,
  follow_up_note      TEXT,    -- e.g. "Review with USG report"

  -- OB/Delivery section (nullable — only for maternity cases)
  delivery_type       TEXT,    -- NVD | LSCS | Forceps | Vacuum
  baby_sex            TEXT,    -- Male | Female
  baby_weight         TEXT,    -- e.g. "2.9 kg"
  apgar_score         TEXT,    -- e.g. "8/9"
  delivery_date       DATE,
  complications       TEXT,    -- PPH, perineal tear, wound infection etc.
  lactation_advice    TEXT,

  -- Document management
  version             INTEGER DEFAULT 1,
  is_final            BOOLEAN DEFAULT FALSE,  -- TRUE = signed off, no more edits
  signed_by           TEXT,                   -- doctor name
  signed_at           TIMESTAMPTZ,
  pdf_generated_at    TIMESTAMPTZ,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE discharge_summaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_auth_discharge_summaries ON discharge_summaries;
CREATE POLICY allow_auth_discharge_summaries ON discharge_summaries
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Index
CREATE INDEX IF NOT EXISTS idx_discharge_patient ON discharge_summaries(patient_id);
CREATE INDEX IF NOT EXISTS idx_discharge_date    ON discharge_summaries(discharge_date);

SELECT 'discharge_summaries table created ✓' AS result;
