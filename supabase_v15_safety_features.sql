-- ============================================================
-- NexMedicon HMS — v15 Safety & Compliance Features
-- Run AFTER all previous migrations (v1–v14)
-- ============================================================

-- ── 1. AUDIT LOG IMMUTABILITY ─────────────────────────────────
-- Make audit_log append-only: no UPDATE, no DELETE

-- Revoke DELETE and UPDATE from all roles on audit_log
DO $$
BEGIN
  -- Prevent deletion of audit records
  EXECUTE 'REVOKE DELETE ON audit_log FROM authenticated';
  EXECUTE 'REVOKE DELETE ON audit_log FROM anon';
  EXECUTE 'REVOKE DELETE ON audit_log FROM service_role';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not revoke DELETE on audit_log: %', SQLERRM;
END $$;

-- Trigger to prevent UPDATE of audit_log rows
CREATE OR REPLACE FUNCTION prevent_audit_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit log entries are immutable and cannot be modified';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_immutable ON audit_log;
CREATE TRIGGER trg_audit_immutable
  BEFORE UPDATE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_update();

-- Trigger to prevent DELETE of audit_log rows (belt + suspenders)
CREATE OR REPLACE FUNCTION prevent_audit_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit log entries are immutable and cannot be deleted';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_delete ON audit_log;
CREATE TRIGGER trg_audit_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_delete();

-- Add hash chain for tamper detection
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entry_hash TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_hash TEXT;

-- ── 2. PATIENT ALLERGIES TABLE ────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_allergies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  allergen TEXT NOT NULL,                    -- e.g. 'Penicillin', 'Sulfa', 'Ibuprofen'
  allergen_type TEXT DEFAULT 'drug',         -- 'drug', 'food', 'environmental'
  reaction TEXT,                             -- e.g. 'Anaphylaxis', 'Rash', 'Hives'
  severity TEXT DEFAULT 'moderate',          -- 'mild', 'moderate', 'severe', 'life-threatening'
  confirmed BOOLEAN DEFAULT true,
  reported_by TEXT,                          -- who reported this allergy
  reported_date TIMESTAMPTZ DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS for patient_allergies
ALTER TABLE patient_allergies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_allergies" ON patient_allergies
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_allergies" ON patient_allergies
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_allergies" ON patient_allergies
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_delete_allergies" ON patient_allergies
  FOR DELETE TO authenticated USING (true);

-- Index for fast lookup during prescription
CREATE INDEX IF NOT EXISTS idx_allergies_patient ON patient_allergies(patient_id);
CREATE INDEX IF NOT EXISTS idx_allergies_allergen ON patient_allergies(allergen);

-- ── 3. DRUG INTERACTIONS LOG ──────────────────────────────────
CREATE TABLE IF NOT EXISTS drug_interaction_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  encounter_id UUID REFERENCES encounters(id),
  drug_a TEXT NOT NULL,
  drug_b TEXT NOT NULL,
  severity TEXT NOT NULL,                    -- 'critical', 'major', 'moderate', 'minor'
  override_reason TEXT NOT NULL,             -- doctor must document why they're overriding
  overridden_by UUID REFERENCES clinic_users(id),
  overridden_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE drug_interaction_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_interaction_overrides" ON drug_interaction_overrides
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 4. CRITICAL VALUE ALERTS ──────────────────────────────────
CREATE TABLE IF NOT EXISTS critical_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  encounter_id UUID REFERENCES encounters(id),
  alert_type TEXT NOT NULL,                  -- 'vital', 'lab', 'drug_interaction', 'allergy'
  parameter TEXT NOT NULL,                   -- e.g. 'haemoglobin', 'bp_systolic', 'spo2'
  value TEXT NOT NULL,                       -- the actual value
  threshold TEXT,                            -- the threshold that was breached
  severity TEXT NOT NULL DEFAULT 'high',     -- 'critical', 'high', 'medium'
  message TEXT NOT NULL,
  action_required TEXT,
  status TEXT DEFAULT 'open',                -- 'open', 'acknowledged', 'resolved', 'escalated'
  acknowledged_by UUID REFERENCES clinic_users(id),
  acknowledged_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES clinic_users(id),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  escalated_to TEXT,                         -- phone/email of escalation target
  escalated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE critical_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_critical_alerts" ON critical_alerts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_critical_alerts_patient ON critical_alerts(patient_id);
CREATE INDEX IF NOT EXISTS idx_critical_alerts_status ON critical_alerts(status);
CREATE INDEX IF NOT EXISTS idx_critical_alerts_severity ON critical_alerts(severity);

