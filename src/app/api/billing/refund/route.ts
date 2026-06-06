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
//
// ╔════════════════════════════════════════════════════════════════════╗
// ║  REFUND-INTEGRITY UPDATES (June 2026)                             ║
// ║                                                                    ║
// ║  BIL-1: We no longer mark a refund 'completed' when Razorpay       ║
// ║         returned HTTP 200 with a body that didn't contain a        ║
// ║         refund id. The transaction now sticks at status='pending' ║
// ║         and the bill stays in its prior state until either the    ║
// ║         webhook confirms the refund or staff retries with a       ║
// ║         manual mode (cash/UPI/cheque). A 200 with an error body   ║
// ║         is treated the same as a 4xx.                              ║
// ║                                                                    ║
// ║  BIL-2: Idempotency. The route now accepts an optional             ║
// ║         `idempotency_key` in the body (or X-Idempotency-Key        ║
// ║         header). On a repeat with the same key we return the      ║
// ║         existing refund row instead of issuing a second one.      ║
// ║                                                                    ║
// ║  BIL-3: Cancelled bills are explicitly rejected (so a soft-       ║
// ║         deleted bill that already had its hospital_fund            ║
// ║         reversal can't be refunded a second time, creating money  ║
// ║         out of nowhere).                                           ║
// ║                                                                    ║
// ║  BIL-4: GST reversal is now ALWAYS computed via                    ║
// ║         calculateGSTReversal() from credit-notes.ts (the single    ║
// ║         source of truth) — both for credit_notes.gst_reversal and ║
// ║         for the credit-note creation downstream. The previous     ║
// ║         multiplicative approximation drifted vs the GST-inclusive ║
// ║         extraction by up to a paisa per refund.                    ║
// ║                                                                    ║
// ║  BIL-5: Audit log uses the canonical audit() helper which routes  ║
// ║         through the hash-chain RPC, instead of the previous raw   ║
// ║         INSERT into audit_log that bypassed the chain entirely.   ║
// ╚════════════════════════════════════════════════════════════════════╝
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

  // BIL-2: idempotency key — header takes precedence over body so a
  // long-running retry mechanism (e.g., a service worker) can supply
  // one even if the original body didn't.
  const idempotencyKey =
    String(req.headers.get('x-idempotency-key') || body?.idempotency_key || '').trim() || null

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

  // ── BIL-2: idempotency check ───────────────────────────────────
  // If a refund with this idempotency key already exists for this bill,
  // return it verbatim instead of issuing a second one. This makes the
  // route safe to retry across network blips and double-clicks.
  if (idempotencyKey) {
    const { data: existingByKey } = await sb
      .from('payment_transactions')
      .select('*')
      .eq('bill_id', billId)
      .eq('transaction_type', 'refund')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()
    if (existingByKey) {
      return NextResponse.json({
        ok: true,
        idempotent: true,
        message: 'Refund already processed (idempotent response).',
        refund: existingByKey,
      })
    }
  }

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
  // BIL-3: cancelled / soft-deleted bills already had their finance
  // entry reversed by the DELETE handler in /api/billing/generate-bill.
  // Refunding one would credit the patient a SECOND time, fabricating
  // money out of nowhere. Reject explicitly.
  if (billStatus === 'cancelled' || bill.is_deleted) {
    return NextResponse.json({
      error:
        'Cannot refund a cancelled / deleted bill. The original cancellation ' +
        'already reversed the income; the patient should have been credited ' +
        'through that path. If the patient still needs money back, please ' +
        'use Settings → Adjustments instead of the refund flow.',
    }, { status: 400 })
  }
  if (billStatus === 'pending' || billStatus === 'unpaid') {
    return NextResponse.json({ error: 'Cannot refund an unpaid bill. No payment has been received.' }, { status: 400 })
  }

  // Check existing refunds to prevent over-refunding
  const { data: existingRefunds } = await sb
    .from('payment_transactions')
    .select('amount, status')
    .eq('bill_id', billId)
    .eq('transaction_type', 'refund')

  const totalPreviousRefunds = (existingRefunds || [])
    // BIL-3: only count active refunds, not cancelled ones
    .filter((r: any) => String(r.status || '') !== 'cancelled')
    .reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0)

  const refundableAmount = billPaid - totalPreviousRefunds
  if (amountNum > refundableAmount) {
    return NextResponse.json({
      error: `Refund amount ₹${amountNum} exceeds refundable amount ₹${refundableAmount.toFixed(2)}. Already refunded: ₹${totalPreviousRefunds.toFixed(2)}`,
      refundable: refundableAmount,
    }, { status: 400 })
  }

  // ── Razorpay refund (if original payment was via Razorpay) ─────
  //
  // BIL-1 fix: detect the case where Razorpay returns HTTP 200 but with
  // a body that has NO refund id (or an inline error block). This used
  // to fall through to status='completed' even though no money had moved.
  let razorpayRefundId: string | null = null
  let razorpayConfirmed = false
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
          const rzpData = await rzpRes.json().catch(() => ({}))
          // BIL-1: refund id MUST be present and a non-empty string for
          // us to consider the refund confirmed by Razorpay. An inline
          // error.description on a 200 means failure regardless of HTTP
          // code (we've seen both shapes from RZP in production).
          const id = typeof rzpData?.id === 'string' && rzpData.id.length > 0
            ? rzpData.id
            : null
          const inlineErr = rzpData?.error?.description
          if (id && !inlineErr) {
            razorpayRefundId = id
            razorpayConfirmed = true
          } else {
            console.error(
              '[billing/refund] Razorpay returned 200 without a usable refund id. ' +
              'Treating as failure to avoid marking refund completed without ' +
              'money having actually moved. Body:', rzpData,
            )
            return NextResponse.json({
              error:
                'Razorpay accepted the request but did not return a refund id. ' +
                'No money has moved. Please retry, or use refund mode "cash" / "upi" / ' +
                '"cheque" for a manually-tracked refund.',
            }, { status: 502 })
          }
        } else {
          const rzpErr = await rzpRes.json().catch(() => ({}))
          console.error('[billing/refund] Razorpay refund failed:', rzpErr)
          return NextResponse.json({
            error: `Razorpay refund failed: ${rzpErr?.error?.description || 'Unknown error'}. Try refund mode 'cash' or 'upi' for manual refund.`,
          }, { status: 422 })
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
  //
  // BIL-1: status semantics ─
  //   - 'pending'    : Razorpay path, refund queued but no id yet
  //                    (this branch shouldn't be reached now that we
  //                    fail-loud above, but kept for safety)
  //   - 'processing' : Razorpay path, id received, awaiting webhook
  //                    confirmation
  //   - 'completed'  : Manual mode (cash/UPI/cheque), money handed
  //                    over by reception. NEVER auto-set for the
  //                    Razorpay path — only the webhook can flip it.
  let initialStatus: 'pending' | 'processing' | 'completed'
  if (refundMode === 'original' && razorpayPaymentId) {
    initialStatus = razorpayConfirmed ? 'processing' : 'pending'
  } else {
    initialStatus = 'completed'
  }

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
    status: initialStatus,
    idempotency_key: idempotencyKey,
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
  // We only flip the bill to 'refunded' for refunds that ACTUALLY MOVED
  // money (status 'completed' or Razorpay 'processing' which the webhook
  // will eventually confirm). A 'pending' refund leaves the bill alone.
  const newTotalRefunded = totalPreviousRefunds + amountNum
  const isFullRefund = newTotalRefunded >= billPaid
  const billShouldFlip = initialStatus !== 'pending'

  if (billShouldFlip) {
    const billUpdate: Record<string, any> = {
      updated_at: now,
    }
    if (isFullRefund) {
      billUpdate.status = 'refunded'
      billUpdate.refunded_at = now
      billUpdate.refund_reason = reason.trim()
    } else {
      billUpdate.refund_amount = newTotalRefunded
      billUpdate.last_refund_at = now
    }
    await sb.from('bills').update(billUpdate).eq('id', billId)
  }

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
  //
  // BIL-4 fix: route through createCreditNote() so the credit note
  // (a) gets a properly-allocated CN number via the retry-on-23505
  // loop, and (b) computes its GST reversal via the same canonical
  // calculateGSTReversal() helper that all the GST audit reports use.
  // We pass gstPercent explicitly so createCreditNote doesn't need
  // to re-read the bill row.
  let creditNoteId: string | null = null
  try {
    const mod = await import('@/lib/credit-notes')
    const cn = await mod.createCreditNote({
      billId,
      patientId: bill.patient_id,
      patientName: bill.patient_name || '',
      mrn: bill.mrn || '',
      originalInvoiceNumber: bill.invoice_number || undefined,
      originalAmount: Number(bill.net_amount || bill.total || 0),
      creditAmount: amountNum,
      reason: reason.trim(),
      refundMode,
      gstPercent: bill.gst_percent != null ? Number(bill.gst_percent) : undefined,
      issuedBy: auth.fullName || auth.email,
      notes: notesClean || undefined,
    })
    creditNoteId = cn?.id || null
  } catch (e: any) {
    console.warn('[billing/refund] Credit note creation failed (non-fatal):', e?.message)
  }

  // ── Audit log ──────────────────────────────────────────────────
  //
  // BIL-5 fix: route through the canonical audit() helper, which goes
  // through the hash-chain RPC instead of a raw audit_log INSERT. This
  // makes refund entries indistinguishable (in tamper-evidence terms)
  // from any other audit entry — they participate in the chain.
  try {
    const auditMod = await import('@/lib/audit')
    await auditMod.audit(
      'update',
      'bill',
      billId,
      `Refund ₹${amountNum} for ${bill.patient_name || 'patient'}`,
      {
        before: { status: billStatus, refund_amount: totalPreviousRefunds },
        after: {
          refund_amount: newTotalRefunded,
          mode: refundMode,
          is_full_refund: isFullRefund,
          razorpay_refund_id: razorpayRefundId,
          credit_note_id: creditNoteId,
          refund_status: initialStatus,
          reason: reason.trim(),
        },
      },
    )
  } catch (e: any) {
    // Audit failure should NOT block the refund (refund already
    // committed), but it should be loud — log a warning.
    console.warn('[billing/refund] Hash-chain audit() failed (non-fatal):', e?.message)
  }

  // ── Return success ─────────────────────────────────────────────
  //
  // BIL-1: when initialStatus is 'pending' the user-facing message
  // is reworded so reception/staff don't tell the patient "your
  // refund is processed" when the money hasn't actually moved yet.
  let message: string
  if (initialStatus === 'pending') {
    message =
      `Refund of ₹${amountNum} requested but NOT yet confirmed by the payment ` +
      `gateway. Do not tell the patient the refund is complete until you see ` +
      `status='completed' on this transaction. You may also retry with refund ` +
      `mode 'cash' / 'upi' / 'cheque' for an immediately-confirmed manual refund.`
  } else if (isFullRefund) {
    message = `Full refund of ₹${amountNum} processed successfully`
  } else {
    message = `Partial refund of ₹${amountNum} processed. Total refunded: ₹${newTotalRefunded.toFixed(2)}`
  }

  return NextResponse.json({
    ok: true,
    message,
    refund: refundRecord,
    creditNoteId,
    billStatus: billShouldFlip && isFullRefund ? 'refunded' : billStatus,
    razorpayRefundId,
    razorpayConfirmed,
    isFullRefund,
    totalRefunded: newTotalRefunded,
    refundStatus: initialStatus,
  })
}