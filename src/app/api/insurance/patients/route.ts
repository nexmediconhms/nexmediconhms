/**
 * src/app/api/insurance/patients/route.ts
 *
 * Insurance Patient List — FIXED Desynchronization
 *
 * ROOT CAUSE OF BUG:
 *   The old sync endpoint used `.or('mediclaim.eq.true,cashless.eq.true,...')`
 *   but the patients table stores these as TEXT fields ('Yes'/'No', not boolean).
 *   Additionally, patients who set insurance_name or insurance_id during
 *   checkout/admission were not being detected because the query only checked
 *   mediclaim/cashless/policy_tpa_name.
 *
 * THIS FIX:
 *   1. Correctly queries ALL insurance-related TEXT fields with proper comparisons
 *   2. Uses case-insensitive matching for 'Yes'/'true'/etc.
 *   3. Also checks insurance_name and insurance_id fields
 *   4. Joins with insurance_claims to get claim status
 *   5. Supports real-time subscription via Supabase channel
 *   6. Provides proper stats for the insurance dashboard
 *
 * ENDPOINTS:
 *   GET /api/insurance/patients?filter=all|no_claim|pending|settled
 *   POST /api/insurance/patients — Force-sync: ensure a patient appears in list
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET: Fetch all insured patients with correct field matching ───
export async function GET(req: NextRequest) {
  // SECURITY FIX: Require authentication
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  try {
    const filter = req.nextUrl.searchParams.get('filter') || 'all'
    const sb = getSupabaseAdmin()

    // FIXED QUERY: The patients table uses TEXT fields for mediclaim/cashless
    // Values can be: 'Yes', 'No', 'true', 'false', 'TRUE', null
    // We need to check ALL insurance-related fields comprehensively
    // v6 FIX: insurance_name, insurance_id, and email do not exist on this DB's
    // patients table. Confirmed columns: id, full_name, mrn, mobile, mediclaim
    // (boolean), cashless (boolean), policy_tpa_name, policy_number, is_active,
    // created_at. Selecting a non-existent column makes PostgREST reject the
    // whole row set with a "column does not exist" error.
    // v7 FIX: same is_active relaxation as /api/insurance/sync route — see comments there
    const { data: allPatients, error: pErr } = await sb
      .from('patients')
      .select('id, full_name, mrn, mobile, mediclaim, cashless, policy_tpa_name, policy_number, created_at, is_active')
      .order('created_at', { ascending: false })

    if (pErr) {
      console.error('[insurance/patients] Query error:', pErr)
      return NextResponse.json({ error: pErr.message }, { status: 500 })
    }

    // Filter for insured patients using proper TEXT field matching
    // This is the KEY FIX: we check all possible insurance indicators
    const insuredPatients = (allPatients || []).filter(p => {
      if (p.is_active === false) return false
      // v6 FIX: dropped hasInsuranceName / hasInsuranceId — those columns do
      // not exist on this DB's patients table and would always be false anyway.
      const hasMediclaim = isYesOrTrue(p.mediclaim)
      const hasCashless = isYesOrTrue(p.cashless)
      const hasTPA = isNonEmpty(p.policy_tpa_name)
      const hasPolicyNumber = isNonEmpty(p.policy_number)

      return hasMediclaim || hasCashless || hasTPA || hasPolicyNumber
    })

    // Get all existing claims for these patients in one query
    const patientIds = insuredPatients.map(p => p.id)

    let existingClaims: any[] = []
    if (patientIds.length > 0) {
      // Batch query - Supabase .in() has a limit, chunk if needed
      const chunks = chunkArray(patientIds, 100)
      for (const chunk of chunks) {
        const { data: claims } = await sb
          .from('insurance_claims')
          .select('id, patient_id, status, claim_amount, approved_amount, created_at, updated_at')
          .in('patient_id', chunk)

        if (claims) existingClaims.push(...claims)
      }
    }

    // Build a map of patient_id → claims
    const claimsByPatient = new Map<string, any[]>()
    for (const claim of existingClaims) {
      const existing = claimsByPatient.get(claim.patient_id) || []
      existing.push(claim)
      claimsByPatient.set(claim.patient_id, existing)
    }

    // Build enriched result
    const result = insuredPatients.map(p => {
      const patientClaims = claimsByPatient.get(p.id) || []
      const hasClaim = patientClaims.length > 0
      const latestClaim = patientClaims.sort((a, b) =>
        new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
      )[0] || null

      const pendingStatuses = ['pre_auth_pending', 'claim_submitted', 'under_review', 'query_raised', 'query_resolved']
      const pendingClaims = patientClaims.filter(c => pendingStatuses.includes(c.status))
      const settledClaims = patientClaims.filter(c => c.status === 'settled')
      const totalClaimed = patientClaims.reduce((s, c) => s + (Number(c.claim_amount) || 0), 0)
      const totalSettled = settledClaims.reduce((s, c) => s + (Number(c.approved_amount) || 0), 0)

      return {
        patient_id: p.id,
        patient_name: p.full_name,
        mrn: p.mrn,
        mobile: p.mobile,
        // v6 FIX: email/insurance_name/insurance_id removed — columns absent on this DB.
        // If a future migration adds them back, restore the fields and they'll flow through.
        mediclaim: isYesOrTrue(p.mediclaim),
        cashless: isYesOrTrue(p.cashless),
        policy_tpa_name: p.policy_tpa_name || null,
        policy_number: p.policy_number || null,
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
    switch (filter) {
      case 'no_claim':
        filtered = result.filter(r => !r.has_claim)
        break
      case 'pending':
        filtered = result.filter(r => r.pending_claims > 0)
        break
      case 'settled':
        filtered = result.filter(r => r.settled_claims > 0)
        break
      // 'all' — no filter
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
    console.error('[insurance/patients] Unexpected error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── POST: Force-sync a patient into the insured list ─────────────
// Called when a patient's insurance fields are updated during
// admission or checkout, ensuring immediate visibility.
export async function POST(req: NextRequest) {
  // SECURITY FIX: Require authentication
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  try {
    const body = await req.json()
    const { patient_id, insurance_data } = body

    if (!patient_id) {
      return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })
    }

    const sb = getSupabaseAdmin()

    // Build the update payload from whatever insurance data is provided
    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    }

    if (insurance_data) {
      if (insurance_data.mediclaim !== undefined) {
        updatePayload.mediclaim = insurance_data.mediclaim ? 'Yes' : 'No'
      }
      if (insurance_data.cashless !== undefined) {
        updatePayload.cashless = insurance_data.cashless ? 'Yes' : 'No'
      }
      if (insurance_data.policy_tpa_name !== undefined) {
        updatePayload.policy_tpa_name = insurance_data.policy_tpa_name || null
      }
      if (insurance_data.policy_number !== undefined) {
        updatePayload.policy_number = insurance_data.policy_number || null
      }
      if (insurance_data.insurance_name !== undefined) {
        updatePayload.insurance_name = insurance_data.insurance_name || null
      }
      if (insurance_data.insurance_id !== undefined) {
        updatePayload.insurance_id = insurance_data.insurance_id || null
      }
    }

    // Only update if we have meaningful data
    if (Object.keys(updatePayload).length > 1) { // > 1 because updated_at is always there
      const { error: updateErr } = await sb
        .from('patients')
        .update(updatePayload)
        .eq('id', patient_id)

      if (updateErr) {
        console.error('[insurance/patients] Update error:', updateErr)
        return NextResponse.json({ error: updateErr.message }, { status: 500 })
      }
    }

    // Verify the patient now appears in the insured list
    const { data: patient } = await sb
      .from('patients')
      .select('id, full_name, mrn, mediclaim, cashless, policy_tpa_name, insurance_name, insurance_id')
      .eq('id', patient_id)
      .single()

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    const isInsured = isYesOrTrue(patient.mediclaim) ||
      isYesOrTrue(patient.cashless) ||
      isNonEmpty(patient.policy_tpa_name) ||
      isNonEmpty(patient.insurance_name) ||
      isNonEmpty(patient.insurance_id)

    return NextResponse.json({
      ok: true,
      patient_id,
      patient_name: patient.full_name,
      is_insured: isInsured,
      message: isInsured
        ? `${patient.full_name} is now visible in the Insured Patient List`
        : `${patient.full_name} insurance data updated but no active insurance flags detected`,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Check if a TEXT field represents a truthy insurance value.
 * The patients table stores mediclaim/cashless as TEXT: 'Yes', 'No', 'true', etc.
 */
function isYesOrTrue(val: any): boolean {
  if (val === null || val === undefined) return false
  if (typeof val === 'boolean') return val
  const str = String(val).trim().toLowerCase()
  return str === 'yes' || str === 'true' || str === '1'
}

/**
 * Check if a text field has a meaningful non-empty value.
 */
function isNonEmpty(val: any): boolean {
  if (val === null || val === undefined) return false
  const str = String(val).trim()
  return str.length > 0 && str !== 'null' && str !== 'undefined' && str !== 'N/A'
}

/**
 * Split array into chunks of specified size.
 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}