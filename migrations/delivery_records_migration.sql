-- ═══════════════════════════════════════════════════════════════════════
-- DELIVERY RECORDS TABLE — For Indian Gynaecologist IPD
-- ═══════════════════════════════════════════════════════════════════════
--
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- Safe to run multiple times (uses IF NOT EXISTS / IF NOT EXISTS patterns)
--
-- This table stores detailed delivery records for each IPD admission.
-- One record per delivery (twins = two records with same admission_id).

CREATE TABLE IF NOT EXISTS public.delivery_records (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ipd_admission_id      UUID,
  patient_id            UUID,
  baby_number           INTEGER DEFAULT 1,

  -- ── Delivery Details ──────────────────────────────────────────
  delivery_date         DATE,
  delivery_time         TEXT,
  delivery_type         TEXT,        -- Normal / LSCS / Vacuum / Forceps / Breech / Water Birth
  delivery_outcome      TEXT,        -- Live Birth / Stillbirth / IUD
  indication            TEXT,        -- Indication for LSCS / assisted delivery
  labour_duration_hours NUMERIC,
  labour_type           TEXT,        -- Spontaneous / Induced / Augmented
  induction_method      TEXT,        -- Oxytocin / Misoprostol / Foley / ARM / Dinoprostone

  -- ── Baby Details ──────────────────────────────────────────────
  baby_sex              TEXT,        -- Male / Female / Ambiguous
  baby_weight_kg        NUMERIC,
  baby_length_cm        NUMERIC,
  head_circumference_cm NUMERIC,
  chest_circumference_cm NUMERIC,
  apgar_1min            INTEGER,
  apgar_5min            INTEGER,
  apgar_10min           INTEGER,
  cry_at_birth          TEXT,        -- Immediate / Delayed / Absent
  resuscitation_needed  BOOLEAN DEFAULT false,
  resuscitation_details TEXT,
  baby_condition        TEXT,        -- Healthy / NICU / Observation
  nicu_admission        BOOLEAN DEFAULT false,
  nicu_reason           TEXT,
  congenital_anomaly    TEXT,
  vitamin_k_given       BOOLEAN DEFAULT true,
  bcg_given             BOOLEAN DEFAULT false,
  opv_zero_given        BOOLEAN DEFAULT false,
  hep_b_given           BOOLEAN DEFAULT false,

  -- ── Mother Details ────────────────────────────────────────────
  episiotomy            TEXT,        -- None / Medio-lateral / Midline / J-shaped
  perineal_tear         TEXT,        -- None / 1st Degree / 2nd Degree / 3rd Degree / 4th Degree
  tear_repaired         BOOLEAN DEFAULT false,
  blood_loss_ml         NUMERIC,
  pph                   BOOLEAN DEFAULT false,
  pph_management        TEXT,
  placenta_delivery     TEXT,        -- Spontaneous / Manual / Incomplete
  placenta_delivery_time TEXT,
  placenta_weight_gm    NUMERIC,
  placenta_complete     BOOLEAN DEFAULT true,
  cord_vessels          TEXT,        -- 3 (2A+1V) / 2 (Single Umbilical Artery)
  cord_around_neck      TEXT,        -- None / Loose / Tight / 1 loop / 2 loops / 3 loops
  cord_length_cm        NUMERIC,
  uterus_well_contracted BOOLEAN DEFAULT true,
  oxytocin_after_delivery BOOLEAN DEFAULT true,
  catheterised          BOOLEAN DEFAULT false,
  mother_condition      TEXT,        -- Stable / Observation / ICU

  -- ── Anesthesia ────────────────────────────────────────────────
  anesthesia_type       TEXT,        -- None / Epidural / Spinal / GA / Local / Pudendal Block
  anesthesiologist      TEXT,

  -- ── Personnel ─────────────────────────────────────────────────
  delivering_doctor     TEXT,
  assistant             TEXT,
  pediatrician          TEXT,
  nurse_on_duty         TEXT,

  -- ── Breastfeeding ─────────────────────────────────────────────
  breastfeeding_initiated BOOLEAN DEFAULT false,
  breastfeeding_time    TEXT,        -- e.g., "Within 1 hour"
  lactation_advice      TEXT,

  -- ── Notes ─────────────────────────────────────────────────────
  delivery_notes        TEXT,
  complications         TEXT,
  postpartum_notes      TEXT,

  -- ── Metadata ──────────────────────────────────────────────────
  created_by            TEXT,
  updated_by            TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Safe column additions (in case table already exists with fewer columns)
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS baby_number INTEGER DEFAULT 1;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS delivery_outcome TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS indication TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS labour_duration_hours NUMERIC;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS labour_type TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS induction_method TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS head_circumference_cm NUMERIC;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS chest_circumference_cm NUMERIC;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS apgar_10min INTEGER;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS cry_at_birth TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS resuscitation_needed BOOLEAN DEFAULT false;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS resuscitation_details TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS baby_condition TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS nicu_admission BOOLEAN DEFAULT false;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS nicu_reason TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS congenital_anomaly TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS vitamin_k_given BOOLEAN DEFAULT true;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS bcg_given BOOLEAN DEFAULT false;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS opv_zero_given BOOLEAN DEFAULT false;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS hep_b_given BOOLEAN DEFAULT false;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS episiotomy TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS perineal_tear TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS tear_repaired BOOLEAN DEFAULT false;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS blood_loss_ml NUMERIC;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS pph BOOLEAN DEFAULT false;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS pph_management TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS placenta_delivery TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS placenta_delivery_time TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS placenta_weight_gm NUMERIC;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS placenta_complete BOOLEAN DEFAULT true;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS cord_vessels TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS cord_around_neck TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS cord_length_cm NUMERIC;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS uterus_well_contracted BOOLEAN DEFAULT true;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS oxytocin_after_delivery BOOLEAN DEFAULT true;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS catheterised BOOLEAN DEFAULT false;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS mother_condition TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS anesthesia_type TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS anesthesiologist TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS delivering_doctor TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS assistant TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS pediatrician TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS nurse_on_duty TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS breastfeeding_initiated BOOLEAN DEFAULT false;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS breastfeeding_time TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS lactation_advice TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS delivery_notes TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS complications TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS postpartum_notes TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE public.delivery_records ADD COLUMN IF NOT EXISTS updated_by TEXT;

-- RLS
ALTER TABLE public.delivery_records ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'delivery_records' AND policyname = 'delivery_records_auth') THEN
    CREATE POLICY delivery_records_auth ON public.delivery_records FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_delivery_records_admission ON public.delivery_records (ipd_admission_id);
CREATE INDEX IF NOT EXISTS idx_delivery_records_patient ON public.delivery_records (patient_id);
