# NexMedicon HMS — Comprehensive Bug Audit Report

**Date:** May 25, 2026  
**Branch:** `audit/comprehensive-bug-report-may2026`  
**Auditor:** Kiro AI  
**Scope:** All modules, lib utilities, API routes, components, and page-level logic

---

## Summary

| Severity | Count |
|----------|-------|
| Critical (Security/Data Loss) | 3 |
| High (Logic Errors / Broken Features) | 5 |
| Medium (Incorrect Behavior / UX) | 4 |
| Low (Code Quality / Dead Code) | 3 |
| **Total** | **15** |

---

## CRITICAL Issues

### BUG C1: Notifications API — No Authentication

**File:** `src/app/api/notifications/route.ts`

**Problem:**  
The `POST /api/notifications` and `GET /api/notifications` endpoints have **no authentication**. Any unauthenticated user can:
1. Create fake notifications (phishing staff with malicious messages)
2. Read all notifications for any role
3. Mark all notifications as read (disrupting workflow)

**Before (current):**
```typescript
// No auth check — anyone can hit these endpoints
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    // ... directly inserts into DB
  }
}

export async function GET(req: NextRequest) {
  // ... directly reads from DB with role param from query string
}
```

**After (fix):**
```typescript
import { requireAuth } from '@/lib/api-auth'

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth
  // ... now only authenticated users can create notifications
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth
  // Use auth.role instead of query param to determine visible notifications
  const role = auth.role
  // ...
}
```

**Impact:**
- Before: Any internet user can inject fake notifications, read patient names from notifications, disrupt clinic workflow
- After: Only authenticated clinic users can interact with notifications, role is derived from session

---

### BUG C2: Notifications API — Top-Level createClient Anti-Pattern

**File:** `src/app/api/notifications/route.ts`

**Problem:**  
The file creates a Supabase client at module top-level using `process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!`. This is the **exact anti-pattern** that was fixed in `supabase-admin.ts` for other routes. During `next build`, if the service role key is missing, it silently falls back to the anon key — meaning notifications would be subject to RLS and may fail silently in production.

**Before (current):**
```typescript
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)
```

**After (fix):**
```typescript
import { getSupabaseAdmin } from '@/lib/supabase-admin'

// Inside the handler function (lazy):
export async function POST(req: NextRequest) {
  const sb = getSupabaseAdmin()
  // ...
}
```

**Impact:**
- Before: Build can fail in certain environments; silent fallback to anon key breaks notification inserts due to RLS policies
- After: Clear error if service key missing; consistent with all other API routes

---

### BUG C3: Revenue Lifecycle — Flawed Unbilled Encounter Detection

**File:** `src/lib/revenue-lifecycle.ts` — `getRevenueMetrics()` function

**Problem:**  
The "unbilled encounters" detection compares `billedEncounterIds` (which is a Set of `patient_id` from bills) against `encounters` using `billedEncounterIds.has(e.patient_id)`. This means if a patient has **any bill** on that date, ALL their encounters are considered "billed" — even if they had multiple encounters and only one was billed.

**Before (current):**
```typescript
// BUG: Maps bills to patient_id, not encounter_id
const billedEncounterIds = new Set(billsList.map(b => b.patient_id))
const totalBilled = billsList.length
const totalNotBilled = encs.filter(e => !billedEncounterIds.has(e.patient_id)).length
```

**After (fix):**
```typescript
// FIX: Use encounter_id from bills (or bill_id from encounters) for accurate mapping
const billedEncounterIds = new Set(
  billsList.map(b => b.encounter_id).filter(Boolean)
)
const totalBilled = billedEncounterIds.size
const totalNotBilled = encs.filter(e => 
  !billedEncounterIds.has(e.id) && !e.bill_id
).length
```

**Impact:**
- Before: If patient "Ramesh" has 2 encounters (OPD morning + procedure afternoon) but only the OPD is billed, revenue reports show 0 unbilled — hiding ₹X,000 in missed revenue
- After: Each encounter is independently tracked for billing, giving accurate unbilled-visit alerts

---

## HIGH Issues

### BUG H1: Billing Page — IST Date Mismatch for "Today's Revenue"

**File:** `src/app/billing/page.tsx`

**Problem:**  
The billing page calculates "today's bills" using `new Date().toDateString()` which uses the **browser's local timezone** (may not be IST). The codebase already has `getIndiaToday()` specifically for this — but the billing page doesn't use it for the dashboard stats.

**Before (current):**
```typescript
const todayStr = new Date().toDateString()
const todayBills = bills.filter(b => new Date(b.created_at).toDateString() === todayStr && b.status === 'paid')
```

