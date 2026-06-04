/**
 * src/lib/credit-notes.ts
 *
 * Credit Note Generation & Management
 *
 * A credit note (CN) is issued when:
 *   - A bill is fully or partially refunded
 *   - An overcharge correction is made
 *   - A service was not provided after billing
 *
 * Credit notes are linked to the original bill and contain:
 *   - Unique CN number (format: CN-YYYY-XXXX)
 *   - Original bill reference
 *   - Line items being credited (or lump sum)
 *   - GST reversal details (CGST/SGST split)
 *   - Issuer and reason
 *
 * This module provides:
 *   1. CN number generation (sequential per year)
 *   2. GST reversal calculation
 *   3. Credit note creation helper
 *   4. Credit note PDF data generation (for printing)
 *   5. Fetch credit notes for a patient/bill
 *
 * DB Table: credit_notes
 *   CREATE TABLE IF NOT EXISTS credit_notes (
 *     id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
 *     cn_number TEXT NOT NULL UNIQUE,
 *     bill_id UUID NOT NULL,
 *     patient_id UUID NOT NULL,
 *     patient_name TEXT NOT NULL,
 *     mrn TEXT,
 *     original_invoice_number TEXT,
 *     original_amount NUMERIC(10,2) NOT NULL,
 *     credit_amount NUMERIC(10,2) NOT NULL,
 *     credit_items JSONB DEFAULT '[]',
 *     reason TEXT NOT NULL,
 *     refund_mode TEXT,
 *     gst_percent NUMERIC(5,2) DEFAULT 0,
 *     gst_reversal NUMERIC(10,2) DEFAULT 0,
 *     cgst_reversal NUMERIC(10,2) DEFAULT 0,
 *     sgst_reversal NUMERIC(10,2) DEFAULT 0,
 *     taxable_reversal NUMERIC(10,2) DEFAULT 0,
 *     issued_by TEXT NOT NULL,
 *     issued_at TIMESTAMPTZ DEFAULT NOW(),
 *     status TEXT DEFAULT 'issued' CHECK (status IN ('issued', 'applied', 'cancelled')),
 *     notes TEXT,
 *     metadata JSONB DEFAULT '{}',
 *     created_at TIMESTAMPTZ DEFAULT NOW(),
 *     updated_at TIMESTAMPTZ DEFAULT NOW()
 *   );
 *
 *   CREATE INDEX idx_credit_notes_bill ON credit_notes(bill_id);
 *   CREATE INDEX idx_credit_notes_patient ON credit_notes(patient_id);
 *   CREATE INDEX idx_credit_notes_number ON credit_notes(cn_number);
 *
 * ═══════════════════════════════════════════════════════════════════════
 * UPDATES IN THIS VERSION (June 2026) — ALL ADDITIVE, NO REMOVALS
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   FIX #22: GST REVERSAL ROUND-TRIPS EXACTLY
 *     Previous: computed taxableReversal via division, then derived gstReversal
 *     as the leftover. With paisa rounding the round-trip
 *     `taxableReversal * (1 + gstPercent/100)` could differ from creditAmount
 *     by a paisa, causing GST audit reports not to balance against bills.
 *
 *     New formula (mathematically equivalent at full precision, paisa-exact
 *     after rounding):
 *         gstReversal     = round( creditAmount × gstPercent / (100 + gstPercent) , 2 )
 *         taxableReversal = creditAmount − gstReversal
 *         cgstReversal    = round( gstReversal / 2 , 2 )
 *         sgstReversal    = gstReversal − cgstReversal
 *
 *     Invariant: taxableReversal + gstReversal === creditAmount (exact).
 *     Invariant: cgstReversal + sgstReversal === gstReversal (exact).
 *
 *   FIX #23: RACE-FREE CN NUMBER GENERATION
 *     Previous: SELECT MAX(cn_number) → parse → +1 → INSERT. Two concurrent
 *     CN creations could read the same MAX and both try to INSERT the same
 *     number — one fails on the UNIQUE constraint, the other proceeds with
 *     the wrong sequence assumption.
 *
 *     New: a retry-on-conflict loop. We attempt the INSERT; if it fails with
 *     PG error 23505 (unique_violation), we re-read MAX and retry up to
 *     5 times. This works without any extra DB schema (uses the existing
 *     UNIQUE constraint on cn_number).
 *
 *     The generateCNNumber() helper is preserved for callers that want the
 *     number BEFORE creating the row (e.g., draft preview), but is now
 *     marked as non-authoritative — the canonical assignment happens inside
 *     createCreditNote() via the retry loop.
 *
 * ALL EXISTING EXPORTS PRESERVED:
 *   - Types: CreditNoteItem, CreditNote, CreateCreditNoteParams, GSTReversal
 *   - Functions: calculateGSTReversal, generateCNNumber, createCreditNote,
 *                getCreditNotesForBill, getCreditNotesForPatient,
 *                cancelCreditNote, formatCreditNoteForPrint, getCreditNoteStats
 *
 * EXTERNAL CALLERS VERIFIED:
 *   - tests/unit/billing-gst.test.ts imports `calculateGSTReversal` —
 *     signature & semantics preserved; existing assertions still hold.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { supabase } from './supabase'

// ── Types ────────────────────────────────────────────────────────

export interface CreditNoteItem {
  label: string
  amount: number
  quantity?: number
}

export interface CreditNote {
  id: string
  cn_number: string
  bill_id: string
  patient_id: string
  patient_name: string
  mrn: string
  original_invoice_number: string | null
  original_amount: number
  credit_amount: number
  credit_items: CreditNoteItem[]
  reason: string
  refund_mode: string | null
  gst_percent: number
  gst_reversal: number
  cgst_reversal: number
  sgst_reversal: number
  taxable_reversal: number
  issued_by: string
  issued_at: string
  status: 'issued' | 'applied' | 'cancelled'
  notes: string | null
  created_at: string
}

export interface CreateCreditNoteParams {
  billId: string
  patientId: string
  patientName: string
  mrn?: string
  originalInvoiceNumber?: string
  originalAmount: number
  creditAmount: number
  creditItems?: CreditNoteItem[]
  reason: string
  refundMode?: string
  gstPercent?: number
  issuedBy: string
  notes?: string
}

export interface GSTReversal {
  taxableReversal: number   // Amount before GST
  gstReversal: number       // Total GST reversal
  cgstReversal: number      // Central GST (half of total)
  sgstReversal: number      // State GST (half of total)
  netCredit: number         // Total credit = taxable + GST
}

// ── Internal rounding helper ─────────────────────────────────────

/**
 * Round to 2 decimal places (paisa precision).
 * Using a banker's-rounding-safe approach: multiply, round-half-away-from-zero, divide.
 * Math.round() in JS is half-away-from-positive-infinity, which is what we want
 * for currency (matches GAAP convention).
 */
