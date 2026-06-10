-- ═══════════════════════════════════════════════════════════════════════
-- SURGERY/OT RECORDS + IPD PACKAGES TABLES
-- For Indian Gynaecologist IPD
-- ═══════════════════════════════════════════════════════════════════════
-- Run in Supabase SQL Editor. Safe to run multiple times.

-- ── 1. SURGERY RECORDS TABLE ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.surgery_records (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ipd_admission_id      UUID,
  patient_id            UUID,

  -- Pre-Op
  surgery_date          DATE,
  surgery_time          TEXT,
  surgery_name          TEXT,
  indication            TEXT,
  pre_op_diagnosis      TEXT,
  consent_taken         BOOLEAN DEFAULT false,
  consent_type          TEXT,
  asa_grade             TEXT,
  blood_arranged        TEXT,
  pre_op_checklist      JSONB,
  pre_op_investigations TEXT,
  pre_op_notes          TEXT,

  -- Intra-Op
  surgery_type          TEXT,
  approach              TEXT,
  surgeon               TEXT,
  assistant             TEXT,
  anesthesiologist      TEXT,
  anesthesia_type       TEXT,
  scrub_nurse           TEXT,
  ot_number             TEXT,
  incision_type         TEXT,
  start_time            TEXT,
  end_time              TEXT,
  duration_minutes      INTEGER,
  findings              TEXT,
  procedure_details     TEXT,
  blood_loss_ml         NUMERIC,
  blood_transfusion     TEXT,
  specimen_sent         TEXT,
  complications_intraop TEXT,
  post_op_diagnosis     TEXT,
  implants_used         TEXT,

  -- Post-Op
  post_op_instructions  TEXT,
  post_op_medications   TEXT,
  diet_post_op          TEXT,
  drain_details         TEXT,
  catheter_removal      TEXT,
  ambulation            TEXT,
  post_op_vitals_stable BOOLEAN DEFAULT true,
  post_op_notes         TEXT,
  discharge_plan        TEXT,

  -- Metadata
  created_by            TEXT,
  updated_by            TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.surgery_records ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'surgery_records' AND policyname = 'surgery_records_auth') THEN
    CREATE POLICY surgery_records_auth ON public.surgery_records FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_surgery_records_admission ON public.surgery_records (ipd_admission_id);
CREATE INDEX IF NOT EXISTS idx_surgery_records_patient ON public.surgery_records (patient_id);

-- ── 2. IPD PACKAGES TABLE ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ipd_packages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  code              TEXT UNIQUE,
  category          TEXT,
  description       TEXT,
  total_amount      NUMERIC NOT NULL DEFAULT 0,
  items             JSONB NOT NULL DEFAULT '[]',
  room_days         INTEGER DEFAULT 0,
  is_active         BOOLEAN DEFAULT true,
  sort_order        INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- If table already exists without the code column or without UNIQUE, fix it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ipd_packages' AND column_name = 'code'
  ) THEN
    ALTER TABLE public.ipd_packages ADD COLUMN code TEXT;
  END IF;

  -- Add unique constraint if missing
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ipd_packages'::regclass AND conname = 'ipd_packages_code_key'
  ) THEN
    -- Remove duplicates first if any
    DELETE FROM public.ipd_packages a USING public.ipd_packages b
    WHERE a.ctid < b.ctid AND a.code IS NOT NULL AND a.code = b.code;

    ALTER TABLE public.ipd_packages ADD CONSTRAINT ipd_packages_code_key UNIQUE (code);
  END IF;
END $$;

ALTER TABLE public.ipd_packages ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ipd_packages' AND policyname = 'ipd_packages_auth') THEN
    CREATE POLICY ipd_packages_auth ON public.ipd_packages FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 3. SEED PACKAGES ─────────────────────────────────────────────────
-- Delete old seed data by code, then re-insert fresh
-- This is safe to run repeatedly

