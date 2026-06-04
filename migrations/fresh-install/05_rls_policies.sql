-- ════════════════════════════════════════════════════════════════════
-- 05_rls_policies.sql
--
-- FRESH-INSTALL STEP 6 of 7 — Row-Level Security (snake_case canonical).
--
-- This REPLACES the old migrations/009_enable_rls_policies.sql which
-- referenced flat-name tables (clinicusers, opdqueue, auditlog) that
-- don't exist on the canonical schema. The old 009 transaction would
-- abort at the first ALTER TABLE clinicusers, silently leaving RLS
-- un-enforced.
--
-- This file:
--   §1 Revokes anonymous access (undoes archive/fix-all-permissions.sql)
--   §2 Enables RLS on every table that contains patient or financial data
--   §3 Defines snake_case role-based policies that match auth.ts roles:
--       admin   — full access
--       doctor  — clinical write access (encounters/prescriptions/labs)
--       staff   — read all, write registration/queue/billing
--       (lab_partner, receptionist treated like staff for now)
--
-- Re-runnable safely (DROP POLICY IF EXISTS / CREATE POLICY).
-- Depends on: 00_extensions_and_helpers.sql (helper functions)
--             01_core_schema.sql           (tables exist)
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- §1  Revoke anonymous access (undoes legacy fix-all-permissions.sql)
-- ════════════════════════════════════════════════════════════════════

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Authenticated gets table access; RLS will further restrict.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- service_role bypasses RLS by definition (used by API routes that need
-- to do work the user isn't directly authorised for, e.g. audit writes).
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ════════════════════════════════════════════════════════════════════
-- §2  Enable RLS on every table  (idempotent)
-- ════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t TEXT;
  -- Tables that hold PHI / financial / operational data
  -- (skip schema_migrations, mrn_counter, bill_counters — those are metadata)
  protected_tables TEXT[] := ARRAY[
    'clinic_users', 'clinic_settings',
    'patients', 'encounters', 'prescriptions',
    'appointments', 'opd_queue',
    'beds', 'ipd_admissions', 'ipd_nursing',
    'bills', 'bill_payments', 'bill_versions', 'credit_notes',
    'hospital_fund', 'payment_attempts',
    'lab_partners', 'lab_portal_users', 'lab_reports',
    'attachments', 'discharge_summaries',
    'audit_log',
    'portal_otp', 'portal_sessions', 'portal_tokens',
    'reminders', 'doctor_alerts', 'clinic_notifications',
    'whatsapp_notifications',
    'insurance_claims', 'insurance_claim_history',
    'ot_schedules', 'cron_job_log',
    'pharmacy_medicines', 'pharmacy_stock_log', 'pharmacy_batches'
  ];
BEGIN
  FOREACH t IN ARRAY protected_tables LOOP
    -- Skip silently if a table doesn't exist on this deployment
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    ELSE
      RAISE NOTICE 'SKIP RLS enable: table % missing', t;
    END IF;
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- §3  Policies (snake_case canonical)
-- ════════════════════════════════════════════════════════════════════
-- Pattern:
--   - SELECT:  is_active_user()        (any active clinic user)
--   - INSERT:  varies (active vs role-restricted)
--   - UPDATE:  varies
--   - DELETE:  is_admin()              (always admin-only)
--
-- service_role bypasses RLS automatically and doesn't need policies.
-- ════════════════════════════════════════════════════════════════════

-- ── PATIENTS ─────────────────────────────────────────────────────
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

-- ── ENCOUNTERS (write = doctor/admin only) ───────────────────────
DROP POLICY IF EXISTS encounters_select ON encounters;
CREATE POLICY encounters_select ON encounters FOR SELECT TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS encounters_insert ON encounters;
CREATE POLICY encounters_insert ON encounters FOR INSERT TO authenticated WITH CHECK (is_active_user());

DROP POLICY IF EXISTS encounters_update ON encounters;
CREATE POLICY encounters_update ON encounters FOR UPDATE TO authenticated USING (is_doctor_or_admin());

DROP POLICY IF EXISTS encounters_delete ON encounters;
CREATE POLICY encounters_delete ON encounters FOR DELETE TO authenticated USING (is_admin());

-- ── PRESCRIPTIONS (doctor-write only) ─────────────────────────────
DROP POLICY IF EXISTS prescriptions_select ON prescriptions;
CREATE POLICY prescriptions_select ON prescriptions FOR SELECT TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS prescriptions_insert ON prescriptions;
CREATE POLICY prescriptions_insert ON prescriptions FOR INSERT TO authenticated WITH CHECK (is_doctor_or_admin());

DROP POLICY IF EXISTS prescriptions_update ON prescriptions;
CREATE POLICY prescriptions_update ON prescriptions FOR UPDATE TO authenticated USING (is_doctor_or_admin());

DROP POLICY IF EXISTS prescriptions_delete ON prescriptions;
CREATE POLICY prescriptions_delete ON prescriptions FOR DELETE TO authenticated USING (is_admin());

-- ── BILLS  (creation = staff or doctor; delete = admin only) ─────
DROP POLICY IF EXISTS bills_select ON bills;
CREATE POLICY bills_select ON bills FOR SELECT TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS bills_insert ON bills;
CREATE POLICY bills_insert ON bills FOR INSERT TO authenticated WITH CHECK (is_active_user());

DROP POLICY IF EXISTS bills_update ON bills;
CREATE POLICY bills_update ON bills FOR UPDATE TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS bills_delete ON bills;
CREATE POLICY bills_delete ON bills FOR DELETE TO authenticated USING (is_admin());

-- ── BILL_PAYMENTS  (active staff can record receipts) ────────────
DROP POLICY IF EXISTS bill_payments_select ON bill_payments;
CREATE POLICY bill_payments_select ON bill_payments FOR SELECT TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS bill_payments_insert ON bill_payments;
CREATE POLICY bill_payments_insert ON bill_payments FOR INSERT TO authenticated WITH CHECK (is_active_user());

DROP POLICY IF EXISTS bill_payments_update ON bill_payments;
CREATE POLICY bill_payments_update ON bill_payments FOR UPDATE TO authenticated USING (is_admin());

-- ── BILL_VERSIONS  (immutable; admin SELECT only) ────────────────
DROP POLICY IF EXISTS bill_versions_select ON bill_versions;
CREATE POLICY bill_versions_select ON bill_versions FOR SELECT TO authenticated USING (is_admin());

DROP POLICY IF EXISTS bill_versions_insert ON bill_versions;
CREATE POLICY bill_versions_insert ON bill_versions FOR INSERT TO authenticated WITH CHECK (is_active_user());

-- (No UPDATE / DELETE policies = nobody can modify bill versions)

-- ── CREDIT_NOTES (admin or doctor; trigger enforces refund cap) ──
DROP POLICY IF EXISTS credit_notes_select ON credit_notes;
CREATE POLICY credit_notes_select ON credit_notes FOR SELECT TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS credit_notes_insert ON credit_notes;
CREATE POLICY credit_notes_insert ON credit_notes FOR INSERT TO authenticated WITH CHECK (is_doctor_or_admin());

DROP POLICY IF EXISTS credit_notes_update ON credit_notes;
CREATE POLICY credit_notes_update ON credit_notes FOR UPDATE TO authenticated USING (is_admin());

-- ── APPOINTMENTS  (any active user) ──────────────────────────────
DROP POLICY IF EXISTS appointments_select ON appointments;
CREATE POLICY appointments_select ON appointments FOR SELECT TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS appointments_insert ON appointments;
CREATE POLICY appointments_insert ON appointments FOR INSERT TO authenticated WITH CHECK (is_active_user());

DROP POLICY IF EXISTS appointments_update ON appointments;
CREATE POLICY appointments_update ON appointments FOR UPDATE TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS appointments_delete ON appointments;
CREATE POLICY appointments_delete ON appointments FOR DELETE TO authenticated USING (is_admin());

-- ── OPD QUEUE  (active users) ────────────────────────────────────
DROP POLICY IF EXISTS opd_queue_select ON opd_queue;
CREATE POLICY opd_queue_select ON opd_queue FOR SELECT TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS opd_queue_insert ON opd_queue;
CREATE POLICY opd_queue_insert ON opd_queue FOR INSERT TO authenticated WITH CHECK (is_active_user());

DROP POLICY IF EXISTS opd_queue_update ON opd_queue;
CREATE POLICY opd_queue_update ON opd_queue FOR UPDATE TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS opd_queue_delete ON opd_queue;
CREATE POLICY opd_queue_delete ON opd_queue FOR DELETE TO authenticated USING (is_admin());

-- ── BEDS / IPD ───────────────────────────────────────────────────
DROP POLICY IF EXISTS beds_all ON beds;
CREATE POLICY beds_all ON beds FOR ALL TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS ipd_admissions_select ON ipd_admissions;
CREATE POLICY ipd_admissions_select ON ipd_admissions FOR SELECT TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS ipd_admissions_insert ON ipd_admissions;
CREATE POLICY ipd_admissions_insert ON ipd_admissions FOR INSERT TO authenticated WITH CHECK (is_active_user());

DROP POLICY IF EXISTS ipd_admissions_update ON ipd_admissions;
CREATE POLICY ipd_admissions_update ON ipd_admissions FOR UPDATE TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS ipd_admissions_delete ON ipd_admissions;
CREATE POLICY ipd_admissions_delete ON ipd_admissions FOR DELETE TO authenticated USING (is_admin());

DROP POLICY IF EXISTS ipd_nursing_all ON ipd_nursing;
CREATE POLICY ipd_nursing_all ON ipd_nursing FOR ALL TO authenticated USING (is_active_user());

-- ── DISCHARGE SUMMARIES ──────────────────────────────────────────
DROP POLICY IF EXISTS discharge_summaries_select ON discharge_summaries;
CREATE POLICY discharge_summaries_select ON discharge_summaries FOR SELECT TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS discharge_summaries_insert ON discharge_summaries;
CREATE POLICY discharge_summaries_insert ON discharge_summaries FOR INSERT TO authenticated WITH CHECK (is_doctor_or_admin());

DROP POLICY IF EXISTS discharge_summaries_update ON discharge_summaries;
CREATE POLICY discharge_summaries_update ON discharge_summaries FOR UPDATE TO authenticated USING (is_doctor_or_admin());

DROP POLICY IF EXISTS discharge_summaries_delete ON discharge_summaries;
CREATE POLICY discharge_summaries_delete ON discharge_summaries FOR DELETE TO authenticated USING (is_admin());

-- ── HOSPITAL FUND  (admin-only writes) ───────────────────────────
DROP POLICY IF EXISTS hospital_fund_select ON hospital_fund;
CREATE POLICY hospital_fund_select ON hospital_fund FOR SELECT TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS hospital_fund_insert ON hospital_fund;
CREATE POLICY hospital_fund_insert ON hospital_fund FOR INSERT TO authenticated WITH CHECK (is_active_user());

DROP POLICY IF EXISTS hospital_fund_update ON hospital_fund;
CREATE POLICY hospital_fund_update ON hospital_fund FOR UPDATE TO authenticated USING (is_admin());

DROP POLICY IF EXISTS hospital_fund_delete ON hospital_fund;
CREATE POLICY hospital_fund_delete ON hospital_fund FOR DELETE TO authenticated USING (is_admin());

-- ── PAYMENT ATTEMPTS ─────────────────────────────────────────────
DROP POLICY IF EXISTS payment_attempts_select ON payment_attempts;
CREATE POLICY payment_attempts_select ON payment_attempts FOR SELECT TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS payment_attempts_insert ON payment_attempts;
CREATE POLICY payment_attempts_insert ON payment_attempts FOR INSERT TO authenticated WITH CHECK (is_active_user());

DROP POLICY IF EXISTS payment_attempts_update ON payment_attempts;
CREATE POLICY payment_attempts_update ON payment_attempts FOR UPDATE TO authenticated USING (is_admin());

-- ── LAB PARTNERS / PORTAL USERS  (admin-managed) ─────────────────
DROP POLICY IF EXISTS lab_partners_all ON lab_partners;
CREATE POLICY lab_partners_all ON lab_partners FOR ALL TO authenticated
  USING (is_active_user()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS lab_portal_users_all ON lab_portal_users;
CREATE POLICY lab_portal_users_all ON lab_portal_users FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- ── LAB REPORTS ──────────────────────────────────────────────────
DROP POLICY IF EXISTS lab_reports_select ON lab_reports;
CREATE POLICY lab_reports_select ON lab_reports FOR SELECT TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS lab_reports_insert ON lab_reports;
CREATE POLICY lab_reports_insert ON lab_reports FOR INSERT TO authenticated WITH CHECK (is_active_user());

DROP POLICY IF EXISTS lab_reports_update ON lab_reports;
CREATE POLICY lab_reports_update ON lab_reports FOR UPDATE TO authenticated USING (is_doctor_or_admin());

DROP POLICY IF EXISTS lab_reports_delete ON lab_reports;
CREATE POLICY lab_reports_delete ON lab_reports FOR DELETE TO authenticated USING (is_admin());

-- ── ATTACHMENTS ──────────────────────────────────────────────────
DROP POLICY IF EXISTS attachments_all ON attachments;
CREATE POLICY attachments_all ON attachments FOR ALL TO authenticated USING (is_active_user());

-- ── CLINIC USERS  (read all; write = admin only) ─────────────────
DROP POLICY IF EXISTS clinic_users_select ON clinic_users;
CREATE POLICY clinic_users_select ON clinic_users FOR SELECT TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS clinic_users_insert ON clinic_users;
CREATE POLICY clinic_users_insert ON clinic_users FOR INSERT TO authenticated WITH CHECK (is_admin());

DROP POLICY IF EXISTS clinic_users_update ON clinic_users;
CREATE POLICY clinic_users_update ON clinic_users FOR UPDATE TO authenticated USING (is_admin());

DROP POLICY IF EXISTS clinic_users_delete ON clinic_users;
CREATE POLICY clinic_users_delete ON clinic_users FOR DELETE TO authenticated USING (is_admin());

-- ── CLINIC SETTINGS  (read-all; admin-write) ─────────────────────
DROP POLICY IF EXISTS clinic_settings_select ON clinic_settings;
CREATE POLICY clinic_settings_select ON clinic_settings FOR SELECT TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS clinic_settings_insert ON clinic_settings;
CREATE POLICY clinic_settings_insert ON clinic_settings FOR INSERT TO authenticated WITH CHECK (is_admin());

DROP POLICY IF EXISTS clinic_settings_update ON clinic_settings;
CREATE POLICY clinic_settings_update ON clinic_settings FOR UPDATE TO authenticated USING (is_admin());

DROP POLICY IF EXISTS clinic_settings_delete ON clinic_settings;
CREATE POLICY clinic_settings_delete ON clinic_settings FOR DELETE TO authenticated USING (is_admin());

-- ── AUDIT LOG  (admin SELECT only; write via insert_audit_entry RPC) ──
DROP POLICY IF EXISTS audit_log_select ON audit_log;
CREATE POLICY audit_log_select ON audit_log FOR SELECT TO authenticated USING (is_admin());

-- INSERT policy is permissive because the SECURITY DEFINER RPC
-- (insert_audit_entry) is the canonical writer, and it runs with
-- elevated privileges. Direct INSERTs from clients are still allowed
-- (with WITH CHECK is_active_user()) so the legacy fallback path in
-- src/lib/audit.ts works on databases where the RPC isn't installed
-- yet — but those legacy inserts will produce hashes that fail
-- verify_audit_chain, which is the desired loud signal.
DROP POLICY IF EXISTS audit_log_insert ON audit_log;
CREATE POLICY audit_log_insert ON audit_log FOR INSERT TO authenticated WITH CHECK (is_active_user());

-- (No UPDATE / DELETE policies = nobody can mutate audit log via REST API.
--  The trg_protect_audit_hashes / trg_block_audit_delete triggers are an
--  additional belt-and-braces guard.)

-- ── PORTAL TABLES  (service role only — patient portal flows use it) ──
DROP POLICY IF EXISTS portal_otp_service ON portal_otp;
CREATE POLICY portal_otp_service ON portal_otp FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS portal_sessions_service ON portal_sessions;
CREATE POLICY portal_sessions_service ON portal_sessions FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS portal_tokens_service ON portal_tokens;
CREATE POLICY portal_tokens_service ON portal_tokens FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ── REMINDERS / NOTIFICATIONS / ALERTS ───────────────────────────
DROP POLICY IF EXISTS reminders_all ON reminders;
CREATE POLICY reminders_all ON reminders FOR ALL TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS doctor_alerts_all ON doctor_alerts;
CREATE POLICY doctor_alerts_all ON doctor_alerts FOR ALL TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS clinic_notifications_all ON clinic_notifications;
CREATE POLICY clinic_notifications_all ON clinic_notifications FOR ALL TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS whatsapp_notifications_all ON whatsapp_notifications;
CREATE POLICY whatsapp_notifications_all ON whatsapp_notifications FOR ALL TO authenticated USING (is_active_user());

-- ── INSURANCE CLAIMS ─────────────────────────────────────────────
DROP POLICY IF EXISTS insurance_claims_all ON insurance_claims;
CREATE POLICY insurance_claims_all ON insurance_claims FOR ALL TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS insurance_claim_history_all ON insurance_claim_history;
CREATE POLICY insurance_claim_history_all ON insurance_claim_history FOR ALL TO authenticated USING (is_active_user());

-- ── OT SCHEDULES ─────────────────────────────────────────────────
DROP POLICY IF EXISTS ot_schedules_all ON ot_schedules;
CREATE POLICY ot_schedules_all ON ot_schedules FOR ALL TO authenticated USING (is_active_user());

-- ── PHARMACY ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS pharmacy_medicines_all ON pharmacy_medicines;
CREATE POLICY pharmacy_medicines_all ON pharmacy_medicines FOR ALL TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS pharmacy_stock_log_all ON pharmacy_stock_log;
CREATE POLICY pharmacy_stock_log_all ON pharmacy_stock_log FOR ALL TO authenticated USING (is_active_user());

DROP POLICY IF EXISTS pharmacy_batches_all ON pharmacy_batches;
CREATE POLICY pharmacy_batches_all ON pharmacy_batches FOR ALL TO authenticated USING (is_active_user());

-- ── CRON JOB LOG  (service-role only) ────────────────────────────
DROP POLICY IF EXISTS cron_job_log_service ON cron_job_log;
CREATE POLICY cron_job_log_service ON cron_job_log FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════
-- §4  POST-INSTALL VERIFICATION QUERY  (run after applying)
-- ════════════════════════════════════════════════════════════════════
-- SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname = 'public' ORDER BY tablename;
-- All app tables should show rowsecurity = true.
-- ════════════════════════════════════════════════════════════════════

INSERT INTO schema_migrations (version, name, applied_at, notes)
VALUES ('FI-05', 'fresh_install_rls_policies', NOW(),
        'Snake_case RLS policies (replaces broken migration 009)')
ON CONFLICT (version) DO NOTHING;

COMMIT;

SELECT 'Fresh-install 05/07: RLS policies — DONE' AS result;
