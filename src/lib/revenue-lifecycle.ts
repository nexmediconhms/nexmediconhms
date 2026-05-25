/**
 * src/lib/revenue-lifecycle.ts
 *
 * Revenue Lifecycle Tracking Module
 *
 * Tracks the complete patient revenue pipeline:
 *   Follow-up → Appointment → Visit → Bill → Payment → Revenue
 *
 * STATUS DEFINITIONS:
 *
 *   visit_status:
 *     - 'scheduled'   → Appointment exists, patient hasn't arrived
 *     - 'arrived'     → Patient checked in (added to OPD queue)
 *     - 'in_progress' → Consultation started (encounter being created)
 *     - 'completed'   → Consultation finished (encounter saved)
 *     - 'no_show'     → Patient didn't arrive (auto-detected by cron)
 *     - 'cancelled'   → Appointment was cancelled
 *
 *   revenue_status:
 *     - 'pending'      → Visit completed, bill not yet generated
 *     - 'billed'       → Bill created for this visit
 *     - 'paid'         → Payment received (partial or full)
 *     - 'not_billed'   → Visit completed but no bill generated (missed revenue)
 *     - 'lost_revenue' → No-show or cancelled after confirmation (opportunity cost)
 *     - 'waived'       → Bill explicitly waived (charity, staff, etc.)
 *
 * USAGE:
 *   import { trackVisitStatus, trackRevenueStatus, getRevenueMetrics } from '@/lib/revenue-lifecycle'
 *
 *   // After patient arrives:
 *   await trackVisitStatus(appointmentId, 'arrived')
 *
 *   // After bill is generated:
 *   await trackRevenueStatus(encounterId, 'billed', billId)
 *
 *   // Get revenue pipeline metrics:
 *   const metrics = await getRevenueMetrics('2026-05-22')
 */

import { supabase } from './supabase'

// ── Types ────────────────────────────────────────────────────────

export type VisitStatus =
  | 'scheduled'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'no_show'
  | 'cancelled'

export type RevenueStatus =
  | 'pending'
  | 'billed'
  | 'paid'
  | 'not_billed'
  | 'lost_revenue'
  | 'waived'

export interface RevenueLifecycleEntry {
  appointment_id?: string
  encounter_id?: string
  patient_id: string
  patient_name?: string
  visit_date: string
  visit_status: VisitStatus
  revenue_status: RevenueStatus
  bill_id?: string
  bill_amount?: number
  paid_amount?: number
  follow_up_id?: string
  appointment_type?: string
}

export interface RevenuePipelineMetrics {
  date: string
  totalScheduled: number
  totalArrived: number
  totalCompleted: number
  totalNoShow: number
  totalBilled: number
  totalNotBilled: number
  totalPaid: number
  totalLostRevenue: number
  conversionRate: number         // arrived / scheduled (%)
  billingRate: number            // billed / completed (%)
  collectionRate: number         // paid / billed (%)
  estimatedLostRevenue: number   // no_show count × avg consultation fee
  unbilledVisits: { patientName: string; patientId: string; encounterId: string; encounterDate: string }[]
  noShowPatients: { patientName: string; patientId: string; appointmentId: string; time: string }[]
}

// ── Visit Status Tracking ────────────────────────────────────────

/**
 * Update the visit status of an appointment.
 * This is called at each stage of the patient journey:
 *   Queue added → arrived
 *   Encounter started → in_progress
 *   Encounter saved → completed
 *   Cron detected no-show → no_show
 *
 * Non-destructive: only updates if the new status is a valid transition.
 */
