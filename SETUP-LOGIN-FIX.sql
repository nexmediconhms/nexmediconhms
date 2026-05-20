-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║  NexMedicon HMS — DEPLOYMENT SETUP (One-Shot)                               ║
-- ║                                                                              ║
-- ║  THIS IS THE ONLY SQL YOU NEED TO RUN FOR A FRESH DEPLOYMENT.               ║
-- ║                                                                              ║
-- ║  What it does:                                                               ║
-- ║  1. Creates the clinic_users table (if not exists)                           ║
-- ║  2. Sets up all RLS (Row Level Security) policies                            ║
-- ║  3. Creates your Admin user directly from auth.users                         ║
-- ║                                                                              ║
-- ║  Prerequisites:                                                              ║
-- ║  - You have already created at least ONE user in Supabase →                  ║
-- ║    Authentication → Users → Add User (with email + password)                 ║
-- ║  - That first user will become the Admin                                     ║
-- ║                                                                              ║
-- ║  HOW TO RUN:                                                                 ║
-- ║  1. Go to Supabase Dashboard → SQL Editor → New Query                       ║
-- ║  2. Paste this ENTIRE file                                                   ║
-- ║  3. Click "Run"                                                              ║
-- ║  4. Verify: you should see your admin email in the results                   ║
-- ║  5. Go to your app → Login with that email/password → Done!                  ║
-- ║                                                                              ║
-- ║  ADDING MORE USERS LATER:                                                    ║
-- ║  After logging in as Admin, go to Settings → Manage Users to add             ║
-- ║  doctors, staff, and lab partners. Each user needs:                           ║
-- ║    - A Supabase Auth account (Authentication → Users → Add User)             ║
-- ║    - A clinic_users row with their role (created via the Manage Users UI)    ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝


-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 1: Create clinic_users table
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.clinic_users (
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

-- Add role constraint (safe if already exists)
DO $$
BEGIN
  ALTER TABLE public.clinic_users DROP CONSTRAINT IF EXISTS clinic_users_role_check;
  ALTER TABLE public.clinic_users ADD CONSTRAINT clinic_users_role_check
    CHECK (role IN ('admin', 'doctor', 'staff', 'lab_partner'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 2: Enable RLS
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.clinic_users ENABLE ROW LEVEL SECURITY;


-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 3: Drop all existing policies (clean slate)
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'clinic_users' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.clinic_users', pol.policyname);
  END LOOP;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 4: Create RLS policies
-- ═══════════════════════════════════════════════════════════════════════════════

-- Users can read their own row (by auth_id)
CREATE POLICY "Users can read own profile"
  ON public.clinic_users FOR SELECT
  USING (auth.uid() = auth_id);

-- Users can read their own row (by email — fallback for auth_id mismatch)
CREATE POLICY "Users can read own profile by email"
  ON public.clinic_users FOR SELECT
  USING (email = auth.email());

-- Admins can read ALL users
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

-- Admins can UPDATE users
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

-- Users can update their own row
CREATE POLICY "Users can update own profile"
  ON public.clinic_users FOR UPDATE
  USING (auth.uid() = auth_id OR email = auth.email());

-- Admins can DELETE users (deactivation preferred, but allow hard delete)
CREATE POLICY "Admins can delete users"
  ON public.clinic_users FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.clinic_users cu
      WHERE cu.auth_id = auth.uid()
        AND cu.role = 'admin'
        AND cu.is_active = true
    )
  );


-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 5: Create Admin user from the FIRST auth.users entry
-- ═══════════════════════════════════════════════════════════════════════════════

-- Clear any broken/stale rows
DELETE FROM public.clinic_users WHERE true;

-- Insert the first auth user as admin
-- (The first user you created in Supabase Authentication becomes admin)
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
LIMIT 1
ON CONFLICT (auth_id) DO UPDATE SET
  role = 'admin',
  is_active = true,
  updated_at = NOW();


-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT
  '✅ Setup complete! You can now login.' AS status,
  cu.email AS admin_email,
  cu.full_name AS admin_name,
  cu.role AS role,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'clinic_users' AND schemaname = 'public') AS policies_count
FROM public.clinic_users cu
WHERE cu.role = 'admin'
LIMIT 1;