DELETE FROM public.ipd_packages WHERE code IN (
  'PKG-ND', 'PKG-LSCS-GW', 'PKG-LSCS-PVT', 'PKG-HYST', 'PKG-DC', 'PKG-LAP', 'PKG-OBS'
);

INSERT INTO public.ipd_packages (name, code, category, description, total_amount, room_days, items, sort_order) VALUES

('Normal Delivery Package', 'PKG-ND', 'Obstetric',
 'Includes 3-day room, delivery charges, doctor fee, nursing, routine medicines & investigations',
 25000, 3,
 '[{"category":"bed","description":"General Ward (3 days)","quantity":3,"rate":2000,"amount":6000},
   {"category":"nursing","description":"Nursing Care","quantity":3,"rate":1000,"amount":3000},
   {"category":"doctor_visit","description":"Obstetrician Fee","quantity":1,"rate":5000,"amount":5000},
   {"category":"procedure","description":"Delivery Charges","quantity":1,"rate":5000,"amount":5000},
   {"category":"medicine","description":"Routine Medicines & IV","quantity":1,"rate":3000,"amount":3000},
   {"category":"investigation","description":"CBC, Urine, Blood Group","quantity":1,"rate":1500,"amount":1500},
   {"category":"nursing","description":"Baby Care","quantity":1,"rate":1500,"amount":1500}]'::jsonb,
 1),

('LSCS Package (General Ward)', 'PKG-LSCS-GW', 'Obstetric',
 'Caesarean section — includes 5-day room, OT charges, surgeon + anesthesia fee, medicines & labs',
 55000, 5,
 '[{"category":"bed","description":"General Ward (5 days)","quantity":5,"rate":2000,"amount":10000},
   {"category":"nursing","description":"Nursing Care","quantity":5,"rate":1000,"amount":5000},
   {"category":"surgical","description":"Surgeon Fee (LSCS)","quantity":1,"rate":12000,"amount":12000},
   {"category":"ot","description":"OT Charges","quantity":1,"rate":8000,"amount":8000},
   {"category":"procedure","description":"Anesthesia Fee (Spinal)","quantity":1,"rate":5000,"amount":5000},
   {"category":"medicine","description":"Medicines, IV Fluids, Antibiotics","quantity":1,"rate":5000,"amount":5000},
   {"category":"investigation","description":"Pre-op & Post-op Labs","quantity":1,"rate":3000,"amount":3000},
   {"category":"nursing","description":"Baby Care","quantity":1,"rate":2000,"amount":2000},
   {"category":"other","description":"Consumables & Dressings","quantity":1,"rate":5000,"amount":5000}]'::jsonb,
 2),

('LSCS Package (Private Room)', 'PKG-LSCS-PVT', 'Obstetric',
 'Caesarean section with private/AC room — premium package',
 75000, 5,
 '[{"category":"bed","description":"Private AC Room (5 days)","quantity":5,"rate":4000,"amount":20000},
   {"category":"nursing","description":"Nursing Care","quantity":5,"rate":1000,"amount":5000},
   {"category":"surgical","description":"Surgeon Fee (LSCS)","quantity":1,"rate":15000,"amount":15000},
   {"category":"ot","description":"OT Charges","quantity":1,"rate":8000,"amount":8000},
   {"category":"procedure","description":"Anesthesia Fee","quantity":1,"rate":6000,"amount":6000},
   {"category":"medicine","description":"Medicines, IV Fluids, Antibiotics","quantity":1,"rate":6000,"amount":6000},
   {"category":"investigation","description":"Pre-op & Post-op Labs","quantity":1,"rate":3000,"amount":3000},
   {"category":"nursing","description":"Baby Care","quantity":1,"rate":2000,"amount":2000},
   {"category":"other","description":"Consumables & Dressings","quantity":1,"rate":5000,"amount":5000},
   {"category":"other","description":"Premium Amenities","quantity":1,"rate":5000,"amount":5000}]'::jsonb,
 3),

