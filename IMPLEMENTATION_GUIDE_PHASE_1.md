# Phase 1 Implementation Guide - Critical Security Fixes
**Branch:** `arch-review-critical-fixes-2026`  
**Timeline:** 5-7 days  
**Status:** 🔴 MUST COMPLETE BEFORE ANY DEPLOYMENT

---

## Overview

This guide provides **step-by-step instructions** to fix all P0 (critical) security issues.  
Each fix is designed to be **non-breaking** - existing functionality will continue to work.

---

## FIX #1: Enable RLS and Remove Dangerous SQL File

### Current Problem
`fix-all-permissions.sql` DISABLES RLS on all tables and grants SELECT to anonymous users.

### Solution

**Step 1:** Delete the dangerous file
```bash
git rm fix-all-permissions.sql
```

**Step 2:** Apply proper RLS policies from critical-security-fixes.patch
```bash
# Extract the RLS SQL from the patch
git show HEAD:critical-security-fixes.patch | grep -A 9999 "supabase_rls_policies.sql" > temp_rls.sql
```

**Step 3:** Run in Supabase SQL Editor
1. Go to Supabase Dashboard → SQL Editor
2. Paste contents of `temp_rls.sql`
3. Click "Run"
4. Verify: Check that RLS is enabled

```sql
-- Verification query
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;
```

Expected: All tables show `rowsecurity = true`

**Step 4:** Test that app still works
1. Log in as admin
2. View patient list
3. Create new patient
4. Generate prescription
5. Check billing

If you get "permission denied" errors, the RLS policies need adjustment.



---

## FIX #2: Migrate Settings from localStorage to Database

### Current Problem
Hospital name, doctor details stored in browser localStorage - lost when cache cleared.

### Solution

**Step 1:** Verify `clinic_settings` table exists
```sql
SELECT * FROM clinic_settings LIMIT 5;
```

**Step 2:** Create migration function (run in Supabase SQL Editor)
```sql
-- Migration helper: Move settings from localStorage → DB
CREATE OR REPLACE FUNCTION migrate_legacy_settings()
RETURNS void AS $$
BEGIN
  -- This function is called from the frontend migration code
  -- Just ensure the table structure is ready
  ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES clinic_users(id);
  ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
END;
$$ LANGUAGE plpgsql;

SELECT migrate_legacy_settings();
```

**Step 3:** Update src/lib/settings.ts
Already implemented correctly - settings.ts reads from Supabase first, localStorage is fallback.

**Step 4:** Force migration on next login
Add this to your login success handler or dashboard mount:

```typescript
// In src/app/page.tsx or dashboard component
useEffect(() => {
  async function migrateSettings() {
    const { data } = await supabase
      .from('clinic_settings')
      .select('key')
      .limit(1)
    
    if (!data || data.length === 0) {
      // No settings in DB, migrate from localStorage
      const localSettings = localStorage.getItem('nexmedicon_settings')
      if (localSettings) {
        const settings = JSON.parse(localSettings)
        // Save to DB
        await saveSettings(settings)
        console.log('✅ Settings migrated to database')
      }
    }
  }
  migrateSettings()
}, [])
```

**Step 5:** Test
1. Clear existing DB settings
2. Add test settings to localStorage
3. Refresh page
4. Check that settings now in `clinic_settings` table



---

## FIX #3: Create Proper Migration System

### Current Problem
15+ SQL files in random order, no tracking.

### Solution

**Step 1:** Create migrations directory structure
```bash
mkdir -p migrations/applied
mkdir -p migrations/archive
```

**Step 2:** Create migration tracking table (run in Supabase)
```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  checksum TEXT,
  success BOOLEAN DEFAULT TRUE
);

-- Grant access
ALTER TABLE schema_migrations DISABLE ROW LEVEL SECURITY;
GRANT ALL ON schema_migrations TO authenticated;
GRANT ALL ON schema_migrations TO service_role;
```

**Step 3:** Document current state
Create `migrations/CURRENT_STATE.md`:

```markdown
# Current Database State (as of May 22, 2026)

## Already Applied (best guess based on file dates)
1. v00-schema-master.sql - Initial schema
2. v01_validation_constraints.sql - Validation rules
3. SETUP-LOGIN-FIX.sql - clinic_users table
4. fix-all-permissions.sql - RLS disabled (WILL BE UNDONE)

## Unknown Status (check production DB)
- add-revenue-lifecycle-columns.sql
- bill_versions_migration.sql  
- 02-fix-storage-rls.sql
- create-users-and-fix-patients.sql

## Action Required
Run verification query to check what's actually in prod.
```

