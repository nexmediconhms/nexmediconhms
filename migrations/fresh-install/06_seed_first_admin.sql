-- ════════════════════════════════════════════════════════════════════
-- 06_seed_first_admin.sql
--
-- FRESH-INSTALL STEP 7 of 7 — Create the FIRST admin user.
--
-- This is a TEMPLATE. You need to do TWO things:
--   1. In the Supabase dashboard → Authentication → Users → "Add user"
--      Create one user with the doctor's real email and a strong password.
--      Note the auth-id UUID (visible after creation).
--   2. Edit this file: replace the placeholders below with the values
--      you used in step 1, then run this SQL in the Supabase SQL editor.
--
-- After this:
--   - The doctor logs in with that email and password.
--   - The doctor can then create staff/lab_partner accounts from the
--     Settings → Users page in the app.
--
-- WHY NOT AUTO-SEED 4 USERS LIKE /api/reset-seed:
--   /api/reset-seed creates four hard-coded accounts with the password
--   "Welcome@1234". For a real clinic, that is a security incident
--   waiting to happen (the credentials are documented in the source
--   code). Always set up the first admin manually with a private
--   password chosen by the clinic owner.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══ EDIT THESE VALUES ═══════════════════════════════════════════════
-- Step 1: Get the auth_id from the Supabase Authentication panel after
--         you've added the user there with their email + password.
-- ─────────────────────────────────────────────────────────────────────

-- Example (replace before running):
--   ADMIN_AUTH_ID:  'a1b2c3d4-e5f6-7890-abcd-1234567890ab'
--   ADMIN_EMAIL:    'doctor@example-clinic.in'
--   ADMIN_FULL_NAME: 'Dr. R. Patel'
--   ADMIN_PHONE:    '+919876543210'

DO $$
DECLARE
  v_admin_auth_id   UUID := 'REPLACE-WITH-AUTH-ID-FROM-SUPABASE-DASHBOARD';
  v_admin_email     TEXT := 'REPLACE-WITH-CLINIC-OWNER-EMAIL@example.in';
  v_admin_full_name TEXT := 'REPLACE WITH CLINIC OWNER FULL NAME';
  v_admin_phone     TEXT := '+91XXXXXXXXXX';
BEGIN
  -- Refuse to run with placeholder values
  IF v_admin_auth_id::TEXT LIKE 'REPLACE-%'
     OR v_admin_email LIKE 'REPLACE-%'
     OR v_admin_full_name LIKE 'REPLACE %' THEN
    RAISE EXCEPTION 'Edit 06_seed_first_admin.sql with the real admin auth_id, email, and name before running.';
  END IF;

  INSERT INTO clinic_users (auth_id, email, full_name, role, phone, is_active)
    VALUES (v_admin_auth_id, v_admin_email, v_admin_full_name, 'admin', v_admin_phone, TRUE)
    ON CONFLICT (email) DO UPDATE
      SET auth_id = EXCLUDED.auth_id,
          full_name = EXCLUDED.full_name,
          role = 'admin',
          phone = EXCLUDED.phone,
          is_active = TRUE,
          updated_at = NOW();

  RAISE NOTICE 'Admin user % seeded with role=admin', v_admin_email;
END $$;

-- ═══ Initial clinic settings (light-touch defaults) ══════════════════
-- These can all be edited in the app at Settings → Clinic.

INSERT INTO clinic_settings (key, value) VALUES
  ('hospitalName',  'My Clinic'),
  ('phone',         ''),
  ('address',       ''),
  ('gstin',         ''),
  ('doctorName',    ''),
  ('doctorMobile',  ''),
  ('staffMobile',   ''),
  ('opdRegistrationFee', '500'),
  ('gstPercent',    '0'),
  ('currency',      'INR')
ON CONFLICT (key) DO NOTHING;

-- ═══ Audit log: record the bootstrap event ═══════════════════════════
PERFORM insert_audit_entry(
  NULL,
  'system',
  'system',
  'create',
  'user',
  NULL,
  'Fresh-install: first admin seeded',
  jsonb_build_object('migration', 'FI-06', 'event', 'first_admin_seeded')
);

INSERT INTO schema_migrations (version, name, applied_at, notes)
VALUES ('FI-06', 'fresh_install_seed_first_admin', NOW(),
        'First admin user created and clinic_settings defaults inserted')
ON CONFLICT (version) DO NOTHING;

COMMIT;

SELECT 'Fresh-install 06/07: First admin seeded — DONE' AS result;
SELECT 'Fresh-install COMPLETE — log in at /login with your admin credentials.' AS next_step;
