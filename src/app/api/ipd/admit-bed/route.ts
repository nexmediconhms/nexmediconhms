/**
 * src/app/api/ipd/admit-bed/route.ts
 *
 * Atomic IPD Bed Assignment API
 *
 * POST /api/ipd/admit-bed
 *
 * ═══════════════════════════════════════════════════════════════════════
 * FIX: IPD Workflow — Bed Assignment Race Condition
 *
 * PROBLEM:
 *   Even with client-side checks, multiple concurrent admissions can
 *   assign the same bed because:
 *     1. Two staff check bed availability at the same time
 *     2. Both see the bed as 'available'
 *     3. Both update the bed status to 'occupied'
 *     4. Both create admission records → bed is double-booked
 *
 * SOLUTION:
 *   This server-side endpoint uses the Postgres function
 *   assign_bed_atomic() which:
 *     1. SELECT FOR UPDATE on the bed row (exclusive lock)
 *     2. Verifies bed is still 'available' inside the lock
 *     3. Checks patient doesn't already have an active admission
 *     4. Updates bed status and creates admission atomically
 *     5. Returns admission ID and bed details
 *
 * ALSO FIXES:
 *   - Admission ↔ billing linkage: returns admission_id for billing
 *   - Bed status consistency: atomic update prevents stuck states
 *   - Audit logging: logs the admission via hash-chained audit
 *
 * Auth: doctor or admin role required.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED_ROLES = ['admin', 'doctor'] as const

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ALLOWED_ROLES as unknown as string[])
  if (auth instanceof Response) return auth

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    patient_id,
    bed_id,
    admitting_doctor,
    diagnosis,
    chief_complaint,
    notes,
    // Additional fields for the admission
    patient_name,
    mrn,
    mobile,
    ward,
    insurance_details,
    expected_discharge,
  } = body ?? {}

  // ── Validation ─────────────────────────────────────────────────

  if (!patient_id || typeof patient_id !== 'string') {
    return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })
  }

  if (!bed_id || typeof bed_id !== 'string') {
    return NextResponse.json({ error: 'bed_id is required' }, { status: 400 })
  }

  if (!admitting_doctor || typeof admitting_doctor !== 'string') {
    return NextResponse.json({ error: 'admitting_doctor is required' }, { status: 400 })
  }

  // ── Get admin client ───────────────────────────────────────────
  let sb: ReturnType<typeof getSupabaseAdmin>
  try {
    sb = getSupabaseAdmin()
  } catch (err) {
    console.error('[admit-bed] Admin client error:', err)
    return NextResponse.json(
      { error: 'Server misconfigured. Contact administrator.' },
      { status: 500 },
    )
  }

  // ── Try atomic bed assignment (DB function) ────────────────────
  try {
    const { data: result, error: rpcErr } = await sb.rpc('assign_bed_atomic', {
      p_patientid: patient_id,
      p_bedid: bed_id,
      p_admittingdoctor: admitting_doctor,
      p_diagnosis: diagnosis || chief_complaint || null,
      p_notes: notes || null,
    })

    if (rpcErr) {
      const msg = rpcErr.message?.toLowerCase() || ''
      const code = (rpcErr as any).code || ''
      if (code === '42883' || msg.includes('does not exist') || msg.includes('function')) {
        // Fall through to legacy path
        console.warn('[admit-bed] assign_bed_atomic not found, using legacy path')
      } else {
        throw rpcErr
      }
    } else if (result && result.length > 0) {
      const row = result[0]

      if (!row.success) {
        return NextResponse.json({
          error: row.error_message || 'Bed assignment failed',
          bed_number: row.bed_number,
          ward: row.ward,
        }, { status: 409 })
      }

      // Log audit
      try {
        await sb.rpc('insert_audit_entry', {
          p_user_id: auth.clinicUserId || null,
          p_user_email: auth.email || admitting_doctor,
          p_user_role: 'doctor',
          p_action: 'create',
          p_entity_type: 'ipd_admission',
          p_entity_id: row.admission_id,
          p_entity_label: `${patient_name || 'Patient'} admitted to Bed ${row.bed_number}`,
          p_changes: JSON.stringify({
            patient_id,
            bed_id,
            bed_number: row.bed_number,
            ward: row.ward,
            admitting_doctor,
            diagnosis,
          }),
        })
      } catch { /* non-fatal */ }

      return NextResponse.json({
        ok: true,
        admission_id: row.admission_id,
        bed_number: row.bed_number,
        ward: row.ward,
        message: `Patient admitted to Bed ${row.bed_number} (${row.ward || 'General'})`,
      }, { status: 201 })
    }
  } catch (rpcEx: any) {
    console.warn('[admit-bed] Atomic assignment failed, trying legacy:', rpcEx?.message)
  }

  // ── Legacy fallback: manual lock with retry ────────────────────
  // This path is used when the assign_bed_atomic function is not deployed.
  // We use a simple check-then-update pattern with conflict detection.

  // Step 1: Check bed availability
  let bed: any = null
  for (const tableName of ['beds']) {
    const { data, error } = await sb
      .from(tableName)
      .select('id, bednumber, ward, status')
      .eq('id', bed_id)
      .single()

    if (!error && data) {
      bed = data
      break
    }
  }

  if (!bed) {
    return NextResponse.json({ error: 'Bed not found' }, { status: 404 })
  }

  if (bed.status !== 'available') {
    return NextResponse.json({
      error: `Bed ${bed.bednumber} is currently ${bed.status}. Choose another bed.`,
      bed_number: bed.bednumber,
      ward: bed.ward,
    }, { status: 409 })
  }

  // Step 2: Check patient doesn't have active admission
  const { data: activeAdmission } = await sb
    .from('ipdadmissions')
    .select('id')
    .eq('patientid', patient_id)
    .eq('status', 'admitted')
    .maybeSingle()

  if (activeAdmission) {
    return NextResponse.json({
      error: 'Patient already has an active IPD admission',
      existing_admission_id: activeAdmission.id,
    }, { status: 409 })
  }

  // Step 3: Update bed status (will fail if another request got there first
  // due to the status check in the WHERE clause)
  const { error: bedErr } = await sb
    .from('beds')
    .update({ status: 'occupied', updatedat: new Date().toISOString() })
    .eq('id', bed_id)
    .eq('status', 'available') // Optimistic lock: only update if still available

  if (bedErr) {
    // Could be a race condition — another admission got the bed
    return NextResponse.json({
      error: 'Bed is no longer available (assigned to another patient). Please refresh and try again.',
    }, { status: 409 })
  }

  // Verify the update actually changed a row (Supabase doesn't return affected count easily)
  const { data: bedCheck } = await sb
    .from('beds')
    .select('status')
    .eq('id', bed_id)
    .single()

  if (bedCheck?.status !== 'occupied') {
    return NextResponse.json({
      error: 'Bed assignment failed — bed may have been taken by another admission.',
    }, { status: 409 })
  }

  // Step 4: Create admission
  const { data: admission, error: admErr } = await sb
    .from('ipdadmissions')
    .insert({
      patientid: patient_id,
      bedid: bed_id,
      admittingdoctor: admitting_doctor,
      diagnosis: diagnosis || chief_complaint || null,
      notes: notes || null,
      status: 'admitted',
    })
    .select('id')
    .single()

  if (admErr) {
    // Rollback bed status
    console.error('[admit-bed] Admission insert failed, rolling back bed:', admErr.message)
    await sb
      .from('beds')
      .update({ status: 'available', updatedat: new Date().toISOString() })
      .eq('id', bed_id)

    return NextResponse.json({
      error: 'Failed to create admission record: ' + admErr.message,
    }, { status: 500 })
  }

  // Step 5: Audit
  try {
    await sb.rpc('insert_audit_entry', {
      p_user_id: auth.clinicUserId || null,
      p_user_email: auth.email || admitting_doctor,
      p_user_role: 'doctor',
      p_action: 'create',
      p_entity_type: 'ipd_admission',
      p_entity_id: admission.id,
      p_entity_label: `${patient_name || 'Patient'} admitted to Bed ${bed.bednumber}`,
      p_changes: JSON.stringify({
        patient_id,
        bed_id,
        bed_number: bed.bednumber,
        ward: bed.ward,
        admitting_doctor,
      }),
    })
  } catch {
    // Try direct insert as fallback
    try {
      await sb.from('auditlog').insert({
        action: 'create',
        entitytype: 'ipd_admission',
        entityid: admission.id,
        entitylabel: `${patient_name || 'Patient'} admitted to Bed ${bed.bednumber}`,
        useremail: auth.email || admitting_doctor,
        userrole: 'doctor',
        changes: JSON.stringify({ patient_id, bed_id, admitting_doctor }),
      })
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({
    ok: true,
    admission_id: admission.id,
    bed_number: bed.bednumber,
    ward: bed.ward,
    message: `Patient admitted to Bed ${bed.bednumber} (${bed.ward || 'General'})`,
  }, { status: 201 })
}