**Step 4:** Verify what's actually applied
Run this in your production/staging Supabase:

```sql
-- Check if columns exist to determine which migrations ran
SELECT 
  'revenue_lifecycle_columns' AS migration,
  EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bills' AND column_name = 'payment_intent_id'
  ) AS applied;
  
-- Add similar checks for other migrations
```

**Step 5:** Create consolidated migration files



**Step 6:** Archive old SQL files
```bash
mv fix-all-permissions.sql migrations/archive/
mv SETUP-LOGIN-FIX.sql migrations/archive/
mv 02-fix-storage-rls.sql migrations/archive/
mv create-users-and-fix-patients.sql migrations/archive/
```

**Step 7:** Create future migration template
Save as `migrations/template.sql`:

```sql
-- Migration: [NUMBER]_[description]
-- Created: [DATE]
-- Author: [NAME]
-- Dependencies: [PREVIOUS_MIGRATION_NUMBER]

-- ════════════════════════════════════════════════
-- DESCRIPTION
-- ════════════════════════════════════════════════
-- What does this migration do?
-- Why is it needed?

-- ════════════════════════════════════════════════
-- UP MIGRATION (apply changes)
-- ════════════════════════════════════════════════

BEGIN;

-- Your SQL here

-- Record migration
INSERT INTO schema_migrations (version, name, applied_at)
VALUES ('001', 'description_here', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ════════════════════════════════════════════════
-- DOWN MIGRATION (rollback - document only)
-- ════════════════════════════════════════════════
-- How to undo this migration if needed
-- (Don't run automatically - just documentation)

-- Example:
-- DROP TABLE new_table;
-- ALTER TABLE old_table DROP COLUMN new_column;
```

---

## FIX #4: Move Client-Side Supabase Calls to API Routes

### Current Problem
Pages directly query database from browser, exposing schema.

### Solution

**Step 1:** Create API route for patient search
```bash
mkdir -p src/app/api/patients/search
```

Create `src/app/api/patients/search/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  // Validate authentication
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  const { searchParams } = req.nextUrl
  const query = searchParams.get('q') || ''
  const searchType = searchParams.get('type') || 'name'

  const supabase = getSupabaseAdmin()

  let dbQuery = supabase
    .from('patients')
    .select('id, mrn, full_name, mobile, dob, gender')
    .eq('is_active', true)

  if (searchType === 'name') {
    dbQuery = dbQuery.ilike('full_name', `%${query}%`)
  } else if (searchType === 'mobile') {
    dbQuery = dbQuery.ilike('mobile', `%${query}%`)
  } else if (searchType === 'mrn') {
    dbQuery = dbQuery.ilike('mrn', `%${query}%`)
  }

  const { data, error } = await dbQuery.limit(50)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ patients: data })
}
```



**Step 2:** Update patient search page to use API

Find all instances of:
```typescript
// OLD (DANGEROUS)
const { data } = await supabase.from('patients').select('*')
```

Replace with:
```typescript
// NEW (SECURE)
const response = await fetch('/api/patients/search?q=' + searchQuery + '&type=' + searchType, {
  headers: {
    'Authorization': `Bearer ${session.access_token}`
  }
})
const { patients } = await response.json()
```

**Step 3:** Repeat for other pages
Priority order:
1. ✅ Patient search (`/search`)  
2. ✅ Patient list (`/patients`)
3. ✅ Billing list (`/billing`)
4. ✅ Appointments (`/appointments`)
5. ✅ Analytics/Reports (`/analytics`)

**Step 4:** Audit remaining client-side calls
```bash
# Find all client-side database calls
grep -r "supabase.from\|supabase.rpc" src/app --include="*.tsx" --exclude-dir="api" | wc -l
```

Target: 0 results (except auth-related calls)

---

## FIX #5: Remove ABDM Credentials from Client Code

### Current Problem
`src/lib/abdm.ts` stores `clientSecret` in localStorage.

### Solution

**Step 1:** Audit ABDM credential storage
Check `src/lib/abdm.ts` line 88-102 for localStorage usage.

**Step 2:** Move credentials to env vars only
Update `.env.example`:

```bash
# ABDM Integration (server-side only)
ABDM_CLIENT_ID=your_client_id_here
ABDM_CLIENT_SECRET=your_client_secret_here
ABDM_ENVIRONMENT=sandbox  # or 'production'
```

**Step 3:** Update ABDM server module
Ensure `src/lib/abdm-server.ts` reads from env:

