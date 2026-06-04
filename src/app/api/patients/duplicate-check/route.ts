/**
 * src/app/api/patients/duplicate-check/route.ts
 *
 * Real-time duplicate patient detection.
 * Called during patient registration when mobile or Aadhaar is entered.
 *
 * FIX: Returning patient auto-detection.
 * When a patient arrives who was registered last month, this endpoint
 * detects them and returns their existing record, preventing duplicates.
 *
 * SCHEMA FIX (2026-06-03):
 *   Was using v00-schema-master column names (fullname, patientid,
 *   chiefcomplaint, isactive, createdat, updatedat) but the live DB
 *   uses snake_case (full_name, patient_id, chief_complaint, is_active,
 *   created_at, updated_at). Updated all column references.
 *
 * Usage from frontend (patient registration form):
 *   // On mobile field blur/change
 *   const res = await fetch('/api/patients/duplicate-check?mobile=9876543210', {
 *     headers: { Authorization: `Bearer ${session.access_token}` }
 *   })
 *   const { found, patients } = await res.json()
 *   if (found) {
 *     // Show modal: "Patient found - Last visit: Jan 15, 2026. Use existing record?"
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { computeAadhaarHmac, isAadhaarHmacConfigured } from '@/lib/phi-crypto'

export const dynamic = 'force-dynamic'

/**
 * 2026-06-04 audit fixes (§2.1, §2.5):
 *   - Aadhaar duplicate detection now uses `aadhaar_hmac` (deterministic
 *     HMAC over the digits) instead of `aadhaar_no`. The plaintext column
 *     is null on every encrypted patient, so the old check could never fire.
 *   - The `name` parameter is now PostgREST-quoted before being injected
 *     into a `.or()` filter string. Crafted names containing commas /
 *     parens / `.eq.` operators were able to extend the filter beyond
 *     the developer's intent (e.g. `Foo,is_active.eq.false` would have
 *     bypassed the is_active filter). We now wrap the value in double
 *     quotes and escape internal quotes per PostgREST quoting rules.
 *   - All comparisons use `.eq()` (exact) for mobile/Aadhaar and a
 *     properly-quoted `.ilike` for fuzzy name. No more raw concatenation
 *     into `.or(...)`.
 */

/** Quote a value safely for use inside a PostgREST .or() filter string. */
function quoteOrValue(v: string): string {
  // PostgREST escapes embedded double quotes by doubling them.
  // Wrapping in double quotes also lets the value contain `,` `.` `(` `)` safely.
  return `"${String(v).replace(/"/g, '""')}"`
}

export async function GET(req: NextRequest) {
  // ── Authentication ────────────────────────────────────────
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  // ── Parse parameters ──────────────────────────────────────
  const { searchParams } = req.nextUrl
  const mobile = (searchParams.get('mobile') || '').replace(/\D/g, '')
  const aadhaar = (searchParams.get('aadhaar') || '').replace(/\D/g, '')
  const fullname = (searchParams.get('name') || '').trim()

  if (!mobile && !aadhaar && !fullname) {
    return NextResponse.json({ found: false, patients: [] })
  }

  const supabase = getSupabaseAdmin()

  // ── Check for duplicates ──────────────────────────────────
  // FIX (2026-06-04 §2.1): Aadhaar lookup now uses the deterministic
  // HMAC column instead of the (always-null on encrypted patients)
  // aadhaar_no plaintext column.
  // FIX (2026-06-04 §2.5): name input is no longer concatenated into
  // a .or() filter string; we run a separate, properly-parameterised
  // ilike query instead.

  // Compute Aadhaar HMAC server-side. Returns null if HMAC key is
  // unconfigured — in that case we just skip the Aadhaar comparison
  // (the front-end shows "encryption not configured" via /api/phi).
  let aadhaarHmac: string | null = null
  if (aadhaar && aadhaar.length === 12 && isAadhaarHmacConfigured()) {
    try { aadhaarHmac = computeAadhaarHmac(aadhaar) } catch { aadhaarHmac = null }
  }

  // Strict-identifier matches via .or() with safely-quoted values.
  // Note: only stable identifiers go here; we never inject the raw
  // user-supplied name into a .or() string.
  const strictConditions: string[] = []
  if (mobile && mobile.length >= 10) {
    strictConditions.push(`mobile.eq.${quoteOrValue(mobile)}`)
  }
  if (aadhaarHmac) {
    strictConditions.push(`aadhaar_hmac.eq.${quoteOrValue(aadhaarHmac)}`)
  }

  let matches: any[] = []

  if (strictConditions.length > 0) {
    const { data: strict, error: strictErr } = await supabase
      .from('patients')
      .select('id, mrn, full_name, mobile, date_of_birth, age, gender, city, created_at, updated_at')
      .or(strictConditions.join(','))
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(5)

    if (strictErr) {
      console.error('[patients/duplicate-check] strict match error:', strictErr.message)
      return NextResponse.json({ found: false, patients: [], error: 'Check failed' })
    }
    matches = strict || []
  }

  // FUZZY name match — only when no strict identifiers provided AND
  // a usable name (>=3 chars) was given. Uses parameterised .ilike(),
  // not a .or() string.
  if (matches.length === 0 && strictConditions.length === 0 && fullname.length >= 3) {
    const { data: nameMatches, error: nameErr } = await supabase
      .from('patients')
      .select('id, mrn, full_name, mobile, date_of_birth, age, gender, city, created_at, updated_at')
      .ilike('full_name', `%${fullname}%`)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(5)

    if (nameErr) {
      console.error('[patients/duplicate-check] name match error:', nameErr.message)
      return NextResponse.json({ found: false, patients: [], error: 'Check failed' })
    }
    matches = nameMatches || []
  }

  if (!matches || matches.length === 0) {
    return NextResponse.json({ found: false, patients: [] })
  }

  // ── Get last encounter for each match ─────────────────────
  // FIX: Column is 'patient_id' (not 'patientid'), 'encounter_date'
  // (not 'date'), 'encounter_type' (not 'type'), 'chief_complaint'
  // (not 'chiefcomplaint') in live DB
  const enrichedMatches = await Promise.all(
    matches.map(async (patient) => {
      const { data: lastEncounter } = await supabase
        .from('encounters')
        .select('encounter_date, encounter_type, chief_complaint')
        .eq('patient_id', patient.id)
        .order('encounter_date', { ascending: false })
        .limit(1)
        .maybeSingle()

      return {
        ...patient,
        last_visit: lastEncounter?.encounter_date || null,
        last_visit_type: lastEncounter?.encounter_type || null,
        last_complaint: lastEncounter?.chief_complaint || null,
      }
    })
  )

  return NextResponse.json({
    found: true,
    patients: enrichedMatches,
    message: `Found ${enrichedMatches.length} existing patient(s) matching this information.`,
  })
}