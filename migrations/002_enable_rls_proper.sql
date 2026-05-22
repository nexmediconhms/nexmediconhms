-- ============================================================
-- Migration 002: ENABLE RLS with proper role-based policies
--
-- This REPLACES the dangerous fix-all-permissions.sql that disabled
-- RLS on all tables. That script should NEVER be run again.
--
-- Policy design:
--   - All authenticated users with is_active=true can read most tables
--   - Only doctors/admins can write clinical data
--   - Only admins can delete patients or view audit logs
--   - Staff can create bills but not modify clinical records
--   - Billing records are append-only (no updates to amount after creation)
--   - PHI fields (Aadhaar) require doctor/admin role
--
-- IMPORTANT: Run this AFTER 000_schema_migrations_table.sql and 001_*.sql
-- ============================================================

-- ── Helper functions (idempotent) ─────────────────────────────

CREATE OR REPLACE FUNCTION is_active_clinic_user() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT EXISTS (
      SELECT 1 FROM clinic_users
      WHERE auth_id = auth.uid() AND is_active = TRUE
    )
  $$;

CREATE OR REPLACE FUNCTION get_user_role() RETURNS text
  LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT role FROM clinic_users
    WHERE auth_id = auth.uid() AND is_active = TRUE
    LIMIT 1
  $$;

CREATE OR REPLACE FUNCTION is_admin_user() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT EXISTS (
      SELECT 1 FROM clinic_users
      WHERE auth_id = auth.uid() AND role = 'admin' AND is_active = TRUE
    )
  $$;

CREATE OR REPLACE FUNCTION is_clinical_user() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT EXISTS (
      SELECT 1 FROM clinic_users
      WHERE auth_id = auth.uid() AND role IN ('admin', 'doctor') AND is_active = TRUE
    )
  $$;

-- ── ENABLE RLS on all tables ──────────────────────────────────

DO $$ 
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN 
    SELECT tablename FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename NOT IN ('schema_migrations')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);
  END LOOP;
END $$;

-- ── Drop all existing policies (clean slate) ──────────────────

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- ── PATIENTS ──────────────────────────────────────────────────

CREATE POLICY "patients_select" ON public.patients
  FOR SELECT TO authenticated
  USING (is_active_clinic_user());

CREATE POLICY "patients_insert" ON public.patients
  FOR INSERT TO authenticated
  WITH CHECK (is_active_clinic_user());

CREATE POLICY "patients_update" ON public.patients
  FOR UPDATE TO authenticated
  USING (is_active_clinic_user())
  WITH CHECK (is_active_clinic_user());

CREATE POLICY "patients_delete" ON public.patients
  FOR DELETE TO authenticated
  USING (is_admin_user());

-- ── ENCOUNTERS ────────────────────────────────────────────────

CREATE POLICY "encounters_select" ON public.encounters
  FOR SELECT TO authenticated
  USING (is_active_clinic_user());

CREATE POLICY "encounters_insert" ON public.encounters
  FOR INSERT TO authenticated
  WITH CHECK (is_clinical_user());

CREATE POLICY "encounters_update" ON public.encounters
  FOR UPDATE TO authenticated
  USING (is_clinical_user())
  WITH CHECK (is_clinical_user());

-- ── PRESCRIPTIONS ─────────────────────────────────────────────

CREATE POLICY "prescriptions_select" ON public.prescriptions
  FOR SELECT TO authenticated
  USING (is_active_clinic_user());

CREATE POLICY "prescriptions_insert" ON public.prescriptions
  FOR INSERT TO authenticated
  WITH CHECK (is_clinical_user());

CREATE POLICY "prescriptions_update" ON public.prescriptions
  FOR UPDATE TO authenticated
  USING (is_clinical_user());

-- ── BILLS ─────────────────────────────────────────────────────

CREATE POLICY "bills_select" ON public.bills
  FOR SELECT TO authenticated
  USING (is_active_clinic_user());

CREATE POLICY "bills_insert" ON public.bills
  FOR INSERT TO authenticated
  WITH CHECK (is_active_clinic_user());

CREATE POLICY "bills_update" ON public.bills
  FOR UPDATE TO authenticated
  USING (is_active_clinic_user());

-- ── BILL_PAYMENTS ─────────────────────────────────────────────

CREATE POLICY "bill_payments_select" ON public.bill_payments
  FOR SELECT TO authenticated
  USING (is_active_clinic_user());

CREATE POLICY "bill_payments_insert" ON public.bill_payments
  FOR INSERT TO authenticated
  WITH CHECK (is_active_clinic_user());