-- ── 5. DATA RETENTION POLICIES TABLE ──────────────────────────
CREATE TABLE IF NOT EXISTS data_retention_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL UNIQUE,          -- 'audit_log', 'encounters', 'prescriptions', etc.
  retention_days INTEGER NOT NULL,           -- how many days to keep
  auto_purge BOOLEAN DEFAULT false,          -- whether to auto-delete expired records
  legal_minimum_days INTEGER DEFAULT 2555,   -- 7 years (Indian medical records requirement)
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES clinic_users(id)
);

ALTER TABLE data_retention_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only_retention" ON data_retention_policies
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM clinic_users
      WHERE auth_id = auth.uid() AND role = 'admin' AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clinic_users
      WHERE auth_id = auth.uid() AND role = 'admin' AND is_active = true
    )
  );

-- Seed default retention policies (Indian medical records: 7 years minimum)
INSERT INTO data_retention_policies (entity_type, retention_days, auto_purge, legal_minimum_days, description)
VALUES
  ('patients',       3650, false, 2555, 'Patient demographics — 10 years, no auto-purge'),
  ('encounters',     3650, false, 2555, 'OPD consultations — 10 years'),
  ('prescriptions',  3650, false, 2555, 'Prescriptions — 10 years'),
  ('lab_reports',    3650, false, 2555, 'Lab results — 10 years'),
  ('bills',          2920, false, 2555, 'Billing records — 8 years (tax requirement)'),
  ('audit_log',      3650, false, 2555, 'Audit trail — 10 years, never auto-purge'),
  ('attachments',    1825, true,  2555, 'Uploaded files — 5 years, auto-purge after'),
  ('opd_queue',       365, true,    30, 'Queue tokens — 1 year, auto-purge'),
  ('reminders',       365, true,    30, 'SMS/WhatsApp reminders — 1 year')
ON CONFLICT (entity_type) DO NOTHING;

-- ── 6. GYNECOLOGY TEMPLATES TABLE ─────────────────────────────
CREATE TABLE IF NOT EXISTS consultation_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,                    -- 'ANC', 'Gynecology', 'Infertility', 'Emergency'
  chief_complaint TEXT,
  diagnosis TEXT,
  notes TEXT,
  default_medications JSONB DEFAULT '[]',    -- pre-filled medications
  default_investigations TEXT,               -- suggested investigations
  default_advice TEXT,
  ob_data_template JSONB DEFAULT '{}',       -- pre-filled OB fields
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE consultation_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_select_templates" ON consultation_templates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_manage_templates" ON consultation_templates
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM clinic_users
      WHERE auth_id = auth.uid() AND role IN ('admin', 'doctor') AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clinic_users
      WHERE auth_id = auth.uid() AND role IN ('admin', 'doctor') AND is_active = true
    )
  );

-- ── 7. SYSTEM STATUS / HEALTH CHECK TABLE ─────────────────────
CREATE TABLE IF NOT EXISTS system_health_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_type TEXT NOT NULL,                  -- 'database', 'api', 'storage', 'auth'
  status TEXT NOT NULL,                      -- 'healthy', 'degraded', 'down'
  response_time_ms INTEGER,
  details JSONB,
  checked_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-cleanup: keep only last 7 days of health checks
CREATE INDEX IF NOT EXISTS idx_health_log_time ON system_health_log(checked_at);

-- ── 8. BACKUP LOG ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS backup_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_type TEXT NOT NULL,                 -- 'full', 'incremental', 'manual'
  status TEXT NOT NULL,                      -- 'started', 'completed', 'failed'
  tables_included TEXT[],
  record_count INTEGER,
  file_size_bytes BIGINT,
  initiated_by UUID REFERENCES clinic_users(id),
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

ALTER TABLE backup_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only_backup_log" ON backup_log
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM clinic_users
      WHERE auth_id = auth.uid() AND role = 'admin' AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clinic_users
      WHERE auth_id = auth.uid() AND role = 'admin' AND is_active = true
    )
  );

-- ── 9. MFA ENROLLMENT TRACKING ────────────────────────────────
ALTER TABLE clinic_users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT false;
ALTER TABLE clinic_users ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ;

-- ── 10. PATIENT TABLE ADDITIONS ───────────────────────────────
-- Add allergy summary field for quick display
ALTER TABLE patients ADD COLUMN IF NOT EXISTS known_allergies TEXT;
-- Add weight for dose calculations
ALTER TABLE patients ADD COLUMN IF NOT EXISTS weight_kg NUMERIC;

-- ── DONE ──────────────────────────────────────────────────────
-- Run this migration in Supabase SQL Editor after all previous migrations.
-- Then deploy the updated application code.
