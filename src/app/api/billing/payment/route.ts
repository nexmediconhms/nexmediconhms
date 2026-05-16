/**
 * src/app/api/billing/payment/route.ts
 *
 * Partial Payment & Refund API
 *
 * POST /api/billing/payment — Record a partial payment or refund
 *
 * Body:
 *   { billId, amount, paymentMode, transactionType, referenceNo, notes, recordedBy }
 *
 * transactionType: 'payment' | 'refund' | 'advance' | 'adjustment'
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/api-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  try {
    const body = await req.json()
    const {
      billId,
      amount,
      paymentMode = 'cash',
      transactionType = 'payment',
      referenceNo,
      notes,
      recordedBy,
    } = body

    if (!billId || !amount || amount <= 0) {
      return NextResponse.json(
        { error: 'billId and amount (> 0) are required' },
        { status: 400 }
      )
    }

    // Fetch the current bill
    const { data: bill, error: billErr } = await supabase
      .from('bills')
      .select('*')
      .eq('id', billId)
      .single()

    if (billErr || !bill) {
      return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
    }

    const netAmount = Number(bill.net_amount || 0)
    const currentPaid = Number(bill.paid || 0)
    const currentRefund = Number(bill.refund_amount || 0)

    // ── Handle REFUND ──────────────────────────────────────────
    if (transactionType === 'refund') {
      if (amount > currentPaid) {
        return NextResponse.json(
          { error: `Refund amount (₹${amount}) cannot exceed paid amount (₹${currentPaid})` },
          { status: 400 }
        )
      }

      // Record the refund transaction
      const { error: txnErr } = await supabase.from('payment_transactions').insert({
        bill_id: billId,
        patient_id: bill.patient_id,
        amount,
        payment_mode: paymentMode,
        transaction_type: 'refund',
        reference_no: referenceNo || null,
        notes: notes || null,
        recorded_by: recordedBy || null,
      })

      if (txnErr) {
        return NextResponse.json({ error: txnErr.message }, { status: 500 })
      }

      // Update bill: reduce paid, set refund fields
      const newPaid = currentPaid - amount
      const newRefund = currentRefund + amount
      let newStatus = bill.status
      if (newPaid <= 0) newStatus = 'refunded'
      else if (newPaid < netAmount) newStatus = 'partial'

      await supabase.from('bills').update({
        paid: newPaid,
        refund_amount: newRefund,
        refund_reason: notes || 'Refund processed',
        refunded_at: new Date().toISOString(),
        refunded_by: recordedBy || null,
        status: newStatus,
        updated_at: new Date().toISOString(),
      }).eq('id', billId)

      return NextResponse.json({
        ok: true,
        message: `Refund of ₹${amount} processed successfully`,
        newPaid,
        newStatus,
      })
    }

    // ── Handle PARTIAL PAYMENT ─────────────────────────────────
    const newPaid = Math.min(currentPaid + amount, netAmount)
    const remaining = netAmount - newPaid

    // Record the payment transaction
    const { error: txnErr } = await supabase.from('payment_transactions').insert({
      bill_id: billId,
      patient_id: bill.patient_id,
      amount,
      payment_mode: paymentMode,
      transaction_type: transactionType,
      reference_no: referenceNo || null,
      notes: notes || null,
      recorded_by: recordedBy || null,
    })

    if (txnErr) {
      return NextResponse.json({ error: txnErr.message }, { status: 500 })
    }

    // Update bill status
    let newStatus: string
    if (newPaid >= netAmount) {
      newStatus = 'paid'
    } else if (newPaid > 0) {
      newStatus = 'partial'
    } else {
      newStatus = 'pending'
    }

    await supabase.from('bills').update({
      paid: newPaid,
      status: newStatus,
      payment_mode: paymentMode,
      paid_at: newStatus === 'paid' ? new Date().toISOString() : bill.paid_at,
      updated_at: new Date().toISOString(),
    }).eq('id', billId)

    return NextResponse.json({
      ok: true,
      message: newStatus === 'paid'
        ? `Payment complete! Bill fully paid.`
        : `Partial payment of ₹${amount} recorded. Remaining: ₹${remaining}`,
      newPaid,
      remaining,
      newStatus,
    })

  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}

// GET — fetch payment history for a bill
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  const billId = req.nextUrl.searchParams.get('billId')
  if (!billId) {
    return NextResponse.json({ error: 'billId param required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('payment_transactions')
    .select('*')
    .eq('bill_id', billId)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ transactions: data || [] })
}
