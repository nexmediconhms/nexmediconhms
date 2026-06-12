-- ═══════════════════════════════════════════════════════════════════════
-- Migration 035: Clinic Settings Table (Issue 2 Fix)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Ensures clinic_settings table exists for DB-backed settings persistence.
-- ADDITIVE — uses IF NOT EXISTS, safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.clinic_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB,
  description TEXT,
  category    TEXT DEFAULT 'general',
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- If the table already existed without certain columns, add them now.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clinic_settings' AND column_name='category') THEN
    ALTER TABLE public.clinic_settings ADD COLUMN category TEXT DEFAULT 'general';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clinic_settings' AND column_name='description') THEN
    ALTER TABLE public.clinic_settings ADD COLUMN description TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clinic_settings' AND column_name='updated_by') THEN
    ALTER TABLE public.clinic_settings ADD COLUMN updated_by TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clinic_settings' AND column_name='created_at') THEN
    ALTER TABLE public.clinic_settings ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

COMMENT ON TABLE public.clinic_settings IS
  'Database-backed clinic settings (replaces localStorage). Key-value store with JSONB values.';

-- Index for category-based queries
CREATE INDEX IF NOT EXISTS idx_clinic_settings_category ON public.clinic_settings(category);
CREATE INDEX IF NOT EXISTS idx_clinic_settings_updated ON public.clinic_settings(updated_at DESC);

-- Enable RLS, then add a TEMPORARY allow-all policy. Migration 034 will
-- replace this with proper role-based policies. Without a placeholder
-- policy, enabling RLS would lock everyone out until 034 runs.
ALTER TABLE public.clinic_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='clinic_settings'
    AND policyname='clinic_settings_temp_allow_auth') THEN
    CREATE POLICY clinic_settings_temp_allow_auth ON public.clinic_settings
      FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
    RAISE NOTICE 'Created temporary allow-auth policy on clinic_settings (will be replaced by migration 034).';
  END IF;
END $$;

-- Seed essential settings with empty defaults (only if not already present).
-- This gives the admin a starting point in the UI.
INSERT INTO public.clinic_settings (key, value, description, category) VALUES
  ('clinic_name',         '""',     'Hospital/clinic display name',         'clinic_info'),
  ('clinic_address',      '""',     'Hospital address (multi-line)',        'clinic_info'),
  ('clinic_phone',        '""',     'Primary contact number',               'clinic_info'),
  ('clinic_email',        '""',     'Contact email',                        'clinic_info'),
  ('clinic_gst',          '""',     'GSTIN (15 chars)',                     'clinic_info'),
  ('doctor_name',         '""',     'Primary doctor full name',             'doctor_info'),
  ('doctor_qualification','""',     'Doctor qualifications (MD, MS, etc.)', 'doctor_info'),
  ('doctor_registration', '""',     'Medical Council registration number',  'doctor_info'),
  ('consultation_fee',    '500',    'Default OPD consultation fee (INR)',   'billing'),
  ('followup_fee',        '300',    'Follow-up consultation fee (INR)',     'billing'),
  ('opd_upi_id',          '""',     'UPI ID for OPD payments',              'payments'),
  ('ipd_upi_id',          '""',     'UPI ID for IPD payments',              'payments'),
  ('invoice_prefix',      '"INV"',  'Invoice number prefix',                'billing'),
  ('gst_percent_default', '0',      'Default GST % (0 for exempt services)','billing'),
  ('prescription_header', '""',     'Top text on prescription PDF',         'documents'),
  ('prescription_footer', '""',     'Footer text on prescription PDF',      'documents')
ON CONFLICT (key) DO NOTHING;

INSERT INTO schema_migrations (version, name, applied_at)
VALUES ('035', 'clinic_settings_db_backed', NOW())
ON CONFLICT DO NOTHING;