```typescript
// src/lib/abdm-server.ts
const ABDM_CLIENT_ID = process.env.ABDM_CLIENT_ID
const ABDM_CLIENT_SECRET = process.env.ABDM_CLIENT_SECRET

if (!ABDM_CLIENT_ID || !ABDM_CLIENT_SECRET) {
  throw new Error('ABDM credentials not configured')
}
```

**Step 4:** Remove client-side credential handling
In `src/lib/abdm.ts`, replace credential functions:

```typescript
// Remove these functions:
// - saveABDMConfig()  
// - loadABDMConfig()
// - readABDMFromLocalStorage()

// Keep only UI helpers:
export function formatABHANumber(raw: string): string { /* ... */ }
export function isValidABHANumber(abha: string): boolean { /* ... */ }
export function maskABHANumber(abha: string): string { /* ... */ }
```

**Step 5:** Update ABDM setup page
Change `/abdm-setup/page.tsx` to just toggle enabled/disabled state, not store credentials.



---

## FIX #6: Add Auth to Lab Import Endpoint

### Current Problem
`/api/labs/extract/route.ts` has no authentication check.

### Solution

**Step 1:** Add requireAuth to lab extract route

Update `src/app/api/labs/extract/route.ts`:

```typescript
import { requireAuth } from '@/lib/api-auth'

export async function POST(req: NextRequest) {
  // Add authentication check
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  // Existing code continues...
  const supabase = createClient(...)
  // ...
}
```

**Step 2:** Add LAB_IMPORT_SECRET validation

```typescript
// At top of route handler
const LAB_IMPORT_SECRET = process.env.LAB_IMPORT_SECRET
if (!LAB_IMPORT_SECRET) {
  return NextResponse.json(
    { error: 'Lab import not configured. Contact administrator.' },
    { status: 503 }
  )
}

// Verify secret from request
const providedSecret = req.headers.get('x-lab-secret')
if (providedSecret !== LAB_IMPORT_SECRET) {
  return NextResponse.json(
    { error: 'Invalid lab import secret' },
    { status: 401 }
  )
}
```

**Step 3:** Generate secret for production

```bash
# Generate secure random secret
openssl rand -hex 32
```

Add to `.env.local`:
```bash
LAB_IMPORT_SECRET=your_generated_secret_here
```

**Step 4:** Update lab partner integration docs
Document that lab partners must include header:
```
X-Lab-Secret: [provided_secret]
```

**Step 5:** Add rate limiting
Install rate limiter (already exists in `src/lib/rate-limit.ts`):

```typescript
import { checkRateLimit } from '@/lib/rate-limit'

// In POST handler
const rateLimitKey = `lab_import_${req.ip || 'unknown'}`
const rateCheck = await checkRateLimit(rateLimitKey, {
  maxRequests: 100,
  windowMs: 24 * 60 * 60 * 1000 // 100 uploads per day
})

if (!rateCheck.allowed) {
  return NextResponse.json(
    { error: 'Rate limit exceeded. Max 100 uploads per day.' },
    { status: 429 }
  )
}
```



---

## FIX #7: Hide Setup Pages from Non-Admin Users

### Current Problem
All authenticated users can see `/abdm-setup`, `/ai-setup`, etc.

### Solution

**Step 1:** Create admin route middleware

Create `src/middleware/admin-check.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function requireAdmin(req: NextRequest) {
  const { data: { session } } = await supabase.auth.getSession()
  
  if (!session) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // Check role from clinic_users
  const { data: user } = await supabase
    .from('clinic_users')
    .select('role')
    .eq('auth_id', session.user.id)
    .single()

  if (!user || user.role !== 'admin') {
    return NextResponse.redirect(new URL('/', req.url))
  }

  return null // Allow access
}
```

**Step 2:** Protect setup pages

In each setup page (`/abdm-setup/page.tsx`, etc.), add:

```typescript
'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function ABDMSetupPage() {
  const router = useRouter()
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function checkAdmin() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/login')
        return
      }

      const { data: user } = await supabase
        .from('clinic_users')
        .select('role')
        .eq('auth_id', session.user.id)
        .single()

      if (user?.role !== 'admin') {
        router.push('/')
        return
      }

      setIsAdmin(true)
      setLoading(false)
    }
    checkAdmin()
  }, [router])

  if (loading) return <div>Loading...</div>
  if (!isAdmin) return null

  // Existing page content...
}
```

**Step 3:** Update sidebar to hide setup links

In `src/components/AppShell.tsx` or sidebar component:

```typescript
// Only show setup links for admin
{currentUserRole === 'admin' && (
  <>
    <Link href="/admin/settings">Settings</Link>
    <Link href="/abdm-setup">ABDM Setup</Link>
    <Link href="/ai-setup">AI Setup</Link>
  </>
)}
```

