# Database Migrations

## Overview

This directory contains all database migrations for NexMedicon HMS.
Migrations are numbered sequentially and must be run in order.

## Migration Runner

Run `node migrations/run.js` to execute pending migrations.
The runner tracks which migrations have been applied in a `schema_migrations` table.

## File Naming Convention

```
000_initial_schema.sql         — Bootstrap (v00-schema-master.sql content)
001_bill_audit_columns.sql     — Bill modification tracking
002_clinic_settings_db.sql     — Clinic settings in database (replaces localStorage)
003_rls_policies.sql           — Row Level Security (ENABLE, not disable)
...
```

## Rules

1. NEVER modify a migration after it has been run in production
2. To fix a previous migration, create a NEW migration with the correction
3. Every migration must be idempotent (safe to run multiple times)
4. Use `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, etc.
5. Include a comment header with what the migration does

## Fresh Database Setup

For a brand new database, run ALL migrations in order:
```bash
node migrations/run.js
```

## Checking Status

```bash
node migrations/run.js --status
```

## SQL Files to DELETE from root (now superseded)

These root-level SQL files are captured in the migration system and should
be removed from the root after confirming migrations work:

- `fix-all-permissions.sql` — **DELETE** (disables RLS, dangerous)
- `SETUP-LOGIN-FIX.sql` — Captured in migration 000
- `create-users-and-fix-patients.sql` — Captured in migration 000
- `add-revenue-lifecycle-columns.sql` — Captured in migration 004
- `bill_versions_migration.sql` — Captured in migration 005
- `02-fix-storage-rls.sql` — Captured in migration 003
- `seed_demo_data.sql` — Keep as optional (not auto-run)

## Which SQL files to KEEP in root (reference only)

- `v00-schema-master.sql` — Reference schema (also in migration 000)
- `seed_demo_data.sql` — Optional demo data, run manually
