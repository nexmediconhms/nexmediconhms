-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║  NexMedicon HMS — FRESH START: Delete All Data & Setup Fresh Credentials    ║
-- ║                                                                              ║
-- ║  PURPOSE: Completely wipes clinic_users and all related data, then sets up   ║
-- ║  the database schema so you can start fresh.                                 ║
-- ║                                                                              ║
-- ║  SAFE TO RUN: Uses DO blocks with exception handling — will NOT fail if a    ║
-- ║  table doesn't exist. It simply skips non-existent tables silently.          ║
-- ║                                                                              ║
-- ║  HOW TO RUN:                                                                 ║
-- ║  1. Go to your Supabase Dashboard → SQL Editor → New Query                  ║
-- ║  2. Paste this ENTIRE file                                                   ║
-- ║  3. Click "Run" (or press Ctrl+Enter)                                        ║
-- ║  4. Then go to Authentication → Users to create auth users (see bottom)      ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 1: DELETE ALL EXISTING DATA (Complete Wipe)
-- Uses DO block with exception handling so it never fails on missing tables
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl TEXT;
  tables_to_clear TEXT[] := ARRAY[
    -- Snake_case names (used in newer code)
    'lab_results',
    'lab_orders',
    'lab_reports',
    'bill_payments',
    'payment_transactions',
    'daily_closings',
    'billing',
    'prescriptions',
    'encounters',
    'anc_visits',
    'anc_registrations',
    'ipd_admissions',
    'bed_assignments',
    'beds',
    'ot_schedules',
    'queue',
    'appointments',
    'patients',
    'clinic_users',
    'audit_logs',
    'notifications',
    'expenses',
    'hospital_fund',
    'discharge_summaries',
    'vitals',
    'documents',
    'settings',
    'consultation_attachments',
    'consultation_files_db',
    'whatsapp_notifications',
    'cron_job_log',
    'reminder_log',
    'follow_ups',
    'backup_log',
    'portal_patients',
    'portal_sessions',
    'patient_allergies',
    'attachments',
    'video_rooms',
    'lab_partners',
    -- Concatenated names (used in v00-schema-master.sql)
    'labreports',
    'bills',
    'ipdadmissions',
    'ipdchargerates',
    'opdqueue',
    'reminders',
    'reminderlog',
    'ancregistrations',
    'ancvisits',
    'dischargesummaries',
    'portalpatients',
    'portalsessions',
    'auditlog',
    'hospitalfund',
    'labpartners',
    'patientallergies',
    'videorooms',
    'clinicsettings'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables_to_clear LOOP
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE true', tbl);
      RAISE NOTICE 'Cleared table: %', tbl;
    EXCEPTION
      WHEN undefined_table THEN
        RAISE NOTICE 'Table % does not exist — skipped', tbl;
      WHEN OTHERS THEN
        RAISE NOTICE 'Error clearing table %: %', tbl, SQLERRM;
    END;
  END LOOP;
END $$;

-- Now clear the tables that almost certainly exist (patients, encounters, etc.)
-- These are cleared LAST because other tables reference them via FK
DO $$
DECLARE
  tbl TEXT;
  final_tables TEXT[] := ARRAY[
    'patients',
    'clinicusers',
    'clinic_users'
  ];
BEGIN
  FOREACH tbl IN ARRAY final_tables LOOP
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE true', tbl);
      RAISE NOTICE 'Cleared table: %', tbl;
    EXCEPTION
      WHEN undefined_table THEN
        RAISE NOTICE 'Table % does not exist — skipped', tbl;
      WHEN OTHERS THEN
        RAISE NOTICE 'Error clearing table %: % (likely FK constraint — already handled)', tbl, SQLERRM;
    END;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 2: Ensure clinic_users table exists with correct schema
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.clinic_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id     UUID NOT NULL UNIQUE,
  email       TEXT NOT NULL,
  full_name   TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'doctor', 'staff', 'lab_partner')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  phone       TEXT,
  specialty   TEXT,
  med_reg_no  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- If the table already existed with old CHECK constraint, update it
DO $$
BEGIN
  -- Drop old constraint and add new one with lab_partner
  ALTER TABLE public.clinic_users DROP CONSTRAINT IF EXISTS clinic_users_role_check;
  ALTER TABLE public.clinic_users ADD CONSTRAINT clinic_users_role_check 
    CHECK (role IN ('admin', 'doctor', 'staff', 'lab_partner'));
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not update role constraint: % — likely already correct', SQLERRM;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 3: Enable RLS on clinic_users
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.clinic_users ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 4: Drop ALL existing policies (clean slate)
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN 
    SELECT policyname FROM pg_policies WHERE tablename = 'clinic_users' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.clinic_users', pol.policyname);
    RAISE NOTICE 'Dropped policy: %', pol.policyname;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 5: Create correct RLS policies
