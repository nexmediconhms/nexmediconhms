/**
 * src/lib/appointments/reschedule.ts
 *
 * Appointment Reschedule Flow
 *
 * Preserves appointment history instead of cancel+rebook pattern.
 * When rescheduling:
 *   1. Updates the existing appointment with new date/time
 *   2. Records the reschedule in appointment history (audit trail)
 *   3. Updates any linked follow-up record
 *   4. Fires WhatsApp automation for reschedule notification
 *   5. Returns the updated appointment
 *
 * USAGE:
 *   import { rescheduleAppointment } from '@/lib/appointments/reschedule'
 *
 *   const result = await rescheduleAppointment({
 *     appointmentId: 'uuid',
 *     newDate: '2026-06-01',
 *     newTime: '10:30',
 *     reason: 'Doctor unavailable',
 *     rescheduledBy: 'Dr. Smith',
 *   })
 */

import { supabase } from '@/lib/supabase'
import { checkAppointmentOverlap } from '@/lib/booking-guards'
import { isSunday } from '@/lib/utils'

export interface RescheduleParams {
  appointmentId: string
  newDate: string
  newTime: string
  reason?: string
  rescheduledBy?: string
}

export interface RescheduleResult {
  success: boolean
  error?: string
  appointment?: any
  previousDate?: string
  previousTime?: string
}

/**
 * Reschedule an existing appointment to a new date/time.
 *
 * Validates:
 *   - New date is not in the past
 *   - New date is not a Sunday (clinic closed)
 *   - No overlap with existing appointments
 *   - Appointment exists and is reschedulable (not completed/cancelled)
 *
 * Preserves:
 *   - Original appointment ID (no delete + re-create)
 *   - Reschedule count in metadata
 *   - Previous date/time in history
 */
export async function rescheduleAppointment(params: RescheduleParams): Promise<RescheduleResult> {
  const { appointmentId, newDate, newTime, reason, rescheduledBy } = params

  if (!appointmentId || !newDate || !newTime) {
    return { success: false, error: 'Appointment ID, new date, and new time are required' }
  }

  // Validate Sunday
  if (isSunday(newDate)) {
    return { success: false, error: 'Clinic is closed on Sundays. Please select a different date.' }
  }

  // Validate not in the past
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  if (newDate < today) {
    return { success: false, error: 'Cannot reschedule to a past date.' }
  }
  if (newDate === today) {
    const now = new Date()
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    if (newTime <= currentTime) {
      return { success: false, error: 'Cannot reschedule to a time that has already passed.' }
    }
  }

  // Fetch existing appointment
  const { data: existing, error: fetchErr } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', appointmentId)
    .single()

  if (fetchErr || !existing) {
    return { success: false, error: 'Appointment not found' }
  }

  // Validate state
  if (existing.status === 'completed') {
    return { success: false, error: 'Cannot reschedule a completed appointment' }
  }
  if (existing.status === 'cancelled') {
    return { success: false, error: 'Cannot reschedule a cancelled appointment' }
  }

  // Check for overlap at new time (exclude current appointment)
  const overlapCheck = await checkAppointmentOverlap({
    patientId: existing.patient_id,
    date: newDate,
    time: newTime,
    durationMin: 15,
    excludeId: appointmentId,
  })

  if (!overlapCheck.ok) {
    return { success: false, error: overlapCheck.reason }
  }

  // Record previous values
  const previousDate = existing.date
  const previousTime = existing.time

  // Calculate reschedule count
  const metadata = existing.metadata ? (typeof existing.metadata === 'string' ? JSON.parse(existing.metadata) : existing.metadata) : {}
  const rescheduleCount = (metadata.reschedule_count || 0) + 1

  // Update the appointment
  const { data: updated, error: updateErr } = await supabase
    .from('appointments')
    .update({
      date: newDate,
      time: newTime,
      status: 'scheduled', // Reset to scheduled (may have been confirmed)
      reminder_sent: false, // Reset reminder so new one can be sent
      updated_at: new Date().toISOString(),
      notes: existing.notes
        ? `${existing.notes}\n[Rescheduled from ${previousDate} ${previousTime}${reason ? ': ' + reason : ''}]`
        : `[Rescheduled from ${previousDate} ${previousTime}${reason ? ': ' + reason : ''}]`,
      metadata: JSON.stringify({
        ...metadata,
        reschedule_count: rescheduleCount,
        last_rescheduled_at: new Date().toISOString(),
        last_rescheduled_by: rescheduledBy || 'staff',
        previous_date: previousDate,
        previous_time: previousTime,
        reschedule_reason: reason || null,
      }),
    })
    .eq('id', appointmentId)
    .select()
    .single()

  if (updateErr) {
    return { success: false, error: `Failed to reschedule: ${updateErr.message}` }
  }

  // Update linked follow-up record if exists
  if (existing.follow_up_id) {
    await supabase
      .from('follow_ups')
      .update({ recommended_date: newDate })
      .eq('id', existing.follow_up_id)
  }

  // Audit log
  try {
    const { audit } = await import('@/lib/audit')
    await audit(
      'update',
      'appointment',
      appointmentId,
      `Rescheduled ${existing.patient_name || 'patient'} from ${previousDate} ${previousTime} to ${newDate} ${newTime}${reason ? ' — ' + reason : ''}`
    )
  } catch { /* non-fatal */ }

  // Fire automation for reschedule notification
  try {
    const { fireAutomation } = await import('@/lib/automation-engine')
    fireAutomation('appointment_created', {
      patientId: existing.patient_id,
      patientName: existing.patient_name || '',
      mobile: existing.mobile || '',
      mrn: existing.mrn || '',
      date: newDate,
      time: newTime,
      type: existing.type || 'Follow-up',
      notes: `Rescheduled from ${previousDate}`,
    })
  } catch { /* non-fatal */ }

  return {
    success: true,
    appointment: updated,
    previousDate,
    previousTime,
  }
}

/**
 * Get reschedule history for an appointment.
 */
export function getRescheduleHistory(appointment: any): {
  count: number
  lastRescheduledAt: string | null
  lastRescheduledBy: string | null
  previousDate: string | null
  previousTime: string | null
  reason: string | null
} {
  const metadata = appointment.metadata
    ? (typeof appointment.metadata === 'string' ? JSON.parse(appointment.metadata) : appointment.metadata)
    : {}

  return {
    count: metadata.reschedule_count || 0,
    lastRescheduledAt: metadata.last_rescheduled_at || null,
    lastRescheduledBy: metadata.last_rescheduled_by || null,
    previousDate: metadata.previous_date || null,
    previousTime: metadata.previous_time || null,
    reason: metadata.reschedule_reason || null,
  }
}