**Step 4:** Move setup pages to /admin directory

```bash
mkdir -p src/app/admin
mv src/app/abdm-setup src/app/admin/
mv src/app/ai-setup src/app/admin/
```

Update all internal links accordingly.



---

## TESTING CHECKLIST

After implementing all fixes, verify:

### Security Tests
- [ ] Try accessing patient data without login → Should fail
- [ ] Try accessing setup pages as staff → Should redirect
- [ ] Try uploading lab report without secret → Should fail  
- [ ] Try querying database directly from browser console → Should fail
- [ ] Check that RLS is enabled on all tables
- [ ] Verify ABDM credentials not in localStorage
- [ ] Verify hospital settings persisted in database

### Functional Tests
- [ ] Login as admin → works
- [ ] Login as doctor → works, sees correct sidebar
- [ ] Login as staff → works, limited access
- [ ] Register new patient → saves correctly
- [ ] Search patient by name → finds results
- [ ] Generate prescription → prints correctly
- [ ] Create bill → calculates correctly
- [ ] Payment via UPI → updates status
- [ ] Lab report upload (with secret) → works
- [ ] Offline mode → shows appropriate message

### Data Integrity Tests
- [ ] Clear browser cache → settings still there
- [ ] Login from different device → sees same settings
- [ ] Change hospital name → reflects immediately
- [ ] Create audit log entry → hash chain valid

### Performance Tests
- [ ] Page load time < 3 seconds
- [ ] Patient search returns in < 1 second
- [ ] Prescription PDF generates in < 2 seconds
- [ ] Database queries optimized (no N+1)

---

## ROLLBACK PLAN

If something breaks during implementation:

### Immediate Rollback (Emergency)
```bash
git checkout main
git push origin main --force
```

Then re-deploy from main branch.

### Partial Rollback (One Fix at a Time)
```bash
# Revert specific commit
git revert <commit_hash>
git push origin arch-review-critical-fixes-2026
```

### Database Rollback
Keep backups before each SQL change:

```sql
-- Before applying RLS policies
pg_dump --schema-only > backup_schema_before_rls.sql

-- Before migrating settings
pg_dump --table=clinic_settings > backup_settings_before_migration.sql
```

---

## DEPLOYMENT CHECKLIST

Before deploying fixes to production:

### Pre-Deployment
- [ ] All tests pass locally
- [ ] Code reviewed by second developer
- [ ] Database backup created
- [ ] Rollback plan documented
- [ ] Monitoring alerts configured

### Deployment Steps
1. Deploy to staging environment first
2. Test all critical workflows  
3. Monitor for 24 hours
4. Deploy to production during low-traffic window (e.g., 2 AM)
5. Monitor logs for first 2 hours

### Post-Deployment
- [ ] Verify RLS is active (check pg_tables)
- [ ] Verify settings loading from database
- [ ] Test login as all role types
- [ ] Check error logs for unusual activity
- [ ] Notify team that deployment complete

---

## SUPPORT & TROUBLESHOOTING

### Common Issues

**Issue:** "Permission denied for table patients"  
**Cause:** RLS enabled but policy too restrictive  
**Fix:** Check role in clinic_users table matches policy

**Issue:** "Settings not saving"  
**Cause:** Database write failing, falling back to localStorage  
**Fix:** Check Supabase connection, verify table exists

**Issue:** "Lab upload fails with 401"  
**Cause:** Missing LAB_IMPORT_SECRET  
**Fix:** Add env var, restart server

**Issue:** "Patient search returns empty"  
**Cause:** API route not deployed or wrong URL  
**Fix:** Check Vercel deployment logs

### Getting Help

If stuck, collect this info before asking:
1. Error message (full text)
2. Browser console logs
3. Supabase logs (Dashboard → Logs)
4. Which fix you were working on
5. Steps to reproduce

---

## NEXT STEPS AFTER PHASE 1

Once all P0 fixes complete:
1. Document what was fixed (update CHANGELOG.md)
2. Deploy to staging for 1 week pilot
3. Collect feedback from pilot users
4. Begin Phase 2 (P1 high-priority fixes)

**Phase 2 Preview:**
- Offline queue with IndexedDB
- UPI payment failure handling
- Patient duplicate detection
- Mobile responsive improvements
- Bill modification audit trail

---

*This guide was created as part of the comprehensive architecture review on May 22, 2026. Questions? Refer to CRITICAL_ARCHITECTURE_REVIEW.md*

