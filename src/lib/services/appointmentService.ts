import { supabase } from '@/lib/supabase'
import { getIndiaToday } from '../utils'
import notify from '@/lib/notifications'

type CreateAppointmentParams = {
  patientId: string
  date: string
  time: string
  patientName: string
  mrn?: string
  mobile?: string
  notes?: string | null
  type?: string
}

type CreateFollowUpMeta = {
  patientName?: string
  mrn?: string
  mobile?: string | null
  encounterDateLabel?: string
  // Gap 6: optional follow-up appointment time in HH:mm. Defaults to '10:00'.
  followUpTime?: string
}

function nowISO() {
  return new Date().toISOString()
}

/**
 * Cancels only FOLLOW-UP related active appointments.
 * DOES NOT cancel manual visits.
 */
export async function cancelActiveAppointment(patientId: string) {
  const { error } = await supabase
    .from('appointments')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString()
    })
    .eq('patient_id', patientId)
    .in('status', ['scheduled', 'confirmed'])
    .eq('type', 'follow_up') // ✅ IMPORTANT FIX

  if (error) throw error
}


/**
 * Create a MANUAL appointment.
 * Guarantees DB constraint safety:
 * - cancels any existing active FOLLOW-UP appointment for same date first
 * - then inserts new scheduled appointment
 *
 * BUG FIX L3: Previously called cancelActiveAppointment() unconditionally,
 * which cancelled ALL active follow-up appointments for this patient regardless
 * of date. This meant booking a "Lab Report Discussion" on Thursday would
 * silently cancel the patient's "ANC Follow-up" scheduled for next week.
 *
 * NEW BEHAVIOUR: Only cancels follow-up appointments on the SAME DATE as the
 * new appointment (prevents time-slot conflicts) while preserving future
 * follow-ups on different dates.
 */
export async function createAppointment(params: CreateAppointmentParams): Promise<string> {
  const {
    patientId,
    date,
    time,
    patientName,
    mrn = '',
    mobile = '',
    notes = null,
    type = 'manual',
  } = params

  // 1) Cancel any existing ACTIVE follow-up appointment on the SAME DATE only
  // BUG FIX L3: Added .eq('date', date) to scope cancellation to conflicting date
  const { error: cancelErr } = await supabase
    .from('appointments')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString()
    })
    .eq('patient_id', patientId)
    .in('status', ['scheduled', 'confirmed'])
    .eq('type', 'follow_up')
    .eq('date', date)

  if (cancelErr) {
    console.warn('[createAppointment] cancel conflicting follow-up failed (non-fatal):', cancelErr.message)
  }

  // 2) Insert new appointment
  const { data, error } = await supabase
    .from('appointments')
    .insert({
      patient_id: patientId,
      patient_name: patientName,
      mrn,
      mobile,
      date,
      time,
      type,
      notes,
      status: 'scheduled',
      reminder_sent: false,
      updated_at: nowISO(),
      source: 'manual',
      follow_up_id: null,
    })
    .select('id')
    .single()

  if (error) {
    // If a race condition happens and DB constraint blocks it, show clean error.
    throw new Error(error.message)
  }

  // Send notification for new appointment
  try {
    await notify.appointmentCreated(patientId, patientName, date, time, type)
  } catch {
    // Non-fatal
  }

  return data.id as string
}

/**
 * Create OR update follow-up for the same encounter and keep appointment in sync.
 * - ensures only one pending follow-up per encounter (matches DB index)
 * - cancels any active appointment first (matches DB constraint)
 * - cancels old follow-up appointment if follow-up is updated
 */
export async function createFollowUp(
  patientId: string,
  encounterId: string,
  followUpDate: string,
  meta?: CreateFollowUpMeta
) {
  // 0) Cancel any active appointment first (required by unique index)
  await cancelActiveAppointment(patientId)

  // 1) Find existing pending follow-up for this encounter
  const { data: existingFu, error: fuFindErr } = await supabase
    .from('follow_ups')
    .select('*')
    .eq('patient_id', patientId)
    .eq('created_from_visit_id', encounterId)
    .eq('status', 'pending')
    .maybeSingle()

  // ✅ Prevent duplicate same-date follow-ups
  if (
    existingFu &&
    existingFu.recommended_date === followUpDate
  ) {
    return {
      id: existingFu.id,
      linked_appointment_id: existingFu.linked_appointment_id
    }
  }
  if (fuFindErr) throw fuFindErr

  const notes =
    meta?.encounterDateLabel
      ? `Follow-up from encounter on ${meta.encounterDateLabel}`
      : 'Follow-up from recent visit'

  if (existingFu) {
    // 2A) Update follow-up date
    const { error: fuUpdateErr } = await supabase
      .from('follow_ups')
      .update({ recommended_date: followUpDate })
      .eq('id', existingFu.id)

    if (fuUpdateErr) throw fuUpdateErr

    // 2B) Cancel the old linked appointment (if exists)
    if (existingFu.linked_appointment_id) {
      await supabase
        .from('appointments')
        .update({ status: 'cancelled', updated_at: nowISO() })
        .eq('id', existingFu.linked_appointment_id)
    }

    // 2C) Create new follow-up appointment
    const { data: appt, error: apptErr } = await supabase
      .from('appointments')
      .insert({
        patient_id: patientId,
        patient_name: meta?.patientName ?? '',
        mrn: meta?.mrn ?? '',
        mobile: meta?.mobile ?? '',
        date: new Date(followUpDate).toISOString().split('T')[0],
        time: meta?.followUpTime ?? '10:00',
        type: 'follow_up',
        notes,
        status: 'scheduled',
        reminder_sent: false,
        updated_at: nowISO(),
        source: 'follow_up',
        follow_up_id: existingFu.id,
      })
      .select('id')
      .single()

    if (apptErr) throw apptErr

    // 2D) Link follow-up -> new appointment
    const { error: linkErr } = await supabase
      .from('follow_ups')
      .update({ linked_appointment_id: appt.id })
      .eq('id', existingFu.id)

    if (linkErr) throw linkErr

    return { id: existingFu.id, linked_appointment_id: appt.id }
  }

  // 3) Create new follow-up
  const { data: newFu, error: fuErr } = await supabase
    .from('follow_ups')
    .insert({
      patient_id: patientId,
      created_from_visit_id: encounterId,
      recommended_date: followUpDate,
      status: 'pending',
    })
    .select('id')
    .single()

  if (fuErr) throw fuErr

  // 4) Create follow-up appointment
  const { data: appt2, error: apptErr2 } = await supabase
    .from('appointments')
    .insert({
      patient_id: patientId,
      patient_name: meta?.patientName ?? '',
      mrn: meta?.mrn ?? '',
      mobile: meta?.mobile ?? '',
      date: new Date(followUpDate).toISOString().split('T')[0],
      time: meta?.followUpTime ?? '10:00',
      type: 'follow_up',
      notes,
      status: 'scheduled',
      reminder_sent: false,
      updated_at: nowISO(),
      source: 'follow_up',
      follow_up_id: newFu.id,
    })
    .select('id')
    .single()

  if (apptErr2) throw apptErr2

  // 5) Link follow-up -> appointment
  const { error: linkErr2 } = await supabase
    .from('follow_ups')
    .update({ linked_appointment_id: appt2.id })
    .eq('id', newFu.id)

  if (linkErr2) throw linkErr2

  return { id: newFu.id, linked_appointment_id: appt2.id }
}

