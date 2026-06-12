/**
 * src/lib/billing-canonical.ts
 *
 * Canonical billing utilities + deprecation guide (Issue 3 Fix). v2.
 *
 * Bug fixes from v1:
 *  - Removed empty `export { } from` that re-exported nothing.
 *  - Removed `export * from` wildcards — they would cause name-collision
 *    errors at compile time if any two billing modules export same symbol.
 *  - Removed guess-which-function-name fallback in calculateGST — it
 *    silently masked bugs. Now we provide our OWN canonical implementation
 *    here and document which existing file to migrate from.
 *
 * WHAT THIS FILE IS:
 *   The single source of truth for NEW billing code.
 *   - Validation helpers (validateBill, validatePayment) — used before INSERT.
 *   - Calculation helpers (calculateGST, round2) — used everywhere money is computed.
 *   - Formatting (formatINR) — single canonical Indian rupee formatter.
 *
 * WHAT THIS FILE IS NOT:
 *   - It does NOT re-export from the 8 existing billing files (doing so
 *     wildcards their internals and causes name collisions). Each existing
 *     file remains the canonical source for its OWN exports — see the
 *     deprecation table below for which to import from.
 *
 * MIGRATION TABLE (use this list when refactoring imports):
 *   GST/tax math:        → '@/lib/billing-tax-unified'   (NOT billing-gst.ts)
 *   Invoice sequences:   → '@/lib/billing-sequence'
 *   Sequence locking:    → '@/lib/bill-sequence-lock'
 *   Bill versioning:     → '@/lib/bill-versioning-enhanced' (NOT bill-versioning.ts)
 *   Schema helpers:      → '@/lib/billing-helpers'         (largely unneeded after Migration 033)
 *   Phase 1 helpers:     → '@/lib/billing-phase1'
 *
 *   Generic validation / formatting:  → THIS FILE
 */

// ─── Currency formatting (single source of truth) ─────────────────────

/**
 * Format an INR amount with Indian locale + 2 decimals.
 * Always use this — never inline `₹${n}` formatting.
 *
 * formatINR(1234.5)  → "₹1,234.50"
 * formatINR(null)    → "₹0.00"
 * formatINR("99.9")  → "₹99.90"
 */
