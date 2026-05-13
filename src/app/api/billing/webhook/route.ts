/**
 * src/app/api/billing/webhook/route.ts
 *
 * ═══════════════════════════════════════════════════════════════
 * CRITICAL BUG FIX: Razorpay webhook had no signature verification.
 *
 * PREVIOUS STATE (vulnerable):
 *   The billing flow integrated Razorpay payments and the v12
 *   migration added a UNIQUE index to prevent duplicate bills on
 *   double-callback. However, the webhook endpoint itself had NO
 *   signature verification, meaning anyone could POST a fake
 *   "payment_captured" payload and mark bills as paid without
 *   actually paying — a direct revenue/fraud risk.
 *
 * FIX:
 *   Razorpay signs every webhook payload with HMAC-SHA256 using
 *   your webhook secret. The signature is sent in the header:
 *     X-Razorpay-Signature: <hex_digest>
 *
 *   We recompute: HMAC-SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET)
 *   and compare using a constant-time comparison to prevent
 *   timing attacks.
 *
 *   If signatures don't match → 400 (not 401, to avoid leaking
 *   information about the verification mechanism).
 *
 * REAL-LIFE EDGE CASES HANDLED:
 *   - Double-callback: Supabase UNIQUE index on razorpay_payment_id
 *     (added in v12) prevents duplicate bill creation. We return
 *     200 on duplicate to prevent Razorpay from retrying forever.
 *   - payment.failed event: Logs the failure, does NOT mark paid.
 *   - Missing bill: If no bill matches the order_id, we log and
 *     return 200 (don't want Razorpay to keep retrying).
 *   - Missing env var: If RAZORPAY_WEBHOOK_SECRET is not set,
 *     we reject ALL requests (fail-safe, not fail-open).
 *   - Malformed JSON: Caught and returns 400.
 *   - Unknown event types: Logged and acknowledged with 200.
 * ═══════════════════════════════════════════════════════════════
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { createClient } from '@supabase/supabase-js'

// Use service role key — webhook runs outside user session context
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ── Signature verification ───────────────────────────────────

/**
 * Verifies Razorpay webhook signature.
 *
 * Razorpay docs: https://razorpay.com/docs/webhooks/validate-test/
 * Algorithm: HMAC-SHA256(rawBody, webhookSecret) → hex digest
 * Header: X-Razorpay-Signature
 *
 * Uses timingSafeEqual to prevent timing-attack signature forgery.
 */
function verifyRazorpaySignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret || !rawBody) return false

  try {
    const expectedHex = createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest('hex')

    // timingSafeEqual requires same-length Buffers
    const expected = Buffer.from(expectedHex, 'hex')
    const received = Buffer.from(signature,   'hex')

    if (expected.length !== received.length) return false
    return timingSafeEqual(expected, received)
  } catch {
    return false
  }
}

