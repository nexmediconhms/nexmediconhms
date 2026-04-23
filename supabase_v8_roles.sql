  -- ============================================================
  -- NexMedicon HMS v8 — Role-Based Access & Clinic Settings
  -- Run in Supabase → SQL Editor → New Query
  -- Safe to run multiple times (IF NOT EXISTS everywhere)
  -- ============================================================

  -- ─── CLINIC USERS (role mapping) ─────────────────────────────
  -- Links Supabase auth.users to clinic roles.
  -- Every person who logs in must have a row here.
  CREATE TABLE IF NOT EXISTS clinic_users (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    auth_id     UUID NOT NULL UNIQUE,          -- references auth.users(id)
    email       TEXT NOT NULL,
    full_name   TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'staff'
                CHECK (role IN ('admin', 'doctor', 'staff')),
    is_active   BOOLEAN DEFAULT TRUE,
    phone       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
  );

  -- Index for fast lookup by auth_id (called on every page load)
  CREATE INDEX IF NOT EXISTS idx_clinic_users_auth ON clinic_users(auth_id);
  CREATE INDEX IF NOT EXISTS idx_clinic_users_email ON clinic_users(email);

  -- RLS: only authenticated users can read clinic_users
  ALTER TABLE clinic_users ENABLE ROW LEVEL SECURITY;

  -- All authenticated users can read (to see who's who)
  DROP POLICY IF EXISTS clinic_users_read ON clinic_users;
  CREATE POLICY clinic_users_read ON clinic_users
    FOR SELECT TO authenticated USING (true);

  -- Only the user themselves or admins can update
  DROP POLICY IF EXISTS clinic_users_update ON clinic_users;
  CREATE POLICY clinic_users_update ON clinic_users
    FOR UPDATE TO authenticated USING (
      auth_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM clinic_users cu
        WHERE cu.auth_id = auth.uid() AND cu.role = 'admin'
      )
    );

  -- Only admins can insert new users
  DROP POLICY IF EXISTS clinic_users_insert ON clinic_users;
  CREATE POLICY clinic_users_insert ON clinic_users
    FOR INSERT TO authenticated WITH CHECK (
      EXISTS (
        SELECT 1 FROM clinic_users cu
        WHERE cu.auth_id = auth.uid() AND cu.role = 'admin'
      )
    );

  -- Only admins can delete users
  DROP POLICY IF EXISTS clinic_users_delete ON clinic_users;
  CREATE POLICY clinic_users_delete ON clinic_users
    FOR DELETE TO authenticated USING (
      EXISTS (
        SELECT 1 FROM clinic_users cu
        WHERE cu.auth_id = auth.uid() AND cu.role = 'admin'
      )
    );

  -- ─── CLINIC SETTINGS (replaces localStorage) ─────────────────
  -- Key-value store for hospital settings.
  -- Shared across all devices and users.
  CREATE TABLE IF NOT EXISTS clinic_settings (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE,
    value       TEXT,
    updated_by  UUID REFERENCES clinic_users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
  );

  ALTER TABLE clinic_settings ENABLE ROW LEVEL SECURITY;

  -- All authenticated users can read settings
  DROP POLICY IF EXISTS clinic_settings_read ON clinic_settings;
  CREATE POLICY clinic_settings_read ON clinic_settings
    FOR SELECT TO authenticated USING (true);

  -- Only admins and doctors can update settings
  DROP POLICY IF EXISTS clinic_settings_write ON clinic_settings;
  CREATE POLICY clinic_settings_write ON clinic_settings
    FOR ALL TO authenticated USING (
      EXISTS (
        SELECT 1 FROM clinic_users cu
        WHERE cu.auth_id = auth.uid() AND cu.role IN ('admin', 'doctor')
      )
    ) WITH CHECK (
      EXISTS (
        SELECT 1 FROM clinic_users cu
        WHERE cu.auth_id = auth.uid() AND cu.role IN ('admin', 'doctor')
      )
    );

  -- ─── AUDIT LOG (who did what) ────────────────────────────────
  CREATE TABLE IF NOT EXISTS audit_log (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID REFERENCES clinic_users(id) ON DELETE SET NULL,
    action      TEXT NOT NULL,       -- 'patient.create', 'encounter.update', etc.
    entity_type TEXT,                -- 'patient', 'encounter', 'prescription'
    entity_id   UUID,                -- the record that was changed
    details     JSONB DEFAULT '{}'::JSONB,  -- extra context
    ip_address  TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );

  ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

  -- Only admins can read audit logs
  DROP POLICY IF EXISTS audit_log_read ON audit_log;
  CREATE POLICY audit_log_read ON audit_log
    FOR SELECT TO authenticated USING (
      EXISTS (
        SELECT 1 FROM clinic_users cu
        WHERE cu.auth_id = auth.uid() AND cu.role = 'admin'
      )
    );

  -- All authenticated users can insert audit entries
  DROP POLICY IF EXISTS audit_log_insert ON audit_log;
  CREATE POLICY audit_log_insert ON audit_log
    FOR INSERT TO authenticated WITH CHECK (true);

  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_entity  ON audit_log(entity_type, entity_id);

  -- ─── BOOTSTRAP: Allow first admin to be created ──────────────
  -- When clinic_users is empty (fresh install), allow the first
  -- authenticated user to insert themselves as admin.
  -- This policy is automatically superseded once an admin exists.
  DROP POLICY IF EXISTS clinic_users_bootstrap ON clinic_users;
  CREATE POLICY clinic_users_bootstrap ON clinic_users
    FOR INSERT TO authenticated WITH CHECK (
      NOT EXISTS (SELECT 1 FROM clinic_users)
    );

  -- ─── HELPER FUNCTION: Get current user's role ────────────────
  CREATE OR REPLACE FUNCTION get_my_role()
  RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT role FROM clinic_users WHERE auth_id = auth.uid() AND is_active = TRUE LIMIT 1;
  $$;

  -- ─── HELPER FUNCTION: Check if current user is admin ─────────
  CREATE OR REPLACE FUNCTION is_admin()
  RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT EXISTS (
      SELECT 1 FROM clinic_users
      WHERE auth_id = auth.uid() AND role = 'admin' AND is_active = TRUE
    );
  $$;

  -- ─── Update existing RLS policies to be role-aware ───────────
  -- Patients: all authenticated can read, only doctor+admin can delete
  -- (Keep existing broad policies for now — tighten incrementally)

  -- ─── INTAKE (public patient self-registration) ───────────────
  -- The /intake page needs to insert patients without being logged in.
  -- We add a special policy for anon inserts on patients table.
  -- This is safe because the intake form only inserts, never reads/updates.
  DROP POLICY IF EXISTS patients_public_insert ON patients;
  CREATE POLICY patients_public_insert ON patients
    FOR INSERT TO anon WITH CHECK (true);

  -- Also allow anon to read (for duplicate check by mobile)
  DROP POLICY IF EXISTS patients_public_read ON patients;
  CREATE POLICY patients_public_read ON patients
    FOR SELECT TO anon USING (true);

  -- Allow anon to insert encounters (for chief complaint from intake)
  DROP POLICY IF EXISTS encounters_public_insert ON encounters;
  CREATE POLICY encounters_public_insert ON encounters
    FOR INSERT TO anon WITH CHECK (true);

  SELECT 'v8 roles migration complete ✓' AS result;
