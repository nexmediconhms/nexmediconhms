/**
 * src/app/api/queue/auto-populate/route.ts
 *
 * Auto-populates OPD Queue from today's confirmed/scheduled appointments.
 * Called on page load of the Queue page, and can be called by cron.
 *
 * Logic:
 *  1. Get all appointments for today with status = scheduled/confirmed
 *  2. Check which ones are NOT already in opd_queue for today
 *  3. Insert them into opd_queue with auto-incremented token numbers
 *
 * This ensures patients appear in the queue without manual intervention.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

const IST = 'Asia/Kolkata'

function todayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: IST })
}

export async function POST(req: NextRequest) {
  try {
    const today = todayIST()

    // 1. Get today's scheduled/confirmed appointments
    const { data: todayAppts, error: apptErr } = await supabase
      .from('appointments')
      .select('id, patient_id, patient_name, mrn, time, type, notes, status')
      .eq('date', today)
      .in('status', ['scheduled', 'confirmed'])
      .order('time', { ascending: true })

    if (apptErr) {
      console.error('[queue/auto-populate] appointment fetch error:', apptErr)
      return NextResponse.json({ error: apptErr.message }, { status: 500 })
    }

    if (!todayAppts || todayAppts.length === 0) {
      return NextResponse.json({ added: 0, message: 'No appointments for today' })
    }

    // 2. Get existing queue entries for today (to avoid duplicates)
    const { data: existingQueue } = await supabase
      .from('opd_queue')
      .select('patient_id')
      .eq('queue_date', today)

    const existingPatientIds = new Set((existingQueue || []).map(q => q.patient_id))

    // 3. Filter out appointments already in queue
    const newEntries = todayAppts.filter(a => a.patient_id && !existingPatientIds.has(a.patient_id))

    if (newEntries.length === 0) {
      return NextResponse.json({ added: 0, message: 'All appointments already in queue' })
    }

    // 4. Get next token number
    const { data: maxToken } = await supabase
      .from('opd_queue')
      .select('token_number')
      .eq('queue_date', today)
      .order('token_number', { ascending: false })
      .limit(1)

    let nextToken = ((maxToken?.[0]?.token_number ?? 0) as number) + 1

    // 5. Insert new queue entries
    const insertRows = newEntries.map(a => ({
      patient_id: a.patient_id,
      queue_date: today,
      token_number: nextToken++,
      status: 'waiting',
      priority: 'normal',
      notes: `${a.type || 'Appointment'} at ${a.time || ''}`.trim(),
    }))

    const { data: inserted, error: insertErr } = await supabase
      .from('opd_queue')
      .insert(insertRows)
      .select()

    if (insertErr) {
      console.error('[queue/auto-populate] insert error:', insertErr)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    return NextResponse.json({
      added: inserted?.length || 0,
      message: `Added ${inserted?.length || 0} patients to queue from today's appointments`,
      entries: inserted,
    })
  } catch (err: any) {
    console.error('[queue/auto-populate] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Also support GET for easy testing / cron
export async function GET(req: NextRequest) {
  return POST(req)
}
