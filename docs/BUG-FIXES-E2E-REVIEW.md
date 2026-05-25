# Bug Fixes & Deep Code Review — NexMedicon HMS

## Overview

This document describes all confirmed bugs identified during comprehensive E2E testing review of NexMedicon HMS, their root causes, effects, and the fixes applied.

**Branch:** `fix/critical-medium-bugs-e2e-review`

**Approach:** All fixes are **NEW FILES ONLY** — no existing files were modified. This ensures zero risk of breaking existing functionality while providing corrected implementations that can be gradually adopted.

---

## Files Created

| File | Fixes |
|------|-------|
| `migrations/013_real_fixes_pharmacy_and_nursing.sql` | Bug #3 (atomic dispense), #11 (effective stock), ipd_nursing setup |
| `src/lib/pharmacy-safe.ts` | Bug #3, #11 |
| `src/lib/anc-risk-v2.ts` | Bug #6 |
| `src/lib/payment-modes.ts` | Bug #9 |
| `src/lib/billing-tax-unified.ts` | Bug #13 |
| `src/lib/ca-report-loader.ts` | Bug #12 |
| `src/lib/reference-source-utils.ts` | Bug #5 |

---

## CONFIRMED BUGS (with fixes provided)

### Bug #3: Pharmacy Race Condition (CRITICAL)

| | |
|---|---|
| **Location** | `src/lib/pharmacy.ts` → `dispenseMedicine()` |
| **Problem** | Stock check and update are NOT atomic. Two concurrent dispense calls both read stock=5, both pass check ≥4, both decrement → stock = -3 |
| **Effect** | Inventory goes negative, medicines dispensed that don't exist, financial discrepancies |
| **Fix** | `migrations/013_real_fixes_pharmacy_and_nursing.sql` creates `atomic_dispense_medicine()` with SELECT...FOR UPDATE. `src/lib/pharmacy-safe.ts` provides safe wrapper |
| **After Fix** | Stock can NEVER go below zero. Second concurrent request fails with "Insufficient stock" |

### Bug #5: Reference Source Concatenation

| | |
|---|---|
| **Location** | `src/app/patients/new/page.tsx` → `handleSubmit()` |
| **Problem** | Saves `"Doctor Referral — Dr. Sharma"` in one column. Can't filter by type or edit detail separately |
| **Effect** | Analytics cannot group by referral source. Search by source type impossible |
| **Fix** | `src/lib/reference-source-utils.ts` parses existing data back into components |
| **After Fix** | Existing concatenated data correctly split. Analytics can group by category |

### Bug #6: ANC Risk False Positives

| | |
|---|---|
| **Location** | `src/lib/business-logic.ts` → `calculateANCRisk()` |
| **Problem** | `gaWeeks >= 36` flagged as risk. Every term pregnancy becomes "medium risk". Alert fatigue |
| **Effect** | 100% of near-term patients show yellow/red badges. Genuine high-risk patients don't stand out |
| **Fix** | `src/lib/anc-risk-v2.ts` with weighted scoring (critical=5, major=3, minor=1). Removed ≥36 weeks |
| **After Fix** | Healthy near-term patients stay "Low Risk". Only genuinely risky patients flagged |

### Bug #9: Payment Mode Type Mismatch

| | |
|---|---|
| **Location** | `src/app/billing/page.tsx` vs `src/lib/business-logic.ts` |
| **Problem** | Billing page defines 3 modes (cash/upi/card). Other modules create bills with 7+ modes. Bills with mode 'insurance'/'cheque' show blank badges |
| **Effect** | Hidden bills in filters, incomplete CA reports, missing payment mode badges |
| **Fix** | `src/lib/payment-modes.ts` — single source of truth with all modes, icons, colors |
| **After Fix** | All payment modes display correctly. Filters include all modes |

### Bug #11: Pharmacy Stock Ignores Expired Batches

| | |
|---|---|
| **Location** | `src/lib/pharmacy.ts` → `hasStock()` |
| **Problem** | Only checks `current_stock >= qty` without deducting expired batch quantities |
| **Effect** | Staff may dispense expired medicines. Low-stock alerts don't fire accurately |
| **Fix** | `src/lib/pharmacy-safe.ts` → `getEffectiveStock()` + DB function `get_effective_stock()` |
| **After Fix** | Stock display shows non-expired quantity. Expired batches clearly separated |

### Bug #12: CA Report Incomplete Data

| | |
|---|---|
| **Location** | `src/app/billing/page.tsx` |
| **Problem** | CA report uses bills loaded on page init (last 30 days, max 500). Quarterly/yearly reports are incomplete |
| **Effect** | CA receives incorrect revenue numbers. Yearly reports show only recent month |
| **Fix** | `src/lib/ca-report-loader.ts` with paginated loading, IST-aware filtering, no 500-bill limit |
| **After Fix** | CA reports always show complete data for selected period |

### Bug #13: GST Calculation Inconsistency

| | |
|---|---|
| **Location** | `src/lib/billing-gst.ts` vs `src/lib/business-logic.ts` |
| **Problem** | Two different GST formulas produce paisa-level differences in edge cases |
| **Effect** | Dashboard shows different totals than receipts. CA reports may have rounding discrepancies |
| **Fix** | `src/lib/billing-tax-unified.ts` — single canonical formula with proper rounding |
| **After Fix** | One formula everywhere. CGST/SGST split always exact. Consistent to the paisa |

