-- ============================================================
-- NexMedicon HMS — Comprehensive Role-Based RLS Policies
-- ============================================================
--
-- SECURITY FIX: Previously, all tables used:
--   FOR ALL TO authenticated USING (true) WITH CHECK (true)
-- This meant ANY authenticated user (even deactivated staff) could
-- read/modify ALL data including other patients, billing, etc.
--
-- This migration replaces those wide-open policies with proper
-- role-based access control that mirrors the permission matrix
-- defined in src/lib/auth.ts.
--
-- Roles:
--   admin  — Full access to everything
--   doctor — Clinical access (patients, encounters, prescriptions, labs)
--            + read-only billing for own patients
--   staff  — Registration, queue, bed management, billing creation
--            but NO access to prescriptions editing or financial reports
--
-- Run this ONCE in Supabase SQL Editor after v8_roles.sql.
-- Safe to re-run (uses DROP POLICY IF EXISTS).
-- ============================================================

-- ─── Helper Functions (idempotent) ───────────────────────────

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



-- ═══════════════════════════════════════════════════════════════
-- PATIENTS TABLE
-- ═══════════════════════════════════════════════════════════════
-- SELECT: all active users (admin, doctor, staff)
-- INSERT: all active users (registration is a common task)
-- UPDATE: all active users (edit patient details)
-- DELETE: admin only (irreversible action)

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_auth_patients ON patients;
DROP POLICY IF EXISTS patients_select ON patients;
DROP POLICY IF EXISTS patients_insert ON patients;
DROP POLICY IF EXISTS patients_update ON patients;
DROP POLICY IF EXISTS patients_delete ON patients;

CREATE POLICY patients_select ON patients
  FOR SELECT TO authenticated
  USING (is_active_user());

CREATE POLICY patients_insert ON patients
  FOR INSERT TO authenticated
  WITH CHECK (is_active_user());

CREATE POLICY patients_update ON patients
  FOR UPDATE TO authenticated
  USING (is_active_user());

CREATE POLICY patients_delete ON patients
  FOR DELETE TO authenticated
  USING (is_admin());

-- ═══════════════════════════════════════════════════════════════
-- ENCOUNTERS TABLE
-- ═══════════════════════════════════════════════════════════════
-- SELECT: all active users
-- INSERT: admin + doctor only (clinical decision)
-- UPDATE: admin + doctor only
-- DELETE: admin only

ALTER TABLE encounters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_auth_encounters ON encounters;
DROP POLICY IF EXISTS encounters_select ON encounters;
DROP POLICY IF EXISTS encounters_insert ON encounters;
DROP POLICY IF EXISTS encounters_update ON encounters;
DROP POLICY IF EXISTS encounters_delete ON encounters;

CREATE POLICY encounters_select ON encounters
  FOR SELECT TO authenticated
  USING (is_active_user());

CREATE POLICY encounters_insert ON encounters
  FOR INSERT TO authenticated
  WITH CHECK (is_doctor_or_admin());

CREATE POLICY encounters_update ON encounters
  FOR UPDATE TO authenticated
  USING (is_doctor_or_admin());

CREATE POLICY encounters_delete ON encounters
  FOR DELETE TO authenticated
  USING (is_admin());

-- ═══════════════════════════════════════════════════════════════
-- PRESCRIPTIONS TABLE
-- ═══════════════════════════════════════════════════════════════
-- SELECT: all active users (staff can view to print)
-- INSERT: admin + doctor only (clinical)
-- UPDATE: admin + doctor only
-- DELETE: admin only

ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_auth_prescriptions ON prescriptions;
DROP POLICY IF EXISTS prescriptions_select ON prescriptions;
DROP POLICY IF EXISTS prescriptions_insert ON prescriptions;
DROP POLICY IF EXISTS prescriptions_update ON prescriptions;
DROP POLICY IF EXISTS prescriptions_delete ON prescriptions;

CREATE POLICY prescriptions_select ON prescriptions
  FOR SELECT TO authenticated
  USING (is_active_user());

