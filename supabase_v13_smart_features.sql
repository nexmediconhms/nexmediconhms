-- ============================================================
-- NexMedicon HMS — v13: Smart Features Migration
-- Run in Supabase → SQL Editor → New Query
-- Safe to re-run (IF NOT EXISTS / DO blocks)
--
-- Covers:
--   1. Fee configuration in clinic_settings
--   2. Patient referrals tracking table
--   3. Staff performance metrics (view)
--   4. Patient engagement tracking
--   5. Visit type history for analytics
-- ============================================================

-- ─── 1. Fee Configuration (seed default) ─────────────────────
INSERT INTO clinic_settings (key, value)
VALUES (
  'fee_config',
  '{"newConsultation": 500, "followUp7Days": 200, "followUp30Days": 300, "ancVisit": 400, "postOpVisit": 0, "procedureFee": 500}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- ─── 2. Patient Referrals Table ──────────────────────────────
CREATE TABLE IF NOT EXISTS patient_referrals (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_id      UUID REFERENCES patients(id) ON DELETE SET NULL,
  referrer_name    TEXT NOT NULL,
  referrer_mobile  TEXT,
  referred_id      UUID REFERENCES patients(id) ON DELETE SET NULL,
  referred_name    TEXT NOT NULL,
  referral_code    TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'completed', 'rewarded')),
  reward_amount    NUMERIC(10,2) DEFAULT 100,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE patient_referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS referrals_policy ON patient_referrals;
CREATE POLICY referrals_policy ON patient_referrals
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_referrals_code ON patient_referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON patient_referrals(referrer_id);

-- ─── 3. Visit Type Tracking ─────────────────────────────────
-- Add visit_type and fee columns to encounters for analytics
ALTER TABLE encounters
  ADD COLUMN IF NOT EXISTS visit_type TEXT DEFAULT 'new'
    CHECK (visit_type IN ('new', 'follow-up', 'anc-followup', 'post-op', 'procedure')),
  ADD COLUMN IF NOT EXISTS consultation_fee NUMERIC(10,2) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_encounters_visit_type ON encounters(visit_type);

-- ─── 4. Marketing Settings ───────────────────────────────────
INSERT INTO clinic_settings (key, value)
VALUES 
  ('marketing_config', '{"clinicName": "", "clinicPhone": "", "upiId": "", "googlePlaceId": "", "referralCode": ""}'::jsonb),
  ('whatsapp_templates_custom', '[]'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ─── 5. Staff Activity Log Enhancement ──────────────────────
-- Add action_duration to audit_log for time tracking
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER;  -- how long the action took

-- ─── 6. Patient Engagement Score ─────────────────────────────
-- Computed view for patient engagement scoring
CREATE OR REPLACE VIEW v_patient_engagement AS
SELECT
  p.id,
  p.full_name,
  p.mrn,
  p.mobile,
  p.created_at AS registered_at,
  COUNT(DISTINCT e.id) AS total_visits,
  MAX(e.encounter_date) AS last_visit_date,
  CURRENT_DATE - MAX(e.encounter_date) AS days_since_last_visit,
  CASE
    WHEN CURRENT_DATE - MAX(e.encounter_date) <= 30 THEN 'active'
    WHEN CURRENT_DATE - MAX(e.encounter_date) <= 90 THEN 'at_risk'
    ELSE 'lost'
  END AS engagement_status,
  CASE
    WHEN CURRENT_DATE - MAX(e.encounter_date) <= 7 THEN 100
    WHEN CURRENT_DATE - MAX(e.encounter_date) <= 30 THEN 80
    WHEN CURRENT_DATE - MAX(e.encounter_date) <= 60 THEN 50
    WHEN CURRENT_DATE - MAX(e.encounter_date) <= 90 THEN 25
    ELSE 10
  END AS engagement_score
FROM patients p
LEFT JOIN encounters e ON e.patient_id = p.id
GROUP BY p.id, p.full_name, p.mrn, p.mobile, p.created_at;

GRANT SELECT ON v_patient_engagement TO authenticated;

-- ─── 7. Revenue Analytics View ───────────────────────────────
CREATE OR REPLACE VIEW v_revenue_daily AS
SELECT
  DATE(created_at) AS bill_date,
  COUNT(*) AS bill_count,
  SUM(net_amount) AS total_revenue,
  SUM(CASE WHEN status = 'paid' THEN net_amount ELSE 0 END) AS collected,
  SUM(CASE WHEN status = 'pending' THEN net_amount ELSE 0 END) AS pending,
  AVG(net_amount) AS avg_bill_value
FROM bills
WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE(created_at)
ORDER BY bill_date DESC;

GRANT SELECT ON v_revenue_daily TO authenticated;

-- ─── Done ─────────────────────────────────────────────────────
SELECT 'v13 smart features migration complete ✓' AS result;
