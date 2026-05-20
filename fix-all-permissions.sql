-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║  NexMedicon HMS — FIX ALL PERMISSIONS (DEFINITIVE)                          ║
-- ║                                                                              ║
-- ║  This script creates ALL tables used by the application and DISABLES RLS     ║
-- ║  on every single one. No more "permission denied" errors anywhere.           ║
-- ║                                                                              ║
-- ║  RUN THIS ONCE after SETUP-LOGIN-FIX.sql                                    ║
-- ║  Supabase Dashboard → SQL Editor → New Query → Paste → Run                  ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════════════
-- HELPER: Function to safely disable RLS + grant access on any table
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fix_table_permissions(tbl TEXT) RETURNS void AS $$
BEGIN
  EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('GRANT ALL ON public.%I TO authenticated', tbl);
  EXECUTE format('GRANT ALL ON public.%I TO service_role', tbl);
  EXECUTE format('GRANT SELECT, INSERT ON public.%I TO anon', tbl);
EXCEPTION WHEN undefined_table THEN
  -- Table doesn't exist yet, skip
  NULL;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════════
-- CORE TABLES: Create if not exist + fix permissions
-- ═══════════════════════════════════════════════════════════════════════════════

-- patients
CREATE TABLE IF NOT EXISTS public.patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mrn TEXT UNIQUE,
  full_name TEXT NOT NULL,
  date_of_birth DATE,
  age INTEGER,
  gender TEXT DEFAULT 'Female',
  mobile TEXT,
  alternate_mobile TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  blood_group TEXT,
  aadhaar TEXT,
  aadhaar_no TEXT,
  abha_id TEXT,
  abha_number TEXT,
  abha_address TEXT,
  abha_verified BOOLEAN DEFAULT FALSE,
  insurance_name TEXT,
  insurance_id TEXT,
  mediclaim TEXT DEFAULT 'No',
  cashless TEXT DEFAULT 'No',
  referred_by TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  notes TEXT,
  doctor_id UUID,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- encounters
CREATE TABLE IF NOT EXISTS public.encounters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  encounter_date DATE DEFAULT CURRENT_DATE,
  encounter_type TEXT DEFAULT 'OPD',
  doctor_id UUID,
  doctor_name TEXT,
  chief_complaint TEXT,
  hpi TEXT,
  pulse NUMERIC,
  bp_systolic NUMERIC,
  bp_diastolic NUMERIC,
  temperature NUMERIC,
  spo2 NUMERIC,
  weight NUMERIC,
  height NUMERIC,
  diagnosis TEXT,
  icd10_codes JSONB,
  notes TEXT,
  clinical_notes TEXT,
  ob_data JSONB,
  plan TEXT,
  follow_up_date DATE,
  follow_up_note TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- prescriptions
CREATE TABLE IF NOT EXISTS public.prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID,
  patient_id UUID,
  patient_name TEXT,
  mrn TEXT,
  mobile TEXT,
  medications JSONB DEFAULT '[]',
  advice TEXT,
  dietary_advice TEXT,
  reports_needed TEXT,
  follow_up_date DATE,
  follow_up_note TEXT,
  diagnosis TEXT,
  doctor_id UUID,
  doctor_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- bills
CREATE TABLE IF NOT EXISTS public.bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  patient_name TEXT,
  mrn TEXT,
  invoice_number TEXT UNIQUE,
  items JSONB DEFAULT '[]',
  subtotal NUMERIC(10,2) DEFAULT 0,
  discount NUMERIC(10,2) DEFAULT 0,
  tax NUMERIC(10,2) DEFAULT 0,
  total NUMERIC(10,2) DEFAULT 0,
  net_amount NUMERIC(10,2) DEFAULT 0,
  paid NUMERIC(10,2) DEFAULT 0,
  due NUMERIC(10,2) DEFAULT 0,
  payment_mode TEXT,
  status TEXT DEFAULT 'unpaid',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- bill_payments
CREATE TABLE IF NOT EXISTS public.bill_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID,
  amount NUMERIC(10,2) NOT NULL,
  payment_mode TEXT,
  reference TEXT,
  notes TEXT,
  received_by TEXT,
  transaction_type TEXT DEFAULT 'payment',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- lab_reports
CREATE TABLE IF NOT EXISTS public.lab_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  encounter_id UUID,
  report_name TEXT NOT NULL,
  report_date DATE DEFAULT CURRENT_DATE,
  lab_name TEXT,
  result TEXT,
  normal_range TEXT,
  unit TEXT,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  attachment_url TEXT,
  source TEXT DEFAULT 'manual',
  lab_partner_id UUID,
  lab_partner_name TEXT,
  portal_upload BOOLEAN DEFAULT FALSE,
  portal_patient_mrn TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- lab_partners
CREATE TABLE IF NOT EXISTS public.lab_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- lab_portal_users
CREATE TABLE IF NOT EXISTS public.lab_portal_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  lab_partner_id UUID,
  auth_token TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- beds