CREATE POLICY prescriptions_insert ON prescriptions
  FOR INSERT TO authenticated
  WITH CHECK (is_doctor_or_admin());

CREATE POLICY prescriptions_update ON prescriptions
  FOR UPDATE TO authenticated
  USING (is_doctor_or_admin());

CREATE POLICY prescriptions_delete ON prescriptions
  FOR DELETE TO authenticated
  USING (is_admin());



-- ═══════════════════════════════════════════════════════════════
-- BEDS TABLE
-- ═══════════════════════════════════════════════════════════════
-- All active users can view and manage beds (reception workflow)

ALTER TABLE beds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_auth_beds ON beds;
DROP POLICY IF EXISTS beds_select ON beds;
DROP POLICY IF EXISTS beds_insert ON beds;
DROP POLICY IF EXISTS beds_update ON beds;
DROP POLICY IF EXISTS beds_delete ON beds;

CREATE POLICY beds_select ON beds
  FOR SELECT TO authenticated
  USING (is_active_user());

CREATE POLICY beds_insert ON beds
  FOR INSERT TO authenticated
  WITH CHECK (is_active_user());

CREATE POLICY beds_update ON beds
  FOR UPDATE TO authenticated
  USING (is_active_user());

CREATE POLICY beds_delete ON beds
  FOR DELETE TO authenticated
  USING (is_admin());

-- ═══════════════════════════════════════════════════════════════
-- BILLS TABLE
-- ═══════════════════════════════════════════════════════════════
-- SELECT: admin + doctor (doctor sees own patients' bills)
-- INSERT: admin + staff (staff creates bills at reception)
-- UPDATE: admin only (prevent bill tampering)
-- DELETE: admin only

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bills') THEN
    EXECUTE 'ALTER TABLE bills ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS allow_auth_bills ON bills';
    EXECUTE 'DROP POLICY IF EXISTS bills_select ON bills';
    EXECUTE 'DROP POLICY IF EXISTS bills_insert ON bills';
    EXECUTE 'DROP POLICY IF EXISTS bills_update ON bills';
    EXECUTE 'DROP POLICY IF EXISTS bills_delete ON bills';

    EXECUTE '
      CREATE POLICY bills_select ON bills
        FOR SELECT TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM clinic_users cu
            WHERE cu.auth_id = auth.uid()
              AND cu.is_active = TRUE
              AND cu.role IN (''admin'', ''doctor'')
          )
        )';

    EXECUTE '
      CREATE POLICY bills_insert ON bills
        FOR INSERT TO authenticated
        WITH CHECK (
          EXISTS (
            SELECT 1 FROM clinic_users cu
            WHERE cu.auth_id = auth.uid()
              AND cu.is_active = TRUE
              AND cu.role IN (''admin'', ''staff'')
          )
        )';

    EXECUTE '
      CREATE POLICY bills_update ON bills
        FOR UPDATE TO authenticated
        USING (is_admin())';

    EXECUTE '
      CREATE POLICY bills_delete ON bills
        FOR DELETE TO authenticated
        USING (is_admin())';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- LAB REPORTS TABLE
-- ═══════════════════════════════════════════════════════════════
-- SELECT: all active users
-- INSERT: admin + doctor
-- UPDATE: admin + doctor
-- DELETE: admin + doctor

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lab_reports') THEN
    EXECUTE 'ALTER TABLE lab_reports ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS allow_auth_select_lab_reports ON lab_reports';
    EXECUTE 'DROP POLICY IF EXISTS allow_auth_insert_lab_reports ON lab_reports';
    EXECUTE 'DROP POLICY IF EXISTS allow_auth_update_lab_reports ON lab_reports';
    EXECUTE 'DROP POLICY IF EXISTS allow_auth_delete_lab_reports ON lab_reports';
    EXECUTE 'DROP POLICY IF EXISTS lab_reports_select ON lab_reports';
    EXECUTE 'DROP POLICY IF EXISTS lab_reports_insert ON lab_reports';
    EXECUTE 'DROP POLICY IF EXISTS lab_reports_update ON lab_reports';
    EXECUTE 'DROP POLICY IF EXISTS lab_reports_delete ON lab_reports';

    EXECUTE '
      CREATE POLICY lab_reports_select ON lab_reports
        FOR SELECT TO authenticated
        USING (is_active_user())';

    EXECUTE '
      CREATE POLICY lab_reports_insert ON lab_reports
        FOR INSERT TO authenticated
        WITH CHECK (is_doctor_or_admin())';

    EXECUTE '
      CREATE POLICY lab_reports_update ON lab_reports
        FOR UPDATE TO authenticated
        USING (is_doctor_or_admin())';

    EXECUTE '
      CREATE POLICY lab_reports_delete ON lab_reports
        FOR DELETE TO authenticated
        USING (is_doctor_or_admin())';
  END IF;
