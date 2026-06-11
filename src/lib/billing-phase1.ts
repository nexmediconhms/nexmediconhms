/**
 * src/lib/billing-phase1.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * Phase 1 Billing Enhancements — Shared Constants & Helpers
 * ═══════════════════════════════════════════════════════════════════════
 *
 * This file is ADDITIVE — it does NOT modify or replace any existing
 * billing helper. It provides utilities for:
 *
 *   1. Deposit management (advance payments for IPD)
 *   2. Partial payment calculations
 *   3. Receipt number generation
 *   4. Patient ledger aggregation
 *   5. Credit note number generation
 *   6. Discharge billing clearance checks
 *
 * USAGE:
 *   import { generateReceiptNumber, computePatientLedger, ... } from '@/lib/billing-phase1'
 *
 * DOES NOT IMPORT FROM:
 *   - billing-gst.ts (no circular deps)
 *   - billing-helpers.ts (no circular deps)
 *   Uses only supabase client
 * ═══════════════════════════════════════════════════════════════════════
 */

import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────

export type DepositStatus = 'collected' | 'partially_adjusted' | 'fully_adjusted' | 'refunded'

export interface PatientDeposit {
  id: string
  patient_id: string
  admission_id: string | null
  amount: number
  payment_mode: string
  payment_ref: string | null
  receipt_number: string | null
  status: DepositStatus
  adjusted_amount: number
  adjusted_bill_id: string | null
  refund_amount: number
  refund_reason: string | null
  refund_mode: string | null
  collected_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface CreditNote {
  id: string
  credit_note_number: string
  original_bill_id: string
  patient_id: string
  amount: number
  reason: string
  type: 'cancellation' | 'refund' | 'correction' | 'discount' | 'other'
  gst_percent: number
  gst_amount: number
  cgst: number
  sgst: number
  created_by: string | null
  created_at: string
}

export interface LedgerEntry {
  id: string
  date: string
  type: 'bill' | 'payment' | 'deposit' | 'deposit_adjustment' | 'refund' | 'credit_note'
  description: string
  reference: string
  debit: number   // amount owed by patient (bills)
  credit: number  // amount paid by patient (payments, deposits)
  balance: number // running balance (positive = patient owes, negative = clinic owes)
  meta?: Record<string, any>
}

export interface LedgerSummary {
  totalBilled: number
  totalPaid: number
  totalDeposits: number
  totalDepositsAdjusted: number
  totalRefunds: number
  totalCreditNotes: number
  currentOutstanding: number
  entries: LedgerEntry[]
}

export interface PartialPaymentInput {
  bill_id: string
  patient_id: string
  payments: {
    amount: number
    payment_mode: string
    payment_ref?: string
  }[]
  received_by: string
  notes?: string
}

export interface DischargeClearanceResult {
  canDischarge: boolean
  totalCharges: number
  totalPaid: number
  totalDeposit: number
  depositAdjusted: number
  outstanding: number
  pendingBills: { id: string; amount: number; status: string }[]
  deposits: PatientDeposit[]
  reasons: string[]
}


// ── Receipt Number Generation ────────────────────────────────────────

/**
 * Generate a sequential receipt number for the current day.
 * Format: RCP-YYYYMMDD-001
 *
 * Uses the bills count as a simple counter (same approach as existing
 * invoice number generation in registration-payment route).
 */
export function generateReceiptNumber(dateStr: string, sequence: number): string {
  const compact = dateStr.replace(/-/g, '')
  return `RCP-${compact}-${String(sequence).padStart(3, '0')}`
}

/**
 * Generate a credit note number for the current day.
 * Format: CN-YYYYMMDD-001
 */
export function generateCreditNoteNumber(dateStr: string, sequence: number): string {
  const compact = dateStr.replace(/-/g, '')
  return `CN-${compact}-${String(sequence).padStart(3, '0')}`
}

/**
 * Generate a deposit receipt number.
 * Format: DEP-YYYYMMDD-001
 */
export function generateDepositReceiptNumber(dateStr: string, sequence: number): string {
  const compact = dateStr.replace(/-/g, '')
  return `DEP-${compact}-${String(sequence).padStart(3, '0')}`
}


// ── Partial Payment Helpers ──────────────────────────────────────────

/**
 * Determine bill status from paid vs total amounts.
 * This matches the existing status values used across the codebase.
 */
export function deriveBillStatus(total: number, paid: number): string {
  if (total <= 0) return 'paid'
  if (paid <= 0) return 'pending'
  if (paid >= total) return 'paid'
  return 'partially_paid'
}

/**
 * Validate a partial payment request.
 * Returns null if valid, or an error string if invalid.
 */
export function validatePartialPayment(
  billTotal: number,
  billPaid: number,
  billStatus: string,
  paymentAmounts: number[]
): string | null {
  // Bill must be payable
  if (['cancelled', 'refunded', 'waived'].includes(billStatus)) {
    return `Cannot pay a ${billStatus} bill`
  }

  const totalPayment = paymentAmounts.reduce((s, a) => s + a, 0)

  if (totalPayment <= 0) {
    return 'Payment amount must be greater than 0'
  }

  const remaining = Math.max(0, billTotal - billPaid)
  if (totalPayment > remaining + 0.01) { // 0.01 tolerance for floating point
    return `Payment ₹${totalPayment.toFixed(2)} exceeds remaining due ₹${remaining.toFixed(2)}`
  }

  for (const amt of paymentAmounts) {
    if (amt <= 0) return 'Each payment split must be greater than 0'
    if (!Number.isFinite(amt)) return 'Invalid payment amount'
  }

  return null
}


// ── Deposit Helpers ──────────────────────────────────────────────────

/**
 * Calculate the unadjusted (available) deposit balance for a patient's admission.
 */
export function getAvailableDepositBalance(deposits: PatientDeposit[]): number {
  return deposits
    .filter(d => !d.is_deleted && d.status !== 'refunded')
    .reduce((sum, d) => sum + (d.amount - d.adjusted_amount - d.refund_amount), 0)
}

/**
 * Load deposits for a specific admission.
 */
export async function loadAdmissionDeposits(admissionId: string): Promise<PatientDeposit[]> {
  const { data, error } = await supabase
    .from('patient_deposits')
    .select('*')
    .eq('admission_id', admissionId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true })

