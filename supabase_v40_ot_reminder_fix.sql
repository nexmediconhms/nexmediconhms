-- ═══════════════════════════════════════════════════════════════
-- v40: OT Schedule Reminder Fix
-- Adds reminder_sent_at column to ot_schedules table
-- so that OT surgery reminders sync properly with the 
-- Reminders/WhatsApp Queue page.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE ot_schedules ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

-- Enable Realtime on ot_schedules (needed for live updates on Reminders page)
-- NOTE: You must also enable Realtime for this table in Supabase Dashboard → 
--       Database → Replication → Toggle ot_schedules ON.