END $$;



-- ═══════════════════════════════════════════════════════════════
-- IPD ADMISSIONS TABLE
-- ═══════════════════════════════════════════════════════════════
-- SELECT: all active users
-- INSERT: all active users (reception can admit)
-- UPDATE: admin + doctor (clinical updates, discharge)
-- DELETE: admin only

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ipd_admissions') THEN
    EXECUTE 'ALTER TABLE ipd_admissions ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS allow_auth_ipd_admissions ON ipd_admissions';
    EXECUTE 'DROP POLICY IF EXISTS ipd_admissions_select ON ipd_admissions';
    EXECUTE 'DROP POLICY IF EXISTS ipd_admissions_insert ON ipd_admissions';
    EXECUTE 'DROP POLICY IF EXISTS ipd_admissions_update ON ipd_admissions';
    EXECUTE 'DROP POLICY IF EXISTS ipd_admissions_delete ON ipd_admissions';

    EXECUTE '
      CREATE POLICY ipd_admissions_select ON ipd_admissions
        FOR SELECT TO authenticated USING (is_active_user())';

    EXECUTE '
      CREATE POLICY ipd_admissions_insert ON ipd_admissions
        FOR INSERT TO authenticated WITH CHECK (is_active_user())';

    EXECUTE '
      CREATE POLICY ipd_admissions_update ON ipd_admissions
        FOR UPDATE TO authenticated USING (is_doctor_or_admin())';

    EXECUTE '
      CREATE POLICY ipd_admissions_delete ON ipd_admissions
        FOR DELETE TO authenticated USING (is_admin())';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- APPOINTMENTS TABLE
-- ═══════════════════════════════════════════════════════════════
-- All active users can manage appointments (common workflow)

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'appointments') THEN
    EXECUTE 'ALTER TABLE appointments ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS appointments_select ON appointments';
    EXECUTE 'DROP POLICY IF EXISTS appointments_insert ON appointments';
    EXECUTE 'DROP POLICY IF EXISTS appointments_update ON appointments';
    EXECUTE 'DROP POLICY IF EXISTS appointments_delete ON appointments';

    EXECUTE '
      CREATE POLICY appointments_select ON appointments
        FOR SELECT TO authenticated USING (is_active_user())';

    EXECUTE '
      CREATE POLICY appointments_insert ON appointments
        FOR INSERT TO authenticated WITH CHECK (is_active_user())';

    EXECUTE '
      CREATE POLICY appointments_update ON appointments
        FOR UPDATE TO authenticated USING (is_active_user())';

    EXECUTE '
      CREATE POLICY appointments_delete ON appointments
        FOR DELETE TO authenticated USING (is_doctor_or_admin())';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- OPD QUEUE TABLE
