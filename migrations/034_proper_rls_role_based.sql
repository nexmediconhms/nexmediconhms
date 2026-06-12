-- ═══════════════════════════════════════════════════════════════════════
-- Migration 034: Proper Role-Based RLS Policies (Issue 4 Fix)
-- ═══════════════════════════════════════════════════════════════════════
-- v2: Fixes bugs found in static review of v1:
--   - current_clinic_user() used RETURN QUERY + EXCEPTION fallback — that
--     pattern doesn't actually catch missing-table errors at runtime.
--     Replaced with single SELECT against the actual table after detecting
--     which name exists at function-creation time.
--   - Added SET search_path = public, pg_temp to all SECURITY DEFINER
--     functions (Supabase security linter requirement).
--   - Pre-flight check: confirms at least one admin user exists before
--     installing policies (otherwise RLS could lock everyone out).
--   - Helper functions now CHECK if their dependencies exist and gracefully
--     skip on missing tables.
--
-- DEPENDENCY: Run migration 033 BEFORE this one. 033 creates the
-- clinic_users view if only clinicusers exists (or vice versa), so this
-- migration can reliably query `clinic_users`.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Step 0: Pre-flight safety check ────────────────────────────────────
-- Verify at least one admin exists. RLS without an admin = locked out.
DO $$
DECLARE
  admin_count INTEGER;
  cu_table_exists BOOLEAN;
BEGIN
  -- Detect which name is the actual table (not view)
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('clinic_users','clinicusers')
    AND table_type='BASE TABLE')
    INTO cu_table_exists;

  IF NOT cu_table_exists THEN
    RAISE EXCEPTION 'PRE-FLIGHT FAILED: Neither clinic_users nor clinicusers table exists. Run earlier migrations first.';
  END IF;

  -- Count admins (try both names)
  BEGIN
    EXECUTE 'SELECT COUNT(*) FROM public.clinic_users WHERE role = $1 AND COALESCE(is_active, true) = true'
      INTO admin_count USING 'admin';
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      EXECUTE 'SELECT COUNT(*) FROM public.clinicusers WHERE role = $1 AND COALESCE(is_active, true) = true'
        INTO admin_count USING 'admin';
    EXCEPTION WHEN OTHERS THEN
      admin_count := 0;
    END;
  END;

  IF admin_count = 0 THEN
    RAISE EXCEPTION 'PRE-FLIGHT FAILED: No active admin user found. Create at least one admin before applying RLS, or you will be locked out.';
  END IF;

  RAISE NOTICE 'Pre-flight OK: % active admin user(s) found.', admin_count;
END $$;

-- ─── Step 1: Helper functions ───────────────────────────────────────────
-- These detect at creation time whether to query clinic_users or clinicusers.
-- We use a wrapper that tries both, but only at CREATE-TIME (not per-call).

DO $$
DECLARE
  cu_table TEXT;
  fn_body TEXT;
BEGIN
  -- Pick the actual base table name (prefer underscore version)
  IF EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='clinic_users' AND table_type='BASE TABLE') THEN
    cu_table := 'clinic_users';
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='clinicusers' AND table_type='BASE TABLE') THEN
    cu_table := 'clinicusers';
  ELSE
    RAISE EXCEPTION 'Cannot locate clinic_users base table';
  END IF;

  -- Build current_clinic_user() function pointing at the real table
  fn_body := format($f$
    CREATE OR REPLACE FUNCTION public.current_clinic_user()
    RETURNS TABLE (id UUID, role TEXT, is_active BOOLEAN) AS $body$
      SELECT cu.id, cu.role, COALESCE(cu.is_active, true)::BOOLEAN
      FROM public.%I cu
      WHERE cu.auth_id = auth.uid()
      LIMIT 1
    $body$ LANGUAGE sql SECURITY DEFINER STABLE
    SET search_path = public, pg_temp;
  $f$, cu_table);
  EXECUTE fn_body;

  RAISE NOTICE 'current_clinic_user() bound to %', cu_table;
END $$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.current_clinic_user() WHERE role = 'admin'
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.is_doctor_or_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.current_clinic_user() WHERE role IN ('admin','doctor')
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.is_staff_or_above()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.current_clinic_user() WHERE role IN ('admin','doctor','staff')
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.is_lab_partner()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.current_clinic_user() WHERE role = 'lab_partner'
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE
   SET search_path = public, pg_temp;

