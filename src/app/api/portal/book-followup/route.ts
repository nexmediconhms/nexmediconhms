/**
 * src/app/api/portal/book-followup/route.ts
 *
 * Patient Portal — Book Follow-up Appointment
 *
 * POST { date, time, type, doctor_name, notes }
 * Header: X-Portal-Session: <session_token>
 *
 * Creates an appointment for the patient.
 * Also supports claiming open video slots.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function validatePortalSession(supabase: any, token: string) {
  if (!token) return null
  const { data } = await supabase
    .from('portal_sessions')
    .select('patient_id, mrn, mobile, expires_at, is_active')
    .eq('session_token', token)
    .eq('is_active', true)
    .single()
  if (!data || new Date(data.expires_at) < new Date()) return null
  return data
}

export async function POST(req: NextRequest) {
  try {
    const sessionToken = req.headers.get('x-portal-session') || ''
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    const session = await validatePortalSession(supabase, sessionToken)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { date, time, type, doctor_name, notes, slot_id } = await req.json()

    // Get patient info
    const { data: patient } = await supabase
      .from('patients')
      .select('id, full_name, mrn, mobile')
      .eq('id', session.patient_id)
      .single()

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    // If claiming an open slot
    if (slot_id) {
      const { error } = await supabase
        .from('appointments')
        .update({
          patient_id:   patient.id,
          patient_name: patient.full_name,
          mrn:          patient.mrn,
          mobile:       patient.mobile,
          status:       type === 'video' ? 'video' : 'confirmed',
          notes:        notes || null,
        })
        .eq('id', slot_id)
        .eq('status', 'open')  // optimistic lock

      if (error) {
        return NextResponse.json({ error: 'Slot is no longer available' }, { status: 409 })
      }

      return NextResponse.json({ success: true, message: 'Appointment booked successfully!' })
    }

    // Create new follow-up appointment
    if (!date || !time) {
      return NextResponse.json({ error: 'Date and time are required' }, { status: 400 })
    }

    // Validate date is in the future
    const apptDate = new Date(date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (apptDate < today) {
      return NextResponse.json({ error: 'Cannot book appointments in the past' }, { status: 400 })
    }

    // Check for duplicate booking on same date/time
    const { data: existing } = await supabase
      .from('appointments')
      .select('id')
      .eq('patient_id', patient.id)
      .eq('date', date)
      .eq('time', time)
      .not('status', 'eq', 'cancelled')
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json({ error: 'You already have an appointment at this time' }, { status: 409 })
    }

    // Insert appointment
    const { data: appt, error: insertErr } = await supabase
      .from('appointments')
      .insert({
        patient_id:   patient.id,
        patient_name: patient.full_name,
        mrn:          patient.mrn,
        mobile:       patient.mobile,
        date,
        time,
        type:         type || 'Follow-up',
        doctor_name:  doctor_name || null,
        notes:        notes || null,
        status:       'scheduled',
      })
      .select()
      .single()

    if (insertErr) {
      console.error('Appointment insert error:', insertErr)
      return NextResponse.json({ error: 'Failed to book appointment' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: 'Follow-up appointment booked successfully!',
      appointment: appt,
    })

  } catch (err: any) {
    console.error('Portal book-followup error:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}

/**
 * GET — Get available slots for booking
 * Header: X-Portal-Session: <session_token>
 */
export async function GET(req: NextRequest) {
  try {
    const sessionToken = req.headers.get('x-portal-session') || ''
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    const session = await validatePortalSession(supabase, sessionToken)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const today    = new Date().toISOString().split('T')[0]
    const nextWeek = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]

    // Get open video slots
    const { data: videoSlots } = await supabase
      .from('appointments')
      .select('id, date, time, doctor_name, type, notes')
      .eq('status', 'open')
      .gte('date', today)
      .lte('date', nextWeek)
      .order('date')
      .order('time')
      .limit(30)

    // Get doctors list for in-person booking
    const { data: doctors } = await supabase
      .from('clinic_users')
      .select('full_name, specialization')
      .eq('role', 'doctor')
      .eq('is_active', true)

    return NextResponse.json({
      video_slots: videoSlots || [],
      doctors:     doctors || [],
    })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