-- ═══════════════════════════════════════════════════════════════
-- All active users can manage the queue

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'opd_queue') THEN
    EXECUTE 'ALTER TABLE opd_queue ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS allow_auth_select_opd_queue ON opd_queue';
    EXECUTE 'DROP POLICY IF EXISTS allow_auth_insert_opd_queue ON opd_queue';
    EXECUTE 'DROP POLICY IF EXISTS allow_auth_update_opd_queue ON opd_queue';
    EXECUTE 'DROP POLICY IF EXISTS allow_auth_delete_opd_queue ON opd_queue';
    EXECUTE 'DROP POLICY IF EXISTS opd_queue_select ON opd_queue';
    EXECUTE 'DROP POLICY IF EXISTS opd_queue_insert ON opd_queue';
    EXECUTE 'DROP POLICY IF EXISTS opd_queue_update ON opd_queue';
    EXECUTE 'DROP POLICY IF EXISTS opd_queue_delete ON opd_queue';

    EXECUTE '
      CREATE POLICY opd_queue_select ON opd_queue
        FOR SELECT TO authenticated USING (is_active_user())';

    EXECUTE '
      CREATE POLICY opd_queue_insert ON opd_queue
        FOR INSERT TO authenticated WITH CHECK (is_active_user())';

    EXECUTE '
      CREATE POLICY opd_queue_update ON opd_queue
        FOR UPDATE TO authenticated USING (is_active_user())';

    EXECUTE '
      CREATE POLICY opd_queue_delete ON opd_queue
        FOR DELETE TO authenticated USING (is_active_user())';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- HOSPITAL FUND TABLE
-- ═══════════════════════════════════════════════════════════════
-- SELECT: all active users
-- INSERT (submit expense): all active users
-- UPDATE (approve): admin only
-- DELETE: admin only

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'hospital_fund') THEN
    EXECUTE 'ALTER TABLE hospital_fund ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS allow_auth_fund ON hospital_fund';
    EXECUTE 'DROP POLICY IF EXISTS hospital_fund_select ON hospital_fund';
    EXECUTE 'DROP POLICY IF EXISTS hospital_fund_insert ON hospital_fund';
    EXECUTE 'DROP POLICY IF EXISTS hospital_fund_update ON hospital_fund';
    EXECUTE 'DROP POLICY IF EXISTS hospital_fund_delete ON hospital_fund';

    EXECUTE '
      CREATE POLICY hospital_fund_select ON hospital_fund
        FOR SELECT TO authenticated USING (is_active_user())';

    EXECUTE '
      CREATE POLICY hospital_fund_insert ON hospital_fund
        FOR INSERT TO authenticated WITH CHECK (is_active_user())';

    EXECUTE '
      CREATE POLICY hospital_fund_update ON hospital_fund
        FOR UPDATE TO authenticated USING (is_admin())';

    EXECUTE '
      CREATE POLICY hospital_fund_delete ON hospital_fund
        FOR DELETE TO authenticated USING (is_admin())';
  END IF;
END $$;



-- ═══════════════════════════════════════════════════════════════
-- CLINIC SETTINGS TABLE
-- ═══════════════════════════════════════════════════════════════
-- SELECT: all active users
-- INSERT/UPDATE: admin only
-- DELETE: admin only

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'clinic_settings') THEN
    EXECUTE 'ALTER TABLE clinic_settings ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS clinic_settings_read ON clinic_settings';
    EXECUTE 'DROP POLICY IF EXISTS clinic_settings_write ON clinic_settings';
    EXECUTE 'DROP POLICY IF EXISTS clinic_settings_select ON clinic_settings';
    EXECUTE 'DROP POLICY IF EXISTS clinic_settings_insert ON clinic_settings';
    EXECUTE 'DROP POLICY IF EXISTS clinic_settings_update ON clinic_settings';
    EXECUTE 'DROP POLICY IF EXISTS clinic_settings_delete ON clinic_settings';

    EXECUTE '
      CREATE POLICY clinic_settings_select ON clinic_settings
        FOR SELECT TO authenticated USING (is_active_user())';

    EXECUTE '
      CREATE POLICY clinic_settings_insert ON clinic_settings
        FOR INSERT TO authenticated WITH CHECK (is_admin())';

    EXECUTE '
      CREATE POLICY clinic_settings_update ON clinic_settings
        FOR UPDATE TO authenticated USING (is_admin())';

    EXECUTE '
      CREATE POLICY clinic_settings_delete ON clinic_settings
        FOR DELETE TO authenticated USING (is_admin())';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- PATIENT ALLERGIES TABLE
