/**
 * src/lib/business-logic.ts
 *
 * ALL BUSINESS LOGIC IN ONE PLACE — no calculations in JSX components.
 *
 * This file uses your ACTUAL database schema:
 * - encounters.encounter_date  (renamed from 'date' by v30 migration)
 * - bills: subtotal, discount, tax, total, paid, due (NOT net_amount/gross_amount)
 * - encounters.patientid (lowercase, no underscore)
 * - clinicusers: role, share_pct, extra_roles
 *
 * USAGE in any component or API route:
 *   import { formatCurrency, todayIST, calculateBill } from '@/lib/business-logic'
 */

// ── Constants ─────────────────────────────────────────────────
import { calculateBillTax } from './billing-tax-unified'

export const PAYMENT_MODES = [
  { value: 'cash',      label: '💵 Cash'      },
  { value: 'upi',       label: '📱 UPI'       },
  { value: 'card',      label: '💳 Card'      },
  { value: 'cheque',    label: '🏦 Cheque'    },
  { value: 'insurance', label: '🏥 Insurance' },
  { value: 'advance',   label: '↩ Advance'   },
  { value: 'other',     label: '• Other'      },
] as const

export type PaymentMode = 'cash' | 'upi' | 'card' | 'cheque' | 'insurance' | 'advance' | 'other'

export const BED_STATUSES = [
  { value: 'available',   label: 'Available',   color: 'green' },
  { value: 'occupied',    label: 'Occupied',    color: 'red'   },
  { value: 'reserved',    label: 'Reserved',    color: 'amber' },
  { value: 'maintenance', label: 'Maintenance', color: 'gray'  },
] as const

export type BedStatus = 'available' | 'occupied' | 'reserved' | 'maintenance'

export const BILL_STATUSES = ['unpaid', 'partial', 'paid', 'refunded', 'waived'] as const
export type BillStatus = typeof BILL_STATUSES[number]

export const DISCHARGE_CONDITIONS = [
  'Satisfactory', 'Stable', 'Fair', 'Improving',
  'Poor', 'Critical', 'Against Medical Advice (LAMA)',
]

export const DELIVERY_TYPES = [
  'Normal Vaginal Delivery (NVD)',
  'LSCS — Elective',
  'LSCS — Emergency',
  'Forceps Delivery',
  'Vacuum Delivery',
  'Breech Delivery',
]

// ── Date helpers (IST) ────────────────────────────────────────
// Always use these instead of new Date().toISOString() for date comparisons
// Your queries use DATE type which is timezone-sensitive

const IST_TIMEZONE = 'Asia/Kolkata'

/** Returns today's date in 'YYYY-MM-DD' format in IST timezone */
export function todayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: IST_TIMEZONE })
}

/** Returns tomorrow's date in 'YYYY-MM-DD' format in IST timezone */
export function tomorrowIST(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA', { timeZone: IST_TIMEZONE })
}

/** Returns a date N days from now in 'YYYY-MM-DD' format in IST */
export function daysFromNowIST(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-CA', { timeZone: IST_TIMEZONE })
}

