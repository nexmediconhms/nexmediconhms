/**
 * src/app/api/insurance/sync/route.ts
 *
 * Insurance Auto-Sync API
 *
 * GET  /api/insurance/sync?filter=all|no_claim|admitted|discharged
 *   Returns patients with mediclaim=Yes or cashless=Yes, with their claim status.
 *
 * POST /api/insurance/sync
 *   Auto-creates an insurance_claims entry for a patient.
 *   Body: { patient_id, trigger: 'manual'|'admission'|'discharge' }
 *
 * This fixes the bug where patients registered with Mediclaim/Cashless=Yes
 * were not appearing in the Insured Patients list.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

// ── GET: List insured patients with sync status ───────────────
export async function GET(req: NextRequest) {
  const filter = req.nextUrl.searchParams.get('filter') || 'all'

  try {
    // Step 1: Get all patients with mediclaim or cashless flags
    const { data: patients, error: patErr } = await supabase
      .from('patients')
      .select('id, full_name, mrn, mobile, age, gender, mediclaim, cashless, policy_tpa_name, policy_number, insurance_company, created_at')
      .or('mediclaim.eq.Yes,mediclaim.eq.yes,mediclaim.eq.TRUE,mediclaim.eq.true,cashless.eq.Yes,cashless.eq.yes,cashless.eq.TRUE,cashless.eq.true')
      .order('created_at', { ascending: false })

    if (patErr) {
      return NextResponse.json({ error: patErr.message }, { status: 500 })
    }

    if (!patients || patients.length === 0) {
      return NextResponse.json({
        patients: [],
        stats: { total_insured: 0, patients_with_claims: 0, patients_without_claims: 0 },
      })
    }

    // Step 2: Get existing insurance claims
    const patientIds = patients.map(p => p.id)
    const { data: claims } = await supabase
      .from('insurance_claims')
      .select('patient_id, status, claim_amount')
      .in('patient_id', patientIds)

    const claimsMap = new Map<string, any>()
    for (const c of claims || []) {
      claimsMap.set(c.patient_id, c)
    }

    // Step 3: Check IPD admissions for admitted/discharged status
    const { data: admissions } = await supabase
      .from('ipd_admissions')
      .select('patient_id, status, admission_date, ward, bed_number')
      .in('patient_id', patientIds)
      .order('admission_date', { ascending: false })

    const admissionMap = new Map<string, any>()
    for (const a of admissions || []) {
      if (!admissionMap.has(a.patient_id)) {
        admissionMap.set(a.patient_id, a)
      }
    }

    // Step 4: Build combined list
    let result = patients.map(p => {
      const claim = claimsMap.get(p.id)
      const admission = admissionMap.get(p.id)
      return {
        patient_id: p.id,
        patient_name: p.full_name,
        mrn: p.mrn,
        mobile: p.mobile,
        age: p.age,
        gender: p.gender,
        mediclaim: p.mediclaim,
        cashless: p.cashless,
        policy_tpa_name: p.policy_tpa_name,
        policy_number: p.policy_number,
        insurance_company: p.insurance_company,
        registered_at: p.created_at,
        // Claim info
        has_claim: !!claim,
        claim_status: claim?.status || null,
        claim_amount: claim?.claim_amount || 0,
        // IPD info
        is_admitted: admission?.status === 'active',
        is_discharged: admission?.status === 'discharged',
        admission_date: admission?.admission_date || null,
        ward: admission?.ward || null,
        bed_number: admission?.bed_number || null,
      }
    })

    // Step 5: Apply filter
    if (filter === 'no_claim') {
      result = result.filter(p => !p.has_claim)
    } else if (filter === 'admitted') {
      result = result.filter(p => p.is_admitted)
    } else if (filter === 'discharged') {
      result = result.filter(p => p.is_discharged)
    }

    // Stats
    const stats = {
      total_insured: patients.length,
      patients_with_claims: result.filter(p => p.has_claim).length,
      patients_without_claims: result.filter(p => !p.has_claim).length,
      admitted: result.filter(p => p.is_admitted).length,
      discharged: result.filter(p => p.is_discharged).length,
    }

    return NextResponse.json({ patients: result, stats, total: result.length })
  } catch (err: any) {
    console.error('[insurance/sync] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── POST: Auto-create claim for a patient ─────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { patient_id, trigger = 'manual' } = body

    if (!patient_id) {
      return NextResponse.json({ error: 'patient_id required' }, { status: 400 })
    }

    // Get patient info
    const { data: patient, error: patErr } = await supabase
      .from('patients')
      .select('id, full_name, mrn, mobile, mediclaim, cashless, policy_tpa_name, policy_number, insurance_company')
      .eq('id', patient_id)
      .single()

    if (patErr || !patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    // Check if claim already exists
    const { data: existingClaim } = await supabase
      .from('insurance_claims')
      .select('id')
      .eq('patient_id', patient_id)
      .maybeSingle()

    if (existingClaim) {
      return NextResponse.json({
        ok: false,
        message: 'Claim already exists for this patient',
        claim_id: existingClaim.id,
      })
    }

    // Check if patient has IPD admission (for claim context)
    const { data: admission } = await supabase
      .from('ipd_admissions')
      .select('admission_date, diagnosis_on_admission, ward')
      .eq('patient_id', patient_id)
      .order('admission_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Create the claim
    const { data: newClaim, error: insertErr } = await supabase
      .from('insurance_claims')
      .insert({
        patient_id: patient.id,
        patient_name: patient.full_name,
        mrn: patient.mrn || '',
        policy_number: patient.policy_number || null,
        tpa_name: patient.policy_tpa_name || null,
        insurance_company: patient.insurance_company || null,
        claim_amount: 0,
        status: 'pre_auth_pending',
        diagnosis: admission?.diagnosis_on_admission || null,
        admission_date: admission?.admission_date || null,
        notes: `Auto-created: ${trigger === 'manual' ? 'Manual sync from Insured Patients list' : trigger === 'admission' ? 'Patient admitted to IPD' : 'Patient discharged from IPD'}. Insurance: ${patient.mediclaim === 'Yes' ? 'Mediclaim' : ''}${patient.cashless === 'Yes' ? ' Cashless' : ''}.`,
      })
      .select('id')
      .single()

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      claim_id: newClaim.id,
      patient_name: patient.full_name,
      message: `Insurance claim created for ${patient.full_name}`,
    })
  } catch (err: any) {
    console.error('[insurance/sync] POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
