/**
 * src/app/api/patients/register/route.ts
 *
 * Atomic Patient Registration API
 *
 * POST /api/patients/register
 *
 * ═══════════════════════════════════════════════════════════════════════
 * FIX: Patient Registration — Duplicate Creation Race Condition
 *
 * PROBLEM:
 *   The client-side duplicate check (checkDuplicates() in patients/new)
 *   is not atomic. Two reception staff registering the same patient at
 *   the same second can both pass the check and create duplicate records.
 *   MRN uniqueness is not enforced at DB level in all deployments.
 *
 * SOLUTION:
 *   This server-side endpoint uses the Postgres function
 *   register_patient_atomic() which:
 *     1. Acquires an advisory lock on the mobile number
 *     2. Checks for existing patient inside the lock
 *     3. Returns existing patient if found (is_duplicate=true)
 *     4. Creates new patient if not found
 *     5. Generates MRN inside the same transaction
 *
 *   The client-side duplicate check is PRESERVED as a UX aid (shows
 *   the warning dialog before submission), but this endpoint is the
 *   authoritative guard against race conditions.
 *
 * FALLBACK:
 *   If the RPC function doesn't exist (pre-migration), we fall back
 *   to the original INSERT with a proper unique constraint check,
 *   returning a clear error on duplicates.
 *
 * Auth: Any authenticated active clinic user.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_NAME_LENGTH = 200
const MAX_ADDRESS_LENGTH = 500
const MAX_NOTES_LENGTH = 1000

export async function POST(req: NextRequest) {
  // Auth check
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    full_name,
    mobile,
    age,
    date_of_birth,
    gender,
    blood_group,
    address,
    aadhaar_no,
    abha_id,
    mediclaim,
    cashless,
    reference_source,
    reference_detail,
    emergency_contact_name,
    emergency_contact_phone,
    policy_tpa_name,
    policy_number,
    consent_confirmed,
  } = body ?? {}

  // ── Validation ─────────────────────────────────────────────────

  if (!full_name || typeof full_name !== 'string' || full_name.trim().length === 0) {
    return NextResponse.json({ error: 'Patient name is required' }, { status: 400 })
  }
  if (full_name.trim().length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: 'Name is too long' }, { status: 400 })
  }

  if (!mobile || typeof mobile !== 'string') {
    return NextResponse.json({ error: 'Mobile number is required' }, { status: 400 })
  }
  const cleanMobile = mobile.replace(/\D/g, '').replace(/^91/, '')
  if (cleanMobile.length !== 10) {
    return NextResponse.json({ error: 'Enter a valid 10-digit mobile number' }, { status: 400 })
  }

  // Aadhaar validation
  const cleanAadhaar = (aadhaar_no || '').replace(/\D/g, '').trim()
  if (cleanAadhaar && cleanAadhaar.length !== 12) {
    return NextResponse.json({ error: 'Aadhaar number must be 12 digits' }, { status: 400 })
  }

  // Address length check
  if (address && typeof address === 'string' && address.length > MAX_ADDRESS_LENGTH) {
    return NextResponse.json({ error: 'Address is too long' }, { status: 400 })
  }

  // Consent check (warning, not blocker, for backward compat)
  if (consent_confirmed !== true && consent_confirmed !== 'true') {
    // Log warning but don't block — many deployments don't have consent UI yet
    console.warn('[register] Patient registration without explicit consent flag')
  }

  // ── Get admin client ───────────────────────────────────────────
  let sb: ReturnType<typeof getSupabaseAdmin>
  try {
    sb = getSupabaseAdmin()
  } catch (err) {
    console.error('[register] Admin client error:', err)
    return NextResponse.json(
      { error: 'Server misconfigured. Contact administrator.' },
      { status: 500 },
    )
  }

  // ── Try atomic registration (DB function) ──────────────────────
  try {
    const { data: result, error: rpcErr } = await sb.rpc('register_patient_atomic', {
      p_fullname: full_name.trim().slice(0, MAX_NAME_LENGTH),
      p_mobile: cleanMobile,
      p_age: age ? String(age) : null,
      p_dob: date_of_birth || null,
      p_gender: gender || 'Female',
      p_bloodgroup: blood_group || null,
      p_address: (address || '').trim().slice(0, MAX_ADDRESS_LENGTH) || null,
      p_aadhaar: cleanAadhaar || null,
      p_abhaid: (abha_id || '').trim() || null,
      p_mediclaim: mediclaim === 'Yes' ? 'Yes' : 'No',
      p_cashless: cashless === 'Yes' ? 'Yes' : 'No',
      p_referredby: reference_source
        ? (reference_detail ? `${reference_source} — ${reference_detail.trim()}` : reference_source)
        : null,
      p_emergname: (emergency_contact_name || '').trim() || null,
      p_emergphone: (emergency_contact_phone || '').replace(/\D/g, '').replace(/^91/, '') || null,
      p_policytpa: (policy_tpa_name || '').trim() || null,
      p_policynum: (policy_number || '').trim() || null,
    })

    if (rpcErr) {
      // Check if function doesn't exist → fall through to legacy path
      const msg = rpcErr.message?.toLowerCase() || ''
      const code = (rpcErr as any).code || ''
      if (code === '42883' || msg.includes('does not exist') || msg.includes('function')) {
        // Fall through to legacy insert below
        console.warn('[register] register_patient_atomic not found, using legacy insert')
      } else if (msg.includes('duplicate') || msg.includes('unique') || code === '23505') {
        return NextResponse.json({
          error: 'A patient with this mobile number or Aadhaar already exists',
          is_duplicate: true,
        }, { status: 409 })
      } else {
        throw rpcErr
      }
    } else if (result && result.length > 0) {
      const row = result[0]
      const isDuplicate = row.is_duplicate === true

      // Audit the registration
      try {
        const auditMod = await import('@/lib/audit')
        if (!isDuplicate) {
          await auditMod.audit('create', 'patient', row.patient_id, row.patient_name)
        }
      } catch { /* non-fatal */ }

      return NextResponse.json({
        ok: true,
        id: row.patient_id,
        mrn: row.patient_mrn,
        full_name: row.patient_name,
        is_duplicate: isDuplicate,
        message: isDuplicate
          ? 'Patient with this mobile/Aadhaar already exists. Returning existing record.'
          : 'Patient registered successfully.',
      }, { status: isDuplicate ? 200 : 201 })
    }
  } catch (rpcEx: any) {
    // Log but fall through to legacy path
    console.warn('[register] Atomic registration failed, trying legacy:', rpcEx?.message)
  }

  // ── Legacy fallback: direct INSERT ─────────────────────────────
  // Used when the register_patient_atomic function is not deployed.
  // The unique index on mobile (from migration 020) still prevents
  // duplicates, but there's a small race window between check & insert.

  // Check for existing patient first
  const { data: existing } = await sb
    .from('patients')
    .select('id, mrn, fullname')
    .or(`mobile.eq.${cleanMobile}${cleanAadhaar ? `,aadhaar.eq.${cleanAadhaar}` : ''}`)
    .limit(1)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({
      ok: true,
      id: existing.id,
      mrn: existing.mrn,
      full_name: existing.fullname,
      is_duplicate: true,
      message: 'Patient with this mobile/Aadhaar already exists.',
    })
  }

  // Build reference string
  const refString = reference_source
    ? (reference_detail ? `${reference_source} — ${reference_detail.trim()}` : reference_source)
    : null

  const { data: newPatient, error: insertErr } = await sb
    .from('patients')
    .insert({
      fullname: full_name.trim().slice(0, MAX_NAME_LENGTH),
      mobile: cleanMobile,
      age: age ? String(age) : null,
      dob: date_of_birth || null,
      gender: gender || 'Female',
      bloodgroup: blood_group || null,
      address: (address || '').trim().slice(0, MAX_ADDRESS_LENGTH) || null,
      aadhaar: cleanAadhaar || null,
      abhaid: (abha_id || '').trim() || null,
      mediclaim: mediclaim === 'Yes' ? 'Yes' : 'No',
      cashless: cashless === 'Yes' ? 'Yes' : 'No',
      referredby: refString,
    })
    .select('id, mrn, fullname')
    .single()

  if (insertErr) {
    if (insertErr.message?.includes('duplicate') || insertErr.message?.includes('unique') || (insertErr as any).code === '23505') {
      return NextResponse.json({
        error: 'A patient with this mobile number or Aadhaar already exists',
        is_duplicate: true,
      }, { status: 409 })
    }
    console.error('[register] Insert failed:', insertErr.message)
    return NextResponse.json({ error: 'Registration failed: ' + insertErr.message }, { status: 500 })
  }

  // Audit
  try {
    const auditMod = await import('@/lib/audit')
    await auditMod.audit('create', 'patient', newPatient.id, newPatient.fullname)
  } catch { /* non-fatal */ }

  return NextResponse.json({
    ok: true,
    id: newPatient.id,
    mrn: newPatient.mrn,
    full_name: newPatient.fullname,
    is_duplicate: false,
    message: 'Patient registered successfully.',
  }, { status: 201 })
}
