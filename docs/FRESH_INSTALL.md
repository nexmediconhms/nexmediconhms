# Deploying NexMedicon HMS to a Brand‑New Doctor's Clinic

**Audience:** the technical person setting up the system for an Indian doctor's clinic from a clean slate (no existing data).

**Time required:** ~45 minutes (most of it waiting for Vercel to build).

**Outcome:** a clean, secure deployment with a single admin user (the doctor) and zero demo data. The doctor logs in, sets clinic name/phone/GST, and can register the first patient straight away.

---

## Phase 1 — Provision infrastructure

### 1.1 Create a fresh Supabase project
1. Go to <https://supabase.com> → **New project**.
2. Name it after the clinic (e.g. `nexmedicon-prod-rajeshClinic`).
3. Choose region **`ap-south-1` (Mumbai)** — closest to most Indian clinics.
4. Set a strong database password and save it in a password manager.
5. Wait for provisioning to finish (~2 minutes).

> **Do not enable** "Create with sample data" if Supabase asks. We're starting empty.

### 1.2 Note your project secrets
From the Supabase dashboard → **Project Settings → API**:
- `Project URL` → this becomes `NEXT_PUBLIC_SUPABASE_URL`
- `anon public` key → this becomes `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` key → this becomes `SUPABASE_SERVICE_ROLE_KEY` *(server‑only — never expose to the browser)*

### 1.3 Generate the PHI encryption keys
On any machine with `openssl`:

```bash
openssl rand -hex 32   # → HOSPITAL_ENCRYPTION_KEY (Aadhaar AES-256)
openssl rand -hex 32   # → HOSPITAL_AADHAAR_HMAC_KEY (deterministic dedup)
```

Save **both** values in your password manager. **If you lose `HOSPITAL_ENCRYPTION_KEY`, every Aadhaar in the database is unrecoverable.** The HMAC key is only used for duplicate detection so losing it is recoverable, but rotating it requires a re‑hash migration.

> Use **two different keys**. Never reuse the AES key as the HMAC key.

---

## Phase 2 — Apply the database schema (in this exact order)

Open the Supabase **SQL Editor** and run each file's contents in this exact order. Each file ends with a `SELECT '… DONE'` line so you'll see green confirmation in the result panel.

**Source:** the files live at `migrations/fresh-install/` in the repo.

| # | File | What it does | Approx. rows changed |
|---|---|---|---|
| 0 | `00_extensions_and_helpers.sql` | Enables `pgcrypto`, `btree_gist`. Defines `is_admin / is_doctor_or_admin / is_active_user / get_my_role` (every RLS policy depends on these). Creates `schema_migrations`. | 0 |
| 1 | `01_core_schema.sql` | Creates every canonical snake_case table (`patients, encounters, prescriptions, appointments, opd_queue, beds, ipd_admissions, ipd_nursing, bills, bill_payments, credit_notes, hospital_fund, lab_partners, lab_portal_users, lab_reports, attachments, discharge_summaries, audit_log, portal_*, clinic_users, clinic_settings, ot_schedules, pharmacy_*`, etc). | 0 |
| 2 | `02_audit_chain.sql` | Defines `insert_audit_entry()` (atomic, advisory‑locked SHA‑256 hash chain). Adds the immutability triggers (`trg_protect_audit_hashes`, `trg_block_audit_delete`). Defines content‑bound `verify_audit_chain()`. | 0 |
| 3 | `03_billing_finance.sql` | Race‑free counters: `next_bill_counter`, `next_queue_token`, `next_mrn`. The `sync_bill_to_finance` trigger (single source of truth — no more double‑revenue). Refund‑cap trigger on `credit_notes`. Pharmacy atomic dispense. Payment‑attempts table (replaces broken migration 007). | 0 |
| 4 | `04_validation_constraints.sql` | Unique partial indexes (mobile/MRN/`aadhaar_hmac`), appointment slot uniqueness, IPD bed/patient single‑occupancy, OT room non‑overlap (EXCLUDE), queue token uniqueness, queue dedup. Adds `patients.aadhaar_hmac` column. | 0 |
| 5 | `05_rls_policies.sql` | Revokes anonymous access. Enables RLS on every PHI/financial table. Defines snake‑case role‑based policies (replaces broken migration 009). | 0 |
| 6 | `06_seed_first_admin.sql` | **Edit before running.** Seeds the FIRST admin user (the clinic owner / lead doctor). Inserts default clinic settings. | 1 row in `clinic_users`, ~10 in `clinic_settings`. |

> **Do not run** `migrations/applied/v00-schema-master.sql`. It uses the legacy flat naming (`clinicusers`, `auditlog`, `opdqueue`) which the application code does not understand. See [`MIGRATIONS_INVENTORY.md`](./MIGRATIONS_INVENTORY.md) for the full why.