CREATE TABLE IF NOT EXISTS public.beds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bed_number TEXT NOT NULL UNIQUE,
  ward TEXT,
  type TEXT DEFAULT 'General',
  status TEXT DEFAULT 'available',
  patient_id UUID,
  patient_name TEXT,
  admission_date DATE,
  expected_discharge DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ipd_admissions
CREATE TABLE IF NOT EXISTS public.ipd_admissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  bed_id UUID,
  admission_date DATE DEFAULT CURRENT_DATE,
  discharge_date DATE,
  admitting_doctor TEXT,
  diagnosis TEXT,
  notes TEXT,
  status TEXT DEFAULT 'admitted',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ipd_nursing
CREATE TABLE IF NOT EXISTS public.ipd_nursing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id UUID,
  patient_id UUID,
  note_type TEXT,
  notes TEXT,
  vitals JSONB,
  medications_given JSONB,
  recorded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ipd_charges
CREATE TABLE IF NOT EXISTS public.ipd_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id UUID,
  patient_id UUID,
  item_name TEXT NOT NULL,
  category TEXT,
  amount NUMERIC(10,2) NOT NULL,
  quantity INTEGER DEFAULT 1,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ipd_charge_rates
CREATE TABLE IF NOT EXISTS public.ipd_charge_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT,
  amount NUMERIC(10,2) NOT NULL,
  unit TEXT DEFAULT 'per day',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- anc_visits
CREATE TABLE IF NOT EXISTS public.anc_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  visit_date DATE DEFAULT CURRENT_DATE,
  gestational_age TEXT,
  weight NUMERIC,
  bp_systolic NUMERIC,
  bp_diastolic NUMERIC,
  fhs NUMERIC,
  fundal_height NUMERIC,
  presentation TEXT,
  notes TEXT,
  doctor_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- appointments
CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  patient_name TEXT,
  mrn TEXT,
  mobile TEXT,
  date DATE NOT NULL,
  time TEXT NOT NULL,
  type TEXT,
  notes TEXT,
  status TEXT DEFAULT 'scheduled',
  reminder_sent BOOLEAN DEFAULT FALSE,
  video_link TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- opd_queue
CREATE TABLE IF NOT EXISTS public.opd_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  patient_name TEXT,
  mrn TEXT,
  mobile TEXT,
  queue_number INTEGER,
  date DATE DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'waiting',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- discharge_summaries
CREATE TABLE IF NOT EXISTS public.discharge_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  admission_id UUID,
  discharge_date DATE DEFAULT CURRENT_DATE,
  diagnosis TEXT,
  procedures TEXT,
  medications_at_discharge JSONB,
  follow_up_instructions TEXT,
  condition_at_discharge TEXT,
  doctor_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- clinic_settings
CREATE TABLE IF NOT EXISTS public.clinic_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- audit_log
CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT,
  entity_type TEXT,
  entity_id TEXT,
  entity_label TEXT,
  changes TEXT,
  user_id TEXT,
  user_email TEXT,
  user_role TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- reminder_log
CREATE TABLE IF NOT EXISTS public.reminder_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT,
  reminder_type TEXT,
  patient_id UUID,
  patient_name TEXT,
  mobile TEXT,
  message TEXT,
  channel TEXT DEFAULT 'whatsapp',
  status TEXT DEFAULT 'sent',
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- whatsapp_notifications
CREATE TABLE IF NOT EXISTS public.whatsapp_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  mobile TEXT,
  message TEXT,
  template TEXT,
  status TEXT DEFAULT 'sent',
  sent_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- clinic_notifications
CREATE TABLE IF NOT EXISTS public.clinic_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  message TEXT,
  type TEXT,
  severity TEXT DEFAULT 'normal',
  source TEXT,
  entity_type TEXT,
  entity_id TEXT,
  patient_id UUID,
  patient_name TEXT,
  mrn TEXT,
  target_roles JSONB,
  metadata JSONB,
  read_by JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- daily_closings
CREATE TABLE IF NOT EXISTS public.daily_closings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_date DATE UNIQUE,
  total_collected NUMERIC(10,2) DEFAULT 0,
  cash_collected NUMERIC(10,2) DEFAULT 0,
  upi_collected NUMERIC(10,2) DEFAULT 0,
  card_collected NUMERIC(10,2) DEFAULT 0,
  total_discount NUMERIC(10,2) DEFAULT 0,
  total_pending NUMERIC(10,2) DEFAULT 0,
  total_refunds NUMERIC(10,2) DEFAULT 0,
  opd_count INTEGER DEFAULT 0,
  ipd_count INTEGER DEFAULT 0,
  bills_count INTEGER DEFAULT 0,
  closed_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- payment_transactions
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID,
  patient_id UUID,
  amount NUMERIC(10,2),
  transaction_type TEXT DEFAULT 'payment',
  payment_mode TEXT,
  reference TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- hospital_fund