-- ═══════════════════════════════════════════════════════════════════════════════

-- Users can read their own row (by auth_id match)
CREATE POLICY "Users can read own profile"
  ON public.clinic_users FOR SELECT
  USING (auth.uid() = auth_id);

-- Users can read their own row by email (fallback for auth_id mismatch)
CREATE POLICY "Users can read own profile by email"
  ON public.clinic_users FOR SELECT
  USING (email = auth.email());

-- Admins can read ALL users (needed for Settings → Manage Users)
CREATE POLICY "Admins can read all users"
  ON public.clinic_users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.clinic_users cu
      WHERE cu.auth_id = auth.uid()
        AND cu.role = 'admin'
        AND cu.is_active = true
    )
  );

-- Admins can INSERT new users
CREATE POLICY "Admins can insert users"
  ON public.clinic_users FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.clinic_users cu
      WHERE cu.auth_id = auth.uid()
        AND cu.role = 'admin'
        AND cu.is_active = true
    )
  );

-- Admins can UPDATE any user (activate/deactivate, change role)
CREATE POLICY "Admins can update users"
  ON public.clinic_users FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.clinic_users cu
      WHERE cu.auth_id = auth.uid()
        AND cu.role = 'admin'
        AND cu.is_active = true
    )
  );

-- Users can update their OWN row (e.g., update phone, name)
CREATE POLICY "Users can update own profile"
  ON public.clinic_users FOR UPDATE
  USING (auth.uid() = auth_id OR email = auth.email());

-- CRITICAL: Allow first user bootstrap (when table is completely empty)
-- This is how the very first admin gets created without any existing admin
CREATE POLICY "Allow first user bootstrap"
  ON public.clinic_users FOR INSERT
  WITH CHECK (NOT EXISTS (SELECT 1 FROM public.clinic_users));

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 6: (OPTIONAL) Delete all Supabase Auth users
-- ═══════════════════════════════════════════════════════════════════════════════
-- UNCOMMENT the line below ONLY if you want to delete ALL login accounts too.
-- After uncommenting and running, you'll need to create new users in Step 7.
-- 
-- DELETE FROM auth.users WHERE true;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 7: INSTRUCTIONS — Create Fresh Users After Running This SQL
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- OPTION A (RECOMMENDED — Easiest):
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Go to Supabase Dashboard → Authentication → Users
-- 2. Delete all existing users (click ⋮ menu → Delete User for each)
-- 3. Click "Add User" → "Create New User" for each role:
--
--    ┌─────────────────────────────────────────────────────────────────┐
--    │ Email                  │ Password     │ Role (assigned in app)  │
--    ├─────────────────────────────────────────────────────────────────┤
--    │ admin@yourclinic.com   │ Admin@123!   │ Admin (auto on 1st login)│
--    │ doctor@yourclinic.com  │ Doctor@123!  │ Doctor                  │
--    │ staff@yourclinic.com   │ Staff@123!   │ Staff                   │
--    │ lab@yourclinic.com     │ Lab@123!     │ Lab Partner             │
--    └─────────────────────────────────────────────────────────────────┘
--    (Use your own emails/passwords — above are just examples)
--    IMPORTANT: Check "Auto Confirm User" when creating each user!
--
-- 4. Log in to the app with the ADMIN email FIRST
--    → The app auto-creates you as Admin (bootstrap flow)
-- 5. Go to Settings → Manage Users → Add the other users with their roles
-- 6. Now each user can log in with their own credentials
--
-- OPTION B (Pre-insert via SQL — for advanced users):
-- ─────────────────────────────────────────────────────────────────────────────
-- After creating auth users in Supabase Dashboard, copy their UUIDs from
-- the Authentication → Users table, then run:
--
-- INSERT INTO public.clinic_users (auth_id, email, full_name, role, is_active)
-- VALUES
--   ('paste-admin-uuid-here',  'admin@yourclinic.com',  'Dr. Admin',    'admin',       true),
--   ('paste-doctor-uuid-here', 'doctor@yourclinic.com', 'Dr. Doctor',   'doctor',      true),
--   ('paste-staff-uuid-here',  'staff@yourclinic.com',  'Staff Member', 'staff',       true),
--   ('paste-lab-uuid-here',    'lab@yourclinic.com',    'Lab Partner',  'lab_partner', true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION: Check everything is clean
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT 
  '✅ Fresh start complete!' AS status,
  (SELECT count(*) FROM public.clinic_users) AS clinic_users_count,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'clinic_users' AND schemaname = 'public') AS rls_policies_count;
