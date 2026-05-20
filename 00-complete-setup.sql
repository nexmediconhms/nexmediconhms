-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  FIX LOGIN: Run this in Supabase → SQL Editor                        ║
-- ║                                                                      ║
-- ║  SAFE: Does NOT delete patients, encounters, prescriptions, etc.     ║
-- ║  Only fixes clinic_users table + RLS policies for login to work.     ║
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
-- STEP 3: Drop ALL existing policies
-- ─────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────
-- STEP 4: Create correct RLS policies
-- ─────────────────────────────────────────────────────

-- Users can read their own row by auth_id
CREATE POLICY "Users can read own profile"
  ON public.clinic_users FOR SELECT
  USING (auth.uid() = auth_id);

-- Users can read their own row by email (handles auth_id mismatch)
CREATE POLICY "Users can read own profile by email"
  ON public.clinic_users FOR SELECT
  USING (email = auth.email());

-- Admins can read all users
CREATE POLICY "Admins can read all users"
  ON public.clinic_users FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.clinic_users cu WHERE cu.auth_id = auth.uid() AND cu.role = 'admin' AND cu.is_active = true));

-- Admins can insert users
CREATE POLICY "Admins can insert users"
  ON public.clinic_users FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.clinic_users cu WHERE cu.auth_id = auth.uid() AND cu.role = 'admin' AND cu.is_active = true));

-- Admins can update users
CREATE POLICY "Admins can update users"
  ON public.clinic_users FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.clinic_users cu WHERE cu.auth_id = auth.uid() AND cu.role = 'admin' AND cu.is_active = true));

-- Users can update their own row
CREATE POLICY "Users can update own profile"
  ON public.clinic_users FOR UPDATE
  USING (auth.uid() = auth_id OR email = auth.email());

-- Allow first user bootstrap (when table is empty)
CREATE POLICY "Allow first user bootstrap"
  ON public.clinic_users FOR INSERT
  WITH CHECK (NOT EXISTS (SELECT 1 FROM public.clinic_users));

-- ─────────────────────────────────────────────────────
-- STEP 5: Fix existing clinic_users auth_id to match auth.users
-- This updates any rows where email matches but auth_id doesn't
-- ─────────────────────────────────────────────────────
UPDATE public.clinic_users cu
SET auth_id = au.id
FROM auth.users au
WHERE cu.email = au.email AND cu.auth_id != au.id;

-- ─────────────────────────────────────────────────────
-- VERIFICATION
-- ─────────────────────────────────────────────────────
SELECT 'DONE' AS status,
  (SELECT count(*) FROM public.clinic_users) AS users,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'clinic_users') AS policies;