-- ─── Step 2: Demote wide-open policies (rollback safety) ────────────────
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname='public' AND policyname LIKE 'allow_auth_%'
      AND policyname NOT LIKE '%_DEPRECATED'
  LOOP
    EXECUTE format('ALTER POLICY %I ON %I.%I RENAME TO %I',
      pol.policyname, pol.schemaname, pol.tablename,
      pol.policyname || '_DEPRECATED');
    RAISE NOTICE 'Renamed wide-open policy: %.% → %_DEPRECATED',
      pol.tablename, pol.policyname, pol.policyname;
  END LOOP;
END $$;

-- ─── Step 3: Generic helper to apply a policy set to a table ────────────
-- Avoids hundreds of lines of repetition.
CREATE OR REPLACE FUNCTION apply_role_policies(
  p_table TEXT,
  p_select_pred TEXT,
  p_insert_pred TEXT,
  p_update_pred TEXT,
  p_delete_pred TEXT
) RETURNS VOID AS $$
BEGIN
  -- Skip if table missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name=p_table AND table_type='BASE TABLE') THEN
    RAISE NOTICE 'apply_role_policies: table % missing, skipping', p_table;
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_table);

  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p_table || '_select', p_table);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p_table || '_insert', p_table);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p_table || '_update', p_table);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p_table || '_delete', p_table);

  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (%s)',
    p_table || '_select', p_table, p_select_pred);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (%s)',
    p_table || '_insert', p_table, p_insert_pred);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (%s)',
    p_table || '_update', p_table, p_update_pred);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (%s)',
    p_table || '_delete', p_table, p_delete_pred);

  RAISE NOTICE 'Applied role policies to %', p_table;
END;
$$ LANGUAGE plpgsql;

-- ─── Step 4: Apply policies to each table ───────────────────────────────
DO $$
BEGIN
  -- Standard staff-can-CRUD, only admin can delete:
  PERFORM apply_role_policies('patients',
    'public.is_staff_or_above() OR public.is_lab_partner()',
    'public.is_staff_or_above()',
    'public.is_staff_or_above()',
    'public.is_admin()');

  PERFORM apply_role_policies('bills',
    'public.is_staff_or_above()',
    'public.is_staff_or_above()',
    'public.is_staff_or_above()',
    'public.is_admin()');

  -- Payments are immutable except by admin
  PERFORM apply_role_policies('bill_payments',
    'public.is_staff_or_above()',
    'public.is_staff_or_above()',
    'public.is_admin()',
    'public.is_admin()');

  PERFORM apply_role_policies('encounters',
    'public.is_staff_or_above()',
    'public.is_staff_or_above()',
    'public.is_staff_or_above()',
    'public.is_admin()');

  PERFORM apply_role_policies('ipd_admissions',
    'public.is_staff_or_above()',
    'public.is_staff_or_above()',
    'public.is_staff_or_above()',
    'public.is_admin()');

  PERFORM apply_role_policies('lab_orders',
    'public.is_staff_or_above() OR public.is_lab_partner()',
    'public.is_staff_or_above()',
    'public.is_staff_or_above() OR public.is_lab_partner()',
    'public.is_admin()');

  -- Only doctors write prescriptions
  PERFORM apply_role_policies('prescriptions',
    'public.is_staff_or_above()',
    'public.is_doctor_or_admin()',
    'public.is_doctor_or_admin()',
    'public.is_admin()');

  PERFORM apply_role_policies('appointments',
    'public.is_staff_or_above()',
    'public.is_staff_or_above()',
    'public.is_staff_or_above()',
    'public.is_staff_or_above()');

  -- New tables from Phase 1-3 billing
  PERFORM apply_role_policies('patient_deposits',
    'public.is_staff_or_above()',
    'public.is_staff_or_above()',
    'public.is_staff_or_above()',
    'public.is_admin()');

  PERFORM apply_role_policies('credit_notes',
    'public.is_staff_or_above()',
    'public.is_staff_or_above()',
    'public.is_staff_or_above()',
    'public.is_admin()');

  PERFORM apply_role_policies('bill_payers',
    'public.is_staff_or_above()',
    'public.is_staff_or_above()',
    'public.is_staff_or_above()',
    'public.is_admin()');

  PERFORM apply_role_policies('billing_templates',
    'public.is_staff_or_above()',
    'public.is_admin()',
    'public.is_admin()',
    'public.is_admin()');

  PERFORM apply_role_policies('insurance_claims',
    'public.is_staff_or_above()',
    'public.is_staff_or_above()',
    'public.is_staff_or_above()',
    'public.is_admin()');
END $$;

