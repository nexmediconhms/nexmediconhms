/**
 * src/app/api/billing/payment/route.ts
 *
 * Partial Payment API
 *
 * GET  /api/billing/payment?billId=xxx  → payment history for a bill
 * POST /api/billing/payment             → record a payment
 *
 * Uses ACTUAL bills schema: total, paid, due (NOT net_amount/gross_amount)
 * The DB trigger update_bill_after_payment() auto-updates paid/due/status.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
      || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  )
}

// GET — fetch payment history for a bill
export async function GET(req: NextRequest) {
  const billId = req.nextUrl.searchParams.get('billId')
  if (!billId) {
    return NextResponse.json({ error: 'billId is required' }, { status: 400 })
  }

  const sb = getSupabase()
  const { data: payments, error } = await sb
    .from('bill_payments')
    .select('*')
    .eq('billid', billId)
    .order('createdat', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ payments: payments || [] })
}

// POST — record a new payment
export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { billId, amount, paymentMode, reference, receivedBy, notes } = body

  // Validation
  if (!billId)              return NextResponse.json({ error: 'billId is required' }, { status: 400 })
  if (!amount || amount <= 0) return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 })
  if (!paymentMode)         return NextResponse.json({ error: 'paymentMode is required' }, { status: 400 })

  const validModes = ['cash', 'upi', 'card', 'cheque', 'insurance', 'advance', 'other']
  if (!validModes.includes(paymentMode)) {
    return NextResponse.json({
      error: `Invalid paymentMode. Use one of: ${validModes.join(', ')}`,
    }, { status: 400 })
  }

  const sb = getSupabase()

  // Fetch the bill — using ACTUAL columns: total, paid, due, status
  const { data: bill, error: billErr } = await sb
    .from('bills')
    .select('id, patientid, total, paid, due, status')
    .eq('id', billId)
    .single()

  if (billErr || !bill) {
    return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
  }
  if (bill.status === 'paid') {
    return NextResponse.json({ error: 'Bill is already fully paid' }, { status: 400 })
  }
  if (bill.status === 'refunded' || bill.status === 'waived') {
    return NextResponse.json({ error: `Cannot add payment to a ${bill.status} bill` }, { status: 400 })
  }

  // Check amount doesn't exceed what's due
  const currentDue = Number(bill.due || 0)
  if (amount > currentDue + 0.01) {
    return NextResponse.json({
      error:  `Payment ₹${amount} exceeds outstanding due ₹${currentDue.toFixed(2)}`,
      due:    currentDue,
    }, { status: 400 })
  }

  // Insert payment — DB trigger will auto-update bill paid/due/status
  const { data: payment, error: payErr } = await sb
    .from('bill_payments')
    .insert({
      billid:      billId,
      patientid:   bill.patientid,
      amount:      Number(amount),
      paymentmode: paymentMode,
      reference:   reference  || null,
      receivedby:  receivedBy || null,
      notes:       notes      || null,
    })
    .select()
    .single()

  if (payErr) {
    return NextResponse.json({ error: payErr.message }, { status: 500 })
  }

  // Fetch updated bill after trigger runs
  const { data: updatedBill } = await sb
    .from('bills')
    .select('id, total, paid, due, status')
    .eq('id', billId)
    .single()

  const isPaid = updatedBill?.status === 'paid'

  return NextResponse.json({
    success: true,
    payment,
    bill:    updatedBill,
    message: isPaid
      ? `✅ Bill fully paid! ₹${amount} received.`
      : `₹${amount} recorded. Remaining due: ₹${updatedBill?.due || 0}`,
  })
}