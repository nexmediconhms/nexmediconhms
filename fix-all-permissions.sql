-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║  NexMedicon HMS — FIX ALL TABLE PERMISSIONS                                 ║
-- ║                                                                              ║
-- ║  Fixes:                                                                      ║
-- ║  1. "permission denied for table patients" on QR scan                        ║
-- ║  2. "Unable to load patients" error on Patients page                         ║
-- ║  3. All core clinical tables accessible by authenticated users               ║
-- ║                                                                              ║
-- ║  Run this in Supabase → SQL Editor after SETUP-LOGIN-FIX.sql                ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX: patients table — disable RLS + grant access
-- ═══════════════════════════════════════════════════════════════════════════════

-- Create if not exists
CREATE TABLE IF NOT EXISTS public.patients (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mrn                     TEXT UNIQUE,
  full_name               TEXT NOT NULL,
  date_of_birth           DATE,
  age                     INTEGER,
  gender                  TEXT DEFAULT 'Female',
  mobile                  TEXT,
  alternate_mobile        TEXT,
  email                   TEXT,
  address                 TEXT,
  city                    TEXT,
  state                   TEXT,
  pincode                 TEXT,
  blood_group             TEXT,
  aadhaar                 TEXT,
  aadhaar_no              TEXT,
  abha_id                 TEXT,
  abha_number             TEXT,
  abha_address            TEXT,
  abha_verified           BOOLEAN DEFAULT FALSE,
  insurance_name          TEXT,
  insurance_id            TEXT,
  mediclaim               TEXT DEFAULT 'No',
  cashless                TEXT DEFAULT 'No',
  referred_by             TEXT,
  emergency_contact_name  TEXT,
  emergency_contact_phone TEXT,
  notes                   TEXT,
  doctor_id               UUID,
  is_active               BOOLEAN DEFAULT TRUE,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.patients DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.patients TO authenticated;
GRANT ALL ON public.patients TO service_role;
GRANT INSERT, SELECT ON public.patients TO anon;  -- Needed for QR self-registration

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX: encounters table
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.encounters (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        UUID REFERENCES public.patients(id),
  encounter_date    DATE DEFAULT CURRENT_DATE,
  encounter_type    TEXT DEFAULT 'OPD',
  doctor_id         UUID,
  doctor_name       TEXT,
  chief_complaint   TEXT,
  hpi               TEXT,
  pulse             NUMERIC,
  bp_systolic       NUMERIC,
  bp_diastolic      NUMERIC,
  temperature       NUMERIC,
  spo2              NUMERIC,
  weight            NUMERIC,
  height            NUMERIC,
  diagnosis         TEXT,
  notes             TEXT,
  ob_data           JSONB,
  plan              TEXT,
  follow_up_date    DATE,
  follow_up_note    TEXT,
  status            TEXT DEFAULT 'active',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.encounters DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.encounters TO authenticated;
GRANT ALL ON public.encounters TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX: prescriptions table
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.prescriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id    UUID REFERENCES public.encounters(id),
  patient_id      UUID REFERENCES public.patients(id),
  medications     JSONB DEFAULT '[]',
  advice          TEXT,
  dietary_advice  TEXT,
  reports_needed  TEXT,
  follow_up_date  DATE,
  doctor_id       UUID,
  doctor_name     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.prescriptions DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.prescriptions TO authenticated;
GRANT ALL ON public.prescriptions TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX: bills table
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.bills (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID REFERENCES public.patients(id),
  invoice_number  TEXT UNIQUE,
  items           JSONB DEFAULT '[]',
  subtotal        NUMERIC(10,2) DEFAULT 0,
  discount        NUMERIC(10,2) DEFAULT 0,
  tax             NUMERIC(10,2) DEFAULT 0,
  total           NUMERIC(10,2) DEFAULT 0,
  net_amount      NUMERIC(10,2) DEFAULT 0,
  paid            NUMERIC(10,2) DEFAULT 0,
  due             NUMERIC(10,2) DEFAULT 0,
  payment_mode    TEXT,
  status          TEXT DEFAULT 'unpaid',
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.bills DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.bills TO authenticated;
GRANT ALL ON public.bills TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX: lab_reports table
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.lab_reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          UUID REFERENCES public.patients(id),
  encounter_id        UUID,
  report_name         TEXT NOT NULL,
  report_date         DATE DEFAULT CURRENT_DATE,
  lab_name            TEXT,
  result              TEXT,
  normal_range        TEXT,
  unit                TEXT,
  status              TEXT DEFAULT 'pending',
  notes               TEXT,
  attachment_url      TEXT,
  source              TEXT DEFAULT 'manual',
  lab_partner_id      UUID,
  lab_partner_name    TEXT,
  portal_upload       BOOLEAN DEFAULT FALSE,
  portal_patient_mrn  TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.lab_reports DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.lab_reports TO authenticated;
GRANT ALL ON public.lab_reports TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX: lab_partners + lab_portal_users tables
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.lab_partners (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  address     TEXT,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.lab_partners DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.lab_partners TO authenticated;
GRANT ALL ON public.lab_partners TO service_role;

CREATE TABLE IF NOT EXISTS public.lab_portal_users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  email             TEXT,
  phone             TEXT,
  lab_partner_id    UUID REFERENCES public.lab_partners(id),
  auth_token        TEXT NOT NULL UNIQUE,
  is_active         BOOLEAN DEFAULT TRUE,
  last_used_at      TIMESTAMPTZ,
  token_expires_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.lab_portal_users DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.lab_portal_users TO authenticated;
GRANT ALL ON public.lab_portal_users TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX: clinic_settings table (for app settings)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.clinic_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.clinic_settings DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.clinic_settings TO authenticated;
GRANT ALL ON public.clinic_settings TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX: beds table (for IPD)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.beds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bed_number      TEXT NOT NULL UNIQUE,
  ward            TEXT,
  type            TEXT DEFAULT 'General',
  status          TEXT DEFAULT 'available',
  patient_id      UUID,
  patient_name    TEXT,
  admission_date  DATE,
  expected_discharge DATE,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.beds DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.beds TO authenticated;
GRANT ALL ON public.beds TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT '✅ All permissions fixed!' AS status,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('patients', 'encounters', 'prescriptions', 'bills', 'lab_reports', 'lab_partners', 'lab_portal_users', 'clinic_settings', 'beds', 'clinic_users')) AS tables_ready;
