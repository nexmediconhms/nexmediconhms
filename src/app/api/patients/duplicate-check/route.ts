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
 * DUPLICATE CLASSIFICATION (2026-06-08):
 *   Returns match_type for each match:
 *     - 'hard_mobile'  → Same mobile number (hard block)
 *     - 'hard_aadhaar' → Same Aadhaar number (hard block)
 *     - 'soft_name'    → Same name + similar age (soft warning, override allowed)
 *   Frontend uses this to decide whether to show "Register Anyway" or hard-block.
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
  const ageParam = searchParams.get('age')
  const age = ageParam ? parseInt(ageParam) : null
  // Optional: exclude a specific patient ID (useful for edit page)
  const excludeId = searchParams.get('exclude_id') || ''

  if (!mobile && !aadhaar && !fullname) {
    return NextResponse.json({ found: false, patients: [] })
  }

  const supabase = getSupabaseAdmin()

  // ── Build match results with classification ────────────────
  interface MatchResult {
    id: string
    mrn: string
    full_name: string
    mobile: string
    age?: number
    gender?: string
    aadhaar_no?: string
    date_of_birth?: string
    city?: string
    created_at?: string
    updated_at?: string
    match_type: 'hard_mobile' | 'hard_aadhaar' | 'soft_name'
    match_reasons: string[]
    is_hard_match: boolean
    last_visit?: string | null
    last_visit_type?: string | null
    last_complaint?: string | null
  }

  const matchMap = new Map<string, MatchResult>()

  // 1. Mobile match — HARD BLOCK (mobile shouldn't be shared across registrations)
  if (mobile && mobile.length >= 10) {
    const { data, error } = await supabase
      .from('patients')
      .select('id, mrn, full_name, mobile, date_of_birth, age, gender, aadhaar_no, city, created_at, updated_at, is_active')
      .eq('mobile', mobile)
      .limit(5)

    if (error) {
      console.error('[patients/duplicate-check] mobile query error:', error.message)
    } else if (data) {
      for (const patient of data) {
        if (patient.is_active === false) continue // skip soft-deleted
        if (excludeId && patient.id === excludeId) continue
        matchMap.set(patient.id, {
          id: patient.id,
          mrn: patient.mrn,
          full_name: patient.full_name,
          mobile: patient.mobile,
          age: patient.age,
          gender: patient.gender,
          aadhaar_no: patient.aadhaar_no,
          date_of_birth: patient.date_of_birth,
          city: patient.city,
          created_at: patient.created_at,
          updated_at: patient.updated_at,
          match_type: 'hard_mobile',
          match_reasons: ['Same mobile number'],
          is_hard_match: true,
        })
      }
    }
  }

  // 2. Aadhaar match — HARD BLOCK (Aadhaar is unique nationally)
  if (aadhaar && aadhaar.length >= 12) {
    const { data, error } = await supabase
      .from('patients')
      .select('id, mrn, full_name, mobile, date_of_birth, age, gender, aadhaar_no, city, created_at, updated_at, is_active')
      .eq('aadhaar_no', aadhaar)
      .limit(5)

    if (error) {
      console.error('[patients/duplicate-check] aadhaar query error:', error.message)
    } else if (data) {
      for (const patient of data) {
        if (patient.is_active === false) continue
        if (excludeId && patient.id === excludeId) continue
        const existing = matchMap.get(patient.id)
        if (existing) {
          if (!existing.match_reasons.includes('Same Aadhaar number')) {
            existing.match_reasons.push('Same Aadhaar number')
          }
          existing.is_hard_match = true
          // Upgrade match_type if it was just mobile before
          if (existing.match_type === 'hard_mobile') {
            existing.match_type = 'hard_aadhaar' // both are hard, aadhaar takes priority in label
          }
        } else {
          matchMap.set(patient.id, {
            id: patient.id,
            mrn: patient.mrn,
            full_name: patient.full_name,
            mobile: patient.mobile,
            age: patient.age,
            gender: patient.gender,
            aadhaar_no: patient.aadhaar_no,
            date_of_birth: patient.date_of_birth,
            city: patient.city,
            created_at: patient.created_at,
            updated_at: patient.updated_at,
            match_type: 'hard_aadhaar',
            match_reasons: ['Same Aadhaar number'],
            is_hard_match: true,
          })
        }
      }
    }
  }

  // 3. Name + similar age — SOFT WARNING (override available)
  //    Same name, different mobile, similar age → could be same-name-different-person
  if (fullname && fullname.length >= 3) {
    // Escape ILIKE wildcards
    const safeName = fullname.replace(/%/g, '\\%').replace(/_/g, '\\_')
    const { data, error } = await supabase
      .from('patients')
      .select('id, mrn, full_name, mobile, date_of_birth, age, gender, aadhaar_no, city, created_at, updated_at, is_active')
      .ilike('full_name', `%${safeName}%`)
      .limit(10)

    if (error) {
      console.error('[patients/duplicate-check] name query error:', error.message)
    } else if (data) {
      for (const patient of data) {
        if (patient.is_active === false) continue
        if (excludeId && patient.id === excludeId) continue
        const existing = matchMap.get(patient.id)
        if (existing) {
          // Already matched by mobile/aadhaar — add name as additional reason
          if (!existing.match_reasons.includes('Same name')) {
            existing.match_reasons.push('Same name')
          }
          // Keep it as hard match since mobile/aadhaar already flagged it
        } else {
          // FIX: Always flag same-name matches as soft warning.
          // Previously required age proximity which missed cases where
          // no age was entered. Now same name alone triggers the warning.
          const patientAge = patient.age
          const ageClose = age !== null && patientAge !== null && patientAge !== undefined
            ? Math.abs(age - patientAge) <= 2
            : false

          const reasons = ['Same name']
          if (ageClose) reasons.push('Similar age')
          matchMap.set(patient.id, {
            id: patient.id,
            mrn: patient.mrn,
            full_name: patient.full_name,
            mobile: patient.mobile,
            age: patient.age,
            gender: patient.gender,
            aadhaar_no: patient.aadhaar_no,
            date_of_birth: patient.date_of_birth,
            city: patient.city,
            created_at: patient.created_at,
            updated_at: patient.updated_at,
            match_type: 'soft_name',
            match_reasons: reasons,
            is_hard_match: false, // SOFT — override allowed
          })
        }
      }
    }
  }

  const matches = Array.from(matchMap.values())

  if (matches.length === 0) {
    return NextResponse.json({ found: false, patients: [] })
  }

  // ── Get last encounter for each match ─────────────────────
  const enrichedMatches = await Promise.all(
    matches.map(async (patient) => {
      try {
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
      } catch {
        return patient
      }
    })
  )

  return NextResponse.json({
    found: true,
    patients: enrichedMatches,
    has_hard_match: matches.some(m => m.is_hard_match),
    has_soft_match: matches.some(m => !m.is_hard_match),
    message: `Found ${enrichedMatches.length} existing patient(s) matching this information.`,
  })
}
