/**
 * src/app/api/patients/lookup/route.ts
 *
 * Returning Patient Auto-Detection
 *
 * When staff starts registration, this endpoint checks if the patient
 * already exists (by mobile, MRN, or name match) and returns their
 * profile + recent encounter history so staff can skip re-registration.
 *
 * GET /api/patients/lookup?mobile=9876543210
 * GET /api/patients/lookup?mrn=P-042
 * GET /api/patients/lookup?name=Priya+Sharma
 *
 * Returns: { found: boolean, patient?: {...}, recentEncounters?: [...] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Auth check
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  const { searchParams } = req.nextUrl
  const mobile = searchParams.get('mobile')?.trim()
  const mrn = searchParams.get('mrn')?.trim()
  const name = searchParams.get('name')?.trim()

  if (!mobile && !mrn && !name) {
    return NextResponse.json(
      { error: 'Provide at least one of: mobile, mrn, or name' },
      { status: 400 }
    )
  }

  const supabase = getSupabaseAdmin()

  try {
    let patient: any = null

    // Priority 1: Search by mobile (most reliable for returning patients)
    if (mobile && !patient) {
      const cleaned = mobile.replace(/[\s\-+]/g, '').slice(-10) // last 10 digits
      const { data } = await supabase
        .from('patients')
        .select('*')
        .or(`mobile.eq.${cleaned},mobile.eq.+91${cleaned},mobile.ilike.%${cleaned}%`)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
      if (data) patient = data
    }

    // Priority 2: Search by MRN (exact match)
    if (mrn && !patient) {
      const { data } = await supabase
        .from('patients')
        .select('*')
        .eq('mrn', mrn)
        .eq('is_active', true)
        .maybeSingle()
      if (data) patient = data
    }

    // Priority 3: Search by name (fuzzy — less reliable)
    if (name && !patient) {
      const { data } = await supabase
        .from('patients')
        .select('*')
        .ilike('full_name', `%${name}%`)
        .eq('is_active', true)
        .limit(5)

      // If exactly 1 match with high confidence, use it
      if (data && data.length === 1) {
        patient = data[0]
      } else if (data && data.length > 1) {
        // Return candidates for staff to choose
        return NextResponse.json({
          found: false,
          candidates: data.map(p => ({
            id: p.id,
            full_name: p.full_name,
            mrn: p.mrn,
            mobile: p.mobile,
            gender: p.gender,
            age: p.age,
          })),
          message: 'Multiple patients found. Please select the correct one.',
        })
      }
    }

    if (!patient) {
      return NextResponse.json({ found: false, message: 'No existing patient found.' })
    }

    // Fetch recent encounters for the returning patient
    const { data: encounters } = await supabase
      .from('encounters')
      .select('id, encounter_date, encounter_type, diagnosis, chief_complaint, doctor_name')
      .eq('patient_id', patient.id)
      .order('encounter_date', { ascending: false })
      .limit(5)

    // Fetch last prescription
    const { data: lastRx } = await supabase
      .from('prescriptions')
      .select('id, medications, follow_up_date, created_at')
      .eq('patient_id', patient.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Fetch pending bills
    const { data: pendingBills } = await supabase
      .from('bills')
      .select('id, total, due, status, created_at')
      .eq('patient_id', patient.id)
      .in('status', ['unpaid', 'partial'])
      .order('created_at', { ascending: false })
      .limit(3)

    return NextResponse.json({
      found: true,
      patient: {
        id: patient.id,
        full_name: patient.full_name,
        mrn: patient.mrn,
        mobile: patient.mobile,
        gender: patient.gender,
        age: patient.age,
        date_of_birth: patient.date_of_birth,
        blood_group: patient.blood_group,
        address: patient.address,
        abha_id: patient.abha_id,
        last_visit: encounters?.[0]?.encounter_date || null,
      },
      recentEncounters: encounters || [],
      lastPrescription: lastRx || null,
      pendingBills: pendingBills || [],
      message: `Returning patient found: ${patient.full_name} (${patient.mrn})`,
    })
  } catch (err: any) {
    console.error('[patient-lookup] Error:', err)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }
}
