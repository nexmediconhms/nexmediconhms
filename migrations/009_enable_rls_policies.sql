-- Migration: 009_enable_rls_policies
-- Created: 2026-05-22
-- Description: Enable RLS on ALL tables with proper role-based policies
-- Dependencies: Requires clinicusers table with helper functions (is_active_user, is_admin, is_doctor_or_admin)
--
-- CRITICAL SECURITY FIX:
-- This migration REPLACES fix-all-permissions.sql which DISABLED RLS on everything.
-- After running this, only authenticated clinic users can access patient data.
--
-- ⚠️ TEST THOROUGHLY AFTER RUNNING:
--   1. Log in as admin → can see all data
--   2. Log in as doctor → can see patients, encounters, prescriptions
--   3. Log in as staff → can see patients, billing, appointments
--   4. Unauthenticated → NO access to any data
--
-- SAFE TO RUN: Uses DROP POLICY IF EXISTS + CREATE POLICY pattern.
-- Will not duplicate policies or break existing data.

-- ════════════════════════════════════════════════════════════════
-- UP MIGRATION
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- ── Step 1: Revoke dangerous anonymous access ───────────────
-- (Undoes fix-all-permissions.sql)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Grant basic authenticated access (RLS will further restrict)
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Service role bypasses RLS (for API routes, cron jobs, webhooks)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ── Step 2: Enable RLS on ALL tables (skip if table doesn't exist) ──

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'patients','encounters','prescriptions','appointments',
      'opdqueue','opd_queue','bills','beds',
      'clinic_users','clinicusers','clinic_settings','auditlog','audit_log',
      'reminders','hospitalfund','hospital_fund',
      'labpartners','lab_partners'
    ])
  LOOP
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relname = tbl AND n.nspname = 'public' AND c.relkind = 'r') THEN
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped ENABLE RLS on %: %', tbl, SQLERRM;
    END;
  END LOOP;
END $$;

-- Enable on tables that may or may not exist (safe with DO block)
DO $$
BEGIN
  EXECUTE 'ALTER TABLE IF EXISTS labreports ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS doctoralerts ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS ancregistrations ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS ancvisits ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS ipdadmissions ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS ipdnursing ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS dischargesummaries ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS patientallergies ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS attachments ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS portalpatients ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS portalsessions ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS videorooms ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE IF EXISTS payment_attempts ENABLE ROW LEVEL SECURITY';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Some optional tables not found — skipping RLS enable for them';
END $$;

