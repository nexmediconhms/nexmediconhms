/**
 * src/app/api/billing/insurance-settlement/route.ts
 *
 * Insurance ↔ Billing Settlement API
 *
 * POST /api/billing/insurance-settlement
 *   Record insurance settlement against a bill.
 *   Body: {
 *     claim_id:       string (insurance_claims.id)
 *     bill_id:        string (bills.id)
 *     settled_amount: number (amount settled by insurer)
 *     patient_copay:  number (amount patient must pay)
 *     utr:            string (settlement reference)
 *     notes?:         string
 *   }
 *
 * GET /api/billing/insurance-settlement?billId=xxx
 *   Get insurance settlement info for a bill.
 *
 * GET /api/billing/insurance-settlement?claimId=xxx
 *   Get bill linkage for a claim.
 *
 * ADDITIVE — does not modify existing insurance or billing routes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  const billId = req.nextUrl.searchParams.get('billId')
  const claimId = req.nextUrl.searchParams.get('claimId')
  const sb = getSupabaseAdmin()

  if (billId) {
    // Get insurance info for a bill
    const { data: claim } = await sb
      .from('insurance_claims')
      .select('*')
      .eq('bill_id', billId)
      .limit(1)
      .single()

    // Also check bill_payers
    const { data: payers } = await sb
      .from('bill_payers')
      .select('*')
      .eq('bill_id', billId)
      .eq('payer_type', 'insurance')

    return NextResponse.json({
      claim: claim || null,
      payers: payers || [],
      has_insurance: !!claim || (payers && payers.length > 0),
    })
  }

  if (claimId) {
    const { data: claim } = await sb
      .from('insurance_claims')
      .select('*')
      .eq('id', claimId)
      .single()

    if (!claim) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 })
    }

    let bill = null
    if (claim.bill_id) {
      const { data: b } = await sb
        .from('bills')
        .select('id, invoice_number, net_amount, total, paid, due, status, patient_id')
        .eq('id', claim.bill_id)
        .single()
      bill = b
    }

    return NextResponse.json({ claim, bill })
  }

  return NextResponse.json({ error: 'billId or claimId required' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { claim_id, bill_id, settled_amount, patient_copay, utr, notes } = body ?? {}

  if (!claim_id || !bill_id) {
    return NextResponse.json({ error: 'claim_id and bill_id are required' }, { status: 400 })
  }

  const settledAmt = Number(settled_amount || 0)
  const copay = Number(patient_copay || 0)

  if (settledAmt <= 0) {
    return NextResponse.json({ error: 'settled_amount must be > 0' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()
  const now = new Date().toISOString()
  const today = now.slice(0, 10)

  // Load bill
  const { data: bill } = await sb.from('bills').select('*').eq('id', bill_id).single()
  if (!bill) {
    return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
  }

  // Load claim
  const { data: claim } = await sb.from('insurance_claims').select('*').eq('id', claim_id).single()
  if (!claim) {
    return NextResponse.json({ error: 'Insurance claim not found' }, { status: 404 })
  }

  const billTotal = Number(bill.net_amount || bill.total || 0)

  // 1. Update insurance_claims with settlement + bill link
  const claimUpdate: Record<string, any> = {
    bill_id,
    approved_amount: settledAmt,
    settlement_utr: utr || null,
    settlement_date: today,
    status: 'settled',
    updated_at: now,
  }

  // Try Phase 1/2 columns
  try {
    claimUpdate.settled_amount = settledAmt
    claimUpdate.patient_copay = copay
    claimUpdate.settlement_bill_id = bill_id
    claimUpdate.co_pay_amount = copay
  } catch { /* columns may not exist */ }

  await sb.from('insurance_claims').update(claimUpdate).eq('id', claim_id)

  // 2. Record insurance claim history
  try {
    await sb.from('insurance_claim_history').insert({
      claim_id,
      old_status: claim.status,
      new_status: 'settled',
      notes: `Settlement: ₹${settledAmt} | Co-pay: ₹${copay} | UTR: ${utr || 'N/A'} | Bill: ${bill.invoice_number || bill_id.slice(0, 8)}`,
      done_by: auth.fullName || auth.email || 'staff',
    })
  } catch { /* table may not exist */ }

  // 3. Create bill_payer record for insurance portion
  try {
    await sb.from('bill_payers').insert({
      bill_id,
      payer_type: 'insurance',
      payer_ref_id: claim_id,
      payer_name: claim.insurance_company || claim.tpa_name || 'Insurance',
      expected_amount: Number(claim.claim_amount || settledAmt),
      paid_amount: settledAmt,
      status: 'settled',
      settlement_ref: utr || null,
      settlement_date: now,
      notes: notes || null,
    })
  } catch { /* table may not exist */ }

  // 4. Record insurance payment in bill_payments
  const paymentPayload: Record<string, any> = {
    bill_id,
    patient_id: bill.patient_id || bill.patientid,
    amount: settledAmt,
    payment_mode: 'insurance',
    reference: utr || `INS-${claim_id.slice(0, 8)}`,
    notes: `Insurance settlement — ${claim.insurance_company || claim.tpa_name || 'Insurance'} | Claim: ${claim_id.slice(0, 8)}`,
    transaction_type: 'payment',
    received_by: auth.fullName || auth.email || 'staff',
  }

  await sb.from('bill_payments').insert(paymentPayload)

  // 5. Update bill paid/due/status
  const newPaid = Number(bill.paid || 0) + settledAmt
  const newDue = Math.max(0, billTotal - newPaid)
  const newStatus = newPaid >= billTotal ? 'paid' : (newPaid > 0 ? 'partially_paid' : bill.status)

  await sb.from('bills').update({
    paid: Math.round(newPaid * 100) / 100,
    due: Math.round(newDue * 100) / 100,
    status: newStatus,
    payment_mode: bill.payment_mode === 'insurance' ? 'insurance' : 'split',
    updated_at: now,
  }).eq('id', bill_id)

  // 6. Audit
  try {
    const { audit } = await import('@/lib/audit')
    await audit('update', 'billing' as any, bill_id,
      `[INSURANCE SETTLEMENT] ₹${settledAmt} settled | Co-pay: ₹${copay} | ` +
      `Insurer: ${claim.insurance_company || claim.tpa_name} | UTR: ${utr || 'N/A'} | ` +
      `Bill: ${bill.invoice_number || bill_id.slice(0, 8)} | By: ${auth.fullName || auth.email}`)
  } catch { /* non-fatal */ }

  return NextResponse.json({
    ok: true,
    settlement: {
      claim_id,
      bill_id,
      settled_amount: settledAmt,
      patient_copay: copay,
      utr,
    },
    bill: {
      id: bill_id,
      total: billTotal,
      paid: Math.round(newPaid * 100) / 100,
      due: Math.round(newDue * 100) / 100,
      status: newStatus,
    },
    remaining_copay: copay > 0 ? `Patient must pay ₹${copay} co-pay` : null,
  })
}