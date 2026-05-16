/**
 * src/app/api/billing/daily-closing/route.ts
 *
 * Daily Closing API — End-of-day revenue summary.
 *
 * GET  /api/billing/daily-closing?date=2024-01-15  → fetch closing for date
 * POST /api/billing/daily-closing                   → generate & save closing
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/api-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  const date = req.nextUrl.searchParams.get('date')
  if (!date) {
    return NextResponse.json({ error: 'date param required (YYYY-MM-DD)' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('daily_closings')
    .select('*')
    .eq('closing_date', date)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ closing: data })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  const body = await req.json()
  const date = body.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const closedBy = body.closedBy || 'Admin'

  // Gather all bills created on this date
  const { data: bills } = await supabase
    .from('bills')
    .select('*')
    .gte('created_at', date + 'T00:00:00')
    .lt('created_at', date + 'T23:59:59.999')

  const allBills = bills || []
  const paidBills = allBills.filter((b: any) => b.status === 'paid')
  const pendingBills = allBills.filter((b: any) => b.status === 'pending')

  // Payment mode breakdown
  let cashCollected = 0
  let upiCollected = 0
  let cardCollected = 0

  for (const b of paidBills) {
    const amt = Number(b.net_amount || 0)
    switch (b.payment_mode) {
      case 'cash': cashCollected += amt; break
      case 'upi':  upiCollected += amt; break
      case 'card': cardCollected += amt; break
      default: cashCollected += amt; break
    }
  }

  const totalCollected = cashCollected + upiCollected + cardCollected
  const totalDiscount = allBills.reduce((s: number, b: any) => s + Number(b.discount || 0), 0)
  const totalPending = pendingBills.reduce((s: number, b: any) => s + Number(b.net_amount || 0), 0)

  // Count OPD encounters for the day
  const { count: opdCount } = await supabase
    .from('encounters')
    .select('id', { count: 'exact', head: true })
    .eq('encounter_date', date)

  // Count IPD admissions for the day
  const { count: ipdCount } = await supabase
    .from('ipd_admissions')
    .select('id', { count: 'exact', head: true })
    .eq('admission_date', date)

  // Count refunds
  const { data: refundTxns } = await supabase
    .from('payment_transactions')
    .select('amount')
    .eq('transaction_type', 'refund')
    .gte('created_at', date + 'T00:00:00')
    .lt('created_at', date + 'T23:59:59.999')

  const totalRefunds = (refundTxns || []).reduce((s: number, t: any) => s + Number(t.amount || 0), 0)

  const closingData = {
    closing_date: date,
    total_opd: opdCount || 0,
    total_ipd: ipdCount || 0,
    total_bills: allBills.length,
    cash_collected: cashCollected,
    upi_collected: upiCollected,
    card_collected: cardCollected,
    total_collected: totalCollected,
    total_discount: totalDiscount,
    total_pending: totalPending,
    total_refunds: totalRefunds,
    notes: body.notes || null,
    closed_by: closedBy,
    closed_at: new Date().toISOString(),
  }

  // Upsert (update if already exists for this date)
  const { data: saved, error: saveErr } = await supabase
    .from('daily_closings')
    .upsert(closingData, { onConflict: 'closing_date' })
    .select()
    .single()

  if (saveErr) {
    return NextResponse.json({ error: saveErr.message }, { status: 500 })
  }

  return NextResponse.json({ closing: saved, message: 'Daily closing saved successfully' })
}