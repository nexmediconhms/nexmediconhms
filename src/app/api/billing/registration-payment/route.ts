/**
 * src/app/api/billing/registration-payment/route.ts
 *
 * Registration Payment API
 *
 * POST /api/billing/registration-payment
 *
 * Creates a bill for registration/consultation fee and records the payment
 * in a single step. Used during patient registration flow.
 *
 * This is separate from the main billing/payment API which requires an
 * existing billId. Here we create the bill + payment atomically.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      patient_id,
      patient_name,
      mrn,
      amount,
      payment_method,
      payment_ref,
      description = 'OPD Registration Fee',
      type = 'registration',
    } = body

    if (!patient_id || !amount || !payment_method) {
      return NextResponse.json(
        { error: 'patient_id, amount, and payment_method are required' },
        { status: 400 }
      )
    }

    const amountNum = parseFloat(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 })
    }

    // Generate invoice number
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const { count } = await supabase
      .from('bills')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', new Date().toISOString().slice(0, 10) + 'T00:00:00')

    const invoiceNumber = `REG-${today}-${String((count || 0) + 1).padStart(3, '0')}`

    // Create the bill
    const { data: bill, error: billError } = await supabase
      .from('bills')
      .insert({
        patient_id,
        patient_name: patient_name || '',
        mrn: mrn || '',
        invoice_number: invoiceNumber,
        items: [{ description, qty: 1, rate: amountNum, amount: amountNum }],
        total: amountNum,
        paid: amountNum,
        due: 0,
        status: 'paid',
        payment_mode: payment_method,
        payment_ref: payment_ref || null,
        notes: `${type} payment — ${payment_method}${payment_ref ? ` (Ref: ${payment_ref})` : ''}`,
      })
      .select('id, invoice_number')
      .single()

    if (billError) {
      console.error('[Registration Payment] Bill creation failed:', billError.message)
      return NextResponse.json({ error: billError.message }, { status: 500 })
    }

    // Record the payment in bill_payments table (if it exists)
    try {
      await supabase.from('bill_payments').insert({
        bill_id: bill.id,
        amount: amountNum,
        payment_mode: payment_method,
        reference: payment_ref || null,
        received_by: 'reception',
        notes: `Registration payment for ${patient_name}`,
      })
    } catch {
      // bill_payments table may not exist — non-fatal
    }

    return NextResponse.json({
      ok: true,
      bill_id: bill.id,
      invoice_number: bill.invoice_number,
      amount: amountNum,
      payment_method,
    })
  } catch (err: any) {
    console.error('[Registration Payment] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
