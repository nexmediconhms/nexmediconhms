-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  COMPLETE FIRST-TIME SETUP FIX                                      ║
-- ║                                                                      ║
-- ║  Run this ONCE in Supabase → SQL Editor → New Query → Run           ║
-- ║                                                                      ║
-- ║  This script:                                                        ║
-- ║  1. Creates the clinic_users table (if not exists)                   ║
-- ║  2. Sets up correct RLS policies for login to work                   ║
-- ║  3. Ensures first-time admin bootstrap works                         ║
-- ║                                                                      ║
-- ║  After running this, go to the app login page, enter your email,     ║
-- ║  verify OTP, and you'll see the "First Time Setup" screen where      ║
-- ║  you enter your name to become the admin.                            ║
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
DROP POLICY IF EXISTS "Admins can read all users" ON public.clinic_users;
DROP POLICY IF EXISTS "Admins can insert users" ON public.clinic_users;
DROP POLICY IF EXISTS "Admins can update users" ON public.clinic_users;
DROP POLICY IF EXISTS "Allow first user bootstrap" ON public.clinic_users;
DROP POLICY IF EXISTS "clinic_users_select_own" ON public.clinic_users;
DROP POLICY IF EXISTS "clinic_users_select_admin" ON public.clinic_users;
DROP POLICY IF EXISTS "clinic_users_insert_admin" ON public.clinic_users;
DROP POLICY IF EXISTS "clinic_users_update_admin" ON public.clinic_users;
DROP POLICY IF EXISTS "Service role full access" ON public.clinic_users;

-- ─────────────────────────────────────────────────────
-- STEP 4: Create policies
-- ─────────────────────────────────────────────────────

-- 4a. Authenticated users can read their OWN row
CREATE POLICY "Users can read own profile"
  ON public.clinic_users
  FOR SELECT
  USING (auth.uid() = auth_id);

-- 4b. Admins can read ALL users (for Settings → Manage Users)
CREATE POLICY "Admins can read all users"
  ON public.clinic_users
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.clinic_users cu
      WHERE cu.auth_id = auth.uid()
        AND cu.role = 'admin'
        AND cu.is_active = true
    )
  );

-- 4c. Admins can insert new users
CREATE POLICY "Admins can insert users"
  ON public.clinic_users
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.clinic_users cu
      WHERE cu.auth_id = auth.uid()
        AND cu.role = 'admin'
        AND cu.is_active = true
    )
  );

-- 4d. Admins can update users
CREATE POLICY "Admins can update users"
  ON public.clinic_users
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.clinic_users cu
      WHERE cu.auth_id = auth.uid()
        AND cu.role = 'admin'
        AND cu.is_active = true
    )
  );

-- 4e. CRITICAL: Allow first-ever user to be inserted when table is empty
--     This makes the bootstrapAdmin() function work for the FIRST login
CREATE POLICY "Allow first user bootstrap"
  ON public.clinic_users
  FOR INSERT
  WITH CHECK (
    NOT EXISTS (SELECT 1 FROM public.clinic_users)
  );

-- ─────────────────────────────────────────────────────
-- STEP 5: Ensure the service_role key can bypass RLS
--         (This is default Supabase behavior but let's be explicit)
-- ─────────────────────────────────────────────────────
-- Note: The service_role key automatically bypasses RLS in Supabase.
-- Our /api/bootstrap and /api/me endpoints use service_role, so they
-- always work regardless of RLS policies.

-- ─────────────────────────────────────────────────────
-- STEP 6: Make sure clinic_users table is EMPTY
--         (so the first-time setup screen triggers)
-- ─────────────────────────────────────────────────────
-- ⚠️ UNCOMMENT THE LINE BELOW ONLY IF YOU WANT TO RESET AND START FRESH
-- DELETE FROM public.clinic_users;

-- ─────────────────────────────────────────────────────
-- VERIFICATION
-- ─────────────────────────────────────────────────────
SELECT 'Setup complete ✓' AS status,
  (SELECT count(*) FROM public.clinic_users) AS existing_users,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'clinic_users') AS policies_created;
