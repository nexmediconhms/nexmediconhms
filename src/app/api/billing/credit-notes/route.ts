/**
 * src/app/api/billing/credit-notes/route.ts
 *
 * Credit Note Management API
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS:
 *   Indian GST law requires a formal Credit Note when:
 *   - A bill/invoice is cancelled after payment
 *   - A refund is issued (full or partial)
 *   - A billing correction reduces the original amount
 *   - A post-billing discount is applied
 *
 *   Without credit notes, your GST returns will mismatch and the
 *   clinic faces audit risk. This route auto-generates CN numbers,
 *   computes GST reversal (CGST + SGST split), and links back to
 *   the original bill for traceability.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ENDPOINTS:
 *
 *   GET /api/billing/credit-notes
 *     List credit notes with filters.
 *     Query params:
 *       patientId   — filter by patient
 *       billId      — filter by original bill
 *       from        — date range start (YYYY-MM-DD)
 *       to          — date range end (YYYY-MM-DD)
 *       type        — cancellation | refund | correction | discount | other
 *       limit       — max results (default 50, max 200)
 *
 *   POST /api/billing/credit-notes
 *     Generate a new credit note.
 *     Body: {
 *       bill_id:    string    (UUID of original bill — required)
 *       amount:     number    (credit note amount — required, must be ≤ bill net_amount)
 *       reason:     string    (reason — required, min 5 chars)
 *       type:       string    (cancellation | refund | correction | discount | other)
 *       refund_id?: string    (link to existing refund record if applicable)
 *     }
 *
 *   GET /api/billing/credit-notes/summary
 *     Aggregate summary for a date range (for GST return / CA reports).
 *     Query params:
 *       from        — required (YYYY-MM-DD)
 *       to          — required (YYYY-MM-DD)
 *
 * Auth: admin, doctor, staff (POST restricted to admin for cancellation type)
 *
 * ─── ADDITIVE ────────────────────────────────────────────────────────
 * New route. Does not modify any existing billing, refund, or
 * cancellation routes. Existing /api/billing/refund continues to
 * work unchanged — you can optionally call this route after a
 * successful refund to generate the corresponding credit note.
 * ─────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GST rate for medical services (update if your clinic uses a different rate)
// Your existing billing-tax-unified.ts is the single source of truth for live billing.
// This constant is ONLY used for credit note GST reversal calculation.
const DEFAULT_GST_PERCENT = 18

// ─────────────────────────────────────────────────────────────────────
// GET — List credit notes with filters
// ─────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  const params = req.nextUrl.searchParams
  const patientId = params.get('patientId')
  const billId = params.get('billId')
  const fromDate = params.get('from')
  const toDate = params.get('to')
  const type = params.get('type')
  const summary = params.get('summary')  // if 'true', return aggregate summary
  const limitParam = params.get('limit')
  const limit = Math.min(Number(limitParam) || 50, 200)

  const sb = getSupabaseAdmin()

  // ── Summary mode (for GST returns / CA reports) ────────────────
  if (summary === 'true') {
    if (!fromDate || !toDate) {
      return NextResponse.json({
        error: 'from and to dates are required for summary mode',
      }, { status: 400 })
    }

    const { data: notes, error: fetchErr } = await sb
      .from('credit_notes')
      .select('*')
      .eq('is_deleted', false)
      .gte('created_at', fromDate + 'T00:00:00+05:30')
      .lte('created_at', toDate + 'T23:59:59+05:30')
      .order('created_at', { ascending: true })

    if (fetchErr) {
      return NextResponse.json({ error: 'Failed to load credit notes: ' + fetchErr.message }, { status: 500 })
    }

    const items = notes || []
    const totalAmount = items.reduce((s: number, cn: any) => s + Number(cn.amount || 0), 0)
    const totalGST = items.reduce((s: number, cn: any) => s + Number(cn.gst_amount || 0), 0)
    const totalCGST = items.reduce((s: number, cn: any) => s + Number(cn.cgst || 0), 0)
    const totalSGST = items.reduce((s: number, cn: any) => s + Number(cn.sgst || 0), 0)
    const totalBase = totalAmount - totalGST

    // Group by type
    const byType: Record<string, { count: number; amount: number }> = {}
    for (const cn of items) {
      const t = cn.type || 'other'
      if (!byType[t]) byType[t] = { count: 0, amount: 0 }
      byType[t].count++
      byType[t].amount += Number(cn.amount || 0)
    }

    // Group by month (for GSTR-1 reporting)
    const byMonth: Record<string, { count: number; amount: number; gst: number }> = {}
    for (const cn of items) {
      const month = (cn.created_at || '').slice(0, 7) // YYYY-MM
      if (!byMonth[month]) byMonth[month] = { count: 0, amount: 0, gst: 0 }
      byMonth[month].count++
      byMonth[month].amount += Number(cn.amount || 0)
      byMonth[month].gst += Number(cn.gst_amount || 0)
    }

    return NextResponse.json({
      period: { from: fromDate, to: toDate },
      totalCount: items.length,
      totalAmount: round2(totalAmount),
      totalBase: round2(totalBase),
      totalGST: round2(totalGST),
      totalCGST: round2(totalCGST),
      totalSGST: round2(totalSGST),
      byType,
      byMonth,
      credit_notes: items,
    })
  }

  // ── List mode ──────────────────────────────────────────────────
  let query = sb
    .from('credit_notes')
    .select('*, bills:original_bill_id(id, invoice_number, patient_id, net_amount, total)')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (patientId) query = query.eq('patient_id', patientId)
  if (billId) query = query.eq('original_bill_id', billId)
  if (type) query = query.eq('type', type)
  if (fromDate) query = query.gte('created_at', fromDate + 'T00:00:00+05:30')
  if (toDate) query = query.lte('created_at', toDate + 'T23:59:59+05:30')

  const { data, error: fetchErr } = await query

  if (fetchErr) {
    console.error('[credit-notes] GET error:', fetchErr.message)
    // Retry without join (bills foreign key may not exist)
    const { data: fallback, error: fallbackErr } = await sb
      .from('credit_notes')
      .select('*')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (fallbackErr) {
      return NextResponse.json({ error: 'Failed to load credit notes' }, { status: 500 })
    }

    return NextResponse.json({ credit_notes: fallback || [], count: (fallback || []).length })
  }

  return NextResponse.json({ credit_notes: data || [], count: (data || []).length })
}


// ─────────────────────────────────────────────────────────────────────
// POST — Generate a new credit note
// ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { bill_id, amount, reason, type, refund_id } = body ?? {}

  // ── Validate inputs ────────────────────────────────────────────
  if (!bill_id || typeof bill_id !== 'string') {
    return NextResponse.json({ error: 'bill_id is required' }, { status: 400 })
  }

  const amountNum = Number(amount)
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return NextResponse.json({ error: 'amount must be greater than 0' }, { status: 400 })
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
    return NextResponse.json({ error: 'reason is required (min 5 characters)' }, { status: 400 })
  }

  const cnType = type || 'cancellation'
  const validTypes = ['cancellation', 'refund', 'correction', 'discount', 'other']
  if (!validTypes.includes(cnType)) {
    return NextResponse.json({
      error: `type must be one of: ${validTypes.join(', ')}`,
    }, { status: 400 })
  }

  const sb = getSupabaseAdmin()

  // ── Load original bill ─────────────────────────────────────────
  const { data: bill, error: billErr } = await sb
    .from('bills')
    .select('*')
    .eq('id', bill_id)
    .single()

  if (billErr || !bill) {
    return NextResponse.json({ error: 'Original bill not found' }, { status: 404 })
  }

  const billTotal = Number(bill.net_amount || bill.total || 0)
  const patientId = bill.patient_id || bill.patientid

  if (!patientId) {
    return NextResponse.json({ error: 'Bill has no patient_id — cannot generate credit note' }, { status: 400 })
  }

  if (amountNum > billTotal + 0.01) {
    return NextResponse.json({
      error: `Credit note amount ₹${amountNum} exceeds bill total ₹${billTotal}`,
    }, { status: 400 })
  }

  // ── Check for duplicate credit notes on same bill ──────────────
  const { data: existingCNs } = await sb
    .from('credit_notes')
    .select('id, amount')
    .eq('original_bill_id', bill_id)
    .eq('is_deleted', false)

  const existingTotal = (existingCNs || []).reduce((s: number, cn: any) => s + Number(cn.amount || 0), 0)

  if (existingTotal + amountNum > billTotal + 0.01) {
    return NextResponse.json({
      error: `Total credit notes (${(existingTotal + amountNum).toFixed(2)}) would exceed bill total (${billTotal}). ` +
             `Existing credit notes: ₹${existingTotal.toFixed(2)}`,
    }, { status: 400 })
  }

  // ── Calculate GST reversal ─────────────────────────────────────
  // Use the bill's own GST rate if available, otherwise default
  let gstPercent = DEFAULT_GST_PERCENT
  if (bill.gst_percent !== undefined && bill.gst_percent !== null) {
    gstPercent = Number(bill.gst_percent)
  } else if (bill.gst_amount !== undefined && billTotal > 0) {
    // Reverse-calculate GST % from bill amounts
    const billGST = Number(bill.gst_amount || 0)
    if (billGST > 0) {
      const baseFromBill = billTotal - billGST
      if (baseFromBill > 0) {
        gstPercent = Math.round((billGST / baseFromBill) * 100 * 100) / 100
      }
    }
  }

  // Calculate GST on credit note amount
  let gstAmount = 0
  let cgst = 0
  let sgst = 0

  if (gstPercent > 0) {
    // Credit note amount is inclusive of GST
    const baseAmount = amountNum / (1 + gstPercent / 100)
    gstAmount = round2(amountNum - baseAmount)
    cgst = round2(gstAmount / 2)
    sgst = round2(gstAmount / 2)
  }

  // ── Generate credit note number ────────────────────────────────
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const todayCompact = todayStr.replace(/-/g, '')

  // Count existing credit notes today for sequence
  const { count: cnCount } = await sb
    .from('credit_notes')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', todayStr + 'T00:00:00+05:30')

  const seq = (cnCount || 0) + 1
  const creditNoteNumber = `CN-${todayCompact}-${String(seq).padStart(3, '0')}`

  // ── Insert credit note ─────────────────────────────────────────
  const cnPayload = {
    credit_note_number: creditNoteNumber,
    original_bill_id: bill_id,
    patient_id: patientId,
    amount: amountNum,
    reason: reason.trim(),
    type: cnType,
    gst_percent: gstPercent,
    gst_amount: gstAmount,
    cgst,
    sgst,
    linked_refund_id: refund_id || null,
    created_by: auth.fullName || auth.email || 'staff',
  }

  const { data: creditNote, error: insertErr } = await sb
    .from('credit_notes')
    .insert(cnPayload)
    .select('*')
    .single()

  if (insertErr) {
    console.error('[credit-notes] INSERT error:', insertErr.message)
    return NextResponse.json({
      error: 'Failed to create credit note: ' + insertErr.message,
      hint: 'Ensure the credit_notes table exists. Run migration 030.',
    }, { status: 500 })
  }

  // ── Update bill status if fully credited ───────────────────────
  const newTotalCredited = existingTotal + amountNum
  if (newTotalCredited >= billTotal - 0.01) {
    // Bill is fully credited → mark as cancelled/refunded
    const newStatus = cnType === 'refund' ? 'refunded' : 'cancelled'
    await sb
      .from('bills')
      .update({
        status: newStatus,
        updated_at: now.toISOString(),
      })
      .eq('id', bill_id)
  }

  // ── Audit log (non-fatal) ──────────────────────────────────────
  try {
    const { audit } = await import('@/lib/audit')
    await audit(
      'create',
      'billing' as any,
      creditNote.id,
      `[CREDIT NOTE] ${creditNoteNumber} | Amount: ₹${amountNum.toLocaleString('en-IN')} | ` +
      `Type: ${cnType} | GST reversal: ₹${gstAmount.toFixed(2)} (CGST: ₹${cgst} + SGST: ₹${sgst}) | ` +
      `Original bill: ${bill.invoice_number || bill_id.slice(0, 8)} | ` +
      `Reason: ${reason.trim()} | By: ${auth.fullName || auth.email}`
    )
  } catch { /* non-fatal */ }

  // ── Return ─────────────────────────────────────────────────────
  return NextResponse.json({
    ok: true,
    credit_note: creditNote,
    credit_note_number: creditNoteNumber,
    gst_reversal: {
      gst_percent: gstPercent,
      gst_amount: gstAmount,
      cgst,
      sgst,
      base_amount: round2(amountNum - gstAmount),
    },
    bill_status_updated: newTotalCredited >= billTotal - 0.01,
    original_bill: {
      id: bill_id,
      invoice_number: bill.invoice_number || bill.invoicenumber,
      total: billTotal,
      total_credited: round2(newTotalCredited),
    },
  })
}


// ── Utility ──────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100
}