  if (error) {
    console.warn('[billing-phase1] loadAdmissionDeposits error:', error.message)
    return []
  }

  return (data || []) as PatientDeposit[]
}

/**
 * Load all deposits for a patient (across all admissions).
 */
export async function loadPatientDeposits(patientId: string): Promise<PatientDeposit[]> {
  const { data, error } = await supabase
    .from('patient_deposits')
    .select('*')
    .eq('patient_id', patientId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    console.warn('[billing-phase1] loadPatientDeposits error:', error.message)
    return []
  }

  return (data || []) as PatientDeposit[]
}


// ── Patient Ledger Computation ───────────────────────────────────────

/**
 * Compute a patient's full financial ledger from all billing tables.
 * This is a CLIENT-SIDE helper. For server-side use, see the API route.
 *
 * Returns a chronologically sorted list of entries with running balance.
 */
export async function computePatientLedger(patientId: string): Promise<LedgerSummary> {
  const entries: LedgerEntry[] = []
  let totalBilled = 0
  let totalPaid = 0
  let totalDeposits = 0
  let totalDepositsAdjusted = 0
  let totalRefunds = 0
  let totalCreditNotes = 0

  // 1. Load bills (both column name variants for compatibility)
  const billMap = new Map<string, any>()

  const { data: modernBills } = await supabase
    .from('bills')
    .select('*')
    .eq('patient_id', patientId)
    .eq('is_deleted', false)
    .limit(200)

  if (modernBills) {
    for (const b of modernBills) billMap.set(b.id, b)
  }

  // Also try legacy column
  const { data: legacyBills } = await supabase
    .from('bills')
    .select('*')
    .eq('patientid', patientId)
    .limit(200)

  if (legacyBills) {
    for (const b of legacyBills) {
      if (!billMap.has(b.id)) billMap.set(b.id, b)
    }
  }

  for (const bill of billMap.values()) {
    const netAmount = Number(bill.net_amount || bill.total || 0)
    const billDate = bill.created_at || bill.createdat || ''
    const invoiceNum = bill.invoice_number || bill.invoicenumber || ''
    const status = bill.status || 'unknown'

    if (status !== 'cancelled' && !bill.is_deleted) {
      totalBilled += netAmount
      entries.push({
        id: bill.id,
        date: billDate,
        type: 'bill',
        description: `Invoice ${invoiceNum}` + (bill.items?.length ? ` — ${bill.items.map((i: any) => i.label || i.description).join(', ')}` : ''),
        reference: invoiceNum,
        debit: netAmount,
        credit: 0,
        balance: 0,
        meta: { status, bill_module: bill.bill_module },
      })
    }
  }

  // 2. Load bill payments
  const { data: payments } = await supabase
    .from('bill_payments')
    .select('*')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: true })
    .limit(500)

  if (payments) {
    for (const p of payments) {
      const amt = Number(p.amount || 0)
      const txType = p.transaction_type || 'payment'

      if (txType === 'refund') {
        totalRefunds += amt
        entries.push({
          id: p.id,
          date: p.created_at,
          type: 'refund',
          description: `Refund — ${p.notes || p.payment_mode || 'refund'}`,
          reference: p.receipt_number || '',
          debit: 0,
          credit: amt,
          balance: 0,
          meta: { payment_mode: p.payment_mode },
        })
      } else {
        totalPaid += amt
        entries.push({
          id: p.id,
          date: p.created_at,
          type: 'payment',
          description: `Payment (${p.payment_mode || 'cash'})${p.reference ? ` Ref: ${p.reference}` : ''}`,
          reference: p.receipt_number || '',
          debit: 0,
          credit: amt,
          balance: 0,
          meta: { payment_mode: p.payment_mode, bill_id: p.bill_id },
        })
      }
    }
  }

  // 3. Load deposits
  const { data: deposits } = await supabase
    .from('patient_deposits')
    .select('*')
    .eq('patient_id', patientId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true })
    .limit(100)

  if (deposits) {
    for (const d of deposits) {
      totalDeposits += Number(d.amount || 0)
      totalDepositsAdjusted += Number(d.adjusted_amount || 0)

      entries.push({
        id: d.id,
        date: d.created_at,
        type: 'deposit',
        description: `Advance Deposit (${d.payment_mode || 'cash'})${d.receipt_number ? ` — ${d.receipt_number}` : ''}`,
        reference: d.receipt_number || '',
        debit: 0,
        credit: Number(d.amount || 0),
        balance: 0,
        meta: { status: d.status, admission_id: d.admission_id },
      })

      if (Number(d.adjusted_amount) > 0) {
        entries.push({
          id: `${d.id}-adj`,
          date: d.updated_at || d.created_at,
          type: 'deposit_adjustment',
          description: `Deposit adjusted against bill`,
          reference: d.receipt_number || '',
          debit: Number(d.adjusted_amount),
          credit: 0,
          balance: 0,
          meta: { deposit_id: d.id, bill_id: d.adjusted_bill_id },
        })
      }

      if (Number(d.refund_amount) > 0) {
        entries.push({
          id: `${d.id}-refund`,
          date: d.updated_at || d.created_at,
          type: 'refund',
          description: `Deposit refund${d.refund_reason ? ` — ${d.refund_reason}` : ''}`,
          reference: d.receipt_number || '',
          debit: 0,
          credit: Number(d.refund_amount),
          balance: 0,
          meta: { deposit_id: d.id },
        })
      }
    }
  }

  // 4. Load credit notes
  const { data: creditNotes } = await supabase
    .from('credit_notes')
    .select('*')
    .eq('patient_id', patientId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true })
    .limit(100)

  if (creditNotes) {
    for (const cn of creditNotes) {
      totalCreditNotes += Number(cn.amount || 0)
      entries.push({
        id: cn.id,
        date: cn.created_at,
        type: 'credit_note',
        description: `Credit Note ${cn.credit_note_number} — ${cn.reason}`,
        reference: cn.credit_note_number,
        debit: 0,
        credit: Number(cn.amount || 0),
        balance: 0,
        meta: { type: cn.type, original_bill_id: cn.original_bill_id },
      })
    }
  }

  // 5. Sort by date and compute running balance
  entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  let runningBalance = 0
  for (const entry of entries) {
    runningBalance += entry.debit - entry.credit
    entry.balance = Math.round(runningBalance * 100) / 100
  }

  const currentOutstanding = Math.max(0, totalBilled - totalPaid - totalDepositsAdjusted - totalRefunds - totalCreditNotes)

  return {
    totalBilled,
    totalPaid,
    totalDeposits,
    totalDepositsAdjusted,
    totalRefunds,
    totalCreditNotes,
    currentOutstanding: Math.round(currentOutstanding * 100) / 100,
    entries,
  }
}


