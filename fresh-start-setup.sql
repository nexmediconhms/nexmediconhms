-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║  NexMedicon HMS — FRESH START: Delete All Data & Setup Fresh Credentials    ║
-- ║                                                                              ║
-- ║  PURPOSE: Completely wipes clinic_users and all related data, then sets up   ║
-- ║  the database schema so you can start fresh.                                 ║
-- ║                                                                              ║
-- ║  HOW TO RUN:                                                                 ║
-- ║  1. Go to your Supabase Dashboard → SQL Editor → New Query                  ║
-- ║  2. Paste this ENTIRE file                                                   ║
-- ║  3. Click "Run" (or press Ctrl+Enter)                                        ║
-- ║  4. Then go to Authentication → Users to create auth users (see below)       ║
-- ║                                                                              ║
-- ║  AFTER RUNNING THIS SQL:                                                     ║
-- ║  You need to create auth users in Supabase Dashboard:                        ║
-- ║  1. Go to Authentication → Users → "Add User"                               ║
-- ║  2. Create users with passwords for each role (see bottom of file)           ║
-- ║  3. The FIRST user to log in will be auto-bootstrapped as Admin              ║
-- ║  OR run the Step 7 below to pre-create clinic_users rows.                    ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 1: DELETE ALL EXISTING DATA (Complete Wipe)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Delete in correct order to avoid foreign key violations
-- (child tables first, parent tables last)

-- Lab-related
DELETE FROM public.lab_results WHERE true;
DELETE FROM public.lab_orders WHERE true;

-- Billing & prescriptions
DELETE FROM public.billing WHERE true;
DELETE FROM public.prescriptions WHERE true;

-- Encounters & visits
DELETE FROM public.encounters WHERE true;

-- ANC / pregnancy tracking
DELETE FROM public.anc_visits WHERE true;

-- IPD
DELETE FROM public.ipd_admissions WHERE true;
DELETE FROM public.bed_assignments WHERE true;

-- Queue
DELETE FROM public.queue WHERE true;

-- Patients (main clinical data)
DELETE FROM public.patients WHERE true;

-- Clinic users (the login/role table)
DELETE FROM public.clinic_users WHERE true;

-- Audit logs
DELETE FROM public.audit_logs WHERE true;

-- Notifications
DELETE FROM public.notifications WHERE true;

-- Hospital fund/expenses
DELETE FROM public.expenses WHERE true;

-- Any other app tables (safe to fail if they don't exist)
DO $$
BEGIN
  -- Try deleting from tables that may or may not exist
  EXECUTE 'DELETE FROM public.appointments WHERE true';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  EXECUTE 'DELETE FROM public.vitals WHERE true';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  EXECUTE 'DELETE FROM public.documents WHERE true';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  EXECUTE 'DELETE FROM public.settings WHERE true';
EXCEPTION WHEN undefined_table THEN NULL;
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

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 3: Enable RLS on clinic_users
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.clinic_users ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 4: Drop ALL existing policies (clean slate)
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Users can read own profile" ON public.clinic_users;
DROP POLICY IF EXISTS "Users can read own profile by email" ON public.clinic_users;
DROP POLICY IF EXISTS "Admins can read all users" ON public.clinic_users;
DROP POLICY IF EXISTS "Admins can insert users" ON public.clinic_users;
DROP POLICY IF EXISTS "Admins can update users" ON public.clinic_users;
DROP POLICY IF EXISTS "Allow first user bootstrap" ON public.clinic_users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.clinic_users;
DROP POLICY IF EXISTS "clinic_users_select_own" ON public.clinic_users;
DROP POLICY IF EXISTS "clinic_users_select_admin" ON public.clinic_users;
DROP POLICY IF EXISTS "clinic_users_insert_admin" ON public.clinic_users;
DROP POLICY IF EXISTS "clinic_users_update_admin" ON public.clinic_users;
DROP POLICY IF EXISTS "Service role full access" ON public.clinic_users;
DROP POLICY IF EXISTS "Authenticated users can read by email" ON public.clinic_users;

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
-- STEP 6: Also delete all Supabase Auth users (optional — uncomment if needed)
-- ═══════════════════════════════════════════════════════════════════════════════
-- WARNING: This deletes ALL auth users. Only uncomment if you want a complete
-- fresh start including authentication credentials.
-- 
-- DELETE FROM auth.users WHERE true;
--
-- If you uncomment the above, you'll need to re-create auth users in Step 7.

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 7: (OPTIONAL) Pre-create clinic_users with known auth_ids
-- ═══════════════════════════════════════════════════════════════════════════════
-- 
-- OPTION A (RECOMMENDED): Let the app handle it automatically
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Create auth users in Supabase Dashboard → Authentication → Users → Add User
-- 2. The FIRST user to log in gets auto-bootstrapped as Admin
-- 3. Then Admin goes to Settings → Manage Users to add Doctor, Staff, Lab Partner
--
-- OPTION B: Pre-insert clinic_users if you already know the auth UUIDs
-- ─────────────────────────────────────────────────────────────────────────────
-- After creating auth users in Supabase Dashboard, find their UUIDs in 
-- Authentication → Users table, then run:
--
-- INSERT INTO public.clinic_users (auth_id, email, full_name, role, is_active)
-- VALUES
--   ('<ADMIN_AUTH_UUID>',  'admin@yourclinic.com',  'Dr. Admin Name',  'admin',       true),
--   ('<DOCTOR_AUTH_UUID>', 'doctor@yourclinic.com', 'Dr. Doctor Name', 'doctor',      true),
--   ('<STAFF_AUTH_UUID>',  'staff@yourclinic.com',  'Staff Name',      'staff',       true),
--   ('<LAB_AUTH_UUID>',    'lab@yourclinic.com',    'Lab Partner',     'lab_partner', true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION: Check everything is clean
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT 
  'Fresh start complete!' AS status,
  (SELECT count(*) FROM public.clinic_users) AS clinic_users_count,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'clinic_users') AS rls_policies_count;
