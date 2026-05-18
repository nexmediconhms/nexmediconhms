/**
 * src/app/api/fhir/patient/[id]/route.ts
 *
 * FHIR R4 Patient Record Export API
 *
 * GET /api/fhir/patient/[id]
 *
 * Returns a FHIR R4 Bundle containing:
 *   - Patient resource
 *   - Encounter resources
 *   - Observation resources (vitals)
 *   - Condition resources (diagnoses)
 *   - MedicationRequest resources (prescriptions)
 *
 * Query params:
 *   ?_summary=true  → returns only the Patient resource
 *
 * SECURITY (this revision):
 *   1. Requires a valid Bearer token from a clinician
 *      (admin / doctor / receptionist / staff). The previous version
 *      was UNAUTHENTICATED and would dump full PHI for any patient ID
 *      to the public internet — a critical PHI exfiltration hole.
 *   2. Uses the service-role Supabase client server-side only — never
 *      exposed to the browser.
 *   3. Validates the [id] path param as a UUID v4-style string before
 *      hitting the database. Rejects anything else with 400.
 *   4. Internal errors are logged on the server with class+message
 *      only (no PHI leakage), and the client receives a generic
 *      OperationOutcome 500 with no DB internals.
 *   5. `Cache-Control: private, no-store` so PHI is never cached by
 *      proxies, browsers, or CDN edges.
 *
 * NOTE ON UI:
 *   Callers must now send `Authorization: Bearer <supabase-access-token>`.
 *   The patient detail page (FHIR Export button) has been updated in
 *   the same change to attach the token before calling this route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole }                from '@/lib/api-auth'
import { getSupabaseAdmin }           from '@/lib/supabase-admin'
import {
  toFHIRPatient,
  buildPatientFHIRBundle,
} from '@/lib/fhir'

export const runtime  = 'nodejs'
export const dynamic  = 'force-dynamic'

// FHIR uses application/fhir+json as the content type
const FHIR_HEADERS_OK = {
  'Content-Type':  'application/fhir+json',
  'X-FHIR-Version': 'R4',
  'Cache-Control': 'private, no-store, max-age=0',
} as const

const FHIR_HEADERS_ERR = {
  'Content-Type':  'application/fhir+json',
  'Cache-Control': 'private, no-store, max-age=0',
} as const

// Standard UUID regex — FHIR resource IDs in our schema are UUIDs.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Build a FHIR OperationOutcome envelope for any failure response so
// that downstream FHIR clients still receive a parseable resource.
function operationOutcome(
  severity: 'error' | 'warning' | 'information',
  code:     string,
  diagnostics: string,
) {
  return {
    resourceType: 'OperationOutcome',
    issue: [{ severity, code, diagnostics }],
  }
}

// PHI-safe error logger — never logs the raw exception's `value`
// payload (some Supabase errors contain row data in .details).
function logFhirError(scope: string, err: unknown) {
  const klass = (err as any)?.constructor?.name || 'Error'
  const msg   = (err as any)?.message            || String(err)
  console.error(`[fhir.patient] ${scope}: ${klass} ${msg}`)
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // ─── 1. Authentication & authorization ─────────────────────────
  const auth = await requireRole(req, ['admin', 'doctor', 'receptionist', 'staff'])
  if (auth instanceof Response) return auth

  // ─── 2. Validate path param as UUID ────────────────────────────
  const patientId = (params?.id ?? '').trim()
  if (!UUID_RE.test(patientId)) {
    return NextResponse.json(
      operationOutcome('error', 'invalid', 'Invalid patient identifier format.'),
      { status: 400, headers: FHIR_HEADERS_ERR }
    )
  }

  const summary = req.nextUrl.searchParams.get('_summary') === 'true'

  try {
    const supabase = getSupabaseAdmin()

    // ─── 3. Fetch patient ──────────────────────────────────────
    const { data: patient, error: patErr } = await supabase
      .from('patients')
      .select('*')
      .eq('id', patientId)
      .single()

    if (patErr || !patient) {
      // Don't echo the raw Supabase error — could leak schema info
      if (patErr && patErr.code !== 'PGRST116') {
        logFhirError('patients.select', patErr)
      }
      return NextResponse.json(
        operationOutcome('error', 'not-found', `Patient ${patientId} not found.`),
        { status: 404, headers: FHIR_HEADERS_ERR }
      )
    }

    // ─── 4. Summary mode — Patient resource only ───────────────
    if (summary) {
      const fhirPatient = toFHIRPatient(patient)
      return NextResponse.json(fhirPatient, { headers: FHIR_HEADERS_OK })
    }

    // ─── 5. Full bundle: encounters + prescriptions ────────────
    const [encountersRes, prescriptionsRes] = await Promise.all([
      supabase
        .from('encounters')
        .select('*')
        .eq('patient_id', patientId)
        .order('encounter_date', { ascending: false }),
      supabase
        .from('prescriptions')
        .select('*')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false }),
    ])

    // Soft-fail on related fetches: log but still emit the bundle
    // with whatever did load. A FHIR consumer can still process the
    // Patient + whichever sub-resources came back.
    if (encountersRes.error)    logFhirError('encounters.select',    encountersRes.error)
    if (prescriptionsRes.error) logFhirError('prescriptions.select', prescriptionsRes.error)

    const bundle = buildPatientFHIRBundle(
      patient,
      encountersRes.data    || [],
      prescriptionsRes.data || [],
    )

    return NextResponse.json(bundle, { headers: FHIR_HEADERS_OK })
  } catch (err) {
    logFhirError('handler', err)
    return NextResponse.json(
      operationOutcome('error', 'exception', 'An internal error occurred while building the FHIR bundle.'),
      { status: 500, headers: FHIR_HEADERS_ERR }
    )
  }
}