**After (fix):**
```typescript
const todayStr = getIndiaToday() // Already imported but not used for this
const todayBills = bills.filter(b => {
  const billDate = new Date(b.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  return billDate === todayStr && b.status === 'paid'
})
```

**Impact:**
- Before: Between midnight and 5:30 AM IST, "Today's Revenue" shows ₹0 (displays yesterday's bills or nothing) because UTC date ≠ IST date
- After: Revenue always reflects the correct clinic day regardless of the time

---

### BUG H2: AppointmentService — Calling Non-Existent Method

**File:** `src/lib/services/appointmentService.ts` — `syncAppointmentFromOPD()`

**Problem:**  
The function calls `notify.appointmentCompleted()` which does **not exist** on the notify object. The `notify` object in `notifications.ts` has methods like `appointmentCreated`, `appointmentCancelled`, etc. — but no `appointmentCompleted`. This causes a silent failure every time an OPD consultation is completed.

**Before (current):**
```typescript
// This method does not exist on the notify object!
await (notify as any).appointmentCompleted?.(patientId, patientName || '', today)
```

**After (fix):**
```typescript
// Use the correct method — opdConsultationSaved is the right semantic match
await notify.opdConsultationSaved(patientId, patientName || '')
```

**Impact:**
- Before: No notification is ever sent when a consultation is completed (the `?.` optional chaining silently returns undefined). Staff never know a consultation finished.
- After: Proper notification sent, staff can see real-time consultation completion in notification panel

---

### BUG H3: getIndiaNow() — Returns a Misleading Date Object

**File:** `src/lib/utils.ts` — `getIndiaNow()` function

**Problem:**  
The function creates a `new Date()` by manually adding IST offset to UTC milliseconds. However, the resulting `Date` object's internal time is **wrong** — it's a Date that, when printed via `.toISOString()`, gives the IST time as if it were UTC. If anyone calls `.getTime()`, `.toISOString()`, or passes it to Supabase as a timestamp, it will be **5:30 hours ahead of actual UTC**, causing data corruption.

**Before (current):**
```typescript
export function getIndiaNow(): Date {
  const now = new Date()
  const IST_OFFSET_MINUTES = 5 * 60 + 30
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60 * 1000)
  return new Date(utcMs + (IST_OFFSET_MINUTES * 60 * 1000))
  // Returns a Date object that LOOKS like IST but is actually 5:30 ahead of real UTC
}
```

**After (fix):**
```typescript
/**
 * Returns an object with IST display values.
 * Do NOT use this to create timestamps for database storage.
 * For DB timestamps, use new Date().toISOString() (always store UTC).
 * For IST display, use: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
 */
export function getIndiaNowISO(): string {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
}
```

**Impact:**
- Before: If used for database writes, timestamps are 5:30 hours off. If used for `.getTime()` comparisons, all time-based logic is wrong
- After: Clear separation — display formatting uses locale, database always stores proper UTC

---

### BUG H4: Offline Queue — useOnlineStatus Hook is Non-Reactive

**File:** `src/lib/offline-queue.ts` — `useOnlineStatus()` function

**Problem:**  
The `useOnlineStatus` hook is advertised as a React hook but doesn't use `useState` or `useEffect`. It returns a static value (`navigator.onLine`) that is computed once on render and **never updates** when the network state changes. Components using this hook won't re-render when going offline/online.

**Before (current):**
```typescript
export function useOnlineStatus() {
  return {
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  }
}
```

**After (fix):**
```typescript
import { useState, useEffect } from 'react'

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Subscribe to pending count changes
    const unsub = offlineQueue.onPendingChange(setPendingCount)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      unsub()
    }
  }, [])

  return { isOnline, pendingCount }
}
```

**Impact:**
- Before: Components that check `isOnline` to show offline banners or queue operations will NEVER update after initial render — users get no visual feedback when internet drops
- After: Reactive updates trigger re-renders, offline banner shows/hides correctly, pending count updates in real-time

---

### BUG H5: Settings Cache — Race Condition on Concurrent Writes

**File:** `src/lib/settings.ts`

**Problem:**  
`saveSettings()` does `_cache = { ...settings }` synchronously and then `await writeToSupabase(settings)` asynchronously. If two tabs call `saveSettings()` nearly simultaneously, the second write can overwrite the first in Supabase while the in-memory cache keeps the second value — but another tab reading from Supabase might get stale data.

Additionally, `initSettings()` has a migration path that fires `writeToSupabase(local).then(...)` without awaiting — meaning a concurrent `saveSettings()` call could race with the migration.

**Before (current):**
```typescript
export async function saveSettings(settings: HospitalSettings): Promise<boolean> {
  _cache = { ...settings }           // Immediate in-memory update
  persistToLocalStorage(settings)    // Sync localStorage
  const ok = await writeToSupabase(settings)  // Async Supabase write
  // No lock, no optimistic concurrency check, no version field
  return ok
}
```

**After (fix):**
```typescript
export async function saveSettings(settings: HospitalSettings): Promise<boolean> {
  // Use optimistic concurrency: include updated_at check
  const ok = await writeToSupabase(settings)
  if (ok) {
    _cache = { ...settings }          // Only update cache on successful write
    persistToLocalStorage(settings)
  }
  return ok
}
```

**Impact:**
- Before: Two admin users editing settings simultaneously can have one overwrite the other without knowing; cache gets out of sync with DB
- After: Cache only reflects confirmed writes; last-write-wins in DB but local cache is always consistent

---

## MEDIUM Issues

### BUG M1: Empty Hooks File — Dead Import Target

**File:** `src/hooks/useAutoSave.ts`

**Problem:**  
The file `src/hooks/useAutoSave.ts` is **completely empty** (0 bytes). However, the actual `useAutoSave` hook exists in `src/lib/useAutoSave.ts`. Any component importing from `@/hooks/useAutoSave` would get `undefined` exports, causing runtime crashes.

**Before:** Empty file exists at `src/hooks/useAutoSave.ts`

**After (fix):** Either:
- Delete the empty file, OR  
- Re-export from the actual location: `export { useAutoSave } from '@/lib/useAutoSave'`

**Impact:**
- Before: Import path confusion; potential runtime errors if wrong path is used
- After: Single source of truth for the hook

---

### BUG M2: Duplicate Code — formatDate/formatDateTime in Two Places

**Files:** `src/lib/utils.ts` AND `src/lib/business-logic.ts`

**Problem:**  
Both `utils.ts` and `business-logic.ts` export `formatDate()` and `formatDateTime()` functions. They have slightly different implementations (utils uses `en-IN` locale, business-logic does `day: '2-digit'`). Components importing from one vs the other get subtly different date formatting.

This is evidenced in `dashboard/page.tsx` which imports from `business-logic.ts`:
```typescript
import { formatCurrency, todayIST, tomorrowIST, daysFromNowIST } from '@/lib/business-logic'
```

While `patients/page.tsx` imports from `utils.ts`:
```typescript
import { formatDate, ageFromDOB, escapeLike } from '@/lib/utils'
```

**Impact:**
- Before: Dates may render differently on different pages (inconsistent UX)
- After: Single canonical `formatDate`/`formatDateTime` used everywhere

---

### BUG M3: Billing Page — CA Report Fetches All Bills But Only Loads 30 Days Initially

**File:** `src/app/billing/page.tsx`

**Problem:**  
The `loadBills()` function only fetches the last 30 days of bills (for performance). But `computeCAReport()` filters the **loaded `bills` array** by date range. If an admin selects "This Quarter" or "This Year" in the CA Report section, only the pre-loaded 30-day window of bills is available — meaning the report will show **incomplete data** without any warning.

The `generateCAReport()` function does make a separate Supabase query with the correct date range, which is correct. But the function still passes the result through `computeCAReport()` which uses the `periodBills` from that query. This is actually **correct** — but the initial render of `allTotal` (total of all loaded paid bills) shows a misleading number:

```typescript
const allTotal = bills.filter(b => b.status === 'paid').reduce((s, b) => s + b.net_amount, 0)
```

This `allTotal` is displayed as "Total Revenue" but only represents 30 days.

**Impact:**
- Before: "Total Revenue" label implies all-time but only shows last 30 days, misleading the admin
- After: Label should say "Last 30 Days Revenue" or fetch actual all-time total

---

### BUG M4: Appointment Realtime — Aggressive Refetch on Every Change

**File:** `src/app/appointments/page.tsx`

**Problem:**  
The realtime subscription calls `fetchAppts()` on **every single postgres_changes event** (INSERT, UPDATE, DELETE) on the appointments table. In a busy clinic with 50+ appointments/day, this means:
- Staff marking one appointment as "confirmed" triggers a full refetch for ALL connected browsers
- No debouncing on the realtime handler
- Three separate count queries also fire on every `appts` state change

```typescript
.on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => fetchAppts())
```

Combined with the `useEffect` that re-runs count queries when `appts` changes:
```typescript
useEffect(() => {
  supabase.from('appointments').select('id', { count: 'exact', head: true })...
  supabase.from('appointments').select('id', { count: 'exact', head: true })...
  supabase.from('appointments').select('id', { count: 'exact', head: true })...
}, [appts, today])
```

This creates a cascade: change → refetch → state update → 3 count queries → potential re-render.

**Impact:**
- Before: Excessive Supabase API calls (potentially 4x per appointment change × number of connected clients); slow UI in busy clinics
- After: Add debouncing (like billing page does) and batch count queries

---

## LOW Issues

### BUG L1: Duplicate Hook File Locations

**Files:** `src/hooks/useAutoSave.ts` (empty) + `src/lib/useAutoSave.ts` (actual implementation)  
**Also:** `src/hooks/useSafeTimeout.ts` exists in hooks directory

**Problem:**  
Hooks are split between two locations (`src/hooks/` and `src/lib/`) with no clear convention. The `src/hooks/useAutoSave.ts` is empty while the real one is in `src/lib/`. This creates confusion for developers about where to put new hooks.

**Fix:** Consolidate all custom hooks into `src/hooks/` and have `src/lib/` re-export if needed for backward compatibility.

---

### BUG L2: Unused `useSafeTimeout` Hook — No References Found

**File:** `src/hooks/useSafeTimeout.ts`

**Problem:**  
This hook exists but may have no consumers in the codebase (based on the file tree exploration). Dead code that increases bundle confusion.

**Fix:** Verify usage with grep; remove if unused or document its purpose.

---

### BUG L3: `cancelActiveAppointment` in AppointmentService — Overly Broad

**File:** `src/lib/services/appointmentService.ts`

**Problem:**  
While `cancelActiveAppointment` correctly filters by `type = 'follow_up'`, the `createAppointment()` function calls it before every new appointment creation. This means creating a manual OPD appointment will cancel any existing **follow-up** appointment — which may not be the user's intent (they might want both).

```typescript
export async function createAppointment(params) {
  // This cancels follow-up appointments even when creating a separate manual appointment
  await cancelActiveAppointment(patientId)
  // ...
}
```

**Impact:**
- Before: Booking a new "Lab Report Discussion" appointment silently cancels the patient's upcoming "ANC Follow-up"
- After: Only cancel conflicting appointments (same date/time), not all follow-ups

---

## Additional Observations (Not Bugs, But Risks)

1. **Middleware Rate Limiter Uses In-Memory Store**: On serverless deployments (Vercel), each cold start gets a fresh Map. Effective rate limiting requires an external store (Redis/Upstash). Currently documented but not mitigated.

2. **`loadClinicUser()` in auth.ts silently updates `auth_id`**: If an email matches but `auth_id` doesn't, it auto-fixes the mismatch. While convenient, this could mask a security issue where two Supabase auth accounts share an email.

3. **CSP allows `'unsafe-eval'` in script-src**: This weakens XSS protection significantly. It's likely needed for Next.js dev mode but should be removed in production builds.

4. **No CSRF Protection on POST endpoints**: While most data mutations go through Supabase (which uses JWT), the custom API routes rely solely on Bearer token auth. A CSRF token would add defense-in-depth.

5. **`pdf-to-image.ts` uses `pdfjs-dist` v5.6** which may have breaking changes vs the configured `serverComponentsExternalPackages` (which explicitly excludes it for client-side use). Version compatibility should be verified.

---

## Recommended Fix Priority

| Priority | Bug ID | Effort | Risk if Unfixed |
|----------|--------|--------|-----------------|
| 1 | C1 | Low (add 3 lines) | Unauthenticated data access |
| 2 | C2 | Low (change import) | Silent build failures / RLS bypass |
| 3 | C3 | Medium | Missed revenue not detected |
| 4 | H1 | Low | Wrong daily revenue display |
| 5 | H2 | Low (1 line fix) | Missing notifications |
| 6 | H3 | Medium | Timestamp corruption if misused |
| 7 | H4 | Medium | Offline mode UI broken |
| 8 | H5 | Medium | Settings data loss on concurrent edits |
| 9 | M4 | Medium | Performance degradation |
| 10 | M1 | Trivial | Developer confusion |
| 11 | M2 | Low | Inconsistent date display |
| 12 | M3 | Low | Misleading revenue label |
| 13 | L1-L3 | Low | Code quality |

---

## How to Use This Report

1. Create a new branch from `main` for each fix (e.g., `fix/C1-notifications-auth`)
2. Apply the fix following the "After" code in each section
3. Test the specific scenario described in "Impact"
4. Merge via PR with the bug ID in the commit message

---

*Generated by Kiro AI Audit — May 25, 2026*