export async function trackVisitStatus(
  appointmentId: string,
  newStatus: VisitStatus
): Promise<void> {
  if (!appointmentId) return

  try {
    // Valid transitions (cannot go backwards except for cancel)
    const validTransitions: Record<VisitStatus, VisitStatus[]> = {
      scheduled: ['arrived', 'no_show', 'cancelled'],
      arrived: ['in_progress', 'completed', 'cancelled'],
      in_progress: ['completed'],
      completed: [], // terminal state
      no_show: [],   // terminal state
      cancelled: [], // terminal state
    }

    // Get current status
    const { data: appt } = await supabase
      .from('appointments')
      .select('status, visit_status')
      .eq('id', appointmentId)
      .single()

    if (!appt) return

    const currentVisitStatus = (appt.visit_status || 'scheduled') as VisitStatus
    const allowed = validTransitions[currentVisitStatus] || []

    if (!allowed.includes(newStatus)) {
      // Invalid transition — skip silently
      return
    }

    await supabase
      .from('appointments')
      .update({
        visit_status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', appointmentId)
  } catch (err) {
    // Non-fatal — lifecycle tracking should never block clinical workflow
    console.warn('[revenue-lifecycle] trackVisitStatus error:', err)
  }
}

// ── Revenue Status Tracking ──────────────────────────────────────

/**
 * Update the revenue status of an encounter.
 * Called when:
 *   - Bill is generated for an encounter → 'billed'
 *   - Payment is received → 'paid'
 *   - End-of-day audit finds unbilled visits → 'not_billed'
 *   - No-show detected → 'lost_revenue'
 */
export async function trackRevenueStatus(
  encounterId: string,
  newStatus: RevenueStatus,
  billId?: string
): Promise<void> {
  if (!encounterId) return

  try {
    const updatePayload: Record<string, any> = {
      revenue_status: newStatus,
      updated_at: new Date().toISOString(),
    }
    if (billId) {
      updatePayload.bill_id = billId
    }

    await supabase
      .from('encounters')
      .update(updatePayload)
      .eq('id', encounterId)
  } catch (err) {
    console.warn('[revenue-lifecycle] trackRevenueStatus error:', err)
  }
}

// ── Revenue Pipeline Metrics ─────────────────────────────────────

/**
 * Calculate revenue pipeline metrics for a given date.
 * Used by the Revenue Engine Dashboard.
 *
 * Returns:
 *   - Conversion funnel (scheduled → arrived → completed → billed → paid)
 *   - Lost revenue estimation
 *   - Unbilled visits list
 *   - No-show patient list
 */
export async function getRevenueMetrics(date: string): Promise<RevenuePipelineMetrics> {
  const avgConsultationFee = 500 // Default ₹500 — should come from settings

  // Fetch all appointments for the date
  const { data: appointments } = await supabase
    .from('appointments')
    .select('id, patient_id, patient_name, time, status, visit_status, type')
    .eq('date', date)

  // Fetch all encounters for the date
  const { data: encounters } = await supabase
    .from('encounters')
    .select('id, patient_id, revenue_status, bill_id')
    .eq('encounter_date', date)

  // Fetch all bills for the date
  const { data: bills } = await supabase
    .from('bills')
    .select('id, patient_id, net_amount, total, paid, status')
    .gte('created_at', date + 'T00:00:00')
    .lte('created_at', date + 'T23:59:59')

  const appts = appointments || []
  const encs = encounters || []
  const billsList = bills || []

  // Count by status
  const totalScheduled = appts.length
  const totalArrived = appts.filter(a =>
    ['arrived', 'in_progress', 'completed'].includes(a.visit_status || a.status || '')
    || a.status === 'completed'
  ).length
  const totalCompleted = encs.length // encounters = completed visits
  const totalNoShow = appts.filter(a => a.status === 'no-show' || a.visit_status === 'no_show').length

  // Revenue tracking
  // FIX MAJOR #5: Use patient_id set correctly — variable name was misleading
  // but the logic needs to compare encounter patient_ids against billed patient_ids
  const billedPatientIds = new Set(billsList.map(b => b.patient_id))
  const totalBilled = billsList.length
  const totalNotBilled = encs.filter(e => !billedPatientIds.has(e.patient_id)).length
  const totalPaid = billsList.filter(b => b.status === 'paid').length

  // Lost revenue = no-shows × avg fee
  const totalLostRevenue = totalNoShow
  const estimatedLostRevenue = totalNoShow * avgConsultationFee

  // Rates
  const conversionRate = totalScheduled > 0 ? Math.round((totalArrived / totalScheduled) * 100) : 0
  const billingRate = totalCompleted > 0 ? Math.round((totalBilled / totalCompleted) * 100) : 0
  const collectionRate = totalBilled > 0 ? Math.round((totalPaid / totalBilled) * 100) : 0

  // Unbilled visits (encounters without corresponding bills)
  const unbilledVisits = encs
    .filter(e => !billedPatientIds.has(e.patient_id))
    .map(e => ({
      patientName: '',
      patientId: e.patient_id,
      encounterId: e.id,
      encounterDate: date,
    }))

  // No-show patients
  const noShowPatients = appts
    .filter(a => a.status === 'no-show' || a.visit_status === 'no_show')
    .map(a => ({
      patientName: a.patient_name || '',
      patientId: a.patient_id,
      appointmentId: a.id,
      time: a.time || '',
    }))

  return {
    date,
    totalScheduled,
    totalArrived,
    totalCompleted,
    totalNoShow,
    totalBilled,
    totalNotBilled,
    totalPaid,
    totalLostRevenue,
    conversionRate,
    billingRate,
    collectionRate,
    estimatedLostRevenue,
    unbilledVisits,
    noShowPatients,
  }
}

// ── Follow-up Conversion Tracking ────────────────────────────────

/**
 * Calculate follow-up conversion rate for a date range.
 * Answers: "Of all follow-ups we scheduled, how many actually came back?"
 */
export async function getFollowUpConversion(
  fromDate: string,
  toDate: string
): Promise<{
  totalScheduled: number
  totalFulfilled: number
  totalMissed: number
  totalPending: number
  conversionRate: number
}> {
  const { data: followUps } = await supabase
    .from('follow_ups')
    .select('id, status, recommended_date')
    .gte('recommended_date', fromDate)
    .lte('recommended_date', toDate)

  const all = followUps || []
  const totalScheduled = all.length
  const totalFulfilled = all.filter(f => f.status === 'fulfilled').length
  const totalMissed = all.filter(f => f.status === 'missed').length
  const totalPending = all.filter(f => f.status === 'pending').length
  const conversionRate = totalScheduled > 0
    ? Math.round((totalFulfilled / totalScheduled) * 100)
    : 0

  return { totalScheduled, totalFulfilled, totalMissed, totalPending, conversionRate }
}

// ── Auto-Cancel Follow-up on Early Visit ─────────────────────────

/**
 * When a patient visits BEFORE their scheduled follow-up date,
 * automatically cancel the old follow-up appointment and mark it as "handled".
 *
 * This prevents:
 *   1. Duplicate reminder SMS/WhatsApp for a visit that already happened
 *   2. Confusion in the appointments list (patient already seen)
 *   3. False "overdue" flags in the follow-up escalation cron
 *
 * Called from handleVisitCompletion() in appointmentService.ts
 *
 * @param patientId - The patient who just visited
 * @param encounterId - The encounter that was just created
 */
export async function cancelFutureFollowUpsOnEarlyVisit(
  patientId: string,
  encounterId?: string
): Promise<{ cancelled: number }> {
  if (!patientId) return { cancelled: 0 }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  let cancelledCount = 0

  try {
    // 1. Find all PENDING follow-ups for this patient with future dates
    const { data: futureFollowUps } = await supabase
      .from('follow_ups')
      .select('id, linked_appointment_id, recommended_date')
      .eq('patient_id', patientId)
      .eq('status', 'pending')
      .gt('recommended_date', today) // FUTURE follow-ups only

    if (!futureFollowUps || futureFollowUps.length === 0) {
      return { cancelled: 0 }
    }

    // 2. Mark follow-ups as 'fulfilled' (patient came early)
    const fuIds = futureFollowUps.map(f => f.id)
    const { error: fuErr } = await supabase
      .from('follow_ups')
      .update({
        status: 'fulfilled',
        updated_at: new Date().toISOString(),
      })
      .in('id', fuIds)

    if (fuErr) {
      console.warn('[revenue-lifecycle] cancel future follow-ups failed:', fuErr.message)
      return { cancelled: 0 }
    }

    // 3. Cancel the linked follow-up appointments
    const appointmentIds = futureFollowUps
      .map(f => f.linked_appointment_id)
      .filter(Boolean) as string[]

    if (appointmentIds.length > 0) {
      await supabase
        .from('appointments')
        .update({
          status: 'cancelled',
          notes: `Auto-cancelled: patient visited early on ${today}${encounterId ? ` (encounter: ${encounterId})` : ''}`,
          updated_at: new Date().toISOString(),
        })
        .in('id', appointmentIds)
        .in('status', ['scheduled', 'confirmed']) // only cancel active ones
    }

    cancelledCount = futureFollowUps.length
    console.log(`[revenue-lifecycle] Auto-cancelled ${cancelledCount} future follow-up(s) for patient ${patientId} (visited early)`)

  } catch (err: any) {
    console.warn('[revenue-lifecycle] cancelFutureFollowUpsOnEarlyVisit error:', err?.message)
  }

  return { cancelled: cancelledCount }
}

// ── End-of-Day Unbilled Detection ────────────────────────────────

/**
 * Find encounters from a given date that were never billed.
 * Called by the daily cron to flag "not_billed" encounters.
 * Also updates revenue_status on those encounters.
 *
 * @param date - Date to check (YYYY-MM-DD format)
 * @returns List of unbilled encounters
 */
export async function detectUnbilledEncounters(date: string): Promise<{
  unbilledCount: number
  unbilled: { patientId: string; patientName: string; encounterId: string }[]
}> {
  try {
    // Get all encounters for the date
    const { data: encounters } = await supabase
      .from('encounters')
      .select('id, patient_id')
      .eq('encounter_date', date)

    if (!encounters || encounters.length === 0) {
      return { unbilledCount: 0, unbilled: [] }
    }

    // Get all bills for the date
    const { data: bills } = await supabase
      .from('bills')
      .select('patient_id')
      .gte('created_at', date + 'T00:00:00')
      .lte('created_at', date + 'T23:59:59')

    const billedPatients = new Set((bills || []).map(b => b.patient_id))

    // Find encounters without corresponding bills
    const unbilled = encounters
      .filter(e => !billedPatients.has(e.patient_id))
      .map(e => ({
        patientId: e.patient_id,
        patientName: '', // Caller can enrich with patient name
        encounterId: e.id,
      }))

    // Update revenue_status for unbilled encounters
    if (unbilled.length > 0) {
      const unbilledIds = unbilled.map(u => u.encounterId)
      await supabase
        .from('encounters')
        .update({ revenue_status: 'not_billed' })
        .in('id', unbilledIds)
        .is('revenue_status', null) // only update if not already set
    }

    return { unbilledCount: unbilled.length, unbilled }
  } catch (err: any) {
    console.warn('[revenue-lifecycle] detectUnbilledEncounters error:', err?.message)
    return { unbilledCount: 0, unbilled: [] }
  }
}