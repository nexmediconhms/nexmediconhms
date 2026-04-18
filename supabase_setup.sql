-- ============================================================
-- HMS MVP — Complete Database Setup
-- Run this entire script in Supabase → SQL Editor → New Query
-- Run it once. It is safe to re-run (uses IF NOT EXISTS).
-- ============================================================

-- ─── PATIENTS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patients (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mrn                     TEXT UNIQUE,
  full_name               TEXT NOT NULL,
  date_of_birth           DATE,
  age                     INTEGER,
  gender                  TEXT CHECK (gender IN ('Female','Male','Other')),
  mobile                  TEXT NOT NULL,
  blood_group             TEXT CHECK (blood_group IN ('A+','A-','B+','B-','O+','O-','AB+','AB-')),
  address                 TEXT,
  abha_id                 TEXT,
  emergency_contact_name  TEXT,
  emergency_contact_phone TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-generate MRN: P-001, P-002 …
CREATE SEQUENCE IF NOT EXISTS patient_mrn_seq START 1;

CREATE OR REPLACE FUNCTION generate_mrn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mrn IS NULL THEN
    NEW.mrn := 'P-' || LPAD(nextval('patient_mrn_seq')::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_patient_mrn ON patients;
CREATE TRIGGER trg_patient_mrn
  BEFORE INSERT ON patients
  FOR EACH ROW EXECUTE FUNCTION generate_mrn();

-- ─── ENCOUNTERS (OPD visits) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS encounters (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id     UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_date DATE    DEFAULT CURRENT_DATE,
  encounter_type TEXT    DEFAULT 'OPD',
  chief_complaint TEXT,
  -- Vitals
  pulse          INTEGER,          -- bpm
  bp_systolic    INTEGER,          -- mmHg
  bp_diastolic   INTEGER,          -- mmHg
  temperature    NUMERIC(4,1),     -- °C
  spo2           INTEGER,          -- %
  weight         NUMERIC(5,1),     -- kg
  height         NUMERIC(5,1),     -- cm
  -- Clinical
  diagnosis      TEXT,
  icd_code       TEXT,
  notes          TEXT,
  -- OB/GYN data stored as flexible JSON
  ob_data        JSONB DEFAULT '{}'::JSONB,
  doctor_name    TEXT DEFAULT 'Dr. Demo',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─── PRESCRIPTIONS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prescriptions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  encounter_id    UUID NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  medications     JSONB NOT NULL DEFAULT '[]'::JSONB,
  -- medications format:
  -- [{ drug, dose, route, frequency, duration, instructions }]
  advice          TEXT,
  dietary_advice  TEXT,
  reports_needed  TEXT,
  follow_up_date  DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── BEDS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS beds (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bed_number         TEXT NOT NULL UNIQUE,
  ward               TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'available'
                       CHECK (status IN ('available','occupied','cleaning','reserved')),
  patient_id         UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_name       TEXT,
  admission_date     DATE,
  expected_discharge DATE,
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ─── SEED: 20 demo beds ──────────────────────────────────────
INSERT INTO beds (bed_number, ward, status) VALUES
  ('GW-01','General Ward','available'),
  ('GW-02','General Ward','available'),
  ('GW-03','General Ward','available'),
  ('GW-04','General Ward','available'),
  ('GW-05','General Ward','available'),
  ('GW-06','General Ward','available'),
  ('GW-07','General Ward','available'),
  ('GW-08','General Ward','available'),
  ('MW-01','Maternity Ward','available'),
  ('MW-02','Maternity Ward','available'),
  ('MW-03','Maternity Ward','available'),
  ('MW-04','Maternity Ward','available'),
  ('MW-05','Maternity Ward','available'),
  ('MW-06','Maternity Ward','available'),
  ('PR-01','Private Room','available'),
  ('PR-02','Private Room','available'),
  ('PR-03','Private Room','available'),
  ('PR-04','Private Room','available'),
  ('ICU-01','ICU','available'),
  ('ICU-02','ICU','available')
ON CONFLICT (bed_number) DO NOTHING;

-- ─── ROW LEVEL SECURITY (RLS) ────────────────────────────────
-- Enable RLS so only authenticated users can read/write
ALTER TABLE patients     ENABLE ROW LEVEL SECURITY;
ALTER TABLE encounters   ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE beds         ENABLE ROW LEVEL SECURITY;

-- Policy: any authenticated user can do everything
-- (tighten per-role in production)
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['patients','encounters','prescriptions','beds']
  LOOP
    EXECUTE format('
      DROP POLICY IF EXISTS allow_auth_%1$s ON %1$s;
      CREATE POLICY allow_auth_%1$s ON %1$s
        FOR ALL TO authenticated USING (true) WITH CHECK (true);
    ', tbl);
  END LOOP;
END;
$$;

-- ─── INDEXES for fast lookup ─────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_patients_name    ON patients  USING gin(to_tsvector('simple', full_name));
CREATE INDEX IF NOT EXISTS idx_patients_mobile  ON patients  (mobile);
CREATE INDEX IF NOT EXISTS idx_encounters_pid   ON encounters(patient_id);
CREATE INDEX IF NOT EXISTS idx_encounters_date  ON encounters(encounter_date);
CREATE INDEX IF NOT EXISTS idx_prescriptions_enc ON prescriptions(encounter_id);
CREATE INDEX IF NOT EXISTS idx_beds_status      ON beds(status);

-- Done!
SELECT 'Database setup complete ✓' AS result;
