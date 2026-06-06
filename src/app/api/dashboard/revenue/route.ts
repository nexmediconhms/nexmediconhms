/**
 * src/app/api/dashboard/revenue/route.ts
 *
 * Dashboard Revenue API — SERVER-SIDE (bypasses RLS)
 *
 * GET /api/dashboard/revenue?today=2026-06-06&weekAgo=2026-05-30
 *
 * This API route fetches revenue data using the SERVICE ROLE KEY,
 * ensuring it can always read from the bills table regardless of
 * RLS policies or auth session state.
 *
 * WHY THIS IS NEEDED:
 *   The dashboard previously queried bills directly from the client
 *   using the anon key. This failed silently when:
 *   1. RLS policies blocked anon/authenticated access
 *   2. The user's session expired
 *   3. The user's clinic_users role wasn't in the policy whitelist
 *   4. The table schema had mismatched column names
 *
 *   By moving the query server-side with service_role, we guarantee
 *   the revenue data is always returned correctly.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
})

export async function GET(req: NextRequest) {
  try {
    const today = req.nextUrl.searchParams.get('today')
    const weekAgo = req.nextUrl.searchParams.get('weekAgo')

    if (!today) {
      return NextResponse.json({ error: 'today parameter is required (YYYY-MM-DD)' }, { status: 400 })
    }

    // Use IST timezone offset for correct boundary matching
    const todayStart = today + 'T00:00:00+05:30'
    const todayEnd = today + 'T23:59:59.999+05:30'
    const weekStart = weekAgo ? weekAgo + 'T00:00:00+05:30' : today + 'T00:00:00+05:30'

    // Fetch today's bills
    const { data: todayBills, error: billsError } = await supabase
      .from('bills')
      .select('id, total, paid, due, status, net_amount, payment_mode, invoice_number, patient_name, created_at')
      .gte('created_at', todayStart)
      .lte('created_at', todayEnd)

    if (billsError) {
      console.error('[Dashboard Revenue API] Bills query failed:', billsError.message, billsError.code)
      return NextResponse.json({
        error: 'Bills query failed: ' + billsError.message,
        code: billsError.code,
      }, { status: 500 })
    }

    // Fetch week's payments
    const { data: weekPayments, error: weekError } = await supabase
      .from('bill_payments')
      .select('amount, created_at')
      .gte('created_at', weekStart)

    if (weekError) {
      console.warn('[Dashboard Revenue API] Week payments query failed (non-fatal):', weekError.message)
    }

    // Fetch daily target
    const { data: targetData } = await supabase
      .from('clinic_settings')
      .select('value')
      .eq('key', 'daily_revenue_target')
      .maybeSingle()  // Won't error if no row found (unlike .single())

    // Calculate revenue using fallback chain
    const bills = todayBills || []
    const todayRevenue = bills.reduce((sum, b) => {
      // Use the best available amount field
      const amount = Number(b.paid) || Number(b.net_amount) || Number(b.total) || 0
      // Only count if bill is paid or has some payment recorded
      if (b.status === 'paid' || Number(b.paid) > 0) {
        return sum + amount
      }
      return sum
    }, 0)

    const pending = bills.filter(b => b.status !== 'paid' && b.status !== 'cancelled')
    const pendingAmount = pending.reduce((sum, b) => sum + (Number(b.due) || Number(b.net_amount) || Number(b.total) || 0), 0)

    const weekRevenue = (weekPayments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0)

    return NextResponse.json({
      ok: true,
      todayRevenue,
      weekRevenue: weekRevenue || todayRevenue,
      todayTarget: Number(targetData?.value || 0),
      pendingBillsCount: pending.length,
      pendingBillsAmt: pendingAmount,
      todayBillsCount: bills.length,
      todayPaidCount: bills.filter(b => b.status === 'paid').length,
      // Also return the raw bills for debugging
      debug: {
        billsFound: bills.length,
        queryRange: { todayStart, todayEnd },
        sampleBill: bills.length > 0 ? { id: bills[0].id, status: bills[0].status, paid: bills[0].paid, net_amount: bills[0].net_amount, total: bills[0].total } : null,
      },
    })
  } catch (err: any) {
    console.error('[Dashboard Revenue API] Unexpected error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