function roundToTwo(n: number): number {
  return Math.round(n * 100) / 100
}

// ── GST Reversal Calculation ─────────────────────────────────────

/**
 * Calculate GST reversal for a credit note.
 *
 * When a refund is issued on a GST-inclusive amount:
 *   creditAmount    = total amount being refunded (incl. GST)
 *   gstReversal     = GST portion of that
 *   taxableReversal = remaining (creditAmount − gstReversal)
 *   CGST            = SGST = gstReversal / 2
 *
 * When GST is 0% (most medical services), all values are 0 except
 * taxableReversal which equals creditAmount.
 *
 * FIX #22: gstReversal is now computed FIRST (in a single rounding step),
 * and taxableReversal is derived from it via subtraction. This guarantees
 * taxableReversal + gstReversal === creditAmount exactly, so GST reports
 * reconcile against bills to the paisa.
 */
export function calculateGSTReversal(creditAmount: number, gstPercent: number): GSTReversal {
  if (gstPercent <= 0 || creditAmount <= 0) {
    return {
      taxableReversal: roundToTwo(Math.max(0, creditAmount)),
      gstReversal: 0,
      cgstReversal: 0,
      sgstReversal: 0,
      netCredit: roundToTwo(Math.max(0, creditAmount)),
    }
  }

  // ─── FIX #22 ───
  // Compute gstReversal FIRST in a single rounding step:
  //   gstReversal = creditAmount × gstPercent / (100 + gstPercent)
  // Then derive taxableReversal by subtraction so the round-trip is exact.
  const gstReversal = roundToTwo((creditAmount * gstPercent) / (100 + gstPercent))
  const taxableReversal = roundToTwo(creditAmount - gstReversal)

  // CGST = SGST half-split. cgst is rounded; sgst is the leftover to
  // preserve the invariant cgst + sgst === gstReversal exactly.
  const cgstReversal = roundToTwo(gstReversal / 2)
  const sgstReversal = roundToTwo(gstReversal - cgstReversal)

  return {
    taxableReversal,
    gstReversal,
    cgstReversal,
    sgstReversal,
    netCredit: roundToTwo(creditAmount),
  }
}

