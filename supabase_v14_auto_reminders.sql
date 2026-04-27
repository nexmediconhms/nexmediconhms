-- ================================================================
-- NexMedicon HMS — v14: Auto-Reminder System
-- Run in Supabase → SQL Editor → New Query
-- Safe to re-run (IF NOT EXISTS pattern).
-- ================================================================

-- ─── 1. Reminder Log — tracks every reminder sent (bulk or individual) ───
CREATE TABLE IF NOT EXISTS reminder_log (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id      UUID REFERENCES patients(id) ON DELETE CASCADE,
  patient_name    TEXT,
  mobile          TEXT,
  reminder_type   TEXT NOT NULL,  -- appointment, follow_up, anc, post_delivery, vaccination, pending_bill, high_risk_anc
  source_table    TEXT,           -- appointments, prescriptions, encounters, discharge_summaries, bills
  source_id       UUID,
  message_preview TEXT,           -- first 200 chars of the message
  channel         TEXT DEFAULT 'whatsapp',  -- whatsapp, sms, etc.
  status          TEXT DEFAULT 'sent',      -- sent, failed, pending
  sent_at         TIMESTAMPTZ DEFAULT NOW(),
  sent_by         TEXT,           -- 'auto', 'manual', 'bulk', user email
  batch_id        UUID,           -- groups reminders sent in one bulk action
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reminder_log_patient   ON reminder_log(patient_id);
CREATE INDEX IF NOT EXISTS idx_reminder_log_type      ON reminder_log(reminder_type);
CREATE INDEX IF NOT EXISTS idx_reminder_log_sent_at   ON reminder_log(sent_at);
CREATE INDEX IF NOT EXISTS idx_reminder_log_batch     ON reminder_log(batch_id);
CREATE INDEX IF NOT EXISTS idx_reminder_log_source    ON reminder_log(source_table, source_id);

-- RLS
ALTER TABLE reminder_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reminder_log_read ON reminder_log;
CREATE POLICY reminder_log_read ON reminder_log
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS reminder_log_insert ON reminder_log;
CREATE POLICY reminder_log_insert ON reminder_log
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS reminder_log_anon_insert ON reminder_log;
CREATE POLICY reminder_log_anon_insert ON reminder_log
  FOR INSERT TO anon WITH CHECK (true);

-- Allow anon read for cron jobs
DROP POLICY IF EXISTS reminder_log_anon_read ON reminder_log;
CREATE POLICY reminder_log_anon_read ON reminder_log
  FOR SELECT TO anon USING (true);

-- ─── 2. Auto-reminder settings in hospital_settings (optional) ───
-- These are stored as JSON in the existing settings mechanism,
-- no schema change needed. Settings keys:
--   auto_reminder_enabled: boolean
--   auto_reminder_time: string (e.g., "08:00")
--   auto_reminder_types: string[] (e.g., ["appointment", "follow_up", "anc"])