export function formatINR(amount: number | string | null | undefined): string {
  const n = Number(amount ?? 0)
  if (!Number.isFinite(n)) return '₹0.00'
  return '₹' + n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Round to paise precision (2 decimal places).
 */
export function round2(n: number | string | null | undefined): number {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return 0
  return Math.round(v * 100) / 100
}

// ─── GST / Tax Calculation ─────────────────────────────────────────────

export interface GSTBreakdown {
  subtotal: number       // pre-tax amount
  gst_percent: number    // applied %
  gst_amount: number     // total tax
  cgst: number           // central GST (half of gst_amount)
  sgst: number           // state GST (other half)
  total: number          // subtotal + gst_amount
}

/**
 * Canonical GST calculation. ALWAYS use this for any new code.
 *
 * For intra-state transactions (default): tax splits into CGST + SGST.
 * For inter-state transactions: caller should use the returned gst_amount
 * as IGST (we do not split for inter-state here).
 *
 * @param subtotal - pre-tax amount (must be ≥ 0)
 * @param gstPercent - tax % (typically 0 for medical services, 5/12/18 for goods)
 */
export function calculateGST(subtotal: number, gstPercent: number): GSTBreakdown {
  const sub = round2(subtotal)
  const pct = Number(gstPercent) || 0
  const gst = round2((sub * pct) / 100)
  const cgst = round2(gst / 2)
  const sgst = round2(gst - cgst)  // ensures cgst+sgst === gst exactly
  return {
    subtotal: sub,
    gst_percent: pct,
    gst_amount: gst,
    cgst,
    sgst,
    total: round2(sub + gst),
  }
}

// ─── Validation ───────────────────────────────────────────────────────

/**
 * Validate a bill object before INSERT/UPDATE.
 * Returns array of human-readable error strings. Empty array = valid.
 */
export function validateBill(bill: any): string[] {
  const errors: string[] = []

  if (!bill) {
    errors.push('Bill is null or undefined')
    return errors
  }

  // After Migration 033, both column names exist. Accept either.
  if (!bill.patient_id && !bill.patientid) {
    errors.push('patient_id (or patientid) is required')
  }

  if (!Array.isArray(bill.items) || bill.items.length === 0) {
    errors.push('At least one bill item is required')
  }

  const subtotal = Number(bill.subtotal ?? 0)
  const total = Number(bill.net_amount ?? bill.total ?? 0)
  const paid = Number(bill.paid ?? 0)
  const gst = Number(bill.gst_amount ?? 0)
  const discount = Number(bill.discount ?? 0)

  if (subtotal < 0) errors.push('subtotal cannot be negative')
  if (total < 0) errors.push('total cannot be negative')
  if (paid < 0) errors.push('paid cannot be negative')
  if (gst < 0) errors.push('gst_amount cannot be negative')
  if (discount < 0) errors.push('discount cannot be negative')
  if (paid > total + 0.01) errors.push(`paid (${paid}) exceeds total (${total})`)

  // Consistency: subtotal - discount + gst ≈ total (within 5 paise rounding)
  if (subtotal > 0 && total > 0) {
    const expected = round2(subtotal - discount + gst)
    const actual = round2(total)
    if (Math.abs(expected - actual) > 0.05) {
      errors.push(
        `Total mismatch: subtotal(${subtotal}) - discount(${discount}) + gst(${gst}) = ${expected}, but total is ${actual}`
      )
    }
  }

  return errors
}

/**
 * Validate a payment payload before INSERT.
 */
export function validatePayment(
  payment: any,
  billDue: number
): string[] {
  const errors: string[] = []

  if (!payment) { errors.push('Payment is null'); return errors }

  const amount = Number(payment.amount ?? 0)
  if (!Number.isFinite(amount) || amount <= 0) {
    errors.push('Payment amount must be a positive number')
  }
  if (amount > billDue + 0.01) {
    errors.push(`Payment (${amount}) exceeds bill due (${billDue})`)
  }

  const mode = payment.payment_mode ?? payment.paymentmode
  if (!mode || typeof mode !== 'string') {
    errors.push('payment_mode is required')
  } else {
    const valid = ['cash', 'card', 'upi', 'netbanking', 'cheque', 'razorpay', 'insurance', 'other']
    if (!valid.includes(String(mode).toLowerCase())) {
      errors.push(`Invalid payment_mode: ${mode}. Expected one of: ${valid.join(', ')}`)
    }
  }

  return errors
}

// ─── Re-export the Phase 1 helpers (these don't conflict because they're
//     scoped to deposits/credit/ledger and don't overlap with other files)
// ─────────────────────────────────────────────────────────────────────────
//
// NOTE: If you find that billing-phase1.ts exports something that conflicts
// with one of OUR exports above (e.g. validateBill), comment this line out
// and import billing-phase1 directly where needed.

// Disabled by default to avoid blind wildcards — uncomment after verifying
// no name collisions in your specific codebase:
// export * from './billing-phase1'

// ═══════════════════════════════════════════════════════════════════════
// DEPRECATION GUIDE
// ═══════════════════════════════════════════════════════════════════════
//
// Files marked DEPRECATED below should not be imported by NEW code.
// Existing imports continue to work and should be migrated over time.
//
// DEPRECATED                          USE INSTEAD
// ─────────────────────────────────   ────────────────────────────────────
// '@/lib/billing-gst'                 '@/lib/billing-tax-unified' OR this file
// '@/lib/bill-versioning'             '@/lib/bill-versioning-enhanced'
//
// To find all imports to migrate, in your repo root:
//   grep -r "from '@/lib/billing-gst'" src/
//   grep -r "from '@/lib/bill-versioning'" src/   # not bill-versioning-enhanced
//
// Do NOT delete the deprecated files until ALL imports are migrated.
// You can add an ESLint `no-restricted-imports` rule for these paths:
//
//   {
//     "rules": {
//       "no-restricted-imports": ["error", {
//         "paths": [
//           { "name": "@/lib/billing-gst", "message": "Use @/lib/billing-canonical or @/lib/billing-tax-unified" },
//           { "name": "@/lib/bill-versioning", "message": "Use @/lib/bill-versioning-enhanced" }
//         ]
//       }]
//     }
//   }
//
// ═══════════════════════════════════════════════════════════════════════