---

## ADDITIONAL BUGS FOUND (not yet fixed — documented for next iteration)

### Bug #14: Portal Self-Payment Confirmation (CRITICAL SECURITY)

| | |
|---|---|
| **Location** | `src/app/api/portal/pay/route.ts` |
| **Problem** | PATCH endpoint allows patients to mark their own bill as "paid" by sending `{ bill_id, payment_mode, transaction_id }` with NO server-side payment verification |
| **Effect** | Revenue loss — patients can mark bills paid without actually paying |
| **Recommendation** | Integrate Razorpay webhook for server-side verification OR require admin confirmation |

### Bug #15: Daily Closing Timezone Bug

| | |
|---|---|
| **Location** | `src/app/api/billing/daily-closing/route.ts` |
| **Problem** | Bills queried with `.gte('created_at', date + 'T00:00:00')` without TZ suffix. `created_at` is stored in UTC. Bills between 00:00-05:30 IST (18:30-00:00 UTC previous day) are MISSED |
| **Effect** | Daily closing misses bills created between midnight and 5:30 AM IST. Incorrect daily revenue |
| **Recommendation** | Use `date + 'T00:00:00+05:30'` for IST-correct filtering (like CA report already does) |

### Bug #16: Offline Queue No Conflict Resolution

| | |
|---|---|
| **Location** | `src/lib/offline-queue.ts` |
| **Problem** | Queued operations synced without version checking or conflict detection. If another user modified the same record while offline, the sync overwrites their changes |
| **Effect** | Data loss in multi-user scenarios when network goes offline |
| **Recommendation** | Add `updated_at` version comparison before applying queued changes |

### Bug #17: Bill Generation Advisory Lock Silently Fails

| | |
|---|---|
| **Location** | `src/app/api/billing/generate-bill/route.ts` |
| **Problem** | When `pg_advisory_lock` RPC fails (function doesn't exist), code continues WITHOUT lock. Concurrency protection is gone |
| **Effect** | Duplicate invoice numbers under concurrent requests. Only single retry catches one collision |
| **Recommendation** | Implement fallback via Supabase SELECT...FOR UPDATE or add the RPC function |

### Bug #18: Notifications Fail Server-Side (Relative URL)

| | |
|---|---|
| **Location** | `src/lib/notifications.ts` |
| **Problem** | Uses `fetch('/api/notifications')` — relative URL only works in browser context. Server-side API route calls (where no origin is defined) fail silently |
| **Effect** | Notifications triggered from API routes (e.g., cron jobs, webhooks) are silently lost |
| **Recommendation** | Use absolute URL via `process.env.NEXT_PUBLIC_SITE_URL` + '/api/notifications' |

### Bug #19: Portal Follow-Up Booking Uses Wrong Timezone

| | |
|---|---|
| **Location** | `src/app/api/portal/book-followup/route.ts` |
| **Problem** | Date validation uses `new Date()` (UTC on server) instead of `getIndiaToday()` for IST |
| **Effect** | Indian patients at 11pm IST can fail to book for "today" or succeed booking past dates |
| **Recommendation** | Replace with `getIndiaToday()` for date comparison |

### Bug #20: OPD Height Pre-fill Creates Stale Data for Pediatrics

| | |
|---|---|
| **Location** | `src/app/opd/new/page.tsx` |
| **Problem** | Height auto-fills from last encounter. For growing children, old height → wrong BMI → incorrect clinical decisions |
| **Effect** | Pediatric patients get stale BMI calculations. Doctor may not notice pre-filled height is outdated |
| **Recommendation** | Only pre-fill height if last encounter is within 30 days, or add visual "stale data" warning |

---

## Integration Guide

### Step 1: Run the Migration
```sql
-- In Supabase SQL Editor, run:
-- migrations/013_real_fixes_pharmacy_and_nursing.sql
```

### Step 2: Replace Imports (one at a time)

```typescript
// Pharmacy dispensing:
// OLD: import { dispenseMedicine } from '@/lib/pharmacy'
// NEW: import { dispenseMedicineSafe } from '@/lib/pharmacy-safe'

// ANC Risk:
// OLD: import { calculateANCRisk } from '@/lib/business-logic'
// NEW: import { calculateANCRiskV2 } from '@/lib/anc-risk-v2'

// Payment Modes:
// OLD: type PayMode = 'cash' | 'upi' | 'card'
// NEW: import { PaymentMode, getPaymentModeDisplay } from '@/lib/payment-modes'

// Tax Calculation:
// OLD: import { calculateTotals } from '@/lib/billing-gst'
// NEW: import { calculateBillTax } from '@/lib/billing-tax-unified'

// CA Reports:
// OLD: computeCAReport(bills, from, to, label)
// NEW: import { loadCAReportData } from '@/lib/ca-report-loader'
```

### Step 3: Quick Fixes for Critical Non-Fixed Bugs

```typescript
// Bug #15 fix — in daily-closing/route.ts, change:
.gte('created_at', date + 'T00:00:00')
.lt('created_at', date + 'T23:59:59.999')
// To:
.gte('created_at', date + 'T00:00:00+05:30')
.lt('created_at', date + 'T23:59:59.999+05:30')

// Bug #19 fix — in portal/book-followup/route.ts, change:
const today = new Date(); today.setHours(0,0,0,0)
// To:
import { getIndiaToday } from '@/lib/utils'
const today = getIndiaToday()
```
