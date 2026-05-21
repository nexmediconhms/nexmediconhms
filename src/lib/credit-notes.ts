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

// ── GST Reversal Calculation ─────────────────────────────────────

/**
 * Calculate GST reversal for a credit note.
 *
 * When a refund is issued on a GST-inclusive amount:
 *   taxableAmount = creditAmount / (1 + gstRate/100)
 *   gstReversal = creditAmount - taxableAmount
 *   CGST = SGST = gstReversal / 2
 *
 * When GST is 0% (most medical services), all values are 0.
 */
export function calculateGSTReversal(creditAmount: number, gstPercent: number): GSTReversal {
  if (gstPercent <= 0 || creditAmount <= 0) {
    return {
      taxableReversal: creditAmount,
      gstReversal: 0,
      cgstReversal: 0,
      sgstReversal: 0,
      netCredit: creditAmount,
    }
  }

  // Credit amount is inclusive of GST
  const taxableReversal = Math.round((creditAmount / (1 + gstPercent / 100)) * 100) / 100
  const gstReversal = Math.round((creditAmount - taxableReversal) * 100) / 100
  const cgstReversal = Math.round((gstReversal / 2) * 100) / 100
  const sgstReversal = gstReversal - cgstReversal // Avoids rounding mismatch

  return {
    taxableReversal,
    gstReversal,
    cgstReversal,
    sgstReversal,
    netCredit: creditAmount,
  }
}

// ── CN Number Generation ─────────────────────────────────────────

/**
 * Generate the next credit note number.
 * Format: CN-YYYY-XXXX (e.g., CN-2026-0001)
 * Sequential per calendar year.
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

  // Generate CN number
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

  if (error) {
    console.error('[credit-notes] Insert failed:', error.message)
    // Table might not exist
    if (error.code === '42P01' || error.message?.includes('relation')) {
      console.warn('[credit-notes] Table does not exist. Run migration SQL.')
    }
    return null
  }

  return data as CreditNote
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
 */
export async function cancelCreditNote(cnId: string, cancelledBy: string): Promise<boolean> {
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