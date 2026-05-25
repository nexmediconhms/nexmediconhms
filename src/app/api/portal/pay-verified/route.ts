/**
 * src/app/api/portal/pay-verified/route.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * BUG #14 FIX: Portal Self-Payment Confirmation (CRITICAL SECURITY)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * PROBLEM:
 *   The existing PATCH endpoint at /api/portal/pay allows a patient to
 *   mark their own bill as "paid" by simply sending:
 *     { bill_id, payment_mode, transaction_id }
 *   There is NO server-side verification that payment actually occurred.
 *   A patient can call this endpoint and mark any bill paid without paying.
 *
 * EFFECT OF BUG:
 *   - Revenue loss: patients can mark bills paid without actual payment
 *   - Financial discrepancy: books show "paid" but no money received
 *   - Trust issue: billing team cannot rely on portal payment status
 *
 * SOLUTION:
 *   This new route /api/portal/pay-verified provides a SECURE payment
 *   confirmation endpoint that:
 *   1. For Razorpay: Verifies payment signature using HMAC-SHA256
 *   2. For UPI: Marks as "payment_claimed" (not "paid") requiring admin review
 *   3. Logs all payment attempts for audit
 *   4. Never trusts client-side payment confirmation alone
 *
 * AFTER FIX:
 *   ✅ Bills only marked "paid" after server-side Razorpay signature verification
 *   ✅ UPI payments go to "payment_claimed" status requiring staff confirmation
 *   ✅ All payment attempts logged (successful and failed)
 *   ✅ Fraudulent self-confirmation attempts are blocked and logged
 *
 * USAGE:
 *   Replace the PATCH handler in /api/portal/pay with a redirect to this route.
 *   Or have the frontend call this route instead of the PATCH endpoint.
 *
 *   POST /api/portal/pay-verified
 *   Header: X-Portal-Session: <session_token>
 *   Body: {
 *     bill_id: string,
 *     razorpay_payment_id?: string,
 *     razorpay_order_id?: string,
 *     razorpay_signature?: string,
 *     payment_mode: "upi" | "card" | "netbanking",
 *     upi_transaction_id?: string  // For manual UPI (needs admin confirmation)
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const razorpaySecret = process.env.RAZORPAY_KEY_SECRET || ''

// ── Session validation (same as portal/pay) ───────────────────────────

async function validatePortalSession(supabase: any, token: string) {
  if (!token) return null
  const { data } = await supabase
    .from('portal_sessions')
    .select('patient_id, mrn, mobile, expires_at, is_active')
    .eq('session_token', token)
    .eq('is_active', true)
    .single()
  if (!data || new Date(data.expires_at) < new Date()) return null
  return data
}

// ── Razorpay signature verification ───────────────────────────────────

function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  if (!razorpaySecret || razorpaySecret.includes('YOUR')) return false
  const body = `${orderId}|${paymentId}`
  const expected = crypto
    .createHmac('sha256', razorpaySecret)
    .update(body)
    .digest('hex')
  return expected === signature
}

// ── Main handler ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const sessionToken = req.headers.get('x-portal-session') || ''
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    // 1. Validate session
    const session = await validatePortalSession(supabase, sessionToken)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const {
      bill_id,
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      payment_mode,
      upi_transaction_id,
    } = body

    if (!bill_id) {
      return NextResponse.json({ error: 'bill_id is required' }, { status: 400 })
    }

    // 2. Fetch the bill (ensure it belongs to this patient)
    const { data: bill, error: billErr } = await supabase
      .from('bills')
      .select('id, patient_id, status, net_amount, total, mrn, patient_name')
      .eq('id', bill_id)
      .eq('patient_id', session.patient_id)
      .single()

    if (billErr || !bill) {
      return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
    }

    if (bill.status === 'paid') {
      return NextResponse.json({ error: 'Bill is already paid', already_paid: true }, { status: 400 })
    }

    const amount = Number(bill.net_amount || bill.total || 0)

    // 3. RAZORPAY VERIFIED PAYMENT — server-side signature check
    if (razorpay_payment_id && razorpay_order_id && razorpay_signature) {
      const isValid = verifyRazorpaySignature(
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      )

      if (!isValid) {
        // Log the failed attempt
        await logPaymentAttempt(supabase, {
          bill_id,
          patient_id: session.patient_id,
          status: 'signature_invalid',
          payment_mode: payment_mode || 'razorpay',
          razorpay_payment_id,
          amount,
        })

        return NextResponse.json(
          { error: 'Payment verification failed. Signature mismatch.' },
          { status: 403 }
        )
      }

      // Signature valid — mark as paid
      const { error: updateErr } = await supabase
        .from('bills')
        .update({
          status: 'paid',
          payment_mode: payment_mode || 'online',
          paid_at: new Date().toISOString(),
          paid: amount,
          due: 0,
          razorpay_payment_id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', bill_id)
        .eq('patient_id', session.patient_id)

      if (updateErr) {
        return NextResponse.json({ error: 'Failed to update bill' }, { status: 500 })
      }

      // Log successful payment
      await logPaymentAttempt(supabase, {
        bill_id,
        patient_id: session.patient_id,
        status: 'verified_paid',
        payment_mode: payment_mode || 'online',
        razorpay_payment_id,
        amount,
      })

      return NextResponse.json({
        success: true,
        verified: true,
        status: 'paid',
        message: 'Payment verified and bill marked as paid.',
      })
    }

    // 4. UPI MANUAL PAYMENT — requires admin confirmation
    if (upi_transaction_id || payment_mode === 'upi') {
      // Do NOT mark as "paid" — mark as "payment_claimed" for staff review
      const { error: updateErr } = await supabase
        .from('bills')
        .update({
          status: 'payment_claimed',
          payment_mode: 'upi',
          razorpay_payment_id: upi_transaction_id || null,
          notes: `Patient claimed UPI payment. Txn ID: ${upi_transaction_id || 'not provided'}. AWAITING STAFF VERIFICATION.`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', bill_id)
        .eq('patient_id', session.patient_id)

      if (updateErr) {
        return NextResponse.json({ error: 'Failed to update bill' }, { status: 500 })
      }

      // Log the claim
      await logPaymentAttempt(supabase, {
        bill_id,
        patient_id: session.patient_id,
        status: 'claimed_awaiting_verification',
        payment_mode: 'upi',
        upi_transaction_id,
        amount,
      })

      // Create notification for staff to verify
      try {
        await supabase.from('clinic_notifications').insert({
          title: 'Payment Verification Needed',
          message: `${bill.patient_name || 'Patient'} claims UPI payment of ₹${amount.toLocaleString('en-IN')} for bill ${bill.mrn || bill_id.slice(-8)}. Txn: ${upi_transaction_id || 'N/A'}. Please verify in bank statement.`,
          type: 'billing',
          severity: 'high',
          source: 'portal_payment',
          entity_type: 'bill',
          entity_id: bill_id,
          patient_id: session.patient_id,
          patient_name: bill.patient_name,
          target_roles: ['admin', 'staff'],
          metadata: { amount, upi_transaction_id, bill_id },
        })
      } catch { /* non-fatal */ }

      return NextResponse.json({
        success: true,
        verified: false,
        status: 'payment_claimed',
        message: 'Payment recorded. Staff will verify and confirm within 24 hours.',
      })
    }

    // 5. No valid payment proof provided
    return NextResponse.json(
      { error: 'Payment proof required. Provide Razorpay signature or UPI transaction ID.' },
      { status: 400 }
    )

  } catch (err: any) {
    console.error('[portal/pay-verified] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}

// ── Payment attempt logging ───────────────────────────────────────────

async function logPaymentAttempt(
  supabase: any,
  params: {
    bill_id: string
    patient_id: string
    status: string
    payment_mode: string
    razorpay_payment_id?: string
    upi_transaction_id?: string
    amount: number
  }
) {
  try {
    await supabase.from('payment_transactions').insert({
      bill_id: params.bill_id,
      patient_id: params.patient_id,
      transaction_type: 'portal_payment_attempt',
      amount: params.amount,
      payment_mode: params.payment_mode,
      status: params.status,
      reference: params.razorpay_payment_id || params.upi_transaction_id || null,
      notes: `Portal payment attempt: ${params.status}`,
      created_at: new Date().toISOString(),
    })
  } catch {
    // Non-fatal — don't block the response
    console.warn('[portal/pay-verified] Failed to log payment attempt')
  }
}