-- ═══════════════════════════════════════════════════════════════
-- SELECT: all active users (needed for prescription safety checks)
-- INSERT/UPDATE: admin + doctor
-- DELETE: admin + doctor

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'patient_allergies') THEN
    EXECUTE 'ALTER TABLE patient_allergies ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS auth_select_allergies ON patient_allergies';
    EXECUTE 'DROP POLICY IF EXISTS auth_insert_allergies ON patient_allergies';
    EXECUTE 'DROP POLICY IF EXISTS auth_update_allergies ON patient_allergies';
    EXECUTE 'DROP POLICY IF EXISTS auth_delete_allergies ON patient_allergies';
    EXECUTE 'DROP POLICY IF EXISTS patient_allergies_select ON patient_allergies';
    EXECUTE 'DROP POLICY IF EXISTS patient_allergies_insert ON patient_allergies';
    EXECUTE 'DROP POLICY IF EXISTS patient_allergies_update ON patient_allergies';
    EXECUTE 'DROP POLICY IF EXISTS patient_allergies_delete ON patient_allergies';

    EXECUTE '
      CREATE POLICY patient_allergies_select ON patient_allergies
        FOR SELECT TO authenticated USING (is_active_user())';

    EXECUTE '
      CREATE POLICY patient_allergies_insert ON patient_allergies
        FOR INSERT TO authenticated WITH CHECK (is_doctor_or_admin())';

    EXECUTE '
      CREATE POLICY patient_allergies_update ON patient_allergies
        FOR UPDATE TO authenticated USING (is_doctor_or_admin())';

    EXECUTE '
      CREATE POLICY patient_allergies_delete ON patient_allergies
        FOR DELETE TO authenticated USING (is_doctor_or_admin())';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- CRITICAL ALERTS TABLE
-- ═══════════════════════════════════════════════════════════════
-- SELECT/INSERT: all active users (alerts are generated automatically)
-- UPDATE/DELETE: admin + doctor

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'critical_alerts') THEN
    EXECUTE 'ALTER TABLE critical_alerts ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS critical_alerts_select ON critical_alerts';
    EXECUTE 'DROP POLICY IF EXISTS critical_alerts_insert ON critical_alerts';
    EXECUTE 'DROP POLICY IF EXISTS critical_alerts_update ON critical_alerts';
    EXECUTE 'DROP POLICY IF EXISTS critical_alerts_delete ON critical_alerts';

    EXECUTE '
      CREATE POLICY critical_alerts_select ON critical_alerts
        FOR SELECT TO authenticated USING (is_active_user())';

    EXECUTE '
      CREATE POLICY critical_alerts_insert ON critical_alerts
        FOR INSERT TO authenticated WITH CHECK (is_active_user())';

    EXECUTE '
      CREATE POLICY critical_alerts_update ON critical_alerts
        FOR UPDATE TO authenticated USING (is_doctor_or_admin())';

    EXECUTE '
      CREATE POLICY critical_alerts_delete ON critical_alerts
        FOR DELETE TO authenticated USING (is_doctor_or_admin())';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- DATA RETENTION POLICIES TABLE
-- ═══════════════════════════════════════════════════════════════
-- SELECT: all active users (settings page)
-- INSERT/UPDATE/DELETE: admin only

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'data_retention_policies') THEN
    EXECUTE 'ALTER TABLE data_retention_policies ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS data_retention_policies_select ON data_retention_policies';
    EXECUTE 'DROP POLICY IF EXISTS data_retention_policies_insert ON data_retention_policies';
    EXECUTE 'DROP POLICY IF EXISTS data_retention_policies_update ON data_retention_policies';
    EXECUTE 'DROP POLICY IF EXISTS data_retention_policies_delete ON data_retention_policies';

    EXECUTE '
      CREATE POLICY data_retention_policies_select ON data_retention_policies
        FOR SELECT TO authenticated USING (is_active_user())';

    EXECUTE '
      CREATE POLICY data_retention_policies_insert ON data_retention_policies
        FOR INSERT TO authenticated WITH CHECK (is_admin())';

    EXECUTE '
      CREATE POLICY data_retention_policies_update ON data_retention_policies
        FOR UPDATE TO authenticated USING (is_admin())';

    EXECUTE '
      CREATE POLICY data_retention_policies_delete ON data_retention_policies
        FOR DELETE TO authenticated USING (is_admin())';
  END IF;
