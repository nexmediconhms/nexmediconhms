/**
 * src/app/api/doctor/earnings/route.ts
 *
 * Doctor Earnings API
 *
 * GET /api/doctor/earnings?from=2024-01-01&to=2024-01-31
 * GET /api/doctor/earnings?doctorId=xxx&from=...&to=...
 *
 * Uses ACTUAL schema:
 * - encounters.encounter_date  (renamed from 'date' by v30 migration)
 * - encounters.patientid       (lowercase, no underscore)
 * - encounters.doctorid        (lowercase)
 * - clinicusers.share_pct      (added by v30 migration)
 * - ipdadmissions.doctorid     (added by v30 migration)
 *
 * ERROR YOU WERE GETTING:
 * "column e.patientid does not exist" — this was because previous code used
 * JOINs with wrong column names. This version uses Supabase client instead
 * of raw SQL joins, so column names are handled automatically.
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

export async function GET(req: NextRequest) {
  const params   = req.nextUrl.searchParams
  const doctorId = params.get('doctorId')
  const from     = params.get('from')
  const to       = params.get('to')

  if (!from || !to) {
    return NextResponse.json({ error: 'from and to date params are required (YYYY-MM-DD)' }, { status: 400 })
  }

  const sb = getSupabase()

  // ── Fetch OPD encounters in the date range ────────────────
  // Using encounter_date (renamed from date by v30 migration)
  let encQuery = sb
    .from('encounters')
    .select('id, patientid, doctorid, doctorname, encounter_date')
    .gte('encounter_date', from)
    .lte('encounter_date', to)

  if (doctorId) encQuery = encQuery.eq('doctorid', doctorId)

  const { data: encounters, error: encErr } = await encQuery
  if (encErr) {
    return NextResponse.json({ error: `Encounters query failed: ${encErr.message}` }, { status: 500 })
  }

  // ── Fetch IPD admissions in the date range ────────────────
  let ipdQuery = sb
    .from('ipdadmissions')
    .select('id, patientid, doctorid, admittingdoctor, admissiondate')
    .gte('admissiondate', from)
    .lte('admissiondate', to)

  if (doctorId) ipdQuery = ipdQuery.eq('doctorid', doctorId)

  const { data: admissions } = await ipdQuery

  // ── Fetch bills for encountered patients ──────────────────
  // Group bills by patientid for later lookup
  const patientIds = [new Set((encounters || []).map(e => e.patientid).filter(Boolean))]

  let billsData: any[] = []
  if (patientIds.length > 0) {
    const { data: bills } = await sb
      .from('bills')
      .select('patientid, total, paid, status, createdat')
      .in('patientid', patientIds)
      .gte('createdat', from + 'T00:00:00')
      .lte('createdat', to + 'T23:59:59')

    billsData = bills || []
  }

  // Map patientid → total collected
  const paidByPatient = new Map<string, number>()
  const grossByPatient = new Map<string, number>()
  for (const b of billsData) {
    const pid = b.patientid
    paidByPatient.set(pid,  (paidByPatient.get(pid)  || 0) + Number(b.paid  || 0))
    grossByPatient.set(pid, (grossByPatient.get(pid) || 0) + Number(b.total || 0))
  }

  // ── Fetch doctor share percentages ────────────────────────
  const { data: doctors } = await sb
    .from('clinicusers')
    .select('id, fullname, share_pct, earning_model')
    .eq('role', 'doctor')

  const shareByDoctor = new Map<string, number>()
  for (const d of doctors || []) {
    shareByDoctor.set(d.id, Number(d.share_pct || 40))
  }

  // ── Build per-doctor earnings ─────────────────────────────

  const doctorMap = new Map<string, {
    doctorid:    string
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
    const key  = enc.doctorid || 'unknown'
    const name = enc.doctorname || 'Unknown Doctor'

    if (!doctorMap.has(key)) {
      doctorMap.set(key, {
        doctorid:   key,
        doctorname: name,
        opdCount:   0,
        ipdCount:   0,
        opdRevenue: 0,
        ipdRevenue: 0,
        collected:  0,
        sharePct:   shareByDoctor.get(key) || 40,
      })
    }

    const d = doctorMap.get(key)!
    d.opdCount++
    const paid = paidByPatient.get(enc.patientid) || 0
    d.opdRevenue += paid
    d.collected  += paid
  }

  // IPD admissions
  for (const adm of admissions || []) {
    const key  = adm.doctorid || 'unknown'
    const name = adm.admittingdoctor || 'Unknown Doctor'

    if (!doctorMap.has(key)) {
      doctorMap.set(key, {
        doctorid:   key,
        doctorname: name,
        opdCount:   0,
        ipdCount:   0,
        opdRevenue: 0,
        ipdRevenue: 0,
        collected:  0,
        sharePct:   shareByDoctor.get(key) || 40,
      })
    }

    doctorMap.get(key)!.ipdCount++
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