CREATE TABLE IF NOT EXISTS public.hospital_fund (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  category TEXT,
  amount NUMERIC(10,2) NOT NULL,
  description TEXT,
  date DATE DEFAULT CURRENT_DATE,
  approved_by TEXT,
  submitted_by TEXT,
  status TEXT DEFAULT 'pending',
  receipt_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ot_schedules
CREATE TABLE IF NOT EXISTS public.ot_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  patient_name TEXT,
  procedure_name TEXT,
  scheduled_date DATE,
  scheduled_time TEXT,
  surgeon TEXT,
  anesthesiologist TEXT,
  status TEXT DEFAULT 'scheduled',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- patient_allergies
CREATE TABLE IF NOT EXISTS public.patient_allergies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  allergen TEXT NOT NULL,
  type TEXT,
  severity TEXT,
  reaction TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- consultation_attachments
CREATE TABLE IF NOT EXISTS public.consultation_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  encounter_id UUID,
  file_name TEXT,
  file_type TEXT,
  file_url TEXT,
  file_size INTEGER,
  notes TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- consultation_files_db
CREATE TABLE IF NOT EXISTS public.consultation_files_db (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  encounter_id UUID,
  file_name TEXT,
  file_type TEXT,
  file_data TEXT,
  notes TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- cron_job_log
CREATE TABLE IF NOT EXISTS public.cron_job_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT,
  status TEXT,
  details TEXT,
  run_at TIMESTAMPTZ DEFAULT NOW()
);

-- backup_log
CREATE TABLE IF NOT EXISTS public.backup_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_type TEXT,
  status TEXT,
  file_url TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- follow_ups
CREATE TABLE IF NOT EXISTS public.follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  patient_name TEXT,
  mobile TEXT,
  due_date DATE,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- reminders
CREATE TABLE IF NOT EXISTS public.reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  patient_name TEXT,
  mobile TEXT,
  type TEXT,
  reminder_type TEXT,
  due_date DATE,
  message TEXT,
  status TEXT DEFAULT 'pending',
  metadata TEXT,
  sent_by TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- portal_sessions
CREATE TABLE IF NOT EXISTS public.portal_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  token TEXT UNIQUE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- portal_tokens
CREATE TABLE IF NOT EXISTS public.portal_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  token TEXT UNIQUE,
  expires_at TIMESTAMPTZ,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- doctor_alerts
CREATE TABLE IF NOT EXISTS public.doctor_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  patient_name TEXT,
  alert_type TEXT,
  message TEXT,
  severity TEXT DEFAULT 'normal',
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- billing_packages
CREATE TABLE IF NOT EXISTS public.billing_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT,
  items JSONB DEFAULT '[]',
  total NUMERIC(10,2),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- NOW: Disable RLS + Grant permissions on EVERY table
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT fix_table_permissions('patients');
SELECT fix_table_permissions('encounters');
SELECT fix_table_permissions('prescriptions');
SELECT fix_table_permissions('bills');
SELECT fix_table_permissions('bill_payments');
SELECT fix_table_permissions('lab_reports');
SELECT fix_table_permissions('lab_partners');
SELECT fix_table_permissions('lab_portal_users');
SELECT fix_table_permissions('beds');
SELECT fix_table_permissions('ipd_admissions');
SELECT fix_table_permissions('ipd_nursing');
SELECT fix_table_permissions('ipd_charges');
SELECT fix_table_permissions('ipd_charge_rates');
SELECT fix_table_permissions('anc_visits');
SELECT fix_table_permissions('appointments');
SELECT fix_table_permissions('opd_queue');
SELECT fix_table_permissions('discharge_summaries');
SELECT fix_table_permissions('clinic_settings');
SELECT fix_table_permissions('clinic_users');
SELECT fix_table_permissions('audit_log');
SELECT fix_table_permissions('reminder_log');
SELECT fix_table_permissions('whatsapp_notifications');
SELECT fix_table_permissions('clinic_notifications');
SELECT fix_table_permissions('daily_closings');
SELECT fix_table_permissions('payment_transactions');
SELECT fix_table_permissions('hospital_fund');
SELECT fix_table_permissions('ot_schedules');
SELECT fix_table_permissions('patient_allergies');
SELECT fix_table_permissions('consultation_attachments');
SELECT fix_table_permissions('consultation_files_db');
SELECT fix_table_permissions('cron_job_log');
SELECT fix_table_permissions('backup_log');
SELECT fix_table_permissions('follow_ups');
SELECT fix_table_permissions('reminders');
SELECT fix_table_permissions('portal_sessions');
SELECT fix_table_permissions('portal_tokens');
SELECT fix_table_permissions('doctor_alerts');
SELECT fix_table_permissions('billing_packages');

-- Clean up the helper function
DROP FUNCTION fix_table_permissions(TEXT);

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX SEQUENCES: Grant usage on ALL sequences (fixes "permission denied for sequence")
-- This covers patient_mrn_seq and any other auto-increment sequences
-- ═══════════════════════════════════════════════════════════════════════════════

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;

-- Also set default privileges so future sequences are automatically accessible
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFY: Count tables with RLS disabled
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT 
  '✅ ALL PERMISSIONS FIXED!' AS status,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS total_tables,
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity) AS tables_without_rls;