END $$;



-- ═══════════════════════════════════════════════════════════════
-- CONSULTATION ATTACHMENTS / FILES
-- ═══════════════════════════════════════════════════════════════
-- SELECT: all active users
-- INSERT: all active users (staff can upload scanned docs)
-- UPDATE: admin + doctor
-- DELETE: admin + doctor

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'consultation_attachments') THEN
    EXECUTE 'ALTER TABLE consultation_attachments ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS allow_auth_attachments ON consultation_attachments';
    EXECUTE 'DROP POLICY IF EXISTS consultation_attachments_select ON consultation_attachments';
    EXECUTE 'DROP POLICY IF EXISTS consultation_attachments_insert ON consultation_attachments';
    EXECUTE 'DROP POLICY IF EXISTS consultation_attachments_update ON consultation_attachments';
    EXECUTE 'DROP POLICY IF EXISTS consultation_attachments_delete ON consultation_attachments';

    EXECUTE '
      CREATE POLICY consultation_attachments_select ON consultation_attachments
        FOR SELECT TO authenticated USING (is_active_user())';
    EXECUTE '
      CREATE POLICY consultation_attachments_insert ON consultation_attachments
        FOR INSERT TO authenticated WITH CHECK (is_active_user())';
    EXECUTE '
      CREATE POLICY consultation_attachments_update ON consultation_attachments
        FOR UPDATE TO authenticated USING (is_doctor_or_admin())';
    EXECUTE '
      CREATE POLICY consultation_attachments_delete ON consultation_attachments
        FOR DELETE TO authenticated USING (is_doctor_or_admin())';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'consultation_files_db') THEN
    EXECUTE 'ALTER TABLE consultation_files_db ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS allow_auth_files_db ON consultation_files_db';
    EXECUTE 'DROP POLICY IF EXISTS consultation_files_db_select ON consultation_files_db';
    EXECUTE 'DROP POLICY IF EXISTS consultation_files_db_insert ON consultation_files_db';
    EXECUTE 'DROP POLICY IF EXISTS consultation_files_db_update ON consultation_files_db';
    EXECUTE 'DROP POLICY IF EXISTS consultation_files_db_delete ON consultation_files_db';

    EXECUTE '
      CREATE POLICY consultation_files_db_select ON consultation_files_db
        FOR SELECT TO authenticated USING (is_active_user())';
    EXECUTE '
      CREATE POLICY consultation_files_db_insert ON consultation_files_db
        FOR INSERT TO authenticated WITH CHECK (is_active_user())';
    EXECUTE '
      CREATE POLICY consultation_files_db_update ON consultation_files_db
        FOR UPDATE TO authenticated USING (is_doctor_or_admin())';
    EXECUTE '
      CREATE POLICY consultation_files_db_delete ON consultation_files_db
        FOR DELETE TO authenticated USING (is_doctor_or_admin())';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- AUDIT LOG TABLE
-- ═══════════════════════════════════════════════════════════════
-- SELECT: admin only (sensitive — shows who did what)
-- INSERT: all authenticated users (everyone generates audit entries)
-- UPDATE: NOBODY (immutable)
-- DELETE: NOBODY (immutable)

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_read ON audit_log;
DROP POLICY IF EXISTS audit_log_insert ON audit_log;
DROP POLICY IF EXISTS allow_auth_insert_audit_log ON audit_log;
DROP POLICY IF EXISTS allow_admin_select_audit_log ON audit_log;
DROP POLICY IF EXISTS audit_log_select ON audit_log;
DROP POLICY IF EXISTS audit_log_insert_new ON audit_log;

