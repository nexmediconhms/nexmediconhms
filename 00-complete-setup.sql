-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  COMPLETE SETUP - Run this in Supabase SQL Editor                    ║
-- ║                                                                      ║
-- ║  SAFE: Does NOT delete any patient data or other tables.             ║
-- ║  Only fixes clinic_users table + RLS policies.                       ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────
-- STEP 1: Create clinic_users table if it doesn't exist
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clinic_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id     UUID NOT NULL UNIQUE,
  email       TEXT NOT NULL,
  full_name   TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'doctor', 'staff')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  phone       TEXT,
  specialty   TEXT,
  med_reg_no  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────
-- STEP 2: Enable RLS
-- ─────────────────────────────────────────────────────
ALTER TABLE public.clinic_users ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────
-- STEP 3: Drop ALL existing policies (clean slate)
-- ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can read own profile" ON public.clinic_users;
DROP POLICY IF EXISTS "Users can read own profile by email" ON public.clinic_users;
DROP POLICY IF EXISTS "Admins can read all users" ON public.clinic_users;
DROP POLICY IF EXISTS "Admins can insert users" ON public.clinic_users;
DROP POLICY IF EXISTS "Admins can update users" ON public.clinic_users;
DROP POLICY IF EXISTS "Allow first user bootstrap" ON public.clinic_users;
DROP POLICY IF EXISTS "clinic_users_select_own" ON public.clinic_users;
DROP POLICY IF EXISTS "clinic_users_select_admin" ON public.clinic_users;
DROP POLICY IF EXISTS "clinic_users_insert_admin" ON public.clinic_users;
DROP POLICY IF EXISTS "clinic_users_update_admin" ON public.clinic_users;
DROP POLICY IF EXISTS "Service role full access" ON public.clinic_users;
DROP POLICY IF EXISTS "Authenticated users can read by email" ON public.clinic_users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.clinic_users;

-- ─────────────────────────────────────────────────────
-- STEP 4: Create RLS policies
-- ─────────────────────────────────────────────────────

-- 4a. Users can read their own row (by auth_id)
CREATE POLICY "Users can read own profile"
  ON public.clinic_users FOR SELECT
  USING (auth.uid() = auth_id);

-- 4b. Users can also read their own row by email match
-- This handles the case where auth_id wasn't set correctly
CREATE POLICY "Users can read own profile by email"
  ON public.clinic_users FOR SELECT
  USING (email = auth.email());

-- 4c. Admins can read ALL users
CREATE POLICY "Admins can read all users"
  ON public.clinic_users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.clinic_users cu
      WHERE cu.auth_id = auth.uid() AND cu.role = 'admin' AND cu.is_active = true
    )
  );

-- 4d. Admins can insert new users
CREATE POLICY "Admins can insert users"
  ON public.clinic_users FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.clinic_users cu
      WHERE cu.auth_id = auth.uid() AND cu.role = 'admin' AND cu.is_active = true
    )
  );

-- 4e. Admins can update any user
CREATE POLICY "Admins can update users"
  ON public.clinic_users FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.clinic_users cu
      WHERE cu.auth_id = auth.uid() AND cu.role = 'admin' AND cu.is_active = true
    )
  );

-- 4f. Users can update their own row (to fix auth_id mismatch)
CREATE POLICY "Users can update own profile"
  ON public.clinic_users FOR UPDATE
  USING (auth.uid() = auth_id OR email = auth.email());

-- 4g. Allow first user to be inserted when table is empty
CREATE POLICY "Allow first user bootstrap"
  ON public.clinic_users FOR INSERT
  WITH CHECK (
    NOT EXISTS (SELECT 1 FROM public.clinic_users)
  );

-- ─────────────────────────────────────────────────────
-- VERIFICATION
-- ─────────────────────────────────────────────────────
SELECT 'DONE' AS status,
  (SELECT count(*) FROM public.clinic_users) AS existing_users,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'clinic_users') AS policies_count;
