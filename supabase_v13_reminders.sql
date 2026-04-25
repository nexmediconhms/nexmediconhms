-- ================================================================
-- NexMedicon HMS — v13: Reminder tracking columns
-- Run in Supabase → SQL Editor → New Query
-- Safe to re-run (IF NOT EXISTS pattern).
-- ================================================================

-- Track when a WhatsApp reminder was last sent for each appointment
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'appointments' AND column_name = 'reminder_sent_at'
  ) THEN
    ALTER TABLE appointments ADD COLUMN reminder_sent_at TIMESTAMPTZ;
    RAISE NOTICE 'Column reminder_sent_at added to appointments.';
  ELSE
    RAISE NOTICE 'Column reminder_sent_at already exists — skipping.';
  END IF;
END $$;

-- Track when a follow-up reminder was last sent for each prescription
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'prescriptions' AND column_name = 'reminder_sent_at'
  ) THEN
    ALTER TABLE prescriptions ADD COLUMN reminder_sent_at TIMESTAMPTZ;
    RAISE NOTICE 'Column reminder_sent_at added to prescriptions.';
  ELSE
    RAISE NOTICE 'Column reminder_sent_at already exists — skipping.';
  END IF;
END $$;

-- Track when a post-delivery / vaccination reminder was last sent
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'discharge_summaries' AND column_name = 'reminder_sent_at'
  ) THEN
    ALTER TABLE discharge_summaries ADD COLUMN reminder_sent_at TIMESTAMPTZ;
    RAISE NOTICE 'Column reminder_sent_at added to discharge_summaries.';
  ELSE
    RAISE NOTICE 'Column reminder_sent_at already exists — skipping.';
  END IF;
END $$;
