-- ══════════════════════════════════════════════════════════════
-- NexMedicon HMS — v13 Enhancement Migrations
-- New features: Lab alerts, consultation fee tracking, lab import
-- ══════════════════════════════════════════════════════════════

-- ── Lab Alerts Table ──────────────────────────────────────────
-- Stores abnormal value alerts for doctor notification
CREATE TABLE IF NOT EXISTS lab_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid REFERENCES patients(id) ON DELETE CASCADE,
  patient_name  text NOT NULL DEFAULT '',
  lab_report_id uuid,
  test_name     text NOT NULL,
  value         text NOT NULL,
  unit          text DEFAULT '',
  reference_range text DEFAULT '',
  severity      text NOT NULL DEFAULT 'high' CHECK (severity IN ('high', 'low', 'critical_high', 'critical_low')),
  status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'acknowledged')),
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- Index for dashboard queries
CREATE INDEX IF NOT EXISTS idx_lab_alerts_status ON lab_alerts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_alerts_patient ON lab_alerts(patient_id);

-- ── Add source tracking to lab_reports ────────────────────────
-- Tracks how the report was created (manual, email_import, lab_portal)
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS source_email text;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS attachment_url text;

-- ── Consultation fee tracking in encounters ───────────────────
-- Store whether the fee was new-patient or follow-up rate
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS fee_type text DEFAULT 'standard';
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS fee_amount numeric(10,2) DEFAULT 0;

-- ── RLS Policies ──────────────────────────────────────────────
-- Lab alerts: any authenticated user can read, admin can update
ALTER TABLE lab_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "lab_alerts_select" ON lab_alerts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY IF NOT EXISTS "lab_alerts_insert" ON lab_alerts
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "lab_alerts_update" ON lab_alerts
  FOR UPDATE TO authenticated USING (true);

-- ── Helpful view: recent alerts with patient info ─────────────
CREATE OR REPLACE VIEW recent_lab_alerts AS
SELECT
  la.*,
  p.mobile as patient_mobile,
  p.mrn as patient_mrn
FROM lab_alerts la
LEFT JOIN patients p ON p.id = la.patient_id
WHERE la.status IN ('new', 'seen')
ORDER BY la.created_at DESC
LIMIT 50;

-- ══════════════════════════════════════════════════════════════
-- Done! Run this migration after the existing v12 migration.
-- ══════════════════════════════════════════════════════════════