> **Do not run** `migrations/applied/seed_demo_data.sql`. It seeds fake patients (Ramesh Patel, Priya Sharma, etc.) and demo bills. **Only run on dev environments**, never on a live clinic.

### Special handling for step 6 (admin seeding)

Before running `06_seed_first_admin.sql`:

1. In Supabase dashboard → **Authentication → Users → Add user**, create one user with:
   - Email: the clinic owner's real email
   - Password: a strong password chosen by the owner (not stored anywhere except their password manager)
   - Auto‑confirm: **on**
2. After the user is created, click them and copy the **`UUID`** at the top of the user detail page.
3. Open `06_seed_first_admin.sql` in a text editor. Replace the four `REPLACE-…` placeholders inside the `DO $$` block with:
   - `v_admin_auth_id` → the UUID from step 2
   - `v_admin_email` → the email
   - `v_admin_full_name` → e.g. `Dr. R. Patel`
   - `v_admin_phone` → e.g. `+919876543210`
4. Now paste the edited SQL into the Supabase SQL editor and run.

The script refuses to run if you forget to replace any placeholder.

### Verification queries

After all six steps, run these in the SQL editor to confirm:

```sql
-- a) Every protected table has RLS on
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
-- All of patients, bills, audit_log, etc. should show rowsecurity = true.

-- b) Helper functions exist
SELECT proname FROM pg_proc
WHERE proname IN ('is_admin','is_doctor_or_admin','is_active_user',
                  'insert_audit_entry','verify_audit_chain',
                  'next_bill_counter','next_queue_token','next_mrn');
-- Should return 8 rows.

-- c) Migration tracking
SELECT version, name, applied_at FROM schema_migrations ORDER BY applied_at;
-- Should show FI-00 through FI-06 (and FI-07 once you run 018).

-- d) The admin user exists
SELECT email, role, is_active FROM clinic_users WHERE role = 'admin';
-- Should return exactly one row.
```

---

## Phase 3 — Storage bucket (private)

The application uses Supabase Storage for lab PDFs and patient attachments. **Use private buckets, not public ones**, so PHI documents require signed URLs (not public links).

1. Dashboard → **Storage → New bucket**:
   - Name: `attachments-private`
   - Public: **OFF**
   - File size limit: 25 MB
   - Allowed MIME types: `application/pdf, image/png, image/jpeg, image/webp`
2. Repeat for `consultation-files-private` (used by lab portal uploads).

The application code generates short‑lived signed URLs (`createSignedUrl`, ~1 hour) instead of public URLs.

> If you already have a public `attachments` or `consultation-files` bucket from a previous deployment, **migrate the files** to the private bucket and update `lab_reports.attachment_url` → `lab_reports.storage_bucket / storage_path`. The fresh‑install schema reserves those columns.

---

## Phase 4 — Deploy the application (Vercel)

1. Push the repo to a fresh GitHub repository owned by the clinic.
2. <https://vercel.com> → **Import Git Repository**, select that repo.
3. **Root directory:** leave blank (the project root contains `package.json`).
4. **Environment variables** (add all of these):

| Name | Value | Where to set |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | from Phase 1.2 | Production, Preview, Development |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Phase 1.2 | Production, Preview, Development |
| `SUPABASE_SERVICE_ROLE_KEY` | from Phase 1.2 | **Production only** — never preview |
| `HOSPITAL_ENCRYPTION_KEY` | 64 hex chars (Phase 1.3) | **Production only** |
| `HOSPITAL_AADHAAR_HMAC_KEY` | 64 hex chars (Phase 1.3) | **Production only** |
| `NEXT_PUBLIC_APP_URL` | your Vercel URL (e.g. `https://clinic.nexmedicon.in`) | Production |
| `NEXT_PUBLIC_PORTAL_URL` | usually same as `NEXT_PUBLIC_APP_URL` | Production |
| `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` | (optional) only if using UPI/online payments | Production |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | (optional) only if using AI lab extraction | Production |

5. Hit **Deploy**. First build takes ~3–5 minutes.
6. Once deployed, visit `/login` and sign in with the admin credentials you created in Phase 2 step 6.

---

## Phase 5 — Post‑deploy hardening checklist

Tick these off before handing the clinic the URL:

### 5.1 Disable the data‑wipe endpoint

The repo ships with `src/app/api/reset-seed/route.ts` which performs a destructive wipe of all data. **In production, this file MUST be deleted or gated.** The fix in this branch makes it refuse to run when `NODE_ENV === 'production'` AND requires `RESET_SEED_TOKEN` env var. As an extra safety, you can also `git rm` the file before deploying:

