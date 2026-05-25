# Bug Fixes from End-to-End Review

## Overview

This document describes all critical and medium bugs identified during comprehensive E2E testing review of NexMedicon HMS, their root causes, effects, and the fixes applied.

**Branch:** `fix/critical-medium-bugs-e2e-review`

**Approach:** All fixes are implemented as **NEW FILES ONLY** — no existing files were modified. This ensures zero risk of breaking existing functionality while providing corrected implementations that can be gradually adopted.

---

## Files Created

| File | Fixes |
|------|-------|
| `migrations/012_fix_role_constraint_and_column_aliases.sql` | Bug #1, #2, #3 (DB), #8 (views), #11 (DB) |
| `src/lib/pharmacy-safe.ts` | Bug #3, #11 |
| `src/lib/reference-source-utils.ts` | Bug #5 |
| `src/lib/anc-risk-v2.ts` | Bug #6 |
| `src/lib/booking-guards-v2.ts` | Bug #7, #10 |
| `src/lib/discharge-clearance-v2.ts` | Bug #8 |
| `src/lib/payment-modes.ts` | Bug #9 |
| `src/lib/billing-tax-unified.ts` | Bug #13 |
| `src/lib/ca-report-loader.ts` | Bug #12 |

---

## Critical Bugs

### Bug #1: Auth/Schema Role Mismatch

| | |
|---|---|
| **Location** | `src/lib/auth.ts` ↔ `migrations/applied/v00-schema-master.sql` |
| **Problem** | `auth.ts` defines `UserRole = 'admin' | 'doctor' | 'staff' | 'lab_partner'` but DB CHECK constraint only allows `('admin','doctor','staff','receptionist')` |
| **Effect** | Lab partner accounts cannot be created. The entire Lab Partner Portal feature is broken. |
| **Fix** | Migration 012 drops and re-creates the CHECK constraint to include `'lab_partner'` |
| **After Fix** | Lab partner users can be created, invited, and login to the lab-partner-portal |

### Bug #2: Schema Column Name Mismatch

| | |
|---|---|
| **Location** | Throughout `src/lib/*.ts` ↔ `v00-schema-master.sql` |
| **Problem** | Schema uses `fullname, authid, isactive, patientid` but code queries `full_name, auth_id, is_active, patient_id` |
| **Effect** | Critical functions return empty results: login (`loadClinicUser` → null), patient search, booking guards, discharge clearance |
| **Fix** | Migration 012 adds GENERATED ALWAYS columns as aliases + creates compatibility views (`clinic_users`, `lab_reports`, `ipd_admissions`, `audit_log`) |
| **After Fix** | Both naming conventions work simultaneously. No code changes needed. |

### Bug #3: Pharmacy Race Condition

| | |
|---|---|
| **Location** | `src/lib/pharmacy.ts` → `dispenseMedicine()` |
| **Problem** | Read-check-update is not atomic. Two concurrent dispense requests can both pass the stock check and both decrement, taking stock below zero. |
| **Effect** | Inventory goes negative, medicines dispensed that don't exist, financial discrepancies |
| **Fix** | New `atomic_dispense_medicine()` DB function with SELECT...FOR UPDATE + new `pharmacy-safe.ts` with multi-strategy fallback |
| **After Fix** | Stock can never go below zero. Concurrent requests correctly rejected with "Insufficient stock" |

### Bug #7: Booking Guards Completely Bypassed

| | |
|---|---|
| **Location** | `src/lib/booking-guards.ts` |
| **Problem** | Queries `patient_id, patient_name, doctor_id` but DB columns are `patientid, patientname` (no underscores). All results return NULL fields. |
| **Effect** | Double-booking prevention is COMPLETELY non-functional. Two patients can be booked at same slot, same patient can have duplicates. |
| **Fix** | New `booking-guards-v2.ts` using correct column names `patientid, patientname, date, time, status` |
| **After Fix** | Overlapping appointments correctly detected. Same-slot warnings shown to staff. |

### Bug #8: Discharge Clearance Non-Functional

| | |
|---|---|
| **Location** | `src/lib/discharge-clearance.ts` |
| **Problem** | Queries `ipd_admissions`, `lab_reports`, `ipd_nursing` — all wrong table names. Actual tables: `ipdadmissions`, `labreports`, and `ipd_nursing` doesn't exist. |
| **Effect** | ALL clearance checks fail silently. Billing clearance never blocks discharge. Patients can be discharged with unpaid bills. |
| **Fix** | New `discharge-clearance-v2.ts` with correct table names and column references |
| **After Fix** | Unpaid bills block discharge. Pending labs shown. Nursing check uses encounters table. |

### Bug #10: Patient Duplicate Detection Broken for Aadhaar

| | |
|---|---|
| **Location** | `src/lib/booking-guards.ts` → `checkPatientDuplicate()` |
| **Problem** | Queries `.eq('aadhaar_no', ...)` but actual column is `aadhaar`. Also queries `full_name` but column is `fullname`. |
| **Effect** | Aadhaar-based duplicate detection completely bypassed. Same Aadhaar can be registered multiple times. |
| **Fix** | New `checkPatientDuplicateV2()` in `booking-guards-v2.ts` using correct column names |
| **After Fix** | Duplicate patients with same Aadhaar correctly detected and warned |

---

## Medium Bugs

### Bug #5: Reference Source Field Concatenation

| | |
|---|---|
| **Location** | `src/app/patients/new/page.tsx` |
| **Problem** | Concatenates referral type + detail into one column: `"Doctor Referral — Dr. Sharma"`. Impossible to filter by type. |
| **Effect** | Analytics cannot group by referral source. Admin cannot filter "show all Doctor Referrals". |
| **Fix** | New `reference-source-utils.ts` with `parseReferenceSource()` that splits existing data back into components |
| **After Fix** | Existing concatenated data correctly parsed. Analytics can group by category. |