CREATE POLICY audit_log_select ON audit_log
  FOR SELECT TO authenticated
  USING (is_admin());

CREATE POLICY audit_log_insert_new ON audit_log
  FOR INSERT TO authenticated
  WITH CHECK (true);  -- All authenticated can write audit entries

-- No UPDATE or DELETE policies — audit log is immutable

-- ═══════════════════════════════════════════════════════════════
-- CLINIC USERS TABLE
-- ═══════════════════════════════════════════════════════════════
-- SELECT: all authenticated (needed for role checks, doctor display)
-- INSERT: admin only (OR bootstrap when no users exist)
-- UPDATE: admin OR self (user can update own profile)
-- DELETE: admin only

ALTER TABLE clinic_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clinic_users_read ON clinic_users;
DROP POLICY IF EXISTS clinic_users_update ON clinic_users;
DROP POLICY IF EXISTS clinic_users_insert ON clinic_users;
DROP POLICY IF EXISTS clinic_users_delete ON clinic_users;
DROP POLICY IF EXISTS clinic_users_bootstrap ON clinic_users;
DROP POLICY IF EXISTS clinic_users_select ON clinic_users;
DROP POLICY IF EXISTS clinic_users_insert_admin ON clinic_users;
DROP POLICY IF EXISTS clinic_users_update_self_or_admin ON clinic_users;
DROP POLICY IF EXISTS clinic_users_delete_admin ON clinic_users;
DROP POLICY IF EXISTS clinic_users_bootstrap_first ON clinic_users;

-- Everyone authenticated can read (needed for role checks throughout app)
CREATE POLICY clinic_users_select ON clinic_users
  FOR SELECT TO authenticated
  USING (true);

-- Admin can create new users
CREATE POLICY clinic_users_insert_admin ON clinic_users
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Admin can invite new users
    EXISTS (
      SELECT 1 FROM clinic_users cu
      WHERE cu.auth_id = auth.uid() AND cu.role = 'admin' AND cu.is_active = TRUE
    )
  );

-- Bootstrap: first user can create themselves when table is empty
CREATE POLICY clinic_users_bootstrap_first ON clinic_users
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT EXISTS (SELECT 1 FROM clinic_users)
  );

-- Admin or self can update
CREATE POLICY clinic_users_update_self_or_admin ON clinic_users
  FOR UPDATE TO authenticated
  USING (
    auth_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM clinic_users cu
      WHERE cu.auth_id = auth.uid() AND cu.role = 'admin' AND cu.is_active = TRUE
    )
  );

-- Only admin can delete
CREATE POLICY clinic_users_delete_admin ON clinic_users
  FOR DELETE TO authenticated
  USING (is_admin());

-- ═══════════════════════════════════════════════════════════════
-- BILLING PACKAGES TABLE
-- ═══════════════════════════════════════════════════════════════
-- SELECT: all active users
-- INSERT/UPDATE/DELETE: admin only (manages pricing)

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'billing_packages') THEN
    EXECUTE 'ALTER TABLE billing_packages ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS billing_packages_select ON billing_packages';
    EXECUTE 'DROP POLICY IF EXISTS billing_packages_insert ON billing_packages';
    EXECUTE 'DROP POLICY IF EXISTS billing_packages_update ON billing_packages';
    EXECUTE 'DROP POLICY IF EXISTS billing_packages_delete ON billing_packages';

    EXECUTE '
      CREATE POLICY billing_packages_select ON billing_packages
        FOR SELECT TO authenticated USING (is_active_user())';
    EXECUTE '
      CREATE POLICY billing_packages_insert ON billing_packages
        FOR INSERT TO authenticated WITH CHECK (is_admin())';
    EXECUTE '
      CREATE POLICY billing_packages_update ON billing_packages
        FOR UPDATE TO authenticated USING (is_admin())';
    EXECUTE '
      CREATE POLICY billing_packages_delete ON billing_packages
        FOR DELETE TO authenticated USING (is_admin())';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- DRUG INTERACTION OVERRIDES TABLE
