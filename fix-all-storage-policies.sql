-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║  COMPREHENSIVE STORAGE RLS FIX                                             ║
-- ║                                                                            ║
-- ║  Fixes the error:                                                          ║
-- ║    "Storage unavailable (mime type text/plain is not supported)"            ║
-- ║    "new row violates row-level security policy"                            ║
-- ║                                                                            ║
-- ║  Creates RLS policies for ALL storage buckets used by the application:     ║
-- ║    1. consultation-files (OPD attachments, general uploads)                ║
-- ║    2. consultation-attachments (legacy name, some code references this)    ║
-- ║    3. ipd-files (IPD patient photos, wound photos, documents)              ║
-- ║                                                                            ║
-- ║  Also creates required tables if they don't exist:                         ║
-- ║    - ipd_files                                                             ║
-- ║    - doctor_alerts                                                         ║
-- ║    - insurance_claims                                                      ║
-- ║    - whatsapp_notifications                                                ║
-- ║                                                                            ║
-- ║  INSTRUCTIONS:                                                             ║
-- ║  1. Go to Supabase Dashboard > SQL Editor                                 ║
-- ║  2. Paste this entire file                                                 ║
-- ║  3. Click "Run"                                                            ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════
-- SECTION 1: CREATE ALL STORAGE BUCKETS
-- ═══════════════════════════════════════════════════════════════

-- Bucket 1: consultation-files (primary bucket for OPD/general uploads)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'consultation-files',
  'consultation-files',
  true,
  52428800,
  ARRAY[
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
    'image/webp', 'image/heic', 'image/heif', 'image/bmp',
    'image/svg+xml',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  public = true;

-- Bucket 2: consultation-attachments (legacy/alternate name)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'consultation-attachments',
  'consultation-attachments',
  true,
  52428800,
  ARRAY[
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
    'image/webp', 'image/heic', 'image/heif', 'image/bmp',
    'image/svg+xml',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  public = true;

-- Bucket 3: ipd-files (IPD patient photos, wound photos, documents)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ipd-files',
  'ipd-files',
  true,
  52428800,
  ARRAY[
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
    'image/webp', 'image/heic', 'image/heif', 'image/bmp',
    'image/svg+xml',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'text/csv',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  public = true;


-- ═══════════════════════════════════════════════════════════════
-- SECTION 2: DROP ALL EXISTING STORAGE POLICIES (clean slate)
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated users can upload"                           ON storage.objects;
DROP POLICY IF EXISTS "authenticated users can read"                             ON storage.objects;
DROP POLICY IF EXISTS "authenticated users can delete"                           ON storage.objects;
DROP POLICY IF EXISTS "authenticated can upload to consultation-attachments"     ON storage.objects;
DROP POLICY IF EXISTS "authenticated can read consultation-attachments"          ON storage.objects;
DROP POLICY IF EXISTS "authenticated can delete own attachments"                 ON storage.objects;
DROP POLICY IF EXISTS "authenticated can update consultation-attachments"        ON storage.objects;
DROP POLICY IF EXISTS "authenticated can upload to consultation-files"           ON storage.objects;
DROP POLICY IF EXISTS "authenticated can read consultation-files"                ON storage.objects;
DROP POLICY IF EXISTS "authenticated can delete consultation-files"              ON storage.objects;
DROP POLICY IF EXISTS "authenticated can update consultation-files"              ON storage.objects;
DROP POLICY IF EXISTS "authenticated can upload to ipd-files"                    ON storage.objects;
DROP POLICY IF EXISTS "authenticated can read ipd-files"                         ON storage.objects;
DROP POLICY IF EXISTS "authenticated can delete ipd-files"                       ON storage.objects;
DROP POLICY IF EXISTS "authenticated can update ipd-files"                       ON storage.objects;
DROP POLICY IF EXISTS "public can read consultation-files"                       ON storage.objects;
DROP POLICY IF EXISTS "public can read consultation-attachments"                 ON storage.objects;
DROP POLICY IF EXISTS "public can read ipd-files"                                ON storage.objects;
DROP POLICY IF EXISTS "allow public read consultation-files"                     ON storage.objects;
DROP POLICY IF EXISTS "allow public read consultation-attachments"               ON storage.objects;
DROP POLICY IF EXISTS "allow public read ipd-files"                              ON storage.objects;
DROP POLICY IF EXISTS "service role full access"                                  ON storage.objects;


-- ═══════════════════════════════════════════════════════════════
-- SECTION 3: CREATE RLS POLICIES FOR ALL BUCKETS
-- ═══════════════════════════════════════════════════════════════

-- ─── consultation-files bucket ────────────────────────────────
CREATE POLICY "authenticated can upload to consultation-files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'consultation-files');

CREATE POLICY "authenticated can read consultation-files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'consultation-files');

CREATE POLICY "authenticated can delete consultation-files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'consultation-files');

CREATE POLICY "authenticated can update consultation-files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'consultation-files');

-- Public read access (for public URLs to work)
CREATE POLICY "public can read consultation-files"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'consultation-files');

-- ─── consultation-attachments bucket ─────────────────────────
CREATE POLICY "authenticated can upload to consultation-attachments"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'consultation-attachments');

CREATE POLICY "authenticated can read consultation-attachments"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'consultation-attachments');