```bash
git rm src/app/api/reset-seed/route.ts
git commit -m "chore: remove reset-seed endpoint for production"
```

### 5.2 Verify PHI encryption is live
Open the app → **Settings → Encryption status** (or call the API directly):
```bash
curl -s https://YOUR_DEPLOY/api/phi -H 'Content-Type: application/json' \
  -d '{"action":"status"}'
```
Should return `{"success":true,"configured":true}`. If it returns `false`, double‑check `HOSPITAL_ENCRYPTION_KEY` (must be exactly 64 hex chars).

### 5.3 Check audit chain integrity
Sign in as admin → **Settings → Audit Log → Verify Chain**. Or in SQL editor:
```sql
SELECT * FROM verify_audit_chain(100);
-- broken_links should be 0 on a fresh install.
```

### 5.4 Confirm RLS is on
```sql
SELECT tablename FROM pg_tables
WHERE schemaname='public' AND rowsecurity = false;
-- Should return only metadata tables: schema_migrations, mrn_counter, bill_counters.
```
If `patients` or `bills` shows up here, **stop** and re‑apply `05_rls_policies.sql`.

### 5.5 Test the lab partner portal token flow
- Settings → Lab Partners → New partner → New portal user → copy token URL.
- The token must NOT appear in `?token=` in the URL bar (the fix in this branch posts the token in the request body, not the query string).

### 5.6 Test rate limiting on portal OTP
Send the same OTP request 6 times in 5 minutes. The 6th should return 429.

---

## Phase 6 — Day 1 walkthrough for the doctor

When you hand over the URL:

1. **Doctor logs in** with the admin email/password.
2. **Settings → Clinic** → fill name, phone, address, GSTIN.
3. **Settings → Users** → add receptionist/staff/nurse accounts (each one gets a confirmation email and chooses their own password).
4. **Settings → Lab Partners** → add the diagnostic labs the clinic uses.
5. **Patients → Register new patient** → confirm Aadhaar field is encrypted (only last 4 digits visible after save; full Aadhaar never displayed in the list).
6. Send a test SMS to the doctor's own phone via the clinic OTP flow to confirm WhatsApp/SMS routing works.

---

## Going forward — backup and disaster recovery

| Item | Cadence | Method |
|---|---|---|
| Database backup | Daily | Supabase **Project Settings → Database → Backups** (auto). Verify restore once a quarter. |
| Encryption key backup | Once at setup, then on every rotation | Password manager (1Password, Bitwarden) shared with at least 2 people at the clinic. |
| Audit log integrity check | Weekly | Run `SELECT * FROM verify_audit_chain(10000)` from the admin dashboard. |
| Storage bucket backup | Weekly | Use Supabase CLI: `supabase storage download attachments-private --recursive`. |
| Code/config backup | On every change | The Vercel project's GitHub link is the source of truth. Tag releases. |

---

## Rolling out updates after go‑live

1. Run any new migrations from `migrations/NNN_*.sql` in numeric order via the SQL editor (NOT including `applied/v00-schema-master.sql` or `applied/seed_demo_data.sql`).
2. `git push` to the GitHub repo connected to Vercel — auto‑deploys.
3. Confirm `verify_audit_chain` still reports zero broken links after the deploy.

---

## Help — common gotchas

| Symptom | Cause | Fix |
|---|---|---|
| "encryptPHI: KEY_NOT_CONFIGURED" on save | `HOSPITAL_ENCRYPTION_KEY` env var missing/empty in Vercel | Add it in Vercel → Settings → Environment Variables → Production, then redeploy. |
| `verify_audit_chain` shows broken links right after install | Some other code wrote to `audit_log` directly (bypassing `insert_audit_entry`) | Find and fix the caller; the broken row's hashes won't reconcile. The repaired entries will start a new valid sub‑chain. |
| New patient registration fails with "duplicate key value violates unique constraint uniq_patients_aadhaar_hmac_nonnull" | Same Aadhaar already registered — this is the dedup working as designed | Surface the existing patient to the user so they can resume that record. |
| Lab partner portal: "Patient not found by MRN" but the MRN exists | MRN format mismatch (`P‑042` vs `P042`) | The `/api/labs/lab-portal` route already tries multiple variants. If still failing, copy the MRN from the patient profile exactly. |
| `pg_advisory_lock not found` on bill generation | Migration 03 hasn't been run | Re‑run `03_billing_finance.sql`. The route's retry-on-conflict logic still produces correct bills, just slower. |

---

**Last updated:** 2026‑06‑04 (audit fixes branch `fix/audit-findings-1-to-10`).
