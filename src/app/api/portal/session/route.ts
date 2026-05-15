/**
 * src/app/api/portal/session/route.ts
 *
 * Patient Portal — Validate Session & Get Patient Data
 *
 * GET with header: X-Portal-Session: <session_token>
 *
 * Returns patient info + all portal data (prescriptions, labs, bills, appointments)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getIndiaToday } from '@/lib/utils'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!

export interface PortalSessionData {
  patient: {
    id: string
    full_name: string
    mrn: string
    age: number
    gender: string
    mobile: string
    blood_group: string
  }
  prescriptions: any[]
  labReports: any[]
  bills: any[]
  appointments: any[]
}

/**
 * Validate a portal session token and return the patient_id if valid.
 */
async function validateSession(supabase: any, sessionToken: string) {
  if (!sessionToken) return null

  const { data: session, error } = await supabase
    .from('portal_sessions')
    .select('id, patient_id, mrn, mobile, expires_at, is_active')
    .eq('session_token', sessionToken)
    .eq('is_active', true)
    .single()

  if (error || !session) return null
  if (new Date(session.expires_at) < new Date()) {
    // Expire the session
    await supabase
      .from('portal_sessions')
      .update({ is_active: false })
      .eq('id', session.id)
    return null
  }

  // Update last_used
  await supabase
    .from('portal_sessions')
    .update({ last_used: new Date().toISOString() })
    .eq('id', session.id)

  return session
}

export async function GET(req: NextRequest) {
  try {
    const sessionToken = req.headers.get('x-portal-session') || ''

    if (!sessionToken) {
      return NextResponse.json({ error: 'No session token provided' }, { status: 401 })
    }

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    const session = await validateSession(supabase, sessionToken)
    if (!session) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 })
    }

    // Load patient data
    const { data: patient } = await supabase
      .from('patients')
      .select('id, full_name, mrn, age, gender, mobile, blood_group')
      .eq('id', session.patient_id)
      .single()

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    // Parallel load all portal data
    const [prescriptions, labReports, bills, appointments] = await Promise.all([
      supabase
        .from('prescriptions')
        .select('*, encounters(encounter_date, diagnosis, doctor_name)')
        .eq('patient_id', patient.id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('lab_reports')
        .select('*')
        .eq('patient_id', patient.id)
        .order('report_date', { ascending: false })
        .limit(20),
      supabase
        .from('bills')
        .select('*')
        .eq('patient_id', patient.id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('appointments')
        .select('*')
        .eq('patient_id', patient.id)
        .gte('date', getIndiaToday())
        .order('date', { ascending: true })
        .limit(20),
    ])

    return NextResponse.json({
      patient,
      prescriptions: prescriptions.data || [],
      labReports:    labReports.data || [],
      bills:         bills.data || [],
      appointments:  appointments.data || [],
    })

  } catch (err: any) {
    console.error('Portal session error:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}

/**
 * DELETE — Logout (invalidate session)
 */
export async function DELETE(req: NextRequest) {
  try {
    const sessionToken = req.headers.get('x-portal-session') || ''
    if (!sessionToken) {
      return NextResponse.json({ error: 'No session' }, { status: 401 })
    }

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    await supabase
      .from('portal_sessions')
      .update({ is_active: false })
      .eq('session_token', sessionToken)

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