CREATE POLICY "authenticated can delete own attachments"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'consultation-attachments');

CREATE POLICY "authenticated can update consultation-attachments"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'consultation-attachments');

CREATE POLICY "public can read consultation-attachments"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'consultation-attachments');

-- ─── ipd-files bucket ─────────────────────────────────────────
CREATE POLICY "authenticated can upload to ipd-files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ipd-files');

CREATE POLICY "authenticated can read ipd-files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ipd-files');

CREATE POLICY "authenticated can delete ipd-files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'ipd-files');

CREATE POLICY "authenticated can update ipd-files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'ipd-files');

CREATE POLICY "public can read ipd-files"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'ipd-files');


-- ═══════════════════════════════════════════════════════════════
-- SECTION 4: CREATE REQUIRED TABLES (if not exist)
-- ═══════════════════════════════════════════════════════════════

-- IPD Files table (for storing upload metadata)
CREATE TABLE IF NOT EXISTS ipd_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ipd_admission_id UUID NOT NULL,
  patient_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER DEFAULT 0,
  storage_key TEXT,
  file_url TEXT,
  file_data TEXT,
  category TEXT DEFAULT 'general',
  description TEXT DEFAULT '',
  ai_extracted_data JSONB DEFAULT '{}',
  uploaded_by TEXT DEFAULT 'Staff',
  uploaded_by_role TEXT DEFAULT 'nurse',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Doctor Alerts table
CREATE TABLE IF NOT EXISTS doctor_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  patient_name TEXT,
  mrn TEXT,
  alert_type TEXT NOT NULL,
  alert_data JSONB DEFAULT '{}',
  severity TEXT DEFAULT 'warning',
  source TEXT DEFAULT 'system',
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Insurance Claims table
CREATE TABLE IF NOT EXISTS insurance_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL,
  patient_name TEXT NOT NULL,
  mrn TEXT,
  policy_number TEXT,
  tpa_name TEXT,
  insurance_company TEXT,
  claim_amount NUMERIC DEFAULT 0,
  approved_amount NUMERIC,
  status TEXT DEFAULT 'pre_auth_pending',
  admission_date DATE,
  discharge_date DATE,
  surgery_name TEXT,
  diagnosis TEXT,
  pre_auth_number TEXT,
  claim_number TEXT,
  settlement_utr TEXT,
  settlement_date DATE,
  documents_sent BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- WhatsApp Notifications log table
CREATE TABLE IF NOT EXISTS whatsapp_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  patient_name TEXT,
  mobile TEXT,
  notification_type TEXT,
  message_preview TEXT,
  recipient_type TEXT,
  status TEXT DEFAULT 'generated',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Reminder log table
CREATE TABLE IF NOT EXISTS reminder_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID,
  patient_name TEXT,
  mobile TEXT,
  reminder_type TEXT,
  source_table TEXT,
  source_id UUID,
  message_preview TEXT,
  channel TEXT DEFAULT 'whatsapp',
  status TEXT DEFAULT 'sent',
  sent_at TIMESTAMPTZ,
  sent_by TEXT,
  batch_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Lab Reports table (for lab partner portal)
CREATE TABLE IF NOT EXISTS lab_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL,
  report_name TEXT NOT NULL,
  report_date DATE DEFAULT CURRENT_DATE,
  lab_name TEXT,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  attachment_url TEXT,
  source TEXT DEFAULT 'manual',
  lab_partner_id UUID,
  lab_partner_name TEXT,
  portal_upload BOOLEAN DEFAULT false,
  portal_patient_mrn TEXT,
  extracted_values JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Lab Portal Users table
CREATE TABLE IF NOT EXISTS lab_portal_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  auth_token TEXT UNIQUE NOT NULL,
  lab_partner_id UUID,
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Lab Partners table
CREATE TABLE IF NOT EXISTS lab_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Clinic Notifications table
CREATE TABLE IF NOT EXISTS clinic_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT,
  type TEXT DEFAULT 'info',
  severity TEXT DEFAULT 'normal',
  source TEXT,
  entity_type TEXT,
  entity_id UUID,
  patient_id UUID,
  patient_name TEXT,
  mrn TEXT,
  target_roles TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════════
-- SECTION 5: ENABLE RLS ON ALL TABLES (but allow authenticated access)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE ipd_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_portal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_notifications ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access to these tables
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'ipd_files', 'doctor_alerts', 'insurance_claims',
    'whatsapp_notifications', 'reminder_log', 'lab_reports',
    'lab_portal_users', 'lab_partners', 'clinic_notifications'
  ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "authenticated full access on %I" ON %I', tbl, tbl);
    EXECUTE format('CREATE POLICY "authenticated full access on %I" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', tbl, tbl);
    -- Also allow service_role (for API routes using service key)
    EXECUTE format('DROP POLICY IF EXISTS "service_role full access on %I" ON %I', tbl, tbl);
    EXECUTE format('CREATE POLICY "service_role full access on %I" ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)', tbl, tbl);
  END LOOP;
END
$$;


-- ═══════════════════════════════════════════════════════════════
-- DONE! Verify:
-- ═══════════════════════════════════════════════════════════════
SELECT policyname, cmd, permissive, tablename
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;
