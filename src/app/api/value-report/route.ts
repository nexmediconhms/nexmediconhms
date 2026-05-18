/**
 * src/app/api/value-report/route.ts
 *
 * Monthly Value Report API
 *
 * Shows doctor/admin the tangible value the app delivered:
 * - No-shows prevented
 * - Lapsed patients recalled
 * - Unbilled consultations caught
 * - Staff hours saved
 *
 * GET /api/value-report?month=2024-01
 *
 * Uses ACTUAL schema:
 * - encounters.encounter_date  (renamed from 'date' by v30 migration)
 *
 * ─── HARDENING (May 2026) ────────────────────────────────────────────
 *  - Auth: financial / operational metrics — admins and doctors only.
 *  - Service-role client now comes from `getSupabaseAdmin()`.
 *  - `month` param is validated against the `YYYY-MM` regex; invalid
 *    inputs return 400 instead of producing nonsensical aggregates.
 *  - Response shape and counters are unchanged.
 * ─────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole }                from '@/lib/api-auth'
import { getSupabaseAdmin }           from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED_ROLES = ['admin', 'doctor'] as const

// Configuration constants — adjust these based on your clinic's averages
const AVG_CONSULTATION_FEE     = 500   // ₹ per patient
const MINUTES_SAVED_PER_RX     = 5    // vs writing by hand
const MINUTES_SAVED_PER_BILL   = 3    // vs manual bill
const MINUTES_SAVED_PER_REMIND = 2    // per automated reminder

function safeErrorLog(scope: string, err: unknown) {
  const code = (err as { code?: string })?.code ?? 'unknown'
  const msg  = (err as { message?: string })?.message ?? String(err)
  // eslint-disable-next-line no-console
  console.error(`[value-report][${scope}] code=${code} msg=${msg}`)
}

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, ALLOWED_ROLES as unknown as string[])
  if (auth instanceof Response) return auth

  let sb
  try {
    sb = getSupabaseAdmin()
  } catch (err) {
    safeErrorLog('getAdmin', err)
    return NextResponse.json(
      { error: 'Server is misconfigured.' },
      { status: 500 }
    )
  }

  const monthRaw = req.nextUrl.searchParams.get('month') ?? ''
  const month = monthRaw || new Date().toISOString().slice(0, 7) // default: current month

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: 'month must be in YYYY-MM format' },
      { status: 400 }
    )
  }

  // Month date range
  const from = month + '-01'
  const toDate = new Date(from)
  toDate.setMonth(toDate.getMonth() + 1)
  toDate.setDate(0)  // last day of month
  const to = toDate.toISOString().slice(0, 10)

  // ── 1. Reminders sent (proxy for no-shows prevented) ─────
  const { count: remindersSent } = await sb
    .from('reminders')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'sent')
    .gte('sentat', from)
    .lte('sentat', to + 'T23:59:59')

  // Industry avg: 15% of reminded patients would have been no-shows
  const noshowsPrevented = Math.round((remindersSent || 0) * 0.15)
  const noshowsValue     = noshowsPrevented * AVG_CONSULTATION_FEE

  // ── 2. Campaign reach (proxy for lapsed patient recall) ──
  const { count: campaignsSent } = await sb
    .from('campaign_logs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'sent')
    .gte('createdat', from)
    .lte('createdat', to + 'T23:59:59')

  // Industry avg: 10% of reached patients actually visit
  const patientsRecalled = Math.round((campaignsSent || 0) * 0.10)
  const recallValue      = patientsRecalled * AVG_CONSULTATION_FEE

  // ── 3. Digital prescriptions (time saved) ────────────────
  const { count: rxCount } = await sb
    .from('prescriptions')
    .select('*', { count: 'exact', head: true })
    .gte('createdat', from)
    .lte('createdat', to + 'T23:59:59')

  // ── 4. Bills generated (time saved) ──────────────────────
  const { count: billCount } = await sb
    .from('bills')
    .select('*', { count: 'exact', head: true })
    .gte('createdat', from)
    .lte('createdat', to + 'T23:59:59')

  // ── 5. Unbilled encounters caught ────────────────────────
  // Uses encounter_date (renamed from 'date' by v30 migration)
  const { data: encounters } = await sb
    .from('encounters')
    .select('id, patientid')
    .gte('encounter_date', from)
    .lte('encounter_date', to)

  const { data: bills } = await sb
    .from('bills')
    .select('patientid')
    .gte('createdat', from + 'T00:00:00')
    .lte('createdat', to + 'T23:59:59')

  const billedPatients = new Set((bills || []).map(b => b.patientid))
  const unbilledCaught = (encounters || [])
    .filter(e => !billedPatients.has(e.patientid)).length
  const unbilledValue  = unbilledCaught * AVG_CONSULTATION_FEE

  // ── 6. Total hours saved ──────────────────────────────────
  const minutesSaved =
    (rxCount       || 0) * MINUTES_SAVED_PER_RX +
    (billCount     || 0) * MINUTES_SAVED_PER_BILL +
    (remindersSent || 0) * MINUTES_SAVED_PER_REMIND

  const hoursSaved = Math.round(minutesSaved / 60 * 10) / 10

  // ── 7. Total revenue collected this month ────────────────
  const { data: paidBills } = await sb
    .from('bill_payments')
    .select('amount')
    .gte('createdat', from + 'T00:00:00')
    .lte('createdat', to + 'T23:59:59')

  const totalRevenue = (paidBills || [])
    .reduce((s, p) => s + Number(p.amount || 0), 0)

  const totalValue = noshowsValue + recallValue + unbilledValue

  // ── Cache the report ──────────────────────────────────────
  const { error: upsertErr } = await sb.from('value_reports').upsert({
    report_month:      from,
    noshows_prevented: noshowsPrevented,
    noshows_value:     noshowsValue,
    patients_recalled: patientsRecalled,
    recall_value:      recallValue,
    unbilled_caught:   unbilledCaught,
    unbilled_value:    unbilledValue,
    hours_saved:       hoursSaved,
    total_value:       totalValue,
  }, { onConflict: 'report_month' })

  // The cache is best-effort; if the table doesn't exist we still
  // serve the live computed report.
  if (upsertErr) safeErrorLog('value_reports.upsert', upsertErr)

  return NextResponse.json({
    month,
    period:            { from, to },
    noshowsPrevented,
    noshowsValue,
    patientsRecalled,
    recallValue,
    unbilledCaught,
    unbilledValue,
    hoursSaved,
    totalValue,
    totalRevenue,
    metrics: {
      remindersSent:   remindersSent   || 0,
      prescriptions:   rxCount         || 0,
      bills:           billCount       || 0,
      totalEncounters: (encounters || []).length,
    },
  })
}