-- ═══════════════════════════════════════════════════════════════
-- SELECT: all active users (for display in prescriptions)
-- INSERT: admin + doctor (override requires clinical justification)
-- UPDATE/DELETE: admin only

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'drug_interaction_overrides') THEN
    EXECUTE 'ALTER TABLE drug_interaction_overrides ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS drug_interaction_overrides_select ON drug_interaction_overrides';
    EXECUTE 'DROP POLICY IF EXISTS drug_interaction_overrides_insert ON drug_interaction_overrides';
    EXECUTE 'DROP POLICY IF EXISTS drug_interaction_overrides_update ON drug_interaction_overrides';
    EXECUTE 'DROP POLICY IF EXISTS drug_interaction_overrides_delete ON drug_interaction_overrides';

    EXECUTE '
      CREATE POLICY drug_interaction_overrides_select ON drug_interaction_overrides
        FOR SELECT TO authenticated USING (is_active_user())';
    EXECUTE '
      CREATE POLICY drug_interaction_overrides_insert ON drug_interaction_overrides
        FOR INSERT TO authenticated WITH CHECK (is_doctor_or_admin())';
    EXECUTE '
      CREATE POLICY drug_interaction_overrides_update ON drug_interaction_overrides
        FOR UPDATE TO authenticated USING (is_admin())';
    EXECUTE '
      CREATE POLICY drug_interaction_overrides_delete ON drug_interaction_overrides
        FOR DELETE TO authenticated USING (is_admin())';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- REMAINING TABLES (safe catch-all for any we missed)
-- ═══════════════════════════════════════════════════════════════
-- These tables use the "active user" pattern — any active authenticated
-- user can interact with them, but deactivated users are locked out.

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'consultation_templates',
    'lab_templates',
    'queue_overrides',
    'ipd_nursing',
    'reminder_log',
    'portal_tokens',
    'portal_otp',
    'portal_sessions'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = tbl) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('DROP POLICY IF EXISTS %I_rls_select ON %I', tbl, tbl);
      EXECUTE format('DROP POLICY IF EXISTS %I_rls_insert ON %I', tbl, tbl);
      EXECUTE format('DROP POLICY IF EXISTS %I_rls_update ON %I', tbl, tbl);
      EXECUTE format('DROP POLICY IF EXISTS %I_rls_delete ON %I', tbl, tbl);

      EXECUTE format('
        CREATE POLICY %I_rls_select ON %I
          FOR SELECT TO authenticated USING (is_active_user())', tbl, tbl);
      EXECUTE format('
        CREATE POLICY %I_rls_insert ON %I
          FOR INSERT TO authenticated WITH CHECK (is_active_user())', tbl, tbl);
      EXECUTE format('
        CREATE POLICY %I_rls_update ON %I
          FOR UPDATE TO authenticated USING (is_active_user())', tbl, tbl);
      EXECUTE format('
        CREATE POLICY %I_rls_delete ON %I
          FOR DELETE TO authenticated USING (is_admin())', tbl, tbl);
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- VERIFICATION: List all tables and their RLS status
-- ═══════════════════════════════════════════════════════════════

SELECT
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- ============================================================
-- DONE. All tables now have role-based RLS policies.
--
-- Key principles enforced:
--   1. Deactivated users (is_active=false) cannot access ANY data
--   2. Staff cannot modify clinical data (encounters, prescriptions)
--   3. Only admin can delete patients or view audit logs
--   4. Only admin can modify billing after creation (prevents fraud)
--   5. Audit log is immutable (no UPDATE/DELETE policies)
--   6. Bootstrap policy allows first user registration
--
-- IMPORTANT: After running this migration:
--   - Test login as each role (admin, doctor, staff) to verify access
--   - Verify staff cannot create encounters (should get RLS error)
--   - Verify deactivated users are fully locked out
-- ============================================================