/**
 * Visit completion cleanup
 * ✅ Only completes follow-up if it's future or same day with visit logic
 *
 * Optional `encounterId` lets callers also stamp the queue row with the
 * encounter that closed it, so queue → encounter is auditable.
 */
export async function handleVisitCompletion(
  patientId: string,
  encounterId?: string,
) {

  const today = getIndiaToday()

  // ✅ Only complete FOLLOW-UP if scheduled for today or before
  const { error: fuErr } = await supabase
    .from('follow_ups')
    .update({ status: 'fulfilled' })
    .eq('patient_id', patientId)
    .eq('status', 'pending')
    .lte('recommended_date', today)   // ✅ CRITICAL FIX

  if (fuErr) throw fuErr

  // ✅ Cancel only follow-up appointments (safe)
  await cancelActiveAppointment(patientId)

  // ✅ NEW: If patient visits BEFORE their scheduled follow-up date,
  // auto-cancel future follow-ups and their linked appointments.
  // This prevents duplicate reminders and false "overdue" flags.
  try {
    const { cancelFutureFollowUpsOnEarlyVisit } = await import('@/lib/revenue-lifecycle')
    await cancelFutureFollowUpsOnEarlyVisit(patientId, encounterId)
  } catch {
    // Non-fatal — early visit detection is a bonus, not critical
  }

  // ✅ Close today's OPD queue token for this patient (Gap 1)
  // Only touches rows that are still open (waiting / in_progress).
  // Never reopens a row that was already marked done or cancelled.
  try {
    const patch: Record<string, unknown> = {
      status: 'done',
      done_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    if (encounterId) patch.encounter_id = encounterId

    await supabase
      .from('opd_queue')
      .update(patch)
      .eq('patient_id', patientId)
      .eq('queue_date', today)
      .in('status', ['waiting', 'vitals_done', 'in_progress'])
  } catch (err) {
    // Non-fatal — visit completion (follow_ups + appointments) already succeeded.
    console.warn('[handleVisitCompletion] queue close failed (non-fatal):', err)
  }
}

/**
 * Sync appointment status from OPD encounter.
 * When a patient is seen in OPD (encounter created), automatically mark
 * their today's appointment as 'completed'.
 *
 * Call this after saving an encounter/consultation.
 */
export async function syncAppointmentFromOPD(patientId: string, patientName?: string) {
  const today = getIndiaToday()

  try {
    // Find today's appointment for this patient with scheduled/confirmed status
    const { data: appointments, error: findErr } = await supabase
      .from('appointments')
      .select('id, status, type')
      .eq('patient_id', patientId)
      .eq('date', today)
      .in('status', ['scheduled', 'confirmed'])
      .limit(1)

    if (findErr) {
      console.warn('[appointmentSync] Error finding appointment:', findErr.message)
      return
    }

    if (!appointments || appointments.length === 0) return

    // Mark as completed
    const { error: updateErr } = await supabase
      .from('appointments')
      .update({
        status: 'completed',
        updated_at: nowISO(),
      })
      .eq('id', appointments[0].id)

    if (updateErr) {
      console.warn('[appointmentSync] Error updating appointment:', updateErr.message)
      return
    }

    // Send notification
    // BUG FIX H2: notify.appointmentCompleted() does not exist on the notify object.
    // The correct method is notify.opdConsultationSaved() which is the semantic match
    // for "patient was seen and consultation is complete". Previously this was a silent
    // no-op (optional chaining on undefined), so staff never received completion notifications.
    try {
      await notify.opdConsultationSaved(patientId, patientName || '')
    } catch {
      // Non-fatal
    }
  } catch (err) {
    console.warn('[appointmentSync] Unexpected error:', err)
  }
}