-- ════════════════════════════════════════════════════════════════════
-- 00_extensions_and_helpers.sql
--
-- FRESH-INSTALL STEP 1 of 7 — Extensions and RLS helper functions.
--
-- Run this first on a brand-new Supabase project for a doctor's clinic.
-- Re-runnable safely (CREATE EXTENSION IF NOT EXISTS, CREATE OR REPLACE).
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Required extensions ────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- EXCLUDE constraints (OT room overlap)

-- ── RLS helper functions ───────────────────────────────────────────
-- These are referenced by every RLS policy. The policy migration
-- (05_rls_policies.sql) WILL FAIL if these don't exist first.

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM clinic_users
  WHERE auth_id = auth.uid() AND is_active = TRUE
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM clinic_users
    WHERE auth_id = auth.uid() AND role = 'admin' AND is_active = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION is_doctor_or_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM clinic_users
    WHERE auth_id = auth.uid() AND role IN ('admin', 'doctor') AND is_active = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION is_active_user()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM clinic_users
    WHERE auth_id = auth.uid() AND is_active = TRUE
  );
$$;

-- Audit-only role check used by audit RLS policies
CREATE OR REPLACE FUNCTION is_admin_or_self_audit(p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_admin() OR EXISTS (
    SELECT 1 FROM clinic_users
    WHERE auth_id = auth.uid() AND id = p_user_id AND is_active = TRUE
  );
$$;

GRANT EXECUTE ON FUNCTION get_my_role()           TO authenticated;
GRANT EXECUTE ON FUNCTION is_admin()              TO authenticated;
GRANT EXECUTE ON FUNCTION is_doctor_or_admin()    TO authenticated;
GRANT EXECUTE ON FUNCTION is_active_user()        TO authenticated;
GRANT EXECUTE ON FUNCTION is_admin_or_self_audit(UUID) TO authenticated;

-- ── Schema migration tracking ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          SERIAL PRIMARY KEY,
  version     TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  applied_at  TIMESTAMPTZ DEFAULT NOW(),
  applied_by  TEXT,
  notes       TEXT
);

INSERT INTO schema_migrations (version, name, applied_at, notes)
VALUES ('FI-00', 'fresh_install_extensions_and_helpers', NOW(),
        'Extensions and RLS helper functions for fresh clinic install')
ON CONFLICT (version) DO NOTHING;

COMMIT;

SELECT 'Fresh-install 00/07: Extensions and helpers — DONE' AS result;