/**
 * Get the refundable balance remaining for a bill.
 *
 * 2026-06-04 audit fix (§6.1): a helper used by createCreditNote() to
 * give the front-end a friendly error message BEFORE the DB trigger
 * enforce_credit_note_cap throws (which it does atomically as the
 * authoritative gate, but its raw error message isn't user-friendly).
 *
 * Returns:
 *   - billTotal:        original net_amount (or total) of the bill
 *   - existingCredits:  sum of all non-cancelled credit-note credit_amounts
 *                       already issued against this bill
 *   - refundable:       billTotal - existingCredits  (never negative)
 *
 * Returns null only if the bill itself can't be found.
 */
export async function getRefundableBalance(billId: string): Promise<{
  billTotal: number
  existingCredits: number
  refundable: number
} | null> {
  const { data: bill } = await supabase
    .from('bills')
    .select('net_amount, total')
    .eq('id', billId)
    .maybeSingle()

  if (!bill) return null

  const billTotal = roundToTwo(Number(bill.net_amount) || Number(bill.total) || 0)

  const { data: existing } = await supabase
    .from('credit_notes')
    .select('credit_amount, status')
    .eq('bill_id', billId)
    .neq('status', 'cancelled')

  const existingCredits = roundToTwo(
    (existing || []).reduce((sum, cn: any) => sum + Number(cn.credit_amount || 0), 0),
  )

  return {
    billTotal,
    existingCredits,
    refundable: roundToTwo(Math.max(0, billTotal - existingCredits)),
  }
}

// ── CN Number Generation ─────────────────────────────────────────

/**
 * Generate the next credit note number.
 * Format: CN-YYYY-XXXX (e.g., CN-2026-0001)
 * Sequential per calendar year.
 *
 * NOTE: This is best-effort — for the authoritative assignment under
 * concurrency, use createCreditNote() which retries on unique-violation
 * (see FIX #23). This function is suitable for previews and drafts.
 */
