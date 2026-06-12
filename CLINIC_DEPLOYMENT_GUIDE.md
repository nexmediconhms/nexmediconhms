# NexMedicon HMS — Clinic Deployment & SQL Migration Guide

## TABLE OF CONTENTS
1. SQL Files: What to Keep, Delete, and Run
2. Data Dependencies in SQL Files
3. Step-by-Step Clinic Deployment
4. First Admin User Setup
5. Post-Deployment Checklist

---

## 1. SQL FILES — KEEP vs DELETE

### ═══ CATEGORY A: MUST KEEP — Fresh Install (run in this order) ═══

| # | File | Purpose | Run Order |
|---|------|---------|-----------|
| 1 | `migrations/applied/v00-schema-master.sql` | Creates ALL base tables (patients, clinicusers, encounters, bills, etc.) | **RUN FIRST** |
| 2 | `migrations/applied/v01_validation_constraints.sql` | Adds constraints and validation rules | **RUN SECOND** |

### ═══ CATEGORY B: MUST KEEP — Incremental Fixes (run in number order) ═══

These add columns, fix schemas, and create new tables that the app code expects.
Run them IN ORDER after v00 + v01.

| # | File | Purpose |
|---|------|---------|
| 3 | `006_add_bill_audit_columns.sql` | Bill audit trail columns |
| 4 | `007_payment_attempts_table.sql` | Payment attempts tracking |
| 5 | `008_schema_migrations_table.sql` | Migration tracking table |
| 6 | `009_enable_rls_policies.sql` | Row Level Security policies |
| 7 | `010_billing_sequence_finance_sync.sql` | Invoice numbering + hospital fund |
| 8 | `010_fix_missing_columns_and_tables.sql` | Missing columns fix |
| 9 | `011_fix_lab_partners_columns.sql` | Lab partner schema |
| 10 | `013_real_fixes_pharmacy_and_nursing.sql` | Pharmacy + nursing tables |
| 11 | `014_prevent_duplicate_queue_entries.sql` | Queue deduplication |
| 12 | `016_portal_full_schema_fix.sql` | Patient portal tables |
| 13 | `017_comprehensive_schema_alignment.sql` | Column name alignment (legacy → modern) |
| 14 | `018_align_ipd_charges_schema.sql` | IPD charge rates |
| 15 | `019_align_ipd_admissions_bill_columns.sql` | IPD admission + bill columns |
| 16 | `020_critical_constraints_phase1.sql` | Critical constraints |
| 17 | `021_fix_consultation_attachments_columns.sql` | Attachment columns |
| 18 | `022.sql` | Schema additions |
| 19 | `023.sql` | Schema additions |
| 20 | `024.sql` | Schema additions |
| 21 | `025_ipd_nursing_complete.sql` | Complete IPD nursing schema |

### ═══ CATEGORY C: MUST KEEP — Feature Modules (run after Category B) ═══

| # | File | Purpose |
|---|------|---------|
| 22 | `consent_forms_migration.sql` | Consent form tables |
| 23 | `delivery_records_migration.sql` | Delivery records for obstetrics |
| 24 | `medication_admin_migration.sql` | Medication administration records |
| 25 | `surgery_and_packages_migration_FIXED.sql` | Surgery packages + billing |

### ═══ CATEGORY D: MUST KEEP — Clinical Enhancements (run after Category C) ═══

| # | File | Purpose |
|---|------|---------|
| 26 | `030_phase1_encounters_vitals_queue_FIXED.sql` | Encounter + vitals + queue columns |
| 27 | `031_phase2_procedures_consents_referrals.sql` | OPD procedures + referrals |
| 28 | `032_phase3_menstrual_infertility_scores.sql` | Gynae-specific clinical scores |

### ═══ CATEGORY E: MUST KEEP — Applied Patches (run after Category D) ═══

| # | File | Purpose |
|---|------|---------|
| 29 | `applied/add-revenue-lifecycle-columns.sql` | Revenue lifecycle tracking |
| 30 | `applied/bill_versions_migration.sql` | Bill version history |

### ═══ CATEGORY F: MUST KEEP — Billing Enhancements (run LAST) ═══

These are the Phase 1-3 billing files we created:

| # | File | Purpose |
|---|------|---------|
| 31 | `030_phase1_billing_enhancements.sql` | Deposits, credit notes, bill payers tables |
| 32 | `031_phase2_3_billing_enhancements.sql` | Billing templates, lab/insurance billing columns |

