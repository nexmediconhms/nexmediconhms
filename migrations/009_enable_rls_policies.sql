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

-- ── Step 2: Enable RLS on ALL tables ────────────────────────

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE encounters ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE opdqueue ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE beds ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinicusers ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinicsettings ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditlog ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospitalfund ENABLE ROW LEVEL SECURITY;
ALTER TABLE labpartners ENABLE ROW LEVEL SECURITY;

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

-- ── Step 3: Create RLS Policies ─────────────────────────────
-- Pattern: Active clinic users can SELECT all, but INSERT/UPDATE/DELETE
-- is role-restricted for sensitive operations.

-- ─── PATIENTS ───────────────────────────────────────────────
DROP POLICY IF EXISTS patients_select ON patients;
CREATE POLICY patients_select ON patients FOR SELECT TO authenticated
  USING (is_active_user());

DROP POLICY IF EXISTS patients_insert ON patients;
CREATE POLICY patients_insert ON patients FOR INSERT TO authenticated
  WITH CHECK (is_active_user());

DROP POLICY IF EXISTS patients_update ON patients;
CREATE POLICY patients_update ON patients FOR UPDATE TO authenticated
  USING (is_active_user());

DROP POLICY IF EXISTS patients_delete ON patients;
CREATE POLICY patients_delete ON patients FOR DELETE TO authenticated
  USING (is_admin());

-- ─── ENCOUNTERS ─────────────────────────────────────────────
DROP POLICY IF EXISTS encounters_select ON encounters;
CREATE POLICY encounters_select ON encounters FOR SELECT TO authenticated
  USING (is_active_user());

DROP POLICY IF EXISTS encounters_insert ON encounters;
CREATE POLICY encounters_insert ON encounters FOR INSERT TO authenticated
  WITH CHECK (is_active_user());

DROP POLICY IF EXISTS encounters_update ON encounters;
CREATE POLICY encounters_update ON encounters FOR UPDATE TO authenticated
  USING (is_doctor_or_admin());

DROP POLICY IF EXISTS encounters_delete ON encounters;
CREATE POLICY encounters_delete ON encounters FOR DELETE TO authenticated
  USING (is_admin());

-- ─── PRESCRIPTIONS ──────────────────────────────────────────
DROP POLICY IF EXISTS prescriptions_select ON prescriptions;
CREATE POLICY prescriptions_select ON prescriptions FOR SELECT TO authenticated
  USING (is_active_user());

DROP POLICY IF EXISTS prescriptions_insert ON prescriptions;
CREATE POLICY prescriptions_insert ON prescriptions FOR INSERT TO authenticated
  WITH CHECK (is_doctor_or_admin());

DROP POLICY IF EXISTS prescriptions_update ON prescriptions;
CREATE POLICY prescriptions_update ON prescriptions FOR UPDATE TO authenticated
  USING (is_doctor_or_admin());

-- ─── BILLS ──────────────────────────────────────────────────
DROP POLICY IF EXISTS bills_select ON bills;
CREATE POLICY bills_select ON bills FOR SELECT TO authenticated
  USING (is_active_user());

DROP POLICY IF EXISTS bills_insert ON bills;
CREATE POLICY bills_insert ON bills FOR INSERT TO authenticated
  WITH CHECK (is_active_user());

DROP POLICY IF EXISTS bills_update ON bills;
CREATE POLICY bills_update ON bills FOR UPDATE TO authenticated
  USING (is_active_user());

DROP POLICY IF EXISTS bills_delete ON bills;
CREATE POLICY bills_delete ON bills FOR DELETE TO authenticated
  USING (is_admin());

-- ─── APPOINTMENTS ───────────────────────────────────────────
DROP POLICY IF EXISTS appointments_select ON appointments;
CREATE POLICY appointments_select ON appointments FOR SELECT TO authenticated
  USING (is_active_user());

DROP POLICY IF EXISTS appointments_insert ON appointments;
CREATE POLICY appointments_insert ON appointments FOR INSERT TO authenticated
  WITH CHECK (is_active_user());

DROP POLICY IF EXISTS appointments_update ON appointments;
CREATE POLICY appointments_update ON appointments FOR UPDATE TO authenticated
  USING (is_active_user());

-- ─── CLINIC USERS (self + admin) ────────────────────────────
DROP POLICY IF EXISTS clinicusers_select ON clinicusers;
CREATE POLICY clinicusers_select ON clinicusers FOR SELECT TO authenticated
  USING (is_active_user());