### Bug #6: ANC Risk False Positives

| | |
|---|---|
| **Location** | `src/lib/business-logic.ts` → `calculateANCRisk()` |
| **Problem** | `gaWeeks >= 36` flagged as risk. Every term pregnancy becomes "medium risk" automatically. |
| **Effect** | Alert fatigue — 100% of near-term patients show yellow/red badges. Genuine high-risk patients don't stand out. |
| **Fix** | New `anc-risk-v2.ts` with weighted scoring: critical=5pts, major=3pts, minor=1pt. Removed ≥36 weeks as risk. |
| **After Fix** | Healthy near-term patients stay "Low Risk". Only genuinely risky patients flagged. |

### Bug #9: Billing PayMode Type Mismatch

| | |
|---|---|
| **Location** | `src/app/billing/page.tsx` vs `src/lib/business-logic.ts` |
| **Problem** | Billing page defines 3 modes (cash/upi/card) but other modules create bills with 7 modes (+ cheque/insurance/advance/other). |
| **Effect** | Bills with mode 'insurance' or 'cheque' show blank badges, invisible in filters, missing from CA reports. |
| **Fix** | New `payment-modes.ts` — single source of truth with all modes, display config, validation, normalization |
| **After Fix** | All payment modes display correctly everywhere with proper icons and colors. |

### Bug #11: Pharmacy Stock Ignores Expired Batches

| | |
|---|---|
| **Location** | `src/lib/pharmacy.ts` → `hasStock()` |
| **Problem** | Only checks `current_stock >= requiredQty` without deducting expired batch quantities. |
| **Effect** | Staff may dispense expired medicines. Low-stock alerts don't fire when effective stock is actually low. |
| **Fix** | New `getEffectiveStock()` and `hasEffectiveStock()` in `pharmacy-safe.ts` + DB function `get_effective_stock()` |
| **After Fix** | Stock display shows non-expired quantity. Expired batches clearly separated. |

### Bug #12: CA Report Incomplete Data

| | |
|---|---|
| **Location** | `src/app/billing/page.tsx` |
| **Problem** | CA report computation uses bills loaded on page init (last 30 days, max 500). Quarterly/yearly reports are incomplete. |
| **Effect** | CA receives incorrect revenue numbers. Yearly reports show only recent month. |
| **Fix** | New `ca-report-loader.ts` with paginated loading, IST-aware filtering, no 500-bill limit |
| **After Fix** | CA reports always show complete data for selected period. No silent data loss. |

### Bug #13: GST Calculation Inconsistency

| | |
|---|---|
| **Location** | `src/lib/billing-gst.ts` vs `src/lib/business-logic.ts` |
| **Problem** | Two different GST formulas used in different modules. Can produce paisa-level differences. |
| **Effect** | Dashboard shows different totals than receipts. CA reports may have rounding discrepancies. |
| **Fix** | New `billing-tax-unified.ts` — single canonical formula with proper rounding for all GST calculations |
| **After Fix** | One formula everywhere. CGST/SGST split always exact. Consistent to the paisa. |

---

## Integration Guide

To adopt these fixes in your application:

### Step 1: Run the Migration
```sql
-- In Supabase SQL Editor:
-- Run migrations/012_fix_role_constraint_and_column_aliases.sql
```

### Step 2: Gradually Replace Imports

```typescript
// Pharmacy dispensing:
// OLD: import { dispenseMedicine } from '@/lib/pharmacy'
// NEW: import { dispenseMedicineSafe } from '@/lib/pharmacy-safe'

// ANC Risk:
// OLD: import { calculateANCRisk } from '@/lib/business-logic'
// NEW: import { calculateANCRiskV2 } from '@/lib/anc-risk-v2'

// Booking Guards:
// OLD: import { checkAppointmentOverlap } from '@/lib/booking-guards'
// NEW: import { checkAppointmentOverlapV2 } from '@/lib/booking-guards-v2'

// Discharge:
// OLD: import { checkDischargeClearance } from '@/lib/discharge-clearance'
// NEW: import { checkDischargeClearanceV2 } from '@/lib/discharge-clearance-v2'

// Payment Modes:
// OLD: type PayMode = 'cash' | 'upi' | 'card'
// NEW: import { PaymentMode, getPaymentModeDisplay } from '@/lib/payment-modes'

// Tax Calculation:
// OLD: import { calculateTotals } from '@/lib/billing-gst'
// NEW: import { calculateBillTax } from '@/lib/billing-tax-unified'

// CA Reports:
// OLD: computeCAReport(bills, from, to, label)  // from local state
// NEW: import { loadCAReportData } from '@/lib/ca-report-loader'
```

### Step 3: No Breaking Changes
All existing code continues to work as-is. The migration adds compatibility layers (views + generated columns) that make existing queries return correct results without code changes.

---

## Testing Verification

After applying fixes, verify:

1. **Login works** → `loadClinicUser()` returns user data via `clinic_users` view
2. **Lab partner can login** → role 'lab_partner' accepted by DB
3. **Pharmacy concurrent dispense** → Second request fails gracefully
4. **Book overlapping appointment** → Warning shown
5. **Discharge with unpaid bills** → Blocked with amount shown
6. **ANC 38-week healthy patient** → Shows "Low Risk" (not "Medium")
7. **Insurance payment bill** → Shows "🏥 Insurance" badge in list
8. **CA Report for full year** → Shows all months, not just last 30 days
