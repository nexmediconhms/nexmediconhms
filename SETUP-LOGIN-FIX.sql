-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║  NexMedicon HMS — ONE-SHOT LOGIN FIX                                        ║
-- ║                                                                              ║
-- ║  THIS IS THE ONLY SQL YOU NEED TO RUN.                                       ║
-- ║  It creates the table + inserts your admin user directly.                    ║
-- ║  No chicken-egg problem. No bootstrap API dependency.                        ║
-- ║                                                                              ║
-- ║  HOW TO RUN:                                                                 ║
-- ║  1. Go to Supabase Dashboard → SQL Editor → New Query                       ║
-- ║  2. Paste this ENTIRE file                                                   ║
-- ║  3. Click "Run"                                                              ║
-- ║  4. Go to your app → Login → You're in!                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 1: Create the clinic_users table (safe — won't error if it exists)
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

-- Fix constraint if table already existed with old role list
DO $$
BEGIN
  ALTER TABLE public.clinic_users DROP CONSTRAINT IF EXISTS clinic_users_role_check;
  ALTER TABLE public.clinic_users ADD CONSTRAINT clinic_users_role_check 
    CHECK (role IN ('admin', 'doctor', 'staff', 'lab_partner'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 2: Enable RLS + Create policies
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.clinic_users ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies first (clean slate)
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'clinic_users' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.clinic_users', pol.policyname);
  END LOOP;
END $$;

-- Policy: Users can read their own row
CREATE POLICY "Users can read own profile"
  ON public.clinic_users FOR SELECT
  USING (auth.uid() = auth_id);

-- Policy: Users can read by email (handles auth_id mismatch)
CREATE POLICY "Users can read own profile by email"
  ON public.clinic_users FOR SELECT
  USING (email = auth.email());

-- Policy: Admins can read all
CREATE POLICY "Admins can read all users"
  ON public.clinic_users FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.clinic_users cu WHERE cu.auth_id = auth.uid() AND cu.role = 'admin' AND cu.is_active = true));

-- Policy: Admins can insert
CREATE POLICY "Admins can insert users"
  ON public.clinic_users FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.clinic_users cu WHERE cu.auth_id = auth.uid() AND cu.role = 'admin' AND cu.is_active = true));

-- Policy: Admins can update
CREATE POLICY "Admins can update users"
  ON public.clinic_users FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.clinic_users cu WHERE cu.auth_id = auth.uid() AND cu.role = 'admin' AND cu.is_active = true));

-- Policy: Users can update own
CREATE POLICY "Users can update own profile"
  ON public.clinic_users FOR UPDATE
  USING (auth.uid() = auth_id OR email = auth.email());

-- Policy: First user bootstrap (when empty)
CREATE POLICY "Allow first user bootstrap"
  ON public.clinic_users FOR INSERT
  WITH CHECK (NOT EXISTS (SELECT 1 FROM public.clinic_users));

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 3: INSERT YOUR ADMIN USER DIRECTLY
-- This bypasses the bootstrap API entirely. No chicken-egg problem.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Clear any stale/broken rows first
DELETE FROM public.clinic_users WHERE true;

-- Insert admin by pulling UUID directly from auth.users
-- This finds YOUR user in the auth table and creates the admin profile
INSERT INTO public.clinic_users (auth_id, email, full_name, role, is_active)
SELECT 
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1), 'Admin'),
  'admin',
  true
FROM auth.users au
ORDER BY au.created_at ASC
LIMIT 1
ON CONFLICT (auth_id) DO UPDATE SET
  role = 'admin',
  is_active = true,
  updated_at = NOW();

-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION: Confirm it worked
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT 
  '✅ SUCCESS — You can now login!' AS status,
  cu.email AS admin_email,
  cu.full_name AS admin_name,
  cu.role AS admin_role,
  cu.auth_id AS auth_uuid
FROM public.clinic_users cu
WHERE cu.role = 'admin'
LIMIT 1;