### ═══ CAN SAFELY DELETE ═══

| File | Why Delete |
|------|-----------|
| `archive/02-fix-storage-rls.sql` | Superseded by migration 009 |
| `archive/create-users-and-fix-patients.sql` | Superseded by v00 + 017 |
| `archive/fix-all-permissions.sql` | Superseded by migration 009 |
| `archive/SETUP-LOGIN-FIX.sql` | Superseded by v00 + portal fix |
| `applied/critical-security-fixes.patch` | It's a .patch file, not SQL — can't run in SQL Editor |

### ═══ DO NOT RUN IN PRODUCTION ═══

| File | Why Skip |
|------|----------|
| `applied/seed_demo_data.sql` | Inserts 15 fake patients with fixed UUIDs — DEMO ONLY |

Keep this file in your repo for future demos, but NEVER run it on a real clinic database.

---

## 2. DATA DEPENDENCIES IN SQL FILES

**Critical question: Do any SQL files depend on data from other SQL files?**

**Answer: NO** — with one exception.

All migration files use `IF NOT EXISTS`, `DO $$ ... END $$` guards, and
`ON CONFLICT DO NOTHING`. They are purely structural (DDL) — they create
tables, add columns, create indexes, and set up RLS policies. None of them
insert required data that other migrations depend on.

**The one exception:** `seed_demo_data.sql` inserts demo patients with
fixed UUIDs, then inserts encounters referencing those patient UUIDs.
But this file is DEMO ONLY — you should NOT run it in production.

**What this means for a fresh clinic:** After running all migrations,
the database will have empty tables with correct structure. The clinic
starts fresh with zero patients, zero bills, etc. The first thing they
do is configure Settings and create their first patient.

---

## 3. STEP-BY-STEP CLINIC DEPLOYMENT

### Step 1: Create Supabase Project

1. Go to https://supabase.com → New Project
2. Choose a region close to the clinic (Mumbai for India: ap-south-1)
3. Set a strong database password — save it somewhere safe
4. Wait for project to spin up (~2 minutes)

### Step 2: Get Supabase Keys