/** How many days until a future date (negative = in the past) */
export function daysUntil(dateStr: string): number {
  const today  = new Date(todayIST() + 'T00:00:00')
  const target = new Date(dateStr   + 'T00:00:00')
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

// ── Formatting ────────────────────────────────────────────────

/** Format a number as Indian Rupees: ₹1,23,456 */
export function formatCurrency(amount: number | null | undefined): string {
  const n = amount ?? 0
  // Show decimals only when there are paisa (non-zero fractional part)
  const hasDecimal = n % 1 !== 0
  return `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: hasDecimal ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}

/** Format a date string for display: '15 Jan 2024' */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

/** Format a datetime for display: '15 Jan 2024, 3:30 PM' */
export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    return new Date(dateStr).toLocaleString('en-IN', {
      day:    '2-digit',
      month:  'short',
      year:   'numeric',
      hour:   '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}


// ── Billing calculations ──────────────────────────────────────
// Match your ACTUAL bills table columns: subtotal, discount, tax, total, paid, due

export interface BillItem {
  label:     string
  amount:    number
  quantity?: number
}

export interface BillCalculation {
  subtotal: number   // sum of all items
  discount: number   // discount amount
  tax:      number   // tax amount
  total:    number   // subtotal - discount + tax
  paid:     number   // amount already paid
  due:      number   // total - paid
  status:   BillStatus
}

/**
 * Calculate bill totals.
 * Use this in the billing form instead of inline math.
 */
export function calculateBill(
  items:       BillItem[],
  discountAmt: number = 0,
  taxPct:      number = 0,
  alreadyPaid: number = 0,
): BillCalculation {
  const subtotal = items.reduce((s, i) => s + (i.amount * (i.quantity ?? 1)), 0)
  const discount = Math.min(discountAmt, subtotal)

  // ═══ FIX: Delegate to unified tax calculation ═══
  const taxBreakdown = calculateBillTax(subtotal, discount, taxPct)
  const tax   = taxBreakdown.gstAmount
  const total = taxBreakdown.totalWithTax
  const paid  = Math.min(alreadyPaid, total)
  const due   = Math.max(total - paid, 0)

  return {
    subtotal,
    discount,
    tax,
    total,
    paid,
    due,
    status: getBillStatus(total, paid),
  }
}

/**
 * Get bill status from paid vs total amounts.
 * Use this instead of inline ternary expressions in components.
 */
export function getBillStatus(total: number, paid: number): BillStatus {
  if (total === 0) return 'paid'            // FIX: Zero-total bills are complete
  if (paid >= total && total > 0) return 'paid'
  if (paid > 0)                   return 'partial'
  return 'unpaid'
}

// ── Bed management ────────────────────────────────────────────

/**
 * What actions can be taken on a bed in a given status?
 * Returns the valid next statuses the bed can transition to.
 */
export function getBedActions(current: BedStatus): BedStatus[] {
  const transitions: Record<BedStatus, BedStatus[]> = {
    available:   ['reserved', 'maintenance'],
    reserved:    ['available', 'maintenance'],
    occupied:    [],           // only freed via discharge
    maintenance: ['available'],
  }
  return transitions[current] || []
}

/** Can this bed be assigned to a new patient? */
export function isBedAssignable(status: BedStatus): boolean {
  return status === 'available' || status === 'reserved'
}

// ── ANC Risk Calculation ──────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high'

export interface ANCRiskResult {
  level:   RiskLevel
  label:   string
  reasons: string[]
  color:   string   // Tailwind classes for badge
}

/**
 * Calculate ANC patient risk level.
 * Single source of truth — import this everywhere instead of
 * duplicating the logic in each component.
 */
export function calculateANCRisk(params: {
  gaWeeks?:     number
  bpSystolic?:  number
  bpDiastolic?: number
  hemoglobin?:  number
  weight?:      number
  gravida?:     number
  age?:         number
  riskFactors?: string[]
}): ANCRiskResult {
  const reasons: string[] = []

  if ((params.riskFactors || []).length > 0) {
    reasons.push(`Pre-existing risk factors: ${params.riskFactors!.join(', ')}`)
  }

  // ═══ FIX #6: Mutually exclusive gestational age checks ═══
  const gaWeeks = params.gaWeeks ?? 0
  if (gaWeeks > 40) {
    reasons.push('Post-dates pregnancy (>40 weeks)')
  } else if (gaWeeks >= 36) {
    // FIX: Only flag near-term when NOT post-dates (36-40 weeks)
    reasons.push('Near-term pregnancy (≥36 weeks)')
  }

  if ((params.bpSystolic ?? 0) > 140)  reasons.push('Hypertension — SBP >140')
  if ((params.bpDiastolic ?? 0) > 90)   reasons.push('Hypertension — DBP >90')

  // ═══ FIX #18: Use nullish coalescing for hemoglobin ═══
  // Before: (params.hemoglobin || 99) — 0 treated as falsy → 99
  // After:  explicit null check — 0 is treated as a suspicious value
  const hb = params.hemoglobin
  if (hb !== undefined && hb !== null) {
    if (hb < 8)       reasons.push('Severe anaemia (Hb <8 g/dL)')
    else if (hb < 11) reasons.push('Mild anaemia (Hb <11 g/dL)')
  }

  if ((params.gravida ?? 0) >= 5)  reasons.push('Grand multiparity (G5 or more)')
  if ((params.age ?? 0) < 18 && params.age !== undefined)
    reasons.push('Adolescent mother (<18 years)')
  if ((params.age ?? 0) > 35)      reasons.push('Advanced maternal age (>35 years)')

  const level: RiskLevel =
    reasons.length >= 3 ? 'high' :
    reasons.length >= 1 ? 'medium' : 'low'

  const COLORS: Record<RiskLevel, string> = {
    low:    'text-green-700 bg-green-100 border-green-200',
    medium: 'text-amber-700 bg-amber-100 border-amber-200',
    high:   'text-red-700 bg-red-100 border-red-200',
  }

  return {
    level,
    label:   `${level.charAt(0).toUpperCase() + level.slice(1)} Risk`,
    reasons,
    color:   COLORS[level],
  }
}

// ── Discharge validation ──────────────────────────────────────

/**
 * Check if a discharge summary has all required fields before finalizing.
 * Returns array of missing field names (empty array = OK to finalize).
 */
export function validateDischarge(summary: Record<string, any>): string[] {
  const required: [string, string][] = [
    ['finaldiagnosis',       'Final Diagnosis'],
    ['conditionatdischarge', 'Condition at Discharge'],
    ['dischargeadvice',      'Discharge Advice'],
    ['followupdate',         'Follow-up Date'],
  ]
  return required
    .filter(([key]) => !summary[key]?.toString().trim())
    .map(([, label]) => label)
}

// ── Prescription helpers ──────────────────────────────────────

/**
 * Check if a medication entry is complete enough to save.
 */
export function isMedicationValid(med: {
  drug?:      string
  dose?:      string
  frequency?: string
}): boolean {
  return !!(med.drug?.trim() && med.frequency?.trim())
}

// ── Revenue metrics ───────────────────────────────────────────

export interface RevenueMetrics {
  gross:          number
  collected:      number
  pending:        number
  discounts:      number
  collectionRate: number   // percentage 0-100
}

/**
 * Calculate revenue metrics from a list of bills.
 * Use this in analytics/dashboard pages.
 */
export function calculateRevenueMetrics(bills: {
  total:    number
  paid:     number
  discount: number
  status:   string
}[]): RevenueMetrics {
  const gross      = bills.reduce((s, b) => s + Number(b.total || 0), 0)
  const collected  = bills.reduce((s, b) => s + Number(b.paid  || 0), 0)
  const discounts  = bills.reduce((s, b) => s + Number(b.discount || 0), 0)
  const pending    = bills
    .filter(b => b.status !== 'paid')
    .reduce((s, b) => s + (Number(b.total) - Number(b.paid || 0)), 0)
  const collectionRate = gross > 0 ? Math.round((collected / gross) * 100) : 0

  return { gross, collected, pending, discounts, collectionRate }
}