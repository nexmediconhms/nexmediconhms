# 🏥 NexMedicon HMS — Doctor Deployment Guide

## ⚠️ READINESS ASSESSMENT

### Can you give this software to the doctor RIGHT NOW?
**❌ NO — not without first running the deployment steps below.**

### Why?
1. **Database has accumulated schema drift** — application code references columns that may not exist (portal_otp table, lab_reports.test_name, etc.)
2. **Old test/demo data** likely exists in the live DB (Test Patient 1, Test Patient 2, etc. visible in your screenshots)
3. **Environment variables** (`NEXT_PUBLIC_SITE_URL`) have a trailing slash causing the portal 404
4. **Some unauthenticated API endpoints** exist that expose patient data
5. **Hospital-specific configuration** (name, logo, address, doctor name, phone) not yet customized

### After following this guide, the software will be:
- ✅ Fully functional for OPD/IPD operations
- ✅ Secure (all APIs authenticated)
- ✅ Clean (no test data)
- ✅ Customized for the doctor's hospital

---

## 📋 PART 1: PREPARING A CLEAN DATABASE

You have **two options** for the doctor's installation:

### OPTION A: New Supabase Project (Recommended — Cleanest)
Create a fresh Supabase project for the doctor. This is the safest, cleanest option.

### OPTION B: Reset Existing Project
Wipe data from your existing Supabase project and reuse it.

---

## OPTION A: Setting Up a Brand New Supabase Project

### Step 1: Create the Supabase Project
1. Go to https://supabase.com and log in
2. Click **"New Project"**
3. Fill in:
   - **Name:** `<doctor-clinic-name>-hms` (e.g., `sarvam-hospital-hms`)
   - **Database Password:** Generate a strong password and **save it securely**
   - **Region:** Choose closest to the doctor's location (e.g., `Mumbai (ap-south-1)` for India)
   - **Pricing Plan:** Free tier is fine for starting; upgrade as patient volume grows
4. Click **"Create new project"** and wait ~2 minutes for provisioning

### Step 2: Run the Schema Setup
Once the project is ready:
1. In Supabase dashboard, go to **SQL Editor** (left sidebar)
2. Click **"New Query"**
3. Copy-paste the contents of `migrations/applied/v00-schema-master.sql` and click **Run**
4. Then run these migrations in order (copy-paste each into a new query):
   - `migrations/applied/v01_validation_constraints.sql`
   - `migrations/applied/bill_versions_migration.sql`
   - `migrations/applied/add-revenue-lifecycle-columns.sql`
   - `migrations/006_add_bill_audit_columns.sql`
   - `migrations/007_payment_attempts_table.sql`
   - `migrations/008_schema_migrations_table.sql`
   - `migrations/009_enable_rls_policies.sql`
   - `migrations/010_billing_sequence_finance_sync.sql`
   - `migrations/010_fix_missing_columns_and_tables.sql`
   - `migrations/011_fix_lab_partners_columns.sql`
   - `migrations/013_real_fixes_pharmacy_and_nursing.sql`
   - `migrations/014_prevent_duplicate_queue_entries.sql`
   - **`migrations/017_comprehensive_schema_alignment.sql`** ← THE NEW ONE FROM THIS BRANCH

Each migration should end with a green "Success" message.

### Step 3: Configure Storage Buckets
In Supabase dashboard → **Storage**:
1. Click **"New bucket"** and create these (all private):
   - `consultation-files` (for patient consultation attachments)
   - `ipd-files` (for IPD nursing photos/documents)
   - `attachments` (for general attachments)
2. For each bucket → click **"Policies"** → **"Add policy"** → Use template "Allow access to authenticated users only"

### Step 4: Get Your API Keys
In Supabase dashboard → **Settings → API**:
1. Copy **Project URL** (looks like `https://abcxyz.supabase.co`)
2. Copy **anon public** key
3. Copy **service_role** key (keep this SECRET — never put in frontend code)

### Step 5: Create the First Admin User
1. Go to **Authentication → Users → Invite user**
2. Enter the doctor's email (e.g., `dr.sarvam@example.com`)
3. The doctor receives an invitation email and sets their password
4. Then in **SQL Editor**, run:

```sql
INSERT INTO clinic_users (auth_id, email, full_name, role, is_active)
SELECT
  id,
  email,
  'Dr. <Doctor Full Name>',  -- ← Replace this
  'admin',
  true
FROM auth.users
WHERE email = 'dr.sarvam@example.com';  -- ← Replace this
```