-- ── Step 3: Create RLS Policies (safely — only if target table exists) ──
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT * FROM (VALUES
      -- (table, policy_name, command, predicate, with_check)
      ('patients',       'patients_select',       'SELECT', 'is_active_user()',     NULL),
      ('patients',       'patients_insert',       'INSERT', NULL,                   'is_active_user()'),
      ('patients',       'patients_update',       'UPDATE', 'is_active_user()',     NULL),
      ('patients',       'patients_delete',       'DELETE', 'is_admin()',           NULL),
      ('encounters',     'encounters_select',     'SELECT', 'is_active_user()',     NULL),
      ('encounters',     'encounters_insert',     'INSERT', NULL,                   'is_active_user()'),
      ('encounters',     'encounters_update',     'UPDATE', 'is_doctor_or_admin()', NULL),
      ('encounters',     'encounters_delete',     'DELETE', 'is_admin()',           NULL),
      ('prescriptions',  'prescriptions_select',  'SELECT', 'is_active_user()',     NULL),
      ('prescriptions',  'prescriptions_insert',  'INSERT', NULL,                   'is_doctor_or_admin()'),
      ('prescriptions',  'prescriptions_update',  'UPDATE', 'is_doctor_or_admin()', NULL),
      ('bills',          'bills_select',          'SELECT', 'is_active_user()',     NULL),
      ('bills',          'bills_insert',          'INSERT', NULL,                   'is_active_user()'),
      ('bills',          'bills_update',          'UPDATE', 'is_active_user()',     NULL),
      ('bills',          'bills_delete',          'DELETE', 'is_admin()',           NULL),
      ('appointments',   'appointments_select',   'SELECT', 'is_active_user()',     NULL),
      ('appointments',   'appointments_insert',   'INSERT', NULL,                   'is_active_user()'),
      ('appointments',   'appointments_update',   'UPDATE', 'is_active_user()',     NULL),
      ('clinic_users',   'clinicusers_select',    'SELECT', 'is_active_user()',     NULL),
      ('clinic_users',   'clinicusers_insert',    'INSERT', NULL,                   'is_admin()'),
      ('clinic_users',   'clinicusers_update',    'UPDATE', 'is_admin()',           NULL),
      ('clinic_settings','clinicsettings_select', 'SELECT', 'is_active_user()',     NULL),
      ('clinic_settings','clinicsettings_upsert', 'INSERT', NULL,                   'is_admin()'),
      ('clinic_settings','clinicsettings_update', 'UPDATE', 'is_admin()',           NULL),
      ('auditlog',       'auditlog_select',       'SELECT', 'is_admin()',           NULL),
      ('auditlog',       'auditlog_insert',       'INSERT', NULL,                   'is_active_user()'),
      ('opdqueue',       'opdqueue_select',       'SELECT', 'is_active_user()',     NULL),
      ('opdqueue',       'opdqueue_insert',       'INSERT', NULL,                   'is_active_user()'),
      ('opdqueue',       'opdqueue_update',       'UPDATE', 'is_active_user()',     NULL),
      ('opdqueue',       'opdqueue_delete',       'DELETE', 'is_active_user()',     NULL),
      ('beds',           'beds_select',           'SELECT', 'is_active_user()',     NULL),
      ('beds',           'beds_all',              'ALL',    'is_active_user()',     'is_active_user()'),
      ('reminders',      'reminders_select',      'SELECT', 'is_active_user()',     NULL),
      ('reminders',      'reminders_all',         'ALL',    'is_active_user()',     'is_active_user()'),
      ('hospitalfund',   'hospitalfund_select',   'SELECT', 'is_active_user()',     NULL),
      ('hospitalfund',   'hospitalfund_insert',   'INSERT', NULL,                   'is_active_user()'),
      ('hospitalfund',   'hospitalfund_update',   'UPDATE', 'is_admin()',           NULL),
      ('labpartners',    'labpartners_select',    'SELECT', 'is_active_user()',     NULL),
      ('labpartners',    'labpartners_all',       'ALL',    'is_admin()',           'is_admin()')
    ) AS x(tbl, policy_name, cmd, predicate, wcheck)
  LOOP
    BEGIN
      -- Skip if the target table doesn't exist (handles either naming convention)
      IF NOT EXISTS (SELECT 1 FROM pg_class c
                     JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE c.relname = pol.tbl AND n.nspname = 'public' AND c.relkind = 'r') THEN
        CONTINUE;
      END IF;

      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policy_name, pol.tbl);

      IF pol.cmd = 'INSERT' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)',
          pol.policy_name, pol.tbl, pol.wcheck);
      ELSIF pol.cmd = 'ALL' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
          pol.policy_name, pol.tbl, pol.predicate, pol.wcheck);
      ELSE
        -- SELECT / UPDATE / DELETE use USING
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR %s TO authenticated USING (%s)',
          pol.policy_name, pol.tbl, pol.cmd, pol.predicate);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped policy % on %: %', pol.policy_name, pol.tbl, SQLERRM;
    END;
  END LOOP;
END $$;

-- ── Step 4: Verify RLS is enabled ───────────────────────────
-- Run this query to verify:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- Record this migration
INSERT INTO schema_migrations (version, name, applied_at, notes)
VALUES ('009', 'enable_rls_policies', NOW(), 'CRITICAL: Enables RLS on all tables. Replaces fix-all-permissions.sql')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ════════════════════════════════════════════════════════════════
-- POST-MIGRATION VERIFICATION
-- ════════════════════════════════════════════════════════════════
-- Run this to verify everything is working:
--
-- 1. Check RLS is enabled:
--    SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
--
-- 2. Test as authenticated user (should work):
--    -- Log in via app, check patient list loads
--
-- 3. Test as anonymous (should FAIL):
--    -- Open Supabase API directly: GET /rest/v1/patients
--    -- Should return empty or 401

-- ════════════════════════════════════════════════════════════════
-- DOWN MIGRATION (documentation only — NEVER run in production)
-- ════════════════════════════════════════════════════════════════
-- WARNING: Running the down migration exposes ALL patient data.
-- Only use for development/testing purposes.
--
-- ALTER TABLE patients DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE encounters DISABLE ROW LEVEL SECURITY;
-- ... (repeat for all tables)