// ── Webhook handler ──────────────────────────────────────────
export async function POST(req: NextRequest) {
  // 1. Ensure webhook secret is configured (fail-safe: reject if missing)
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET env var is not set. Rejecting all requests.')
    return NextResponse.json(
      { error: 'Webhook not configured' },
      { status: 500 }
    )
  }

  // 2. Read raw body as text (MUST be raw — JSON.parse would change byte order)
  let rawBody: string
  try {
    rawBody = await req.text()
  } catch (e) {
    console.error('[razorpay-webhook] Failed to read request body:', e)
    return NextResponse.json({ error: 'Cannot read body' }, { status: 400 })
  }

  // 3. Verify signature
  const signature = req.headers.get('x-razorpay-signature') ?? ''
  const isValid   = verifyRazorpaySignature(rawBody, signature, webhookSecret)

  if (!isValid) {
    console.warn('[razorpay-webhook] Invalid signature. Possible spoofed request.',
      { ip: req.headers.get('x-forwarded-for') ?? 'unknown' })
    // Return 400 (not 401) — don't reveal verification mechanism
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // 4. Parse JSON payload
  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch (e) {
    console.error('[razorpay-webhook] Malformed JSON in verified payload:', e)
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 })
  }

  const event   = payload.event   as string | undefined
  const entity  = payload.payload?.payment?.entity ?? payload.payload?.order?.entity ?? {}

  console.log('[razorpay-webhook] Received event:', event, '| payment_id:', entity.id ?? 'N/A')

  // 5. Handle event types
  switch (event) {
    // ── Payment captured (most common success event) ──────────
    case 'payment.captured': {
      const paymentId = entity.id         as string | undefined
      const orderId   = entity.order_id   as string | undefined
      const amount    = entity.amount     as number | undefined  // in paise
      const currency  = entity.currency   as string | undefined
      const method    = entity.method     as string | undefined
      const status    = entity.status     as string | undefined

      if (!paymentId || !orderId) {
        console.error('[razorpay-webhook] payment.captured missing paymentId or orderId', { paymentId, orderId })
        // Return 200 so Razorpay doesn't retry — this is a data issue, not a server error
        return NextResponse.json({ ok: false, reason: 'Missing payment or order ID' })
      }

      // Find the matching bill by razorpay_order_id
      const { data: bill, error: findErr } = await supabase
        .from('bills')
        .select('id, status, razorpay_payment_id, net_amount')
        .eq('razorpay_order_id', orderId)
        .single()

      if (findErr || !bill) {
        // Bill not found — could be a test payment or a webhook arriving before the bill is created
        console.warn('[razorpay-webhook] No bill found for order_id:', orderId)
        // Return 200 to prevent Razorpay from retrying indefinitely
        return NextResponse.json({ ok: true, note: 'No matching bill found; acknowledged' })
      }

      // Already marked paid — idempotent: return 200 without error
      if (bill.status === 'paid') {
        console.log('[razorpay-webhook] Bill already marked paid (idempotent):', bill.id)
        return NextResponse.json({ ok: true, note: 'Already paid' })
      }

      // Mark bill as paid
      const { error: updateErr } = await supabase
        .from('bills')
        .update({
          status:               'paid',
          razorpay_payment_id:  paymentId,
          paid_at:              new Date().toISOString(),
          payment_method:       method ?? 'razorpay',
          payment_notes:        JSON.stringify({
            currency,
            amount_paise: amount,
            payment_method: method,
            captured_at:    new Date().toISOString(),
          }),
        })
        .eq('id', bill.id)

      if (updateErr) {
        // Check for unique constraint violation (double-callback)
        if (updateErr.code === '23505') {
          console.log('[razorpay-webhook] Duplicate payment_id (unique constraint). Already processed:', paymentId)
          return NextResponse.json({ ok: true, note: 'Duplicate; already processed' })
        }
        console.error('[razorpay-webhook] Failed to mark bill paid:', updateErr)
        // Return 500 so Razorpay will retry
        return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
      }

      console.log('[razorpay-webhook] Bill marked paid:', bill.id, '| payment:', paymentId)
      return NextResponse.json({ ok: true, billId: bill.id })
    }

    // ── Payment authorized (for two-step capture flows) ───────
    case 'payment.authorized': {
      const paymentId = entity.id       as string | undefined
      const orderId   = entity.order_id as string | undefined
      console.log('[razorpay-webhook] Payment authorized (awaiting capture):', paymentId, orderId)
      // We handle final state on payment.captured only
      return NextResponse.json({ ok: true, note: 'Authorized — waiting for capture' })
    }

    // ── Payment failed ─────────────────────────────────────────
    case 'payment.failed': {
      const orderId     = entity.order_id         as string | undefined
      const errorCode   = entity.error_code       as string | undefined
      const errorDesc   = entity.error_description as string | undefined

      if (orderId) {
        // Update bill status to 'failed' (or leave as 'pending' — your choice)
        // Here we add a payment_notes field so staff can see why it failed
        await supabase
          .from('bills')
          .update({
            payment_notes: JSON.stringify({
              failure_reason:      errorDesc ?? 'Unknown',
              failure_code:        errorCode ?? 'Unknown',
              failed_at:           new Date().toISOString(),
            }),
          })
          .eq('razorpay_order_id', orderId)
          .eq('status', 'pending') // only update if still pending — don't overwrite a successful payment

        console.log('[razorpay-webhook] Payment failed for order:', orderId, errorCode, errorDesc)
      }

      return NextResponse.json({ ok: true, note: 'Failure logged' })
    }

    // ── Order paid (alternative event some integrations use) ──
    case 'order.paid': {
      const orderId   = payload.payload?.order?.entity?.id as string | undefined
      const paymentId = payload.payload?.payment?.entity?.id as string | undefined
      console.log('[razorpay-webhook] order.paid received:', orderId, paymentId)
      // Handled via payment.captured — just acknowledge
      return NextResponse.json({ ok: true, note: 'order.paid acknowledged' })
    }

    // ── Refund events ──────────────────────────────────────────
    case 'refund.created':
    case 'refund.processed':
    case 'refund.failed': {
      const refundId  = entity.id        as string | undefined
      const paymentId = entity.payment_id as string | undefined
      console.log(`[razorpay-webhook] ${event}:`, refundId, 'for payment:', paymentId)
      // Future: update bill refund_amount, refund_status fields
      return NextResponse.json({ ok: true, note: `${event} acknowledged` })
    }

    // ── Unknown / future events ────────────────────────────────
    default: {
      console.log('[razorpay-webhook] Unhandled event type (acknowledged):', event)
      // Always return 200 for unknown events — Razorpay will keep retrying on non-2xx
      return NextResponse.json({ ok: true, note: `Event '${event}' acknowledged` })
    }
  }
}