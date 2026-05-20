-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  FIX: "Account exists but hasn't been assigned a role yet" error   ║
-- ║                                                                    ║
-- ║  ROOT CAUSE:                                                       ║
-- ║  RLS (Row Level Security) is enabled on the clinic_users table     ║
-- ║  but there is no SELECT policy allowing authenticated users to     ║
-- ║  read their own row. This causes the login flow to fail because    ║
-- ║  the app cannot load the user's profile/role.                      ║
-- ║                                                                    ║
-- ║  INSTRUCTIONS:                                                     ║
-- ║  1. Go to your Supabase project dashboard                         ║
-- ║  2. Click "SQL Editor" in the left sidebar                        ║
-- ║  3. Click "New query"                                              ║
-- ║  4. Copy ALL the code below and paste it in the editor            ║
-- ║  5. Click "Run" (or press Ctrl+Enter)                             ║
-- ║  6. You should see "Success" message                              ║
-- ║  7. Try logging in again — it should work now                     ║
-- ║                                                                    ║
-- ║  WHAT THIS DOES:                                                   ║
-- ║  ✅ Allows authenticated users to read their OWN clinic_users row  ║
-- ║  ✅ Allows admins to read ALL clinic_users rows (for user mgmt)    ║
-- ║  ✅ Allows admins to insert/update clinic_users (for adding users) ║
-- ║  ✅ Preserves security — users cannot see other users' data        ║
-- ╚══════════════════════════════════════════════════════════════════════╝


-- ─────────────────────────────────────────────────────
-- STEP 1: Ensure RLS is enabled (idempotent)
-- ─────────────────────────────────────────────────────
ALTER TABLE public.clinic_users ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────
-- STEP 2: Drop existing policies (if any) to avoid conflicts
-- ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can read own profile" ON public.clinic_users;
DROP POLICY IF EXISTS "Admins can read all users" ON public.clinic_users;
DROP POLICY IF EXISTS "Admins can insert users" ON public.clinic_users;
DROP POLICY IF EXISTS "Admins can update users" ON public.clinic_users;
DROP POLICY IF EXISTS "clinic_users_select_own" ON public.clinic_users;
DROP POLICY IF EXISTS "clinic_users_select_admin" ON public.clinic_users;
DROP POLICY IF EXISTS "clinic_users_insert_admin" ON public.clinic_users;
DROP POLICY IF EXISTS "clinic_users_update_admin" ON public.clinic_users;


-- ─────────────────────────────────────────────────────
-- STEP 3: Create SELECT policy — users can read their own row
-- This is the CRITICAL policy that fixes the login error.
-- Without this, loadClinicUser() returns null and the app
-- shows "hasn't been assigned a role yet".
-- ─────────────────────────────────────────────────────
CREATE POLICY "Users can read own profile"
  ON public.clinic_users
  FOR SELECT
  USING (auth.uid() = auth_id);


-- ─────────────────────────────────────────────────────
-- STEP 4: Create SELECT policy — admins can read all users
-- Needed for Settings → Manage Users page
-- ─────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────
-- STEP 5: Create INSERT policy — admins can add new users
-- ─────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────
-- STEP 6: Create UPDATE policy — admins can update users
-- ─────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────
-- STEP 7: Allow first-time setup (INSERT when no users exist)
-- This allows the bootstrapAdmin() function to work when
-- the clinic_users table is empty (first-time setup).
-- ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow first user bootstrap" ON public.clinic_users;

CREATE POLICY "Allow first user bootstrap"
  ON public.clinic_users
  FOR INSERT
  WITH CHECK (
    -- Only allow if no users exist yet (first-time setup)
    NOT EXISTS (SELECT 1 FROM public.clinic_users)
  );


-- ─────────────────────────────────────────────────────
-- VERIFICATION: Check that policies were created
-- ─────────────────────────────────────────────────────
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'clinic_users';
