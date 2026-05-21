/**
 * src/app/api/billing/refund/route.ts
 *
 * Billing Refund API
 *
 * POST /api/billing/refund — Initiate a refund for a paid bill
 *
 * Body: {
 *   billId:       string (UUID)
 *   amount:       number (refund amount in rupees — full or partial)
 *   reason:       string (mandatory refund reason)
 *   refundMode:   'original' | 'cash' | 'upi' | 'cheque' (how to return money)
 *   notes?:       string (optional internal notes)
 * }
 *
 * Flow:
 *   1. Validate auth (admin only)
 *   2. Validate bill exists, is paid/partial, refund doesn't exceed paid amount
 *   3. If Razorpay payment exists, initiate Razorpay refund
 *   4. Record refund in `payment_transactions` table
 *   5. Update bill status (paid → refunded/partial)
 *   6. Create credit note entry
 *   7. Save bill version snapshot (audit trail)
 *   8. Log audit entry
 *   9. Return success with refund details
 *
 * GET /api/billing/refund?billId=xxx — Get refund history for a bill
 *
 * Auth: Admin only (refunds are sensitive financial operations)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED_ROLES = ['admin'] as const
const REFUND_MODES = ['original', 'cash', 'upi', 'cheque'] as const
type RefundMode = typeof REFUND_MODES[number]

const MAX_REFUND_AMOUNT = 10_000_000 // ₹1 crore cap
const MAX_REASON_LENGTH = 500
const MAX_NOTES_LENGTH = 1000

// ─────────────────────────────────────────────────────────────────────
// GET — fetch refund history for a bill
// ─────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireRole(req, [...ALLOWED_ROLES, 'doctor'])
  if (auth instanceof Response) return auth

  const billId = req.nextUrl.searchParams.get('billId')
  if (!billId) {
    return NextResponse.json({ error: 'billId query parameter is required' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()

  const { data: refunds, error } = await sb
    .from('payment_transactions')
    .select('*')
    .eq('bill_id', billId)
    .eq('transaction_type', 'refund')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[billing/refund] GET error:', error.message)
    return NextResponse.json({ error: 'Failed to fetch refund history' }, { status: 500 })
  }

  return NextResponse.json({ refunds: refunds || [] })
}

// ─────────────────────────────────────────────────────────────────────
// POST — initiate a refund
// ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ALLOWED_ROLES as unknown as string[])
  if (auth instanceof Response) return auth

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { billId, amount, reason, refundMode, notes } = body ?? {}

  // ── Validation ─────────────────────────────────────────────────
  if (!billId || typeof billId !== 'string') {
    return NextResponse.json({ error: 'billId is required' }, { status: 400 })
  }

  const amountNum = typeof amount === 'string' ? parseFloat(amount) : Number(amount)
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return NextResponse.json({ error: 'Refund amount must be greater than 0' }, { status: 400 })
  }
  if (amountNum > MAX_REFUND_AMOUNT) {
    return NextResponse.json({ error: 'Refund amount exceeds maximum allowed' }, { status: 400 })
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
    return NextResponse.json({ error: 'Refund reason is required (minimum 5 characters)' }, { status: 400 })
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return NextResponse.json({ error: `Reason exceeds ${MAX_REASON_LENGTH} characters` }, { status: 400 })
  }

  if (!refundMode || !(REFUND_MODES as readonly string[]).includes(refundMode)) {
    return NextResponse.json(
      { error: `Invalid refundMode. Use one of: ${REFUND_MODES.join(', ')}` },
      { status: 400 }
    )
  }

  const notesClean = notes ? String(notes).trim().slice(0, MAX_NOTES_LENGTH) : null

  // ── Get admin client ───────────────────────────────────────────
  const sb = getSupabaseAdmin()

  // ── Fetch the bill ─────────────────────────────────────────────
  const { data: bill, error: billErr } = await sb
    .from('bills')
    .select('*')
    .eq('id', billId)
    .single()

  if (billErr || !bill) {
    return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
  }

  // ── Validate bill state ────────────────────────────────────────
  const billPaid = Number(bill.paid || bill.net_amount || 0)
  const billStatus = bill.status

  if (billStatus === 'refunded') {
    return NextResponse.json({ error: 'This bill has already been fully refunded' }, { status: 400 })
  }
  if (billStatus === 'waived') {
    return NextResponse.json({ error: 'Cannot refund a waived bill' }, { status: 400 })
  }
  if (billStatus === 'pending' || billStatus === 'unpaid') {
    return NextResponse.json({ error: 'Cannot refund an unpaid bill. No payment has been received.' }, { status: 400 })
  }

  // Check existing refunds to prevent over-refunding
  const { data: existingRefunds } = await sb
    .from('payment_transactions')
    .select('amount')
    .eq('bill_id', billId)
    .eq('transaction_type', 'refund')

  const totalPreviousRefunds = (existingRefunds || []).reduce(
    (sum: number, r: any) => sum + Number(r.amount || 0), 0
  )

  const refundableAmount = billPaid - totalPreviousRefunds
  if (amountNum > refundableAmount) {
    return NextResponse.json({
      error: `Refund amount ₹${amountNum} exceeds refundable amount ₹${refundableAmount.toFixed(2)}. Already refunded: ₹${totalPreviousRefunds.toFixed(2)}`,
      refundable: refundableAmount,
    }, { status: 400 })
  }

  // ── Razorpay refund (if original payment was via Razorpay) ─────
  let razorpayRefundId: string | null = null
  const razorpayPaymentId = bill.razorpay_payment_id

  if (refundMode === 'original' && razorpayPaymentId) {
    try {
      const rzpKeyId = process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID
      const rzpKeySecret = process.env.RAZORPAY_KEY_SECRET

      if (rzpKeyId && rzpKeySecret) {
        const basicAuth = Buffer.from(`${rzpKeyId}:${rzpKeySecret}`).toString('base64')
        const rzpRes = await fetch(
          `https://api.razorpay.com/v1/payments/${razorpayPaymentId}/refund`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Basic ${basicAuth}`,
            },
            body: JSON.stringify({
              amount: Math.round(amountNum * 100), // Razorpay uses paise
              notes: {
                bill_id: billId,
                reason: reason.slice(0, 200),
                refunded_by: auth.fullName || auth.email,
              },
            }),
          }
        )

        if (rzpRes.ok) {
          const rzpData = await rzpRes.json()
          razorpayRefundId = rzpData.id || null
        } else {
          const rzpErr = await rzpRes.json().catch(() => ({}))
          console.error('[billing/refund] Razorpay refund failed:', rzpErr)
          // Don't block manual refund — log and continue with manual mode
          if (refundMode === 'original') {
            return NextResponse.json({
              error: `Razorpay refund failed: ${rzpErr?.error?.description || 'Unknown error'}. Try refund mode 'cash' or 'upi' for manual refund.`,
            }, { status: 422 })
          }
        }
      } else {
        // Razorpay keys not configured — fall through to manual refund recording
        console.warn('[billing/refund] Razorpay keys not configured, recording manual refund')
      }
    } catch (err: any) {
      console.error('[billing/refund] Razorpay API error:', err.message)
      return NextResponse.json({
        error: `Razorpay refund error: ${err.message}. Try refund mode 'cash' for manual refund.`,
      }, { status: 422 })
    }
  }

  // ── Record refund transaction ──────────────────────────────────
  const now = new Date().toISOString()
  const refundTransaction = {
    bill_id: billId,
    patient_id: bill.patient_id,
    patient_name: bill.patient_name || '',
    transaction_type: 'refund',
    amount: amountNum,
    payment_mode: refundMode === 'original' ? (bill.payment_mode || 'cash') : refundMode,
    reference: razorpayRefundId || null,
    reason: reason.trim(),
    notes: notesClean,
    processed_by: auth.fullName || auth.email,
    processed_by_id: auth.clinicUserId,
    razorpay_refund_id: razorpayRefundId,
    status: razorpayRefundId ? 'processing' : 'completed',
    created_at: now,
  }

  const { data: refundRecord, error: refundErr } = await sb
    .from('payment_transactions')
    .insert(refundTransaction)
    .select()
    .single()

  if (refundErr) {
    console.error('[billing/refund] Insert error:', refundErr.message)
    // If table doesn't exist, provide clear message
    if (refundErr.code === '42P01' || refundErr.message?.includes('relation')) {
      return NextResponse.json({
        error: 'payment_transactions table not found. Please run the migration SQL.',
        migration_needed: true,
      }, { status: 500 })
    }
    return NextResponse.json({ error: 'Failed to record refund' }, { status: 500 })
  }

  // ── Update bill status ─────────────────────────────────────────
  const newTotalRefunded = totalPreviousRefunds + amountNum
  const isFullRefund = newTotalRefunded >= billPaid

  const billUpdate: Record<string, any> = {
    updated_at: now,
  }

  if (isFullRefund) {
    billUpdate.status = 'refunded'
    billUpdate.refunded_at = now
    billUpdate.refund_reason = reason.trim()
  } else {
    // Partial refund — bill remains 'paid' or becomes 'partial' depending on logic
    billUpdate.refund_amount = newTotalRefunded
    billUpdate.last_refund_at = now
  }

  await sb.from('bills').update(billUpdate).eq('id', billId)

  // ── Save bill version snapshot (audit) ─────────────────────────
  try {
    const { saveBillVersion } = await import('@/lib/bill-versioning')
    await saveBillVersion({
      billId,
      currentBill: bill,
      modifier: auth.fullName || auth.email,
      modificationType: 'refund',
      reason: reason.trim(),
      newAmount: isFullRefund ? 0 : Number(bill.net_amount || bill.total || 0),
    })
  } catch (e) {
    // Non-fatal — version tracking is a bonus
    console.warn('[billing/refund] Bill versioning failed (non-fatal):', e)
  }

  // ── Generate credit note ───────────────────────────────────────
  let creditNoteId: string | null = null
  try {
    const cnPayload = {
      bill_id: billId,
      patient_id: bill.patient_id,
      patient_name: bill.patient_name || '',
      mrn: bill.mrn || '',
      original_amount: Number(bill.net_amount || bill.total || 0),
      credit_amount: amountNum,
      reason: reason.trim(),
      refund_mode: refundMode,
      issued_by: auth.fullName || auth.email,
      issued_at: now,
      status: 'issued',
      gst_reversal: bill.gst_amount && bill.gst_amount > 0
        ? Math.round((amountNum / Number(bill.net_amount || 1)) * Number(bill.gst_amount) * 100) / 100
        : 0,
    }

    const { data: cnRecord } = await sb
      .from('credit_notes')
      .insert(cnPayload)
      .select('id')
      .single()

    creditNoteId = cnRecord?.id || null
  } catch (e: any) {
    // Table may not exist yet — non-fatal
    console.warn('[billing/refund] Credit note insert failed (non-fatal):', e?.message)
  }

  // ── Audit log ──────────────────────────────────────────────────
  await sb.from('audit_log').insert({
    action: 'refund_initiated',
    entity_type: 'bill',
    entity_id: billId,
    entity_label: `Refund ₹${amountNum} for ${bill.patient_name || 'patient'}`,
    user_id: auth.clinicUserId,
    user_name: auth.fullName || auth.email,
    changes: JSON.stringify({
      amount: amountNum,
      reason: reason.trim(),
      mode: refundMode,
      is_full_refund: isFullRefund,
      razorpay_refund_id: razorpayRefundId,
      credit_note_id: creditNoteId,
    }),
  }).then(() => {}) // Non-blocking

  // ── Return success ─────────────────────────────────────────────
  return NextResponse.json({
    ok: true,
    message: isFullRefund
      ? `Full refund of ₹${amountNum} processed successfully`
      : `Partial refund of ₹${amountNum} processed. Total refunded: ₹${newTotalRefunded.toFixed(2)}`,
    refund: refundRecord,
    creditNoteId,
    billStatus: isFullRefund ? 'refunded' : billStatus,
    razorpayRefundId,
    isFullRefund,
    totalRefunded: newTotalRefunded,
  })
}