DROP POLICY IF EXISTS clinicusers_insert ON clinicusers;
CREATE POLICY clinicusers_insert ON clinicusers FOR INSERT TO authenticated
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS clinicusers_update ON clinicusers;
CREATE POLICY clinicusers_update ON clinicusers FOR UPDATE TO authenticated
  USING (is_admin());

-- ─── CLINIC SETTINGS ────────────────────────────────────────
DROP POLICY IF EXISTS clinicsettings_select ON clinicsettings;
CREATE POLICY clinicsettings_select ON clinicsettings FOR SELECT TO authenticated
  USING (is_active_user());

DROP POLICY IF EXISTS clinicsettings_upsert ON clinicsettings;
CREATE POLICY clinicsettings_upsert ON clinicsettings FOR INSERT TO authenticated
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS clinicsettings_update ON clinicsettings;
CREATE POLICY clinicsettings_update ON clinicsettings FOR UPDATE TO authenticated
  USING (is_admin());

-- ─── AUDIT LOG (read by admin, insert by all active users) ──
DROP POLICY IF EXISTS auditlog_select ON auditlog;
CREATE POLICY auditlog_select ON auditlog FOR SELECT TO authenticated
  USING (is_admin());

DROP POLICY IF EXISTS auditlog_insert ON auditlog;
CREATE POLICY auditlog_insert ON auditlog FOR INSERT TO authenticated
  WITH CHECK (is_active_user());

-- ─── OPD QUEUE ──────────────────────────────────────────────
DROP POLICY IF EXISTS opdqueue_select ON opdqueue;
CREATE POLICY opdqueue_select ON opdqueue FOR SELECT TO authenticated
  USING (is_active_user());

DROP POLICY IF EXISTS opdqueue_insert ON opdqueue;
CREATE POLICY opdqueue_insert ON opdqueue FOR INSERT TO authenticated
  WITH CHECK (is_active_user());

DROP POLICY IF EXISTS opdqueue_update ON opdqueue;
CREATE POLICY opdqueue_update ON opdqueue FOR UPDATE TO authenticated
  USING (is_active_user());

DROP POLICY IF EXISTS opdqueue_delete ON opdqueue;
CREATE POLICY opdqueue_delete ON opdqueue FOR DELETE TO authenticated
  USING (is_active_user());

-- ─── BEDS ───────────────────────────────────────────────────
DROP POLICY IF EXISTS beds_select ON beds;
CREATE POLICY beds_select ON beds FOR SELECT TO authenticated
  USING (is_active_user());

DROP POLICY IF EXISTS beds_all ON beds;
CREATE POLICY beds_all ON beds FOR ALL TO authenticated
  USING (is_active_user());

-- ─── REMINDERS ──────────────────────────────────────────────
DROP POLICY IF EXISTS reminders_select ON reminders;
CREATE POLICY reminders_select ON reminders FOR SELECT TO authenticated
  USING (is_active_user());

DROP POLICY IF EXISTS reminders_all ON reminders;
CREATE POLICY reminders_all ON reminders FOR ALL TO authenticated
  USING (is_active_user());

-- ─── HOSPITAL FUND ──────────────────────────────────────────
DROP POLICY IF EXISTS hospitalfund_select ON hospitalfund;
CREATE POLICY hospitalfund_select ON hospitalfund FOR SELECT TO authenticated
  USING (is_active_user());

DROP POLICY IF EXISTS hospitalfund_insert ON hospitalfund;
CREATE POLICY hospitalfund_insert ON hospitalfund FOR INSERT TO authenticated
  WITH CHECK (is_active_user());

DROP POLICY IF EXISTS hospitalfund_update ON hospitalfund;
CREATE POLICY hospitalfund_update ON hospitalfund FOR UPDATE TO authenticated
  USING (is_admin());

-- ─── LAB PARTNERS ───────────────────────────────────────────
DROP POLICY IF EXISTS labpartners_select ON labpartners;
CREATE POLICY labpartners_select ON labpartners FOR SELECT TO authenticated
  USING (is_active_user());

DROP POLICY IF EXISTS labpartners_all ON labpartners;
CREATE POLICY labpartners_all ON labpartners FOR ALL TO authenticated
  USING (is_admin());

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