### Step 6: Configure Hospital Settings
Run this in SQL Editor (replace values with the doctor's clinic info):

```sql
-- Clear any default settings first
DELETE FROM clinic_settings WHERE key IN (
  'hospitalName','address','phone','email','doctorName','doctorMobile',
  'gstNumber','registrationNo','daily_revenue_target'
);

-- Insert hospital details
INSERT INTO clinic_settings (key, value) VALUES
  ('hospitalName',         'Sarvam Hospital'),                          -- ← Replace
  ('address',              'Plot 123, Main Road, City, State, PIN'),    -- ← Replace
  ('phone',                '+91 9876543210'),                            -- ← Replace
  ('email',                'contact@sarvamhospital.com'),                -- ← Replace
  ('doctorName',           'Dr. Sarvam Patel'),                          -- ← Replace
  ('doctorMobile',         '+91 9876543210'),                            -- ← Replace (for WhatsApp alerts)
  ('gstNumber',            '24ABCDE1234F1Z5'),                           -- ← Replace (or leave blank)
  ('registrationNo',       'DMC/12345/2020'),                            -- ← Replace
  ('daily_revenue_target', '15000')                                      -- ← Daily revenue target in ₹
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

---

## OPTION B: Resetting an Existing Supabase Project

⚠️ **WARNING**: This will DELETE ALL existing data. Only do this if you're sure.

### Step 1: Export Current Data First (Backup)
In Supabase dashboard → **Database → Backups** → Click **"Take backup"** before doing anything.

### Step 2: Wipe All Data (Keep Schema)
Run this in SQL Editor:

```sql
-- ⚠️ DESTRUCTIVE: Deletes all data but keeps tables/indexes/policies
BEGIN;

-- Disable triggers temporarily to allow truncation
SET session_replication_role = 'replica';

-- Truncate in dependency order (children first)
TRUNCATE TABLE
  reminder_log,
  whatsapp_notifications,
  clinic_notifications,
  doctor_alerts,
  audit_log,
  insurance_claim_history,
  insurance_claims,
  bill_payments,
  bills,
  lab_reports,
  ipd_nursing,
  ipd_files,
  ipd_charges,
  ipd_admissions,
  discharge_summaries,
  appointments,
  prescriptions,
  encounters,
  ot_schedules,
  opd_queue,
  anc_visits,
  pharmacy_stock_log,
  pharmacy_batches,
  hospital_fund,
  portal_sessions,
  portal_otp,
  portal_tokens,
  patients
RESTART IDENTITY CASCADE;

-- Reset bill sequence numbers
SELECT setval('bills_id_seq', 1, false) WHERE EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bills_id_seq');

-- Re-enable triggers
SET session_replication_role = 'origin';

COMMIT;

SELECT 'Database wiped clean, schema preserved' AS result;
```

### Step 3: Run Migration 017 (Schema Alignment)
Copy-paste `migrations/017_comprehensive_schema_alignment.sql` into SQL Editor and run it.

### Step 4: Reset Auth Users (Optional)
If you want to remove all old test users:
1. **Authentication → Users** → Select all old users → Delete
2. Then follow Step 5 of Option A to invite the doctor as admin

### Step 5: Configure Hospital Settings
Same as Option A, Step 6.

---

## 📋 PART 2: ENVIRONMENT VARIABLES SETUP

### For Vercel Deployment

Go to your Vercel project → **Settings → Environment Variables**. Set these:

| Variable | Value | Notes |
|----------|-------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<your-project>.supabase.co` | From Supabase Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | The anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | ⚠️ Keep secret! Never expose in frontend |
| `NEXT_PUBLIC_SITE_URL` | `https://your-domain.com` | **NO TRAILING SLASH** |
| `NEXT_PUBLIC_HOSPITAL_NAME` | `Sarvam Hospital` | Used in WhatsApp messages |
| `CRON_SECRET` | `<generate-random-32-chars>` | For securing cron endpoints |
| `OPENAI_API_KEY` | `sk-...` | Optional: for AI features (lab extraction, summaries) |
| `HOSPITAL_ENCRYPTION_KEY` | `<32-char-hex>` | For PHI encryption (Aadhaar etc.) |
| `RAZORPAY_KEY_ID` | `rzp_...` | Optional: for online payments |
| `RAZORPAY_KEY_SECRET` | `<secret>` | Optional |

### ⚠️ CRITICAL: Verify NEXT_PUBLIC_SITE_URL has NO trailing slash
- ✅ **Correct:** `https://nexmediconhms.vercel.app`
- ❌ **Wrong:** `https://nexmediconhms.vercel.app/` (causes 404 on portal links)

### Generate the encryption key
Run this in your terminal:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy the output as the value for `HOSPITAL_ENCRYPTION_KEY`.

### Generate CRON_SECRET
```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

---

## 📋 PART 3: DEPLOY THE LATEST CODE

### Step 1: Merge the Fix Branch
The fix branch `fix/all-issues-comprehensive` contains all the critical fixes:
1. Portal authorization fix
2. Portal URL double-slash fix
3. Database schema alignment
4. Security fixes for unauthenticated APIs
5. Lab reports portal compatibility fix
6. Duplicate-check route schema fix

Merge it via GitHub UI or:
```bash
git checkout main
git merge fix/all-issues-comprehensive
git push origin main
```

### Step 2: Wait for Vercel Auto-Deploy
Vercel will automatically deploy the merged code (takes ~2 minutes).

### Step 3: Trigger a Fresh Deployment
After updating env variables, click **"Redeploy"** in Vercel to apply changes.

---

## 📋 PART 4: HANDOVER CHECKLIST

### Before handing over to the doctor, verify ALL of these:

#### A. Database
- [ ] Migration 017 ran successfully (no errors in SQL Editor)
- [ ] All tables exist: `patients`, `encounters`, `prescriptions`, `bills`, `lab_reports`, `opd_queue`, `appointments`, `ot_schedules`, `ipd_admissions`, `beds`, `discharge_summaries`, `portal_otp`, `portal_sessions`, `portal_tokens`
- [ ] Demo/test data is removed (no "Test Patient" entries)
- [ ] Doctor is created in `clinic_users` with role='admin'
- [ ] Hospital settings are populated in `clinic_settings`
- [ ] Storage buckets created: `consultation-files`, `ipd-files`, `attachments`

#### B. Environment
- [ ] `NEXT_PUBLIC_SITE_URL` is set with NO trailing slash
- [ ] All Supabase keys are correctly set in Vercel
- [ ] `HOSPITAL_ENCRYPTION_KEY` is generated and set
- [ ] `CRON_SECRET` is generated and set
- [ ] `NEXT_PUBLIC_HOSPITAL_NAME` matches the doctor's clinic

#### C. Functional Smoke Tests (do these AS THE DOCTOR after deployment)
- [ ] **Login** with the doctor's credentials succeeds
- [ ] **Dashboard** loads without errors
- [ ] **Register a new patient** → patient saved with correct MRN format
- [ ] **Add patient to OPD queue** → token assigned correctly
- [ ] **Start consultation** → can record vitals, diagnosis, prescription
- [ ] **Generate a bill** → invoice number assigned, payment recordable
- [ ] **Click Portal button** → WhatsApp opens with correct URL (single slash, not double)
- [ ] **Open the portal URL in a browser** → Portal verify page loads (no 404)
- [ ] **Book an appointment** → reminder generated correctly
- [ ] **Add a medicine to pharmacy** → low-stock alert works
- [ ] **Schedule a surgery** → OT schedule shows it correctly
- [ ] **Admit patient to IPD** → bed status changes to occupied
- [ ] **Discharge patient** → bill auto-generated, bed freed

#### D. Security Verification
- [ ] Try opening `/api/insurance/sync` in browser without logging in → should get 401
- [ ] Try opening `/api/labs/portal-users` without admin role → should get 403
- [ ] Try opening `/api/audit` as non-admin → should get 403

---

## 📋 PART 5: POST-HANDOVER MAINTENANCE

### Daily
- Check `Daily Closing` to verify revenue
- Review `Doctor Alerts` for abnormal lab values
- Send pending WhatsApp reminders

### Weekly
- Backup database (Supabase → Backups → Take backup)
- Review audit log for unusual activity
- Check pharmacy for expiring medicines

### Monthly
- Review user accounts (deactivate ex-staff)
- Update lab partner commission rates if changed
- Export financial reports

---

## 🚨 EMERGENCY CONTACTS / ROLLBACK

If something breaks after deployment:

### Quick rollback in Vercel
1. Vercel Dashboard → Deployments
2. Find the last working deployment
3. Click **"..."** → **"Promote to Production"**

### Rollback database migration
```sql
-- Migration 017 only ADDS columns, never drops.
-- To rollback: just don't use the new columns.
-- The app code falls back to old column names where possible.
```

### Restore from backup
1. Supabase → Database → Backups
2. Select the backup → **Restore**

---

## 📞 SUPPORT INFORMATION

When the doctor reports an issue, ask them for:
1. **Screenshot of the error**
2. **What action triggered it** (which button, which page)
3. **Browser console output** (F12 → Console tab)
4. **Vercel function logs** (Vercel → Functions → Logs)
5. **Time of the error** (so you can find it in audit_log)

---

## ✅ FINAL VERDICT

**With this guide followed, the software IS READY to give to the doctor.**

The codebase is feature-complete for an Indian gynecology/general practice clinic with:
- Patient management
- OPD consultation + queue
- Appointments + WhatsApp reminders
- ANC registry with risk assessment
- Pharmacy inventory
- OT scheduling with conflict detection
- IPD admissions + nursing chart
- Bed management
- Billing with sequential invoices
- Insurance claim tracking
- Lab integration with revenue sharing
- Patient portal with OTP login
- Online payments via Razorpay
- AI features (clinical summary, lab extraction)
- Daily closing reports
- Audit trail
- HIPAA/DISHA-aligned security

**Estimated setup time:** 2-3 hours for a clean deployment, including data entry of doctor's specific configuration.
