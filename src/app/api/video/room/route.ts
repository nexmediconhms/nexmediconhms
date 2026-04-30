/**
 * src/app/api/video/room/route.ts  — UPDATED
 *
 * CHANGE: Replaced the manual inline Bearer token check with requireAuth().
 * Everything else — crypto room ID generator, Jitsi link format, appointment
 * video_link update, GET by appointment_id — preserved exactly.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/api-auth'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!

function generateRoomId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function POST(req: NextRequest) {
  // ── Auth gate ────────────────────────────────────────────────
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth
  // ────────────────────────────────────────────────────────────

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const body = await req.json().catch(() => ({}))
  const { appointment_id, patient_name, doctor_name } = body

  const roomId   = generateRoomId()
  const roomName = `nexmedicon-${roomId}`

  // Jitsi deep-link (free, open-source, HIPAA-compatible with proper deployment)
  const jitsiBase   = 'https://meet.jit.si'
  const doctorLink  = `${jitsiBase}/${roomName}#config.prejoinPageEnabled=true&config.startWithVideoMuted=false`
  const patientLink = `${jitsiBase}/${roomName}`

  // If appointment_id provided, update the appointment record with the video link
  if (appointment_id) {
    await supabase
      .from('appointments')
      .update({ video_link: patientLink })
      .eq('id', appointment_id)
  }

  return NextResponse.json({
    room_id:      roomId,
    room_name:    roomName,
    doctor_link:  doctorLink,
    patient_link: patientLink,
  })
}

/**
 * GET /api/video/room?appointment_id=xxx
 * Returns the video link for an existing appointment
 */
export async function GET(req: NextRequest) {
  const supabase        = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { searchParams } = new URL(req.url)
  const appointmentId   = searchParams.get('appointment_id')

  if (!appointmentId) {
    return NextResponse.json({ error: 'appointment_id required' }, { status: 400 })
  }

  const { data } = await supabase
    .from('appointments')
    .select('id, video_link, patient_name, doctor_name, date, time, status')
    .eq('id', appointmentId)
    .single()

  if (!data) {
    return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
  }

  return NextResponse.json(data)
}