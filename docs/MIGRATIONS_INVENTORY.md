# NexMedicon HMS — SQL Migration Inventory & Cleanup Guide

**Last reviewed:** 2026‑06‑04
**Purpose:** Tell you exactly which SQL files are canonical (keep), which are broken or legacy (delete or ignore), and which have been replaced by newer files.

---

## TL;DR

| Bucket | What to do |
|---|---|
| `migrations/fresh-install/*` | **The canonical fresh‑clinic bundle.** Run these (in numeric order) on a brand‑new Supabase project. |
| `migrations/006…017_*.sql` (snake_case ones) | **Keep.** These are good migrations for an existing DB. Run any not yet applied. |
| `migrations/applied/v01_validation_constraints.sql` | **Keep.** Schema‑resilient, additive. |
| `migrations/applied/add‑revenue‑lifecycle‑columns.sql` | **Keep.** Additive, idempotent. |
| `migrations/applied/bill_versions_migration.sql` | **Keep.** Creates `bill_versions` audit table. |
| `migrations/applied/critical‑security‑fixes.patch` | **Keep as reference.** The SQL inside (audit hash chain + RLS helpers) is now extracted into the fresh‑install bundle for clarity. |
| `migrations/applied/v00‑schema‑master.sql` | **DO NOT RUN on a fresh clinic.** Uses the *no‑underscore* naming (`clinicusers`, `opdqueue`, `auditlog`, `labreports`, `ipdadmissions`, `hospitalfund`, `dischargesummaries`, `patientid`, `aadhaar`, `fullname`) which **contradicts 100 % of the application code** (which uses snake_case). It's kept only as historical reference for clinics that already ran it. |
| `migrations/applied/seed_demo_data.sql` | **DO NOT RUN on a real clinic.** It seeds fake patients, doctors, appointments, and bills for demos. Running it on a doctor's live database will mix demo data with real PHI. |
| `migrations/007_payment_attempts_table.sql` | **REPLACED** by `migrations/fresh-install/03_payment_attempts_table.sql`. The original used `clinicusers` (flat) instead of `clinic_users` (snake_case) — wrong on every modern install. |
| `migrations/009_enable_rls_policies.sql` | **REPLACED** by `migrations/fresh-install/05_rls_policies.sql`. The original ALTERs `clinicusers`/`opdqueue`/`auditlog` tables that don't exist on snake_case databases — the whole migration **rolled back silently in production**, leaving RLS unverified. |
| `migrations/archive/*` | **Already archived. Do not run.** Includes `fix-all-permissions.sql` which **disabled RLS** and granted `anon` full read of patient data — the very thing 009 was supposed to undo. |
| `migrations/applied/` (folder name) | **Misleading.** Despite the name, it does not mean "already run". It's just where some early one‑time files were parked. Treat each file individually using this table. |

---

## Detailed file-by-file

### `migrations/` (numbered)

| File | Verdict | Why |
|---|---|---|
| `006_add_bill_audit_columns.sql` | ✅ KEEP | Adds `modified_by`, `modified_at`, `modification_reason` to `bills`. Uses snake_case `clinic_users`. Idempotent. |
| `007_payment_attempts_table.sql` | ❌ REPLACE with `fresh-install/03_payment_attempts_table.sql` | Creates `payment_attempts` table but FK references `clinicusers(id)` (flat) — fails on snake_case DBs. The replacement uses `clinic_users(id)`. |
| `008_schema_migrations_table.sql` | ✅ KEEP | Creates the `schema_migrations` tracking table. Run this **first** on existing DBs. |
| `009_enable_rls_policies.sql` | ❌ REPLACE with `fresh-install/05_rls_policies.sql` | References tables `clinicusers`, `opdqueue`, `auditlog` (flat) inside a single transaction. On a snake_case DB the first `ALTER TABLE clinicusers …` errors and the **entire transaction rolls back**, leaving RLS effectively un‑applied. |
| `010_billing_sequence_finance_sync.sql` | ✅ KEEP | Adds bill_module, idempotency_key, soft‑delete, advisory‑lock helpers, the `sync_bill_to_finance` trigger, payment history function, lab partner extensions. Snake_case, idempotent. |
| `010_fix_missing_columns_and_tables.sql` | ✅ KEEP | Even though the file number 010 collides with the file above, the content is additive and idempotent — they don't conflict in practice. (Rename to `010b_…` if you want a tidy ordering.) |
| `011_fix_lab_partners_columns.sql` | ✅ KEEP | Fixes `lab_partners` column drift. Idempotent. |
| `013_real_fixes_pharmacy_and_nursing.sql` | ✅ KEEP | Atomic pharmacy dispense RPC, `ipd_nursing` table. |
| `014_prevent_duplicate_queue_entries.sql` | ✅ KEEP | Partial unique index for one active queue entry per patient per day. |
| `016_portal_full_schema_fix.sql` | ✅ KEEP | Adds missing portal columns. Subsumed by 017 but harmless. |
| `017_comprehensive_schema_alignment.sql` | ✅ KEEP | The "make every app column actually exist" migration. Run this **last** on existing DBs. |
| `018_audit_findings_fixes.sql` | ✅ KEEP (NEW — added by this audit) | Consolidates DB changes for sections 1–10 of the audit findings (HMAC for Aadhaar dedup, queue token RPC, hash chain enforcement, refund cap, etc). |

