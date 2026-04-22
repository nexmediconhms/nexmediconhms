/**
 * FHIR R4 Patient Record Export API
 * 
 * GET /api/fhir/patient/[id]
 * 
 * Returns a FHIR R4 Bundle containing:
 * - Patient resource
 * - Encounter resources
 * - Observation resources (vitals)
 * - Condition resources (diagnoses)
 * - MedicationRequest resources (prescriptions)
 * 
 * Query params:
 *   ?format=json (default) | xml (not yet supported)
 *   ?_summary=true (returns only Patient resource)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  toFHIRPatient,
  toFHIREncounter,
  toFHIRVitalObservations,
  toFHIRCondition,
  toFHIRMedicationRequests,
  toFHIRBundle,
  buildPatientFHIRBundle,
} from '@/lib/fhir'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const patientId = params.id
    const summary   = req.nextUrl.searchParams.get('_summary') === 'true'

    // Fetch patient
    const { data: patient, error: patErr } = await supabase
      .from('patients')
      .select('*')
      .eq('id', patientId)
      .single()

    if (patErr || !patient) {
      return NextResponse.json(
        {
          resourceType: 'OperationOutcome',
          issue: [{
            severity: 'error',
            code: 'not-found',
            diagnostics: `Patient ${patientId} not found`,
          }],
        },
        { status: 404, headers: { 'Content-Type': 'application/fhir+json' } }
      )
    }

    // Summary mode — return just the Patient resource
    if (summary) {
      const fhirPatient = toFHIRPatient(patient)
      return NextResponse.json(fhirPatient, {
        headers: { 'Content-Type': 'application/fhir+json' },
      })
    }

    // Full mode — fetch encounters and prescriptions
    const [{ data: encounters }, { data: prescriptions }] = await Promise.all([
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

    const bundle = buildPatientFHIRBundle(
      patient,
      encounters || [],
      prescriptions || [],
    )

    return NextResponse.json(bundle, {
      headers: {
        'Content-Type': 'application/fhir+json',
        'X-FHIR-Version': 'R4',
      },
    })
  } catch (err: any) {
    return NextResponse.json(
      {
        resourceType: 'OperationOutcome',
        issue: [{
          severity: 'error',
          code: 'exception',
          diagnostics: err.message,
        }],
      },
      { status: 500, headers: { 'Content-Type': 'application/fhir+json' } }
    )
  }
}
