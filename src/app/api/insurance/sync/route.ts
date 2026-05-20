/**
 * src/app/api/insurance/sync/route.ts
 *
 * Insurance Claims Auto-Sync API
 *
 * This endpoint automatically syncs insurance data from patient registration
 * to the insurance claims module. It handles:
 *
 *   1. GET /api/insurance/sync — Returns all patients with insurance who don't
 *      have active claims yet (potential claims list)
 *
 *   2. POST /api/insurance/sync — Auto-creates a claim entry when a patient
 *      with insurance is admitted/discharged (called by IPD admission/discharge flows)
 *
 *   3. PATCH /api/insurance/sync — Updates claim status based on patient events
 *      (e.g., discharge → claim_submitted, bill paid → settled)
 *
 * In Indian clinic context:
 *   - Patient registers with mediclaim=true, cashless=true, policy details
 *   - When admitted for surgery/treatment, pre-auth is initiated
 *   - After discharge, claim documents are submitted
 *   - TPA reviews → approves/rejects → settlement
 *   - This API keeps the insurance module in sync with all of this automatically
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

// ── GET: Fetch all insured patients and their claim status ────
export async function GET(req: NextRequest) {
  try {
    const filter = req.nextUrl.searchParams.get('filter') // 'no_claim' | 'all' | 'pending' | 'settled'

    // Get all patients with insurance (mediclaim = true OR cashless = true OR policy_tpa_name is not null)
    const { data: insuredPatients, error: pErr } = await supabase
      .from('patients')
      .select('id, full_name, mrn, mobile, mediclaim, cashless, policy_tpa_name, policy_number, created_at')
      .or('mediclaim.eq.true,cashless.eq.true,policy_tpa_name.neq.')
      .order('created_at', { ascending: false })

    if (pErr) {
      return NextResponse.json({ error: pErr.message }, { status: 500 })
    }

    // Get all existing claims
    const { data: existingClaims, error: cErr } = await supabase
      .from('insurance_claims')
      .select('id, patient_id, status, claim_amount, approved_amount, created_at, updated_at')

    if (cErr) {
      return NextResponse.json({ error: cErr.message }, { status: 500 })
    }

    // Build a map of patient_id → claims
    const claimsByPatient = new Map<string, any[]>()
    for (const claim of existingClaims || []) {
      const existing = claimsByPatient.get(claim.patient_id) || []
      existing.push(claim)
      claimsByPatient.set(claim.patient_id, existing)
    }

    // Categorize patients
    const result = (insuredPatients || []).map(p => {
      const patientClaims = claimsByPatient.get(p.id) || []
      const hasClaim = patientClaims.length > 0
      const latestClaim = patientClaims.sort((a: any, b: any) =>
        new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
      )[0] || null

      const pendingClaims = patientClaims.filter((c: any) =>
        ['pre_auth_pending', 'claim_submitted', 'under_review', 'query_raised', 'query_resolved'].includes(c.status)
      )
      const settledClaims = patientClaims.filter((c: any) => c.status === 'settled')
      const totalClaimed = patientClaims.reduce((s: number, c: any) => s + (Number(c.claim_amount) || 0), 0)
      const totalSettled = settledClaims.reduce((s: number, c: any) => s + (Number(c.approved_amount) || 0), 0)

      return {
        patient_id: p.id,
        patient_name: p.full_name,
        mrn: p.mrn,
        mobile: p.mobile,
        mediclaim: p.mediclaim,
        cashless: p.cashless,
        policy_tpa_name: p.policy_tpa_name,
        policy_number: p.policy_number,
        registered_at: p.created_at,
        has_claim: hasClaim,
        total_claims: patientClaims.length,
        pending_claims: pendingClaims.length,
        settled_claims: settledClaims.length,
        total_claimed_amount: totalClaimed,
        total_settled_amount: totalSettled,
        latest_claim_status: latestClaim?.status || null,
        latest_claim_id: latestClaim?.id || null,
      }
    })

    // Apply filter
    let filtered = result
    if (filter === 'no_claim') {
      filtered = result.filter(r => !r.has_claim)
    } else if (filter === 'pending') {
      filtered = result.filter(r => r.pending_claims > 0)
    } else if (filter === 'settled') {
      filtered = result.filter(r => r.settled_claims > 0)
    }

    // Summary stats
    const stats = {
      total_insured_patients: result.length,
      patients_without_claims: result.filter(r => !r.has_claim).length,
      patients_with_pending: result.filter(r => r.pending_claims > 0).length,
      patients_settled: result.filter(r => r.settled_claims > 0).length,
      total_pending_amount: result.reduce((s, r) => s + r.total_claimed_amount - r.total_settled_amount, 0),
      total_settled_amount: result.reduce((s, r) => s + r.total_settled_amount, 0),
    }

    return NextResponse.json({
      patients: filtered,
      stats,
      total: filtered.length,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── POST: Auto-create insurance claim from patient event ──────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      patient_id,
      trigger,         // 'admission' | 'discharge' | 'manual' | 'registration'
      admission_id,    // IPD admission ID (optional)
      claim_amount,    // Pre-filled amount (optional)
      diagnosis,       // From IPD admission (optional)
      surgery_name,    // From OT schedule (optional)
      admission_date,
      discharge_date,
    } = body

    if (!patient_id) {
      return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })
    }

    // Fetch patient details
    const { data: patient, error: pErr } = await supabase
      .from('patients')
      .select('id, full_name, mrn, mobile, mediclaim, cashless, policy_tpa_name, policy_number')
      .eq('id', patient_id)
      .single()

    if (pErr || !patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    // Verify patient actually has insurance
    if (!patient.mediclaim && !patient.cashless && !patient.policy_tpa_name) {
      return NextResponse.json({
        ok: false,
        message: 'Patient does not have insurance/mediclaim. No claim created.',
        skip: true,
      })
    }

    // Check if there's already an active (non-settled) claim for this patient
    const { data: existingActive } = await supabase
      .from('insurance_claims')
      .select('id, status')
      .eq('patient_id', patient_id)
      .not('status', 'in', '("settled","rejected")')
      .limit(1)

    // If triggered by admission and there's already an active claim, don't create duplicate
    if (trigger === 'admission' && existingActive && existingActive.length > 0) {
      return NextResponse.json({
        ok: true,
        message: 'Active claim already exists for this patient.',
        existing_claim_id: existingActive[0].id,
        skip: true,
      })
    }

    // Create the claim
    const claimData: any = {
      patient_id: patient.id,
      patient_name: patient.full_name,
      mrn: patient.mrn || '',
      policy_number: patient.policy_number || null,
      tpa_name: patient.policy_tpa_name || null,
      insurance_company: null,
      claim_amount: Number(claim_amount) || 0,
      status: trigger === 'admission' ? 'pre_auth_pending' : 'pre_auth_pending',
      diagnosis: diagnosis || null,
      surgery_name: surgery_name || null,
      admission_date: admission_date || null,
      discharge_date: discharge_date || null,
      notes: `Auto-created from ${trigger} on ${new Date().toLocaleDateString('en-IN')}`,
      created_by: 'system',
      documents_sent: false,
    }

    // If triggered by discharge, set claim_submitted status
    if (trigger === 'discharge') {
      claimData.status = 'claim_submitted'
      claimData.notes = `Claim auto-submitted after discharge on ${new Date().toLocaleDateString('en-IN')}`
    }

    const { data: newClaim, error: insertErr } = await supabase
      .from('insurance_claims')
      .insert(claimData)
      .select('id')
      .single()

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    // Log to history
    await supabase.from('insurance_claim_history').insert({
      claim_id: newClaim.id,
      old_status: null,
      new_status: claimData.status,
      notes: claimData.notes,
      done_by: 'system',
    }).then(() => {}).catch(() => {})

    return NextResponse.json({
      ok: true,
      claim_id: newClaim.id,
      message: `Insurance claim auto-created for ${patient.full_name}`,
      trigger,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── PATCH: Update claim based on patient events ───────────────
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { claim_id, patient_id, event, data: eventData } = body

    // Find the claim
    let claimQuery = supabase.from('insurance_claims').select('*')
    if (claim_id) {
      claimQuery = claimQuery.eq('id', claim_id)
    } else if (patient_id) {
      claimQuery = claimQuery.eq('patient_id', patient_id).not('status', 'in', '("settled","rejected")').order('created_at', { ascending: false }).limit(1)
    }
    const { data: claims } = await claimQuery
    const claim = claims?.[0]
    if (!claim) {
      return NextResponse.json({ ok: false, message: 'No active claim found' })
    }

    // Handle different events
    let updates: any = { updated_at: new Date().toISOString() }

    switch (event) {
      case 'bill_generated':
        // When bill is generated, update claim amount
        if (eventData?.bill_amount) {
          updates.claim_amount = Number(eventData.bill_amount)
        }
        break

      case 'bill_paid':
        // When patient pays (reimbursement case), mark as settled
        if (!claim.cashless) {
          updates.status = 'settled'
          updates.approved_amount = Number(eventData?.paid_amount) || claim.claim_amount
          updates.settlement_date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
        }
        break

      case 'discharge':
        // Auto-advance to claim_submitted after discharge
        if (['pre_auth_pending', 'pre_auth_approved'].includes(claim.status)) {
          updates.status = 'claim_submitted'
          updates.discharge_date = eventData?.discharge_date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
        }
        break

      case 'documents_submitted':
        updates.documents_sent = true
        break

      default:
        return NextResponse.json({ ok: false, message: `Unknown event: ${event}` })
    }

    await supabase.from('insurance_claims').update(updates).eq('id', claim.id)

    // Log history
    if (updates.status && updates.status !== claim.status) {
      await supabase.from('insurance_claim_history').insert({
        claim_id: claim.id,
        old_status: claim.status,
        new_status: updates.status,
        notes: `Auto-updated from event: ${event}`,
        done_by: 'system',
      }).then(() => {}).catch(() => {})
    }

    return NextResponse.json({ ok: true, claim_id: claim.id, updates })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
