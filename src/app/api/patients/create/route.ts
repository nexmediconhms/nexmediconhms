/**
 * src/app/api/patients/create/route.ts
 *
 * Server-side patient registration with PHI encryption + race-free MRN.
 *
 * 2026-06-04 audit fix (§1.1, §2.1, §2.2, §2.4): the patient registration
 * page used to insert directly into `patients` from the BROWSER using the
 * anon-key Supabase client. That meant:
 *   - Aadhaar was stored in plaintext (`encryptPatientPHI` is server-only)
 *   - MRN was assigned by an out-of-repo DB trigger (or returned NULL)
 *   - Duplicate Aadhaar detection did not work (queried `aadhaar_no`,
 *     which is null on encrypted records)
 *   - Validation (age range, future DOB, gender enum) was bypassable by
 *     calling the Supabase REST API directly
 *
 * This route fixes all four. The page now POSTs the form here; the
 * server validates → encrypts Aadhaar → computes HMAC dedup key →
 * allocates an MRN via the `next_mrn` RPC → inserts. The browser never
 * sees or supplies an MRN, never handles encryption, and never sees
 * the dedup hash.
 *
 * ENDPOINT
 *   POST /api/patients/create
 *
 * REQUEST  (application/json)
 *   {
 *     full_name:        string,            // REQUIRED, trimmed
 *     mobile:           string,            // REQUIRED, 10 digits (after strip)
 *     date_of_birth?:   string,            // YYYY-MM-DD, must be past
 *     age?:             string | number,   // 0..150 (auto if dob given)
 *     gender?:          'Male' | 'Female' | 'Other',
 *     blood_group?:     string,
 *     address?:         string,
 *     abha_id?:         string,            // 14 digits
 *     aadhaar_no?:      string,            // 12 digits, will be encrypted
 *     emergency_contact_name?:  string,
 *     emergency_contact_phone?: string,
 *     mediclaim?:       'Yes' | 'No',
 *     cashless?:        'Yes' | 'No',
 *     reference_source?: string,
 *     reference_detail?: string,
 *     policy_tpa_name?: string,
 *     policy_number?:   string
 *   }
 *
 * RESPONSE  (200 OK)
 *   { success: true, patient: { id, mrn, full_name, mobile, aadhaar_last4 } }
 *
 * ERRORS
 *   400 — validation failed (returns { error: string, fieldErrors: {…} })
 *   409 — duplicate (mobile or aadhaar_hmac collision)
 *   503 — encryption not configured
 *   500 — unexpected
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  encryptPHI,
  buildEncryptedAadhaarFields,
  isEncryptionConfigured,
  isAadhaarHmacConfigured,
  PHIEncryptionError,
} from '@/lib/phi-crypto'
import {
  validateRequired,
  validateMobile,
  validateAadhaar,
  validateABHA,
  validateAge,
  validatePastDate,
} from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Allowed values
const GENDERS = new Set(['Male', 'Female', 'Other'])
const YES_NO  = new Set(['Yes', 'No'])

interface FieldErrors { [k: string]: string }

function digits(s: string | undefined | null): string {
  return String(s ?? '').replace(/\D/g, '')
}

function trimOrNull(s: string | undefined | null): string | null {
  if (s === undefined || s === null) return null
  const t = String(s).trim()
  return t.length === 0 ? null : t
}

export async function POST(req: NextRequest) {
  // 1) Auth — any active clinic user can register a patient
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  // 2) Parse body
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // 3) Validation — using the centralised validators (§2.3)
  const fieldErrors: FieldErrors = {}
  {
    const e = validateRequired(body.full_name, 'Patient name')
    if (e) fieldErrors.full_name = e
  }
  {
    const e = validateMobile(body.mobile || '', /*required*/ true)
    if (e) fieldErrors.mobile = e
  }
  if (body.aadhaar_no) {
    const e = validateAadhaar(body.aadhaar_no)
    if (e) fieldErrors.aadhaar_no = e
  }
  if (body.abha_id) {
    const e = validateABHA(body.abha_id)
    if (e) fieldErrors.abha_id = e
  }
  if (body.age !== undefined && body.age !== null && body.age !== '') {
    const e = validateAge(body.age)
    if (e) fieldErrors.age = e
  }
  if (body.date_of_birth) {
    const e = validatePastDate(body.date_of_birth, 'Date of birth')
    if (e) fieldErrors.date_of_birth = e
  }
  if (body.gender && !GENDERS.has(body.gender)) {
    fieldErrors.gender = 'Gender must be Male, Female, or Other'
  }
  if (body.mediclaim && !YES_NO.has(body.mediclaim)) {
    fieldErrors.mediclaim = 'mediclaim must be Yes or No'
  }
  if (body.cashless && !YES_NO.has(body.cashless)) {
    fieldErrors.cashless = 'cashless must be Yes or No'
  }
  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ error: 'Validation failed', fieldErrors }, { status: 400 })
  }

  // 4) Encryption preflight (§1.1) — refuse to register when encryption
  //    is unconfigured AND the user supplied an Aadhaar. Mobile encryption
  //    is best-effort; Aadhaar is mandatory if provided.
  const aadhaarDigits = digits(body.aadhaar_no).slice(0, 12)
  if (aadhaarDigits.length > 0 && !isEncryptionConfigured()) {
    return NextResponse.json(
      { error: 'Encryption not configured. Set HOSPITAL_ENCRYPTION_KEY before storing Aadhaar.' },
      { status: 503 },
    )
  }
  if (aadhaarDigits.length > 0 && !isAadhaarHmacConfigured()) {
    return NextResponse.json(
      {
        error: 'Aadhaar duplicate-detection key not configured. Set HOSPITAL_AADHAAR_HMAC_KEY ' +
               'before storing Aadhaar.',
      },
      { status: 503 },
    )
  }

  const sb = getSupabaseAdmin()

  // 5) Build the row — encrypt Aadhaar, compute HMAC, encrypt mobile copy.
  const mobileDigits = digits(body.mobile).slice(-10)
  let encrypted: ReturnType<typeof buildEncryptedAadhaarFields> = null
  try {
    encrypted = buildEncryptedAadhaarFields(aadhaarDigits || null)
  } catch (e: any) {
    if (e instanceof PHIEncryptionError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 503 })
    }
    throw e
  }

  // Mobile is kept plaintext in `mobile` for OTP routing; encrypted in
  // `mobile_encrypted` as defence-in-depth. encryptPHI throws on bad key.
  let mobileEncrypted: string | null = null
  if (mobileDigits.length === 10) {
    try {
      mobileEncrypted = encryptPHI(mobileDigits)
    } catch (err) {
      if (err instanceof PHIEncryptionError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 503 })
      }
      // Truly unexpected: don't block — log and proceed without encrypted copy.
      console.error('[patients/create] mobile encrypt non-config error', err)
      mobileEncrypted = null
    }
  }

  // 6) Allocate MRN via the race-free DB function (§2.4)
  let mrn: string | null = null
  try {
    const { data: mrnRow, error: mrnErr } = await sb.rpc('next_mrn')
    if (!mrnErr && mrnRow) mrn = String(mrnRow)
  } catch (e: any) {
    console.warn('[patients/create] next_mrn RPC unavailable; falling back to in-route counter:', e?.message)
  }

  // Fallback: synchronous max+1 (better than NULL; rare path — only when
  // the DB function isn't deployed yet). Wrapped in retry-on-conflict
  // since two concurrent fallbacks could collide.
  if (!mrn) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: maxRow } = await sb
        .from('patients')
        .select('mrn')
        .like('mrn', 'P-%')
        .order('mrn', { ascending: false })
        .limit(1)
        .maybeSingle()
      const lastNum = maxRow?.mrn ? parseInt(String(maxRow.mrn).replace(/\D/g, ''), 10) : 0
      const candidate = `P-${String((isNaN(lastNum) ? 0 : lastNum) + 1 + attempt).padStart(4, '0')}`
      // Probe — if the candidate is taken, increment and retry
      const { data: probe } = await sb
        .from('patients').select('id').eq('mrn', candidate).maybeSingle()
      if (!probe) { mrn = candidate; break }
    }
    if (!mrn) {
      mrn = `P-${Date.now().toString(36).toUpperCase().slice(-6)}`
    }
  }

  // 7) Compose the insert payload
  const reference =
    body.reference_source && String(body.reference_source).trim().length > 0
      ? (trimOrNull(body.reference_detail)
          ? `${String(body.reference_source).trim()} — ${trimOrNull(body.reference_detail)}`
          : String(body.reference_source).trim())
      : null

  const ageNum = body.age !== undefined && body.age !== null && body.age !== ''
    ? Number(String(body.age).replace(/\D/g, ''))
    : null

  const payload: Record<string, any> = {
    mrn,
    full_name: String(body.full_name).trim(),
    age: Number.isFinite(ageNum as number) && (ageNum as number) >= 0 && (ageNum as number) <= 150 ? ageNum : null,
    date_of_birth: trimOrNull(body.date_of_birth),
    gender: body.gender || null,
    mobile: mobileDigits.length === 10 ? mobileDigits : null,
    mobile_encrypted: mobileEncrypted,
    blood_group: trimOrNull(body.blood_group),
    address: trimOrNull(body.address),
    abha_id: trimOrNull(body.abha_id),
    emergency_contact_name: trimOrNull(body.emergency_contact_name),
    emergency_contact_phone: digits(body.emergency_contact_phone).slice(-10) || null,
    mediclaim: body.mediclaim === 'Yes' ? 'Yes' : 'No',
    cashless:  body.cashless  === 'Yes' ? 'Yes' : 'No',
    reference_source: reference,
    policy_tpa_name: trimOrNull(body.policy_tpa_name),
    policy_number:   trimOrNull(body.policy_number),
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  if (encrypted) {
    payload.aadhaar_encrypted = encrypted.aadhaar_encrypted
    payload.aadhaar_last4     = encrypted.aadhaar_last4
    payload.aadhaar_hmac      = encrypted.aadhaar_hmac
    payload.aadhaar_no        = null
  }

  // 8) Insert. Unique indexes (mobile, mrn, aadhaar_hmac) catch races
  //    that slipped past the front-end duplicate check.
  const { data: inserted, error: insertErr } = await sb
    .from('patients')
    .insert(payload)
    .select('id, mrn, full_name, mobile, aadhaar_last4')
    .single()

  if (insertErr) {
    // 23505 = unique_violation
    if (insertErr.code === '23505') {
      const msg = insertErr.message || ''
      let field: string | null = null
      if (msg.includes('mobile')) field = 'mobile'
      else if (msg.includes('mrn')) field = 'mrn'
      else if (msg.includes('aadhaar_hmac')) field = 'aadhaar_no'
      return NextResponse.json(
        {
          error: 'A patient with these details already exists',
          duplicate_field: field,
          fieldErrors: field
            ? { [field]: 'A patient with this value already exists' }
            : { mobile: 'Duplicate patient' },
        },
        { status: 409 },
      )
    }
    console.error('[patients/create] insert error:', insertErr.message)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  // 9) Audit (non-blocking but awaited so a failed audit is logged)
  try {
    await sb.rpc('insert_audit_entry', {
      p_user_id:      auth.clinicUserId,
      p_user_email:   auth.email,
      p_user_role:    auth.role,
      p_action:       'create',
      p_entity_type:  'patient',
      p_entity_id:    inserted!.id,
      p_entity_label: `${inserted!.full_name} (${inserted!.mrn})`,
      p_changes:      JSON.stringify({
        after: {
          full_name: inserted!.full_name,
          mrn: inserted!.mrn,
          mobile: inserted!.mobile,
          aadhaar_last4: inserted!.aadhaar_last4,
        },
      }),
    })
  } catch (e: any) {
    console.warn('[patients/create] audit insert failed (non-fatal):', e?.message)
  }

  return NextResponse.json({
    success: true,
    patient: inserted,
  })
}
