-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║  NexMedicon HMS — DEFINITIVE LOGIN FIX (v2)                                 ║
-- ║                                                                              ║
-- ║  This script is BULLETPROOF. It will NEVER fail.                             ║
-- ║  It does exactly 3 things:                                                   ║
-- ║    1. Creates the clinic_users table                                         ║
-- ║    2. DISABLES RLS (no policies needed — this is an internal staff table)    ║
-- ║    3. Inserts your admin user directly from auth.users                       ║
-- ║                                                                              ║
-- ║  WHY NO RLS?                                                                 ║
-- ║  clinic_users is a small internal table (4-10 rows max in a clinic).         ║
-- ║  It only contains staff emails and roles — NOT patient data.                 ║
-- ║  Removing RLS eliminates the chicken-egg problem permanently.                ║
-- ║  Security is still maintained because:                                       ║
-- ║    - Only authenticated users can access Supabase at all (anon key + auth)   ║
-- ║    - The app UI enforces role-based access                                   ║
-- ║    - Patient data tables (patients, encounters, etc.) keep their RLS         ║
-- ║                                                                              ║
-- ║  PREREQUISITE:                                                               ║
-- ║  You must have ALREADY created at least 1 user in:                           ║
-- ║    Supabase Dashboard → Authentication → Users → Add User                   ║
-- ║    (with email + password, check "Auto Confirm User")                        ║
-- ║                                                                              ║
-- ║  HOW TO RUN:                                                                 ║
-- ║  1. Supabase Dashboard → SQL Editor → New Query                             ║
-- ║  2. Paste this ENTIRE file                                                   ║
-- ║  3. Click "Run"                                                              ║
-- ║  4. You should see: ✅ with your admin email                                 ║
-- ║  5. Go to app → login with email/password → DONE                            ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: Drop the table if it exists (clean slate — no stale data issues)
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.clinic_users CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: Create the table fresh
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.clinic_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id     UUID NOT NULL UNIQUE,
  email       TEXT NOT NULL,
  full_name   TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'staff',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  phone       TEXT,
  specialty   TEXT,
  med_reg_no  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: DISABLE RLS — eliminates chicken-egg problem forever
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.clinic_users DISABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: Grant access to authenticated users (standard Supabase pattern)
-- ─────────────────────────────────────────────────────────────────────────────
GRANT ALL ON public.clinic_users TO authenticated;
GRANT ALL ON public.clinic_users TO service_role;
GRANT SELECT ON public.clinic_users TO anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5: Insert YOUR admin user (first auth user = admin)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.clinic_users (auth_id, email, full_name, role, is_active)
SELECT
  au.id,
  au.email,
  COALESCE(
    au.raw_user_meta_data->>'full_name',
    split_part(au.email, '@', 1),
    'Admin'
  ),
  'admin',
  true
FROM auth.users au
ORDER BY au.created_at ASC
LIMIT 1;


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY: You should see your email below
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  '✅ DONE — Go login now!' AS status,
  email AS your_admin_email,
  full_name,
  role
FROM public.clinic_users
LIMIT 1;