('Hysterectomy Package', 'PKG-HYST', 'Gynaecology',
 'Abdominal/Vaginal hysterectomy — includes 5-day stay, OT, surgeon fee, labs',
 60000, 5,
 '[{"category":"bed","description":"General Ward (5 days)","quantity":5,"rate":2000,"amount":10000},
   {"category":"nursing","description":"Nursing Care","quantity":5,"rate":1000,"amount":5000},
   {"category":"surgical","description":"Surgeon Fee","quantity":1,"rate":15000,"amount":15000},
   {"category":"ot","description":"OT Charges","quantity":1,"rate":8000,"amount":8000},
   {"category":"procedure","description":"Anesthesia Fee","quantity":1,"rate":6000,"amount":6000},
   {"category":"medicine","description":"Medicines & IV","quantity":1,"rate":6000,"amount":6000},
   {"category":"investigation","description":"Pre-op Labs + HPE","quantity":1,"rate":4000,"amount":4000},
   {"category":"other","description":"Consumables & Dressings","quantity":1,"rate":6000,"amount":6000}]'::jsonb,
 4),

('D&C / Suction Evacuation', 'PKG-DC', 'Gynaecology',
 'Day care / 1-day admission for D&C or suction evacuation',
 12000, 1,
 '[{"category":"bed","description":"Day Care Bed (1 day)","quantity":1,"rate":1500,"amount":1500},
   {"category":"nursing","description":"Nursing Care","quantity":1,"rate":500,"amount":500},
   {"category":"surgical","description":"Surgeon Fee","quantity":1,"rate":4000,"amount":4000},
   {"category":"ot","description":"OT / Procedure Room","quantity":1,"rate":2000,"amount":2000},
   {"category":"procedure","description":"Anesthesia (Short GA/Sedation)","quantity":1,"rate":2000,"amount":2000},
   {"category":"medicine","description":"Medicines","quantity":1,"rate":1000,"amount":1000},
   {"category":"investigation","description":"Ultrasound + Labs","quantity":1,"rate":1000,"amount":1000}]'::jsonb,
 5),

('Laparoscopic Surgery Package', 'PKG-LAP', 'Gynaecology',
 'Diagnostic/Operative laparoscopy — 2-3 day stay',
 50000, 3,
 '[{"category":"bed","description":"Room (3 days)","quantity":3,"rate":2500,"amount":7500},
   {"category":"nursing","description":"Nursing Care","quantity":3,"rate":1000,"amount":3000},
   {"category":"surgical","description":"Surgeon Fee (Laparoscopy)","quantity":1,"rate":15000,"amount":15000},
   {"category":"ot","description":"OT Charges + Laparoscopy Equipment","quantity":1,"rate":10000,"amount":10000},
   {"category":"procedure","description":"Anesthesia Fee (GA)","quantity":1,"rate":5000,"amount":5000},
   {"category":"medicine","description":"Medicines & IV","quantity":1,"rate":4000,"amount":4000},
   {"category":"investigation","description":"Pre-op Labs","quantity":1,"rate":2500,"amount":2500},
   {"category":"other","description":"Consumables","quantity":1,"rate":3000,"amount":3000}]'::jsonb,
 6),

('Observation / Short Stay', 'PKG-OBS', 'General',
 'Short observation stay (1-2 days) for monitoring',
 8000, 2,
 '[{"category":"bed","description":"General Ward (2 days)","quantity":2,"rate":1500,"amount":3000},
   {"category":"nursing","description":"Nursing Care","quantity":2,"rate":500,"amount":1000},
   {"category":"doctor_visit","description":"Doctor Rounds","quantity":2,"rate":500,"amount":1000},
   {"category":"medicine","description":"Medicines & IV","quantity":1,"rate":1500,"amount":1500},
   {"category":"investigation","description":"Basic Labs","quantity":1,"rate":1500,"amount":1500}]'::jsonb,
 7);