From Supabase Dashboard → Project Settings → API:
- Copy `Project URL` (looks like: https://xxxx.supabase.co)
- Copy `anon public` key
- Copy `service_role` key (keep this SECRET)

### Step 3: Run SQL Migrations

In Supabase Dashboard → SQL Editor → New Query:

Run files in this exact order (paste each file and click Run):

```
1.  v00-schema-master.sql
2.  v01_validation_constraints.sql
3.  006_add_bill_audit_columns.sql
4.  007_payment_attempts_table.sql
5.  008_schema_migrations_table.sql
6.  009_enable_rls_policies.sql
7.  010_billing_sequence_finance_sync.sql
8.  010_fix_missing_columns_and_tables.sql
9.  011_fix_lab_partners_columns.sql
10. 013_real_fixes_pharmacy_and_nursing.sql
11. 014_prevent_duplicate_queue_entries.sql
12. 016_portal_full_schema_fix.sql
13. 017_comprehensive_schema_alignment.sql
14. 018_align_ipd_charges_schema.sql
15. 019_align_ipd_admissions_bill_columns.sql
16. 020_critical_constraints_phase1.sql
17. 021_fix_consultation_attachments_columns.sql
18. 022.sql
19. 023.sql
20. 024.sql
21. 025_ipd_nursing_complete.sql
22. consent_forms_migration.sql
23. delivery_records_migration.sql
24. medication_admin_migration.sql
25. surgery_and_packages_migration_FIXED.sql
26. 030_phase1_encounters_vitals_queue_FIXED.sql
27. 031_phase2_procedures_consents_referrals.sql
28. 032_phase3_menstrual_infertility_scores.sql
29. applied/add-revenue-lifecycle-columns.sql
30. applied/bill_versions_migration.sql
31. 030_phase1_billing_enhancements.sql       (our Phase 1)
32. 031_phase2_3_billing_enhancements.sql     (our Phase 2-3)
```

Each file should complete without errors. If one fails, check the error —
it's usually a harmless "already exists" warning.

### Step 4: Create First Admin User

In Supabase Dashboard → Authentication → Users → Add User:
- Email: doctor's actual email
- Password: a temporary password (they'll change it later)
- Check "Auto confirm email"

Then in SQL Editor, run:

```sql
-- Replace with the doctor's actual email and the auth user ID from step above
INSERT INTO clinic_users (auth_id, full_name, email, role, is_active, is_primary)
VALUES (
  '<paste-auth-user-UUID-here>',
  'Dr. [Doctor Name]',
  '[doctor-email]',
  'admin',
  true,
  true
);
```

To find the auth user UUID: go to Authentication → Users → click the user → copy the UID.

### Step 5: Set Up Razorpay (for payments)

1. Go to https://dashboard.razorpay.com
2. Create account / use existing
3. Get API keys from Settings → API Keys
4. Note the Key ID and Key Secret

### Step 6: Deploy to Vercel

1. Push codebase to a GitHub repository
2. Go to https://vercel.com → New Project → Import from GitHub
3. Select the repository
4. Add Environment Variables:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...

# Razorpay
RAZORPAY_KEY_ID=rzp_live_xxxx
RAZORPAY_KEY_SECRET=xxxx
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_xxxx

# Fallback UPI (used when OPD/IPD specific UPIs not set in Settings)
NEXT_PUBLIC_UPI_ID=clinic@upi

# Optional: AI features
ANTHROPIC_API_KEY=sk-ant-xxxx    (for AI discharge summary, OCR etc.)
OPENAI_API_KEY=sk-xxxx           (for doctor note OCR, alternative AI)
```

5. Click Deploy
6. After deployment, note the URL (e.g., https://clinic-name.vercel.app)

### Step 7: Configure Custom Domain (Optional)

In Vercel → Project → Settings → Domains:
- Add your custom domain (e.g., app.clinicname.com)
- Update DNS as instructed

### Step 8: First Login & Settings Configuration

1. Open the deployed URL
2. Login with the admin email + temporary password
3. Go to Settings page and configure:
   - Hospital name, address, phone
   - GST number (if applicable)
   - Consultation fees (OPD, follow-up)
   - UPI IDs for OPD and IPD
   - Prescription header text
   - Receipt/invoice prefix

### Step 9: Add Additional Staff (Optional)

Go to Settings → Users → Add User for:
- Additional doctors (role: doctor)
- Receptionist/staff (role: staff)
- Lab partners (role: lab_partner)

Or go to Settings → Doctors → Add Doctor for doctor-specific setup
(NOTE: apply the bug fix first — see DOCTORS_PAGE_FIX.md)

---

## 4. POST-DEPLOYMENT CHECKLIST

- [ ] Admin can login
- [ ] Settings page loads and saves
- [ ] Can register a new patient
- [ ] Can create an OPD encounter
- [ ] Can generate a bill
- [ ] Can record payment (Razorpay/UPI/cash)
- [ ] Can create prescription PDF
- [ ] Beds page shows available beds
- [ ] Can admit a patient to IPD
- [ ] Lab orders can be created
- [ ] Settings → Doctors page works (after fix)
- [ ] Dashboard shows revenue data
- [ ] Audit log records actions

---

## 5. QUICK REFERENCE — Environment Variables

| Variable | Required? | Where to Get |
|----------|-----------|--------------|
| `NEXT_PUBLIC_SUPABASE_URL` | YES | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | YES | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | YES | Supabase → Settings → API |
| `RAZORPAY_KEY_ID` | YES (for payments) | Razorpay Dashboard |
| `RAZORPAY_KEY_SECRET` | YES (for payments) | Razorpay Dashboard |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | YES (for payments) | Same as RAZORPAY_KEY_ID |
| `NEXT_PUBLIC_UPI_ID` | Optional | Clinic's UPI ID |
| `ANTHROPIC_API_KEY` | Optional | For AI features |
| `OPENAI_API_KEY` | Optional | For OCR features |

---

## 6. FILE CLEANUP SUMMARY

### Delete these folders/files from your repo:

```
migrations/archive/                          ← entire folder (4 files, all superseded)
migrations/applied/critical-security-fixes.patch  ← not SQL, can't run
.claude/                                     ← development agent configs, not needed
playwright-output.log                        ← test output
playwright-report/                           ← test report
build-output.log                             ← build log
```

### Keep but mark as DEMO-ONLY:

```
migrations/applied/seed_demo_data.sql        ← keep for demos, never run in production
```

### Keep everything else — the app needs all source files under `src/`.
