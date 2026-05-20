-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║  NexMedicon HMS — CREATE USERS + FIX PATIENTS TABLE                         ║
-- ║                                                                              ║
-- ║  Run this AFTER SETUP-LOGIN-FIX.sql (which created admin).                   ║
-- ║                                                                              ║
-- ║  What this does:                                                             ║
-- ║  PART A: Creates Doctor, Staff users in clinic_users                         ║
-- ║  PART B: Creates the patients table + disables RLS (fixes the error)         ║
-- ║  PART C: Creates lab_partners + lab_portal_users tables for lab partner      ║
-- ║                                                                              ║
-- ║  PREREQUISITE:                                                               ║
-- ║  You must FIRST create auth users in Supabase Dashboard →                    ║
-- ║  Authentication → Users → Add User (email + password, Auto Confirm)          ║
-- ║  for each role you want. Then paste their UUIDs below.                       ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝


-- ═══════════════════════════════════════════════════════════════════════════════
-- PART A: ADD DOCTOR & STAFF USERS
-- ═══════════════════════════════════════════════════════════════════════════════
-- 
-- STEP 1: Create auth users in Supabase Dashboard:
--   Authentication → Users → "Add User" → Create New User
--   ┌────────────────────────────────┬─────────────┬──────────────────┐
--   │ Email                          │ Password    │ Auto Confirm? ✓  │
--   ├────────────────────────────────┼─────────────┼──────────────────┤
--   │ doctor@yourclinic.com          │ Doctor@123! │ Yes              │
--   │ staff1@yourclinic.com          │ Staff1@123! │ Yes              │
--   │ staff2@yourclinic.com          │ Staff2@123! │ Yes              │
--   └────────────────────────────────┴─────────────┴──────────────────┘
--   (Replace with YOUR actual emails and passwords)
--
-- STEP 2: After creating them, run this SQL to add them to clinic_users:

INSERT INTO public.clinic_users (auth_id, email, full_name, role, is_active, specialty)
SELECT
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1)),
  CASE
    WHEN au.email ILIKE '%doctor%' THEN 'doctor'
    WHEN au.email ILIKE '%staff%' THEN 'staff'
    ELSE 'staff'
  END,
  true,
  CASE
    WHEN au.email ILIKE '%doctor%' THEN 'General Medicine'
    ELSE NULL
  END
FROM auth.users au
WHERE au.email != (SELECT email FROM public.clinic_users WHERE role = 'admin' LIMIT 1)
  AND au.id NOT IN (SELECT auth_id FROM public.clinic_users)
ORDER BY au.created_at ASC
ON CONFLICT (auth_id) DO NOTHING;

-- Verify users created:
SELECT email, full_name, role, is_active FROM public.clinic_users ORDER BY role;


-- ═══════════════════════════════════════════════════════════════════════════════
-- PART B: FIX PATIENTS TABLE (fixes "Unable to load patients" error)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Create patients table if it doesn't exist
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

-- DISABLE RLS on patients too (same reasoning as clinic_users — all staff need access)
ALTER TABLE public.patients DISABLE ROW LEVEL SECURITY;

-- Grant access
GRANT ALL ON public.patients TO authenticated;
GRANT ALL ON public.patients TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════════
-- PART C: LAB PARTNER SETUP
-- ═══════════════════════════════════════════════════════════════════════════════
-- Lab partners DON'T use Supabase Auth. They have their own token-based portal.
-- This creates the required tables for the lab partner portal.

-- Lab partners master table
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

-- Lab portal users (token-based auth for lab partners)
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

-- Lab reports table
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

-- Create a sample lab partner + portal user
INSERT INTO public.lab_partners (name, phone)
VALUES ('City Pathology Lab', '+91 98765 00000')
ON CONFLICT DO NOTHING;

-- Create portal user with auto-generated token
INSERT INTO public.lab_portal_users (name, email, lab_partner_id, auth_token, is_active)
SELECT
  'Lab Technician',
  'lab@citypathlab.com',
  lp.id,
  'LP-' || encode(gen_random_bytes(16), 'hex'),
  true
FROM public.lab_partners lp
WHERE lp.name = 'City Pathology Lab'
  AND NOT EXISTS (SELECT 1 FROM public.lab_portal_users WHERE email = 'lab@citypathlab.com')
LIMIT 1;


-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT '── CLINIC USERS ──' AS section;
SELECT email, full_name, role FROM public.clinic_users ORDER BY role;

SELECT '── LAB PARTNER PORTAL ──' AS section;
SELECT
  lpu.name AS lab_user,
  lp.name AS lab_name,
  lpu.auth_token AS portal_token,
  lpu.is_active
FROM public.lab_portal_users lpu
JOIN public.lab_partners lp ON lp.id = lpu.lab_partner_id;

SELECT '── TABLES STATUS ──' AS section;
SELECT
  (SELECT count(*) FROM public.clinic_users) AS clinic_users,
  (SELECT count(*) FROM public.patients) AS patients,
  (SELECT count(*) FROM public.lab_partners) AS lab_partners,
  (SELECT count(*) FROM public.lab_portal_users) AS portal_users;
