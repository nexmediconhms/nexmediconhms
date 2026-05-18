/**
 * src/app/api/doctor/earnings/route.ts
 *
 * Doctor Earnings API
 *
 * GET /api/doctor/earnings?from=2024-01-01&to=2024-01-31
 * GET /api/doctor/earnings?doctorId=xxx&from=...&to=...
 *
 * Uses correct snake_case table/column names matching deployed DB:
 * - encounters.encounter_date
 * - encounters.patient_id
 * - encounters.doctor_name  (text field)
 * - ipd_admissions (NOT ipdadmissions)
 * - bills.patient_id, bills.net_amount, bills.status, bills.created_at
 * - clinic_users.share_pct
 *
 * ─── HARDENING (May 2026) ────────────────────────────────────────────
 *  - Auth: financial roll-up across the whole clinic — admins and
 *    doctors only.  Receptionists / staff cannot view this endpoint.
 *  - Service-role client now comes from `getSupabaseAdmin()` so the
 *    route does not crash `next build` when env vars are absent at
 *    static-page-data collection.
 *  - Errors are logged structurally server-side; clients see neutral
 *    messages so we don't leak DB column names / migration state.
 *  - Aggregation logic is unchanged — same response shape, same
 *    sharing math, same field names.
 * ─────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole }                from '@/lib/api-auth'
import { getSupabaseAdmin }           from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED_ROLES = ['admin', 'doctor'] as const

function safeErrorLog(scope: string, err: unknown) {
  const code = (err as { code?: string })?.code ?? 'unknown'
  const msg  = (err as { message?: string })?.message ?? String(err)
  // eslint-disable-next-line no-console
  console.error(`[doctor-earnings][${scope}] code=${code} msg=${msg}`)
}

export async function GET(req: NextRequest) {
  // Auth
  const auth = await requireRole(req, ALLOWED_ROLES as unknown as string[])
  if (auth instanceof Response) return auth

  // Validate inputs
  const params   = req.nextUrl.searchParams
  const doctorId = params.get('doctorId')
  const from     = params.get('from')
  const to       = params.get('to')

  if (!from || !to) {
    return NextResponse.json(
      { error: 'from and to date params are required (YYYY-MM-DD)' },
      { status: 400 }
    )
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json(
      { error: 'from and to must be YYYY-MM-DD' },
      { status: 400 }
    )
  }

  // doctorId is currently informational; the main aggregation groups
  // by encounter.doctor_name regardless.  Keep it in the API surface
  // so a future iteration can filter without changing the contract.
  void doctorId

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

  // ── Fetch OPD encounters in the date range ────────────────
  const encQuery = sb
    .from('encounters')
    .select('id, patient_id, doctor_name, encounter_date')
    .gte('encounter_date', from)
    .lte('encounter_date', to)

  const { data: encounters, error: encErr } = await encQuery
  if (encErr) {
    safeErrorLog('encounters', encErr)
    return NextResponse.json(
      { error: 'Failed to fetch OPD encounters.' },
      { status: 500 }
    )
  }

  // ── Fetch IPD admissions in the date range ────────────────
  // Use ipd_admissions (snake_case) — the actual table in deployed DB
  const ipdQuery = sb
    .from('ipd_admissions')
    .select('id, patient_id, admitting_doctor, admission_date')
    .gte('admission_date', from)
    .lte('admission_date', to)

  const { data: admissions, error: ipdErr } = await ipdQuery
  if (ipdErr) safeErrorLog('ipd_admissions', ipdErr)

  // ── Fetch bills for encountered patients ──────────────────
  const patientIdSet = new Set<string>(
    (encounters || []).map((e: any) => e.patient_id).filter(Boolean)
  )
  // Also include IPD patient_ids
  for (const adm of admissions || []) {
    if (adm.patient_id) patientIdSet.add(adm.patient_id)
  }
  const patientIds = Array.from(patientIdSet)

  let billsData: any[] = []
  if (patientIds.length > 0) {
    const { data: bills, error: billsErr } = await sb
      .from('bills')
      .select('patient_id, net_amount, status, created_at')
      .in('patient_id', patientIds)
      .gte('created_at', from + 'T00:00:00')
      .lte('created_at', to + 'T23:59:59')

    if (billsErr) safeErrorLog('bills', billsErr)
    billsData = bills || []
  }

  // Map patient_id → total collected
  const paidByPatient = new Map<string, number>()
  for (const b of billsData) {
    if (b.status === 'paid') {
      const pid = b.patient_id
      paidByPatient.set(pid, (paidByPatient.get(pid) || 0) + Number(b.net_amount || 0))
    }
  }

  // ── Fetch doctor share percentages ────────────────────────
  // Try clinic_users (snake_case) first, fall back to clinicusers
  let doctors: any[] = []
  const { data: d1, error: d1Err } = await sb
    .from('clinic_users')
    .select('id, full_name, share_pct, earning_model')
    .in('role', ['admin', 'doctor'])

  if (d1Err) safeErrorLog('clinic_users', d1Err)

  if (d1 && d1.length > 0) {
    doctors = d1
  } else {
    const { data: d2, error: d2Err } = await sb
      .from('clinicusers')
      .select('id, fullname, share_pct, earning_model')
      .eq('role', 'doctor')
    if (d2Err) safeErrorLog('clinicusers', d2Err)
    doctors = d2 || []
  }

  const shareByDoctor = new Map<string, number>()
  for (const d of doctors) {
    shareByDoctor.set(d.full_name || d.fullname || '', Number(d.share_pct || 40))
  }

  // ── Build per-doctor earnings ─────────────────────────────

  const doctorMap = new Map<string, {
    doctorname:  string
    opdCount:    number
    ipdCount:    number
    opdRevenue:  number
    ipdRevenue:  number
    collected:   number
    sharePct:    number
  }>()

  // OPD encounters
  for (const enc of encounters || []) {
    const name = enc.doctor_name || 'Unknown Doctor'

    if (!doctorMap.has(name)) {
      doctorMap.set(name, {
        doctorname: name,
        opdCount:   0,
        ipdCount:   0,
        opdRevenue: 0,
        ipdRevenue: 0,
        collected:  0,
        sharePct:   shareByDoctor.get(name) || 40,
      })
    }

    const d = doctorMap.get(name)!
    d.opdCount++
    const paid = paidByPatient.get(enc.patient_id) || 0
    d.opdRevenue += paid
    d.collected  += paid
  }

  // IPD admissions
  for (const adm of admissions || []) {
    const name = adm.admitting_doctor || 'Unknown Doctor'

    if (!doctorMap.has(name)) {
      doctorMap.set(name, {
        doctorname: name,
        opdCount:   0,
        ipdCount:   0,
        opdRevenue: 0,
        ipdRevenue: 0,
        collected:  0,
        sharePct:   shareByDoctor.get(name) || 40,
      })
    }

    const d = doctorMap.get(name)!
    d.ipdCount++
    const paid = paidByPatient.get(adm.patient_id) || 0
    d.ipdRevenue += paid
    d.collected  += paid
  }

  // Calculate earnings for each doctor
  const earnings = Array.from(doctorMap.values()).map(d => {
    const totalRevenue  = d.opdRevenue + d.ipdRevenue
    const doctorEarning = Math.round(totalRevenue * d.sharePct) / 100
    const clinicShare   = totalRevenue - doctorEarning

    return {
      ...d,
      totalRevenue,
      doctorEarning,
      clinicShare,
    }
  })

  // Sort by total revenue descending
  earnings.sort((a, b) => b.totalRevenue - a.totalRevenue)

  return NextResponse.json({
    period:   { from, to },
    earnings,
    totals: {
      totalRevenue:  earnings.reduce((s, d) => s + d.totalRevenue, 0),
      doctorEarning: earnings.reduce((s, d) => s + d.doctorEarning, 0),
      clinicShare:   earnings.reduce((s, d) => s + d.clinicShare, 0),
      opdCount:      earnings.reduce((s, d) => s + d.opdCount, 0),
      ipdCount:      earnings.reduce((s, d) => s + d.ipdCount, 0),
    },
  })
}