// ── Discharge Billing Clearance ──────────────────────────────────────

/**
 * Check if an IPD admission's billing is cleared for discharge.
 *
 * Rules:
 *   1. All bills linked to the admission must be 'paid' or 'waived'
 *   2. Outstanding = total charges - paid - deposits adjusted
 *   3. If outstanding > 0, discharge requires explicit override (admin only)
 */
export async function checkDischargeBillingClearance(
  admissionId: string,
  patientId: string
): Promise<DischargeClearanceResult> {
  const reasons: string[] = []
  const pendingBills: { id: string; amount: number; status: string }[] = []

  // 1. Load bills for this admission
  const { data: bills } = await supabase
    .from('bills')
    .select('id, net_amount, total, paid, due, status, admission_id')
    .or(`admission_id.eq.${admissionId},notes.ilike.%IPD-${admissionId}%`)
    .eq('patient_id', patientId)

  let totalCharges = 0
  let totalPaid = 0

  for (const bill of (bills || [])) {
    if (bill.is_deleted || bill.status === 'cancelled') continue
    const amt = Number(bill.net_amount || bill.total || 0)
    totalCharges += amt
    totalPaid += Number(bill.paid || 0)

    if (bill.status !== 'paid' && bill.status !== 'waived') {
      pendingBills.push({
        id: bill.id,
        amount: amt,
        status: bill.status,
      })
    }
  }

  // 2. Load deposits for this admission
  const deposits = await loadAdmissionDeposits(admissionId)
  const totalDeposit = deposits.reduce((s, d) => s + Number(d.amount || 0), 0)
  const depositAdjusted = deposits.reduce((s, d) => s + Number(d.adjusted_amount || 0), 0)

  // 3. Calculate outstanding
  const outstanding = Math.max(0, totalCharges - totalPaid - depositAdjusted)

  // 4. Determine if discharge is allowed
  if (pendingBills.length > 0) {
    reasons.push(`${pendingBills.length} bill(s) are not fully paid`)
  }
  if (outstanding > 0) {
    reasons.push(`Outstanding balance: ₹${outstanding.toLocaleString('en-IN')}`)
  }

  const canDischarge = reasons.length === 0

  return {
    canDischarge,
    totalCharges,
    totalPaid,
    totalDeposit,
    depositAdjusted,
    outstanding,
    pendingBills,
    deposits,
    reasons,
  }
}