### `migrations/applied/`

| File | Verdict | Why |
|---|---|---|
| `v00-schema-master.sql` | ⚠️ **DO NOT RUN on fresh clinic** | Creates the legacy *flat‑name* schema (`clinicusers`, `opdqueue`, `labreports`, `ipdadmissions`, `auditlog`, `hospitalfund`, `dischargesummaries`, `patientid`, `aadhaar`, `fullname`). Application code uses snake_case everywhere (`clinic_users`, `opd_queue`, `lab_reports`, `audit_log`, etc.). Running this on a new clinic will create columns the app cannot read. **Use `migrations/fresh-install/01_core_schema.sql` instead.** |
| `v01_validation_constraints.sql` | ✅ KEEP | Adds unique partial indexes for mobile/Aadhaar/MRN/appointment slot/IPD bed/OT room. Schema‑resilient (skips silently if columns missing). |
| `add-revenue-lifecycle-columns.sql` | ✅ KEEP | Adds `appointments.visit_status`, `encounters.revenue_status`, `encounters.bill_id`. |
| `bill_versions_migration.sql` | ✅ KEEP | Creates `bill_versions` immutable audit table. |
| `critical-security-fixes.patch` | ✅ KEEP (reference) | The SQL inside this Git patch (`insert_audit_entry`, `protect_audit_hash_columns`, `verify_audit_chain`, `is_admin`, `is_doctor_or_admin`, `is_active_user`, snake‑case RLS policies) is **CRITICAL** and must be applied. The fresh‑install bundle extracts these into clean `.sql` files so you don't have to apply a Git patch. On existing DBs that already applied the patch, no action needed. |
| `seed_demo_data.sql` | ⚠️ **DO NOT RUN on real clinic** | Seeds fake patients (Ramesh Patel, Priya Sharma, etc.), demo appointments, demo bills, demo lab reports. **Only for development**. Mixing this with real patient data is a data‑integrity disaster. |

### `migrations/archive/`

All files in this directory are **legacy and harmful** if re-applied. Specifically:

| File | What it does | Why it's dangerous |
|---|---|---|
| `02-fix-storage-rls.sql` | Old storage bucket policy | Superseded by per‑bucket settings in Supabase dashboard. |
| `SETUP-LOGIN-FIX.sql` | Legacy admin user creation | Replaced by `bootstrap` flow + manual user creation in admin panel. Contains old hard‑coded admin credentials. |
| `create-users-and-fix-patients.sql` | Legacy schema patch | Pre‑dates the snake_case alignment. |
| `fix-all-permissions.sql` | **`GRANT ALL ON ALL TABLES … TO anon`** | Disables RLS effectively. Anyone with the public anon key could `SELECT * FROM patients`. Was meant as a one‑time dev workaround. **Never run this on production.** |

> **Safe to delete the whole `migrations/archive/` folder** if you want a tidy repo. Keep them only if you need historical context.

---

## What to delete vs keep — a checklist

### Safe to delete from the repo (won't break anything)
- `migrations/archive/` (entire folder)
- `migrations/applied/seed_demo_data.sql` (only if no environment uses it)

### Must keep
- All numbered files in `migrations/` **except 007 and 009** (replaced).
- Everything in `migrations/applied/` **except** `v00-schema-master.sql` (legacy) and `seed_demo_data.sql` (demo only).
- The new `migrations/fresh-install/` folder.

### Replace
- `migrations/007_payment_attempts_table.sql` → use `migrations/fresh-install/03_payment_attempts_table.sql`.
- `migrations/009_enable_rls_policies.sql` → use `migrations/fresh-install/05_rls_policies.sql`.

> If you don't want to delete the originals (to preserve git history), just **don't run them** during fresh setup. The fresh‑install bundle's order avoids both.

---

## Going forward — adding new migrations

Use `NNN_short_name.sql` numbered sequentially after `018`. Always:

1. Wrap in `BEGIN; … COMMIT;` (or use `DO $$ … END $$;` blocks for conditional DDL so a missing column doesn't kill the transaction — see `017_comprehensive_schema_alignment.sql` for the pattern).
2. Use `CREATE … IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS … ; CREATE POLICY …` so re‑running is safe.
3. Use **snake_case** table and column names (canonical convention).
4. Record the migration:
   ```sql
   INSERT INTO schema_migrations (version, name, applied_at, notes)
   VALUES ('NNN', 'short_name', NOW(), 'What this does')
   ON CONFLICT (version) DO NOTHING;
   ```

---

**See also:** `docs/FRESH_INSTALL.md` for the full step‑by‑step guide for a brand‑new doctor's clinic.