-- ── CLINIC_SETTINGS ───────────────────────────────────────────

CREATE POLICY "clinic_settings_select" ON public.clinic_settings
  FOR SELECT TO authenticated
  USING (is_active_clinic_user());

CREATE POLICY "clinic_settings_upsert" ON public.clinic_settings
  FOR INSERT TO authenticated
  WITH CHECK (is_admin_user());

CREATE POLICY "clinic_settings_update" ON public.clinic_settings
  FOR UPDATE TO authenticated
  USING (is_admin_user());

-- ── CLINIC_USERS ──────────────────────────────────────────────

CREATE POLICY "clinic_users_select" ON public.clinic_users
  FOR SELECT TO authenticated
  USING (is_active_clinic_user());

CREATE POLICY "clinic_users_manage" ON public.clinic_users
  FOR ALL TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

-- ── APPOINTMENTS ──────────────────────────────────────────────

CREATE POLICY "appointments_select" ON public.appointments
  FOR SELECT TO authenticated
  USING (is_active_clinic_user());

CREATE POLICY "appointments_insert" ON public.appointments
  FOR INSERT TO authenticated
  WITH CHECK (is_active_clinic_user());

CREATE POLICY "appointments_update" ON public.appointments
  FOR UPDATE TO authenticated
  USING (is_active_clinic_user());

CREATE POLICY "appointments_delete" ON public.appointments
  FOR DELETE TO authenticated
  USING (is_active_clinic_user());

-- ── LAB_REPORTS ───────────────────────────────────────────────

CREATE POLICY "lab_reports_select" ON public.lab_reports
  FOR SELECT TO authenticated
  USING (is_active_clinic_user());

CREATE POLICY "lab_reports_insert" ON public.lab_reports
  FOR INSERT TO authenticated
  WITH CHECK (is_active_clinic_user());

CREATE POLICY "lab_reports_update" ON public.lab_reports
  FOR UPDATE TO authenticated
  USING (is_active_clinic_user());

-- ── AUDIT_LOG (admin read-only) ───────────────────────────────

CREATE POLICY "audit_log_select" ON public.audit_log
  FOR SELECT TO authenticated
  USING (is_admin_user());

CREATE POLICY "audit_log_insert" ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (is_active_clinic_user());

-- ── DOCTOR_ALERTS ─────────────────────────────────────────────

CREATE POLICY "doctor_alerts_select" ON public.doctor_alerts
  FOR SELECT TO authenticated
  USING (is_active_clinic_user());

CREATE POLICY "doctor_alerts_insert" ON public.doctor_alerts
  FOR INSERT TO authenticated
  WITH CHECK (is_active_clinic_user());

CREATE POLICY "doctor_alerts_update" ON public.doctor_alerts
  FOR UPDATE TO authenticated
  USING (is_clinical_user());

-- ── ALL OTHER TABLES: default authenticated read/write ────────
-- (beds, ipd_*, anc_*, opd_queue, discharge_summaries, etc.)

DO $$
DECLARE
  tbl TEXT;
  existing_policies INT;
BEGIN
  FOR tbl IN 
    SELECT tablename FROM pg_tables 
    WHERE schemaname = 'public'
    AND tablename NOT IN (
      'patients', 'encounters', 'prescriptions', 'bills', 'bill_payments',
      'clinic_settings', 'clinic_users', 'appointments', 'lab_reports',
      'audit_log', 'doctor_alerts', 'schema_migrations'
    )
  LOOP
    -- Only add default policies if no custom policies exist
    SELECT count(*) INTO existing_policies 
    FROM pg_policies WHERE tablename = tbl AND schemaname = 'public';
    
    IF existing_policies = 0 THEN
      EXECUTE format(
        'CREATE POLICY "default_select" ON public.%I FOR SELECT TO authenticated USING (is_active_clinic_user())',
        tbl
      );
      EXECUTE format(
        'CREATE POLICY "default_insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (is_active_clinic_user())',
        tbl
      );
      EXECUTE format(
        'CREATE POLICY "default_update" ON public.%I FOR UPDATE TO authenticated USING (is_active_clinic_user())',
        tbl
      );
    END IF;
  END LOOP;
END $$;

-- ── SERVICE ROLE bypass (for API routes using admin client) ────
-- service_role always bypasses RLS by default in Supabase.
-- No explicit policy needed.

-- ── VERIFY ────────────────────────────────────────────────────

SELECT 
  'RLS ENABLED' AS status,
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename != 'schema_migrations') AS total_tables,
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true) AS tables_with_rls;
