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

export const dynamic = 'force-dynamic'

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
  const conditions: string[] = []

  if (mobile && mobile.length >= 10) {
    conditions.push(`mobile.eq.${mobile}`)
  }
  if (aadhaar && aadhaar.length >= 12) {
    conditions.push(`aadhaar.eq.${aadhaar}`)
  }

  if (conditions.length === 0 && fullname) {
    // Fuzzy name match only if no exact identifiers provided
    conditions.push(`fullname.ilike.%${fullname}%`)
  }

  if (conditions.length === 0) {
    return NextResponse.json({ found: false, patients: [] })
  }

  const { data: matches, error } = await supabase
    .from('patients')
    .select('id, mrn, fullname, mobile, dob, age, gender, city, createdat, updatedat')
    .or(conditions.join(','))
    .eq('isactive', true)
    .order('updatedat', { ascending: false })
    .limit(5)

  if (error) {
    console.error('[patients/duplicate-check] Error:', error.message)
    return NextResponse.json({ found: false, patients: [], error: 'Check failed' })
  }

  if (!matches || matches.length === 0) {
    return NextResponse.json({ found: false, patients: [] })
  }

  // ── Get last encounter for each match ─────────────────────
  const enrichedMatches = await Promise.all(
    matches.map(async (patient) => {
      const { data: lastEncounter } = await supabase
        .from('encounters')
        .select('date, type, chiefcomplaint')
        .eq('patientid', patient.id)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()

      return {
        ...patient,
        last_visit: lastEncounter?.date || null,
        last_visit_type: lastEncounter?.type || null,
        last_complaint: lastEncounter?.chiefcomplaint || null,
      }
    })
  )

  return NextResponse.json({
    found: true,
    patients: enrichedMatches,
    message: `Found ${enrichedMatches.length} existing patient(s) matching this information.`,
  })
}