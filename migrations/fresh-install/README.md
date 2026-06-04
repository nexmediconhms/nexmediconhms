# Fresh-Install SQL Bundle

This folder contains the canonical SQL files to set up a brand-new database for a doctor's clinic. **Run them in numeric order** in the Supabase SQL editor.

| Step | File | Run in SQL editor? |
|---|---|---|
| 0 | `00_extensions_and_helpers.sql` | Yes |
| 1 | `01_core_schema.sql` | Yes |
| 2 | `02_audit_chain.sql` | Yes |
| 3 | `03_billing_finance.sql` | Yes |
| 4 | `04_validation_constraints.sql` | Yes |
| 5 | `05_rls_policies.sql` | Yes |
| 6 | `06_seed_first_admin.sql` | **EDIT FIRST**, then run |

For the full deployment guide (provisioning, environment variables, post-deploy hardening, day‑1 walkthrough), see [`/docs/FRESH_INSTALL.md`](../../docs/FRESH_INSTALL.md).

For the file-by-file inventory of which legacy migrations to keep, replace, or delete, see [`/docs/MIGRATIONS_INVENTORY.md`](../../docs/MIGRATIONS_INVENTORY.md).

> **For existing clinics** with an existing database, do NOT run these files — they assume an empty schema. Instead apply individual numbered migrations from `migrations/NNN_*.sql` (in number order) for whatever isn't yet applied.