-- ─── Step 5: clinic_users — admin manages, all read own ─────────────────
DO $$
DECLARE cu_tbl TEXT;
BEGIN
  -- Apply to whichever is the base table
  IF EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='clinic_users' AND table_type='BASE TABLE') THEN
    cu_tbl := 'clinic_users';
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='clinicusers' AND table_type='BASE TABLE') THEN
    cu_tbl := 'clinicusers';
  ELSE
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', cu_tbl);

  EXECUTE format('DROP POLICY IF EXISTS clinic_users_select ON public.%I', cu_tbl);
  EXECUTE format('DROP POLICY IF EXISTS clinic_users_insert ON public.%I', cu_tbl);
  EXECUTE format('DROP POLICY IF EXISTS clinic_users_update ON public.%I', cu_tbl);
  EXECUTE format('DROP POLICY IF EXISTS clinic_users_delete ON public.%I', cu_tbl);

  EXECUTE format(
    'CREATE POLICY clinic_users_select ON public.%I FOR SELECT USING (public.is_staff_or_above() OR auth_id = auth.uid())',
    cu_tbl);
  EXECUTE format(
    'CREATE POLICY clinic_users_insert ON public.%I FOR INSERT WITH CHECK (public.is_admin())',
    cu_tbl);
  EXECUTE format(
    'CREATE POLICY clinic_users_update ON public.%I FOR UPDATE USING (public.is_admin() OR auth_id = auth.uid())',
    cu_tbl);
  EXECUTE format(
    'CREATE POLICY clinic_users_delete ON public.%I FOR DELETE USING (public.is_admin())',
    cu_tbl);
END $$;

-- ─── Step 6: clinic_settings — admin writes, all staff read ─────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='clinic_settings' AND table_type='BASE TABLE') THEN
    RETURN;
  END IF;

  ALTER TABLE public.clinic_settings ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS clinic_settings_select ON public.clinic_settings;
  DROP POLICY IF EXISTS clinic_settings_insert ON public.clinic_settings;
  DROP POLICY IF EXISTS clinic_settings_update ON public.clinic_settings;
  DROP POLICY IF EXISTS clinic_settings_delete ON public.clinic_settings;

  CREATE POLICY clinic_settings_select ON public.clinic_settings
    FOR SELECT USING (public.is_staff_or_above());
  CREATE POLICY clinic_settings_insert ON public.clinic_settings
    FOR INSERT WITH CHECK (public.is_admin());
  CREATE POLICY clinic_settings_update ON public.clinic_settings
    FOR UPDATE USING (public.is_admin());
  CREATE POLICY clinic_settings_delete ON public.clinic_settings
    FOR DELETE USING (public.is_admin());
END $$;

-- ─── Step 7: audit_log — immutable, admin reads ─────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='audit_log' AND table_type='BASE TABLE') THEN
    RETURN;
  END IF;

  ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS audit_log_select ON public.audit_log;
  DROP POLICY IF EXISTS audit_log_insert ON public.audit_log;
  -- Intentionally no UPDATE / DELETE policies → these operations
  -- are silently disallowed by RLS for non-superusers. Audit log is immutable.

  CREATE POLICY audit_log_select ON public.audit_log
    FOR SELECT USING (public.is_admin());
  CREATE POLICY audit_log_insert ON public.audit_log
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
END $$;

-- ─── Step 8: Record migration ──────────────────────────────────────────
INSERT INTO schema_migrations (version, name, applied_at)
VALUES ('034', 'proper_rls_role_based_v2', NOW())
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFICATION:
--   -- All new role-based policies:
--   SELECT tablename, policyname FROM pg_policies
--   WHERE schemaname='public' AND policyname NOT LIKE '%_DEPRECATED'
--   ORDER BY tablename, policyname;
--
--   -- The demoted wide-open policies (kept for rollback):
--   SELECT tablename, policyname FROM pg_policies
--   WHERE schemaname='public' AND policyname LIKE '%_DEPRECATED';
--
-- ROLLBACK (emergency only):
--   DO $$ DECLARE p RECORD; BEGIN
--     FOR p IN SELECT tablename, policyname FROM pg_policies
--              WHERE schemaname='public' AND policyname LIKE '%_DEPRECATED'
--     LOOP
--       EXECUTE format('ALTER POLICY %I ON public.%I RENAME TO %I',
--         p.policyname, p.tablename, REPLACE(p.policyname, '_DEPRECATED', ''));
--     END LOOP;
--   END $$;
-- ═══════════════════════════════════════════════════════════════════════