export async function generateCNNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `CN-${year}-`

  try {
    // Get the latest CN number for this year
    const { data } = await supabase
      .from('credit_notes')
      .select('cn_number')
      .like('cn_number', `${prefix}%`)
      .order('cn_number', { ascending: false })
      .limit(1)

    let nextSeq = 1
    if (data && data.length > 0) {
      const lastNum = data[0].cn_number
      const seqStr = lastNum.replace(prefix, '')
      const seq = parseInt(seqStr, 10)
      if (!isNaN(seq)) nextSeq = seq + 1
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`
  } catch (err) {
    // Fallback: timestamp-based to prevent duplicates
    const ts = Date.now().toString(36).slice(-4).toUpperCase()
    return `${prefix}${ts}`
  }
}

// ── Create Credit Note ───────────────────────────────────────────

/**
 * Create a credit note entry in the database.
 * Called from the refund API and from admin bill modifications.
 *
 * Returns the created credit note or null on failure.
 *
 * FIX #23: Race-free via retry-on-conflict. If two concurrent calls compute
 * the same next CN number, the database UNIQUE constraint catches it; we
 * re-read MAX and retry. Up to 5 retries before giving up.
 */
export async function createCreditNote(params: CreateCreditNoteParams): Promise<CreditNote | null> {
  const {
    billId,
    patientId,
    patientName,
    mrn = '',
    originalInvoiceNumber,
    originalAmount,
    creditAmount,
    creditItems = [],
    reason,
    refundMode,
    gstPercent = 0,
    issuedBy,
    notes,
  } = params

  // Calculate GST reversal
  const gst = calculateGSTReversal(creditAmount, gstPercent)

  // ─────────────────────────────────────────────────────────────────
  // 2026-06-04 audit fix (§6.1): refund-cap PRE-FLIGHT.
  //
  // Authoritative gate: the DB trigger enforce_credit_note_cap (see
  // migrations/fresh-install/03_billing_finance.sql §5) refuses any
  // INSERT or UPDATE that would push (sum of non-cancelled credits) >
  // bill total. That trigger is the security boundary — even if this
  // pre-flight is removed or bypassed, the database still refuses.
  //
  // The pre-flight here exists to surface a friendly error message
  // ("You can refund up to ₹X. You requested ₹Y.") instead of the
  // trigger's raw Postgres exception, AND to short-circuit before we
  // burn a CN number on a doomed insert.
  // ─────────────────────────────────────────────────────────────────
  if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
    console.warn('[credit-notes] refusing CN with non-positive credit_amount:', creditAmount)
    return null
  }
  try {
    const balance = await getRefundableBalance(billId)
    if (balance) {
      // Tolerance of 1 paisa to absorb floating-point dust
      if (creditAmount > balance.refundable + 0.01) {
        console.warn(
          `[credit-notes] refund cap exceeded: refundable=₹${balance.refundable}, requested=₹${creditAmount}, ` +
          `bill=₹${balance.billTotal}, existing_credits=₹${balance.existingCredits}`,
        )
        return null
      }
    } else {
      console.warn('[credit-notes] bill not found, declining to create CN:', billId)
      return null
    }
  } catch (e: any) {
    // If the pre-flight query itself fails, we still proceed — the
    // DB trigger is the authoritative gate.
    console.warn('[credit-notes] refundable-balance pre-flight failed (non-fatal):', e?.message)
  }

  // FIX #23: retry-on-conflict loop
  const MAX_RETRIES = 5
  let lastError: any = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Generate (or regenerate) the CN number for this attempt.
    // Each attempt re-reads MAX(cn_number) so a colliding concurrent
    // insert is corrected on the next pass.
    const cnNumber = await generateCNNumber()

    const payload = {
      cn_number: cnNumber,
      bill_id: billId,
      patient_id: patientId,
      patient_name: patientName,
      mrn,
      original_invoice_number: originalInvoiceNumber || null,
      original_amount: originalAmount,
      credit_amount: creditAmount,
      credit_items: creditItems.length > 0 ? creditItems : [{ label: reason, amount: creditAmount }],
      reason,
      refund_mode: refundMode || null,
      gst_percent: gstPercent,
      gst_reversal: gst.gstReversal,
      cgst_reversal: gst.cgstReversal,
      sgst_reversal: gst.sgstReversal,
      taxable_reversal: gst.taxableReversal,
      issued_by: issuedBy,
      issued_at: new Date().toISOString(),
      status: 'issued',
      notes: notes || null,
    }

    const { data, error } = await supabase
      .from('credit_notes')
      .insert(payload)
      .select()
      .single()

    if (!error && data) {
      return data as CreditNote
    }

    lastError = error

    // PG error 23505 = unique_violation (cn_number collided).
    // Retry with a freshly-read MAX. Add a small jittered delay to spread
    // out concurrent retries.
    if (error?.code === '23505' && error?.message?.includes('cn_number')) {
      const jitterMs = 10 + Math.floor(Math.random() * 40)
      await new Promise(resolve => setTimeout(resolve, jitterMs))
      console.warn(
        `[credit-notes] CN number ${cnNumber} collided — retrying (attempt ${attempt + 1}/${MAX_RETRIES})`,
      )
      continue
    }

    // Any other error: don't retry, log and bail out
    console.error('[credit-notes] Insert failed:', error?.message)
    if (error?.code === '42P01' || error?.message?.includes('relation')) {
      console.warn('[credit-notes] Table does not exist. Run migration SQL.')
    }
    // 2026-06-04 audit fix (§6.1): the enforce_credit_note_cap trigger
    // raises an exception with "Refund cap exceeded:" prefix when the
    // pre-flight above is bypassed (e.g. concurrent CNs for the same
    // bill). Detect and log the friendly message — caller still gets
    // null but the server logs are clear about why.
    if (error?.message && /refund cap exceeded/i.test(error.message)) {
      console.warn('[credit-notes] DB trigger refused: ' + error.message)
    }
    return null
  }

  // Retries exhausted
  console.error(
    `[credit-notes] CN number generation failed after ${MAX_RETRIES} retries. ` +
    `Last error: ${lastError?.message || 'unknown'}`,
  )
  return null
}

// ── Fetch Credit Notes ───────────────────────────────────────────

/**
 * Get all credit notes for a specific bill.
 */
export async function getCreditNotesForBill(billId: string): Promise<CreditNote[]> {
  const { data, error } = await supabase
    .from('credit_notes')
    .select('*')
    .eq('bill_id', billId)
    .order('created_at', { ascending: false })

  if (error) {
    console.warn('[credit-notes] Fetch for bill failed:', error.message)
    return []
  }

  return (data || []) as CreditNote[]
}

/**
 * Get all credit notes for a specific patient.
 */
export async function getCreditNotesForPatient(patientId: string): Promise<CreditNote[]> {
  const { data, error } = await supabase
    .from('credit_notes')
    .select('*')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })

  if (error) {
    console.warn('[credit-notes] Fetch for patient failed:', error.message)
    return []
  }

  return (data || []) as CreditNote[]
}

/**
 * Cancel a credit note (e.g., if refund was reversed).
 * Only changes status — does NOT delete the record (audit trail).
 *
 * 2026-06-04 audit fix (§6.2): this used to ONLY flip status to
 * 'cancelled', leaving the original revenue/refund effect untouched
 * in hospital_fund. A cancelled credit note (= refund didn't actually
 * happen / was reversed) now also inserts a small reversal/correction
 * row in hospital_fund so the GL balances. The reversal row references
 * the credit_note id via metadata so the audit trail is intact.
 */
export async function cancelCreditNote(cnId: string, cancelledBy: string): Promise<boolean> {
  // Fetch the credit note BEFORE we cancel it — we need its amount for
  // the reversal entry, and we need to know it's still 'issued' so we
  // don't double-reverse on a re-cancel.
  const { data: cn, error: fetchErr } = await supabase
    .from('credit_notes')
    .select('id, cn_number, credit_amount, bill_id, patient_name, mrn, status')
    .eq('id', cnId)
    .maybeSingle()

  if (fetchErr || !cn) {
    console.error('[credit-notes] Cancel — CN not found:', fetchErr?.message)
    return false
  }
  if (cn.status !== 'issued') {
    // Already cancelled or already applied — nothing to do.
    console.warn(`[credit-notes] Cancel skipped: CN ${cn.cn_number} status=${cn.status}`)
    return false
  }

  const { error } = await supabase
    .from('credit_notes')
    .update({
      status: 'cancelled',
      notes: `Cancelled by ${cancelledBy} on ${new Date().toLocaleDateString('en-IN')}`,
      updated_at: new Date().toISOString(),
    })
    .eq('id', cnId)
    .eq('status', 'issued') // Only cancel if still in 'issued' state

  if (error) {
    console.error('[credit-notes] Cancel failed:', error.message)
    return false
  }

  // §6.2: insert a finance correction row.
  //
  // Semantic: a credit note (status='issued') reduced clinic revenue by
  // its credit_amount. Cancelling that credit note "un-does" the refund,
  // i.e. revenue goes back UP by credit_amount. We record this as type
  // 'income' / category 'cn_cancelled' so it appears in the day's
  // collections and the GL balances out.
  //
  // Non-fatal if the insert fails — the cancel itself succeeded; the
  // finance side will be reconciled on the next CA report.
  try {
    await supabase.from('hospital_fund').insert({
      type: 'income',
      amount: roundToTwo(Number(cn.credit_amount) || 0),
      category: 'cn_cancelled',
      description:
        `Credit note ${cn.cn_number} cancelled — revenue reinstated. ` +
        `Patient: ${cn.patient_name}${cn.mrn ? ` (${cn.mrn})` : ''}`,
      submitted_by: cancelledBy,
      status: 'approved',
      bill_id: cn.bill_id,
    })
  } catch (e: any) {
    console.warn('[credit-notes] Cancel — finance reversal insert failed (non-fatal):', e?.message)
  }

  return true
}

// ── Credit Note Print Data ───────────────────────────────────────

/**
 * Generate structured data for printing/PDF rendering of a credit note.
 * Used by the receipt printer or PDF generator.
 */
export function formatCreditNoteForPrint(cn: CreditNote, hospitalSettings: {
  hospitalName?: string
  address?: string
  phone?: string
  gstin?: string
  doctorName?: string
}): {
  header: string[]
  body: string[]
  footer: string[]
} {
  const hs = hospitalSettings
  const header = [
    hs.hospitalName || 'Hospital',
    hs.address || '',
    hs.phone ? `Phone: ${hs.phone}` : '',
    '',
    '═══ CREDIT NOTE ═══',
    '',
    `CN Number: ${cn.cn_number}`,
    `Date: ${new Date(cn.issued_at).toLocaleDateString('en-IN')}`,
    `Original Invoice: ${cn.original_invoice_number || '—'}`,
    '',
  ].filter(Boolean)

  const body = [
    `Patient: ${cn.patient_name}`,
    `MRN: ${cn.mrn || '—'}`,
    '',
    '─── Credit Details ───',
    '',
    ...cn.credit_items.map((item, i) =>
      `${i + 1}. ${item.label}${item.quantity ? ` (×${item.quantity})` : ''}: ₹${item.amount.toLocaleString('en-IN')}`
    ),
    '',
    `Reason: ${cn.reason}`,
    '',
    '─── Amount ───',
    '',
    `Original Bill Amount: ₹${cn.original_amount.toLocaleString('en-IN')}`,
    `Credit Amount: ₹${cn.credit_amount.toLocaleString('en-IN')}`,
  ]

  if (cn.gst_reversal > 0) {
    body.push(
      '',
      '─── GST Reversal ───',
      `Taxable Value: ₹${cn.taxable_reversal.toFixed(2)}`,
      `CGST @ ${(cn.gst_percent / 2).toFixed(1)}%: ₹${cn.cgst_reversal.toFixed(2)}`,
      `SGST @ ${(cn.gst_percent / 2).toFixed(1)}%: ₹${cn.sgst_reversal.toFixed(2)}`,
      `Total GST Reversal: ₹${cn.gst_reversal.toFixed(2)}`,
    )
    if (hs.gstin) {
      body.push(`GSTIN: ${hs.gstin}`)
    }
  }

  const footer = [
    '',
    `Refund Mode: ${cn.refund_mode || 'As per original payment'}`,
    `Issued By: ${cn.issued_by}`,
    '',
    `Status: ${cn.status.toUpperCase()}`,
    '',
    '─────────────────────',
    'This is a computer-generated credit note.',
    hs.hospitalName || '',
  ]

  return { header, body, footer }
}

// ── Summary Stats ────────────────────────────────────────────────

/**
 * Get credit note statistics for a date range (for CA report).
 */
export async function getCreditNoteStats(fromDate: string, toDate: string): Promise<{
  totalCount: number
  totalAmount: number
  totalGSTReversal: number
  byReason: { reason: string; count: number; amount: number }[]
}> {
  const { data, error } = await supabase
    .from('credit_notes')
    .select('credit_amount, gst_reversal, reason')
    .eq('status', 'issued')
    .gte('issued_at', fromDate + 'T00:00:00+05:30')
    .lte('issued_at', toDate + 'T23:59:59+05:30')

  if (error || !data) {
    return { totalCount: 0, totalAmount: 0, totalGSTReversal: 0, byReason: [] }
  }

  const totalAmount = data.reduce((s, cn) => s + Number(cn.credit_amount || 0), 0)
  const totalGSTReversal = data.reduce((s, cn) => s + Number(cn.gst_reversal || 0), 0)

  // Group by reason
  const reasonMap: Record<string, { count: number; amount: number }> = {}
  for (const cn of data) {
    const key = cn.reason || 'Unspecified'
    if (!reasonMap[key]) reasonMap[key] = { count: 0, amount: 0 }
    reasonMap[key].count += 1
    reasonMap[key].amount += Number(cn.credit_amount || 0)
  }

  const byReason = Object.entries(reasonMap)
    .map(([reason, stats]) => ({ reason, ...stats }))
    .sort((a, b) => b.amount - a.amount)

  return {
    totalCount: data.length,
    totalAmount,
    totalGSTReversal,
    byReason,
  }
}