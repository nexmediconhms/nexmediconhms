/**
 * src/app/api/billing/partial-payment/route.ts
 *
 * Partial & Split Payment API
 *
 * POST /api/billing/partial-payment
 *   Record one or more payment splits against an existing bill.
 *   Supports: single partial payment, split payment (cash + UPI), full payment.
 *
 * Body: {
 *   bill_id:     string (UUID)
 *   patient_id:  string (UUID)
 *   payments:    { amount: number, payment_mode: string, payment_ref?: string }[]
 *   received_by: string
 *   notes?:      string
 *   deposit_adjustment?: number  (amount to adjust from advance deposit)
 *   admission_id?: string        (required if deposit_adjustment > 0)
 * }
 *
 * Response: {
 *   ok: true,
 *   bill: { id, status, paid, due },
 *   payment_ids: string[],
 *   receipt_numbers: string[],
 *   deposit_adjusted?: number
 * }
 *
 * Auth: admin, doctor, staff
 *
 * ─── ADDITIVE ────────────────────────────────────────────────────────
 * This is a NEW route. It does NOT modify any existing billing routes.
 * Existing /api/billing/payment and /api/billing/generate-bill continue
 * to work exactly as before.
 * ─────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_PAYMENT_MODES = ['cash', 'upi', 'card', 'cheque', 'online', 'insurance', 'other']
const MAX_SPLITS = 5        // max payment splits in one transaction
const MAX_AMOUNT = 10000000 // ₹1 crore

export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    bill_id,
    patient_id,
    payments,
    received_by,
    notes,
    deposit_adjustment,
    admission_id,
  } = body ?? {}

  // ── Validation ─────────────────────────────────────────────────
  if (!bill_id || typeof bill_id !== 'string') {
    return NextResponse.json({ error: 'bill_id is required' }, { status: 400 })
  }
  if (!patient_id || typeof patient_id !== 'string') {
    return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })
  }
  if (!Array.isArray(payments) || payments.length === 0) {
    return NextResponse.json({ error: 'payments array is required (at least one payment)' }, { status: 400 })
  }
  if (payments.length > MAX_SPLITS) {
    return NextResponse.json({ error: `Maximum ${MAX_SPLITS} payment splits allowed` }, { status: 400 })
  }

  // Validate each payment split
  for (let i = 0; i < payments.length; i++) {
    const p = payments[i]
    if (!p || typeof p !== 'object') {
      return NextResponse.json({ error: `payments[${i}] must be an object` }, { status: 400 })
    }
    const amt = Number(p.amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      return NextResponse.json({ error: `payments[${i}].amount must be > 0` }, { status: 400 })
    }
    if (amt > MAX_AMOUNT) {
      return NextResponse.json({ error: `payments[${i}].amount exceeds maximum` }, { status: 400 })
    }
    if (!p.payment_mode || !ALLOWED_PAYMENT_MODES.includes(p.payment_mode)) {
      return NextResponse.json({
        error: `payments[${i}].payment_mode must be one of: ${ALLOWED_PAYMENT_MODES.join(', ')}`,
      }, { status: 400 })
    }
  }

  const totalPaymentAmount = payments.reduce((s: number, p: any) => s + Number(p.amount), 0)
  const depositAdj = Number(deposit_adjustment || 0)

  if (depositAdj < 0) {
    return NextResponse.json({ error: 'deposit_adjustment cannot be negative' }, { status: 400 })
  }
  if (depositAdj > 0 && !admission_id) {
    return NextResponse.json({ error: 'admission_id is required when adjusting deposits' }, { status: 400 })
  }

  // ── Fetch bill ─────────────────────────────────────────────────
  const sb = getSupabaseAdmin()

  const { data: bill, error: billErr } = await sb
    .from('bills')
    .select('*')
    .eq('id', bill_id)
    .single()

  if (billErr || !bill) {
    return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
  }

  // Check bill is payable
  const billStatus = bill.status
  if (['cancelled', 'refunded', 'waived'].includes(billStatus) || bill.is_deleted) {
    return NextResponse.json({ error: `Cannot pay a ${billStatus} bill` }, { status: 400 })
  }

  const billTotal = Number(bill.net_amount || bill.total || 0)
  const billPaid = Number(bill.paid || 0)
  const remaining = Math.max(0, billTotal - billPaid)

  const totalCredit = totalPaymentAmount + depositAdj
  if (totalCredit > remaining + 0.01) {
    return NextResponse.json({
      error: `Total payment ₹${totalCredit.toFixed(2)} exceeds remaining due ₹${remaining.toFixed(2)}`,
      remaining,
    }, { status: 400 })
  }

  // ── Deposit adjustment (if any) ────────────────────────────────
  if (depositAdj > 0) {
    // Load available deposits for this admission
    const { data: deposits } = await sb
      .from('patient_deposits')
      .select('*')
      .eq('admission_id', admission_id)
      .eq('is_deleted', false)
      .in('status', ['collected', 'partially_adjusted'])
      .order('created_at', { ascending: true })

    if (!deposits || deposits.length === 0) {
      return NextResponse.json({ error: 'No available deposits found for this admission' }, { status: 400 })
    }

    const availableDeposit = deposits.reduce(
      (s: number, d: any) => s + Number(d.amount || 0) - Number(d.adjusted_amount || 0) - Number(d.refund_amount || 0),
      0
    )

    if (depositAdj > availableDeposit + 0.01) {
      return NextResponse.json({
        error: `Deposit adjustment ₹${depositAdj} exceeds available deposit ₹${availableDeposit.toFixed(2)}`,
      }, { status: 400 })
    }

    // Apply adjustment across deposits (FIFO)
    let remaining_adj = depositAdj
    for (const dep of deposits) {
      if (remaining_adj <= 0) break
      const depAvailable = Number(dep.amount) - Number(dep.adjusted_amount || 0) - Number(dep.refund_amount || 0)
      if (depAvailable <= 0) continue

      const adjAmount = Math.min(remaining_adj, depAvailable)
      const newAdjusted = Number(dep.adjusted_amount || 0) + adjAmount
      const newStatus = newAdjusted >= Number(dep.amount) ? 'fully_adjusted' : 'partially_adjusted'

      await sb
        .from('patient_deposits')
        .update({
          adjusted_amount: newAdjusted,
          adjusted_bill_id: bill_id,
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', dep.id)

      remaining_adj -= adjAmount
    }
  }

  // ── Generate receipt numbers & record payments ─────────────────
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const todayCompact = todayStr.replace(/-/g, '')

  // Count existing payments today for receipt numbering
  const { count: paymentCount } = await sb
    .from('bill_payments')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', todayStr + 'T00:00:00+05:30')

  const splitGroup = crypto.randomUUID()
  const paymentIds: string[] = []
  const receiptNumbers: string[] = []

  for (let i = 0; i < payments.length; i++) {
    const p = payments[i]
    const seq = (paymentCount || 0) + i + 1
    const receiptNumber = `RCP-${todayCompact}-${String(seq).padStart(3, '0')}`

    const paymentPayload: Record<string, any> = {
      bill_id,
      patient_id,
      amount: Number(p.amount),
      payment_mode: p.payment_mode,
      reference: p.payment_ref || null,
      receipt_number: receiptNumber,
      received_by: received_by || auth.fullName || auth.email || 'staff',
      notes: notes || `Partial payment — ${p.payment_mode}`,
      transaction_type: 'payment',
      split_group: payments.length > 1 ? splitGroup : null,
    }

    const { data: paymentData, error: payErr } = await sb
      .from('bill_payments')
      .insert(paymentPayload)
      .select('id')
      .single()

    if (payErr) {
      console.error('[partial-payment] bill_payments insert failed:', payErr.message)
      // Try without the new columns (split_group, receipt_number)
      delete paymentPayload.split_group
      delete paymentPayload.receipt_number
      const { data: retryData, error: retryErr } = await sb
        .from('bill_payments')
        .insert(paymentPayload)
        .select('id')
        .single()

      if (retryErr) {
        return NextResponse.json({
          error: `Failed to record payment ${i + 1}: ${retryErr.message}`,
        }, { status: 500 })
      }
      paymentIds.push(retryData.id)
    } else {
      paymentIds.push(paymentData.id)
    }
    receiptNumbers.push(receiptNumber)
  }

  // ── Update bill totals ─────────────────────────────────────────
  const newPaid = billPaid + totalCredit
  const newDue = Math.max(0, billTotal - newPaid)
  const newStatus = newPaid >= billTotal ? 'paid' : (newPaid > 0 ? 'partially_paid' : 'pending')
  const paidAt = newStatus === 'paid' ? now.toISOString() : null

  // Build update payload — only set fields we know exist
  const billUpdate: Record<string, any> = {
    paid: Math.round(newPaid * 100) / 100,
    due: Math.round(newDue * 100) / 100,
    status: newStatus,
    updated_at: now.toISOString(),
  }

  // Set payment_mode to the first payment's mode (or 'split' if multiple)
  if (payments.length === 1) {
    billUpdate.payment_mode = payments[0].payment_mode
  } else {
    billUpdate.payment_mode = 'split'
  }

  // Only set paid_at if transitioning to paid
  if (paidAt) {
    billUpdate.paid_at = paidAt
  }

  // Only set deposit_adjusted if we adjusted deposits
  if (depositAdj > 0) {
    billUpdate.deposit_adjusted = (Number(bill.deposit_adjusted || 0)) + depositAdj
  }

  const { error: updateErr } = await sb
    .from('bills')
    .update(billUpdate)
    .eq('id', bill_id)

  if (updateErr) {
    console.error('[partial-payment] bill update failed:', updateErr.message)
    // Try minimal update (in case some columns don't exist)
    const minimalUpdate: Record<string, any> = {
      paid: Math.round(newPaid * 100) / 100,
      due: Math.round(newDue * 100) / 100,
      status: newStatus,
    }
    if (paidAt) minimalUpdate.paid_at = paidAt

    await sb.from('bills').update(minimalUpdate).eq('id', bill_id)
  }

  // ── Audit log (non-fatal) ──────────────────────────────────────
  try {
    const { audit } = await import('@/lib/audit')
    await audit(
      'update',
      'billing' as any,
      bill_id,
      `[PARTIAL PAYMENT] Bill ${bill.invoice_number || bill_id.slice(0, 8)} | ` +
      `Payments: ${payments.map((p: any) => `₹${p.amount} (${p.payment_mode})`).join(' + ')} | ` +
      (depositAdj > 0 ? `Deposit adjusted: ₹${depositAdj} | ` : '') +
      `New status: ${newStatus} | Paid: ₹${newPaid.toFixed(2)} / ₹${billTotal.toFixed(2)} | ` +
      `By: ${auth.fullName || auth.email || 'unknown'}`
    )
  } catch { /* audit non-fatal */ }

  return NextResponse.json({
    ok: true,
    bill: {
      id: bill_id,
      status: newStatus,
      paid: Math.round(newPaid * 100) / 100,
      due: Math.round(newDue * 100) / 100,
      total: billTotal,
    },
    payment_ids: paymentIds,
    receipt_numbers: receiptNumbers,
    deposit_adjusted: depositAdj > 0 ? depositAdj : undefined,
  })
}
