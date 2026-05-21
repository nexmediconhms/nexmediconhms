/**
 * src/lib/patient-timeline.ts
 *
 * Patient History Timeline Builder
 *
 * Aggregates ALL clinical events for a patient into a single
 * chronological timeline. Used in the patient profile page.
 *
 * Event sources:
 *   - Encounters (OPD visits, consultations)
 *   - Prescriptions (medications prescribed)
 *   - Lab Reports (test results)
 *   - Bills (payments, refunds)
 *   - IPD Admissions (admission + discharge)
 *   - ANC Visits (antenatal check-ups)
 *   - Appointments (scheduled, completed, cancelled)
 *   - Discharge Summaries (IPD discharge records)
 *   - OT Schedules (surgeries performed)
 *
 * Each event is normalized into a common TimelineEvent shape
 * for consistent rendering in the UI.
 */

import { supabase } from './supabase'

// ── Types ────────────────────────────────────────────────────────

export interface TimelineEvent {
  id: string
  type:
    | 'encounter'
    | 'prescription'
    | 'lab'
    | 'bill'
    | 'admission'
    | 'discharge'
    | 'anc_visit'
    | 'appointment'
    | 'surgery'
  date: string
  title: string
  subtitle?: string
  icon: string          // emoji for easy rendering
  color: string         // tailwind color name (blue, green, red, etc.)
  data: Record<string, any>
  isCritical?: boolean  // highlight important events
  tags?: string[]       // searchable tags
}

// ── Main Builder ─────────────────────────────────────────────────

/**
 * Build a complete patient timeline from all clinical data sources.
 * Returns events sorted by date descending (most recent first).
 *
 * @param patientId - Patient UUID
 * @param limit - Max events to return (default 200)
 */
export async function buildPatientTimeline(
  patientId: string,
  limit: number = 200
): Promise<TimelineEvent[]> {
  if (!patientId) return []

  // Fetch all data sources in parallel for speed
  const [
    encounters,
    prescriptions,
    labs,
    bills,
    admissions,
    appointments,
    dischargeSummaries,
    otSchedules,
  ] = await Promise.all([
    supabase
      .from('encounters')
      .select('id, encounter_date, encounter_type, diagnosis, chief_complaint, bp_systolic, bp_diastolic, pulse, weight, spo2, ob_data, doctorname')
      .eq('patient_id', patientId)
      .order('encounter_date', { ascending: false })
      .limit(50),
    supabase
      .from('prescriptions')
      .select('id, created_at, diagnosis, medications, follow_up_date, advice, reports_needed')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('lab_reports')
      .select('id, report_date, test_name, status, results, lab_partner, created_at')
      .eq('patient_id', patientId)
      .order('report_date', { ascending: false })
      .limit(50),
    supabase
      .from('bills')
      .select('id, created_at, net_amount, total, paid, due, status, payment_mode, items, notes')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('ipd_admissions')
      .select('id, admission_date, bed_number, ward, admitting_doctor, diagnosis_on_admission, status, chief_complaint')
      .eq('patient_id', patientId)
      .order('admission_date', { ascending: false })
      .limit(20),
    supabase
      .from('appointments')
      .select('id, date, time, type, status, notes')
      .eq('patient_id', patientId)
      .order('date', { ascending: false })
      .limit(30),
    supabase
      .from('discharge_summaries')
      .select('id, discharge_date, final_diagnosis, condition_at_discharge, follow_up_date, signed_by, delivery_type, baby_sex, baby_weight')
      .eq('patient_id', patientId)
      .order('discharge_date', { ascending: false })
      .limit(20),
    supabase
      .from('ot_schedules')
      .select('id, surgery_date, surgery_name, surgeon, ot_room, start_time, end_time, status, priority')
      .eq('patient_id', patientId)
      .order('surgery_date', { ascending: false })
      .limit(20),
  ])

  const events: TimelineEvent[] = []

  // ── Process Encounters ───────────────────────────────────────
  for (const enc of encounters.data || []) {
    const vitals: string[] = []
    if (enc.bp_systolic && enc.bp_diastolic) vitals.push(`BP: ${enc.bp_systolic}/${enc.bp_diastolic}`)
    if (enc.pulse) vitals.push(`Pulse: ${enc.pulse}`)
    if (enc.spo2) vitals.push(`SpO₂: ${enc.spo2}%`)
    if (enc.weight) vitals.push(`Wt: ${enc.weight}kg`)

    const isHighRisk = enc.diagnosis?.toLowerCase().includes('high risk') ||
                       enc.ob_data?.risk_level === 'high'

    events.push({
      id: enc.id,
      type: 'encounter',
      date: enc.encounter_date,
      title: `${enc.encounter_type || 'OPD'} Visit${enc.doctorname ? ` — Dr. ${enc.doctorname}` : ''}`,
      subtitle: [
        enc.diagnosis,
        enc.chief_complaint ? `CC: ${enc.chief_complaint}` : null,
        vitals.length > 0 ? vitals.join(' · ') : null,
      ].filter(Boolean).join(' | '),
      icon: '🩺',
      color: 'blue',
      data: enc,
      isCritical: isHighRisk,
      tags: [enc.encounter_type, enc.diagnosis, 'visit', 'opd'].filter(Boolean) as string[],
    })
  }

  // ── Process Prescriptions ────────────────────────────────────
  for (const rx of prescriptions.data || []) {
    const meds = Array.isArray(rx.medications)
      ? rx.medications.slice(0, 4).map((m: any) => m.drug || m.name || '').filter(Boolean)
      : []

    events.push({
      id: rx.id,
      type: 'prescription',
      date: rx.created_at?.split('T')[0] || '',
      title: `Prescription${rx.diagnosis ? ` — ${rx.diagnosis}` : ''}`,
      subtitle: [
        meds.length > 0 ? `Meds: ${meds.join(', ')}` : null,
        rx.follow_up_date ? `Follow-up: ${rx.follow_up_date}` : null,
        rx.reports_needed ? `Tests: ${rx.reports_needed}` : null,
      ].filter(Boolean).join(' · '),
      icon: '💊',
      color: 'purple',
      data: rx,
      tags: ['prescription', rx.diagnosis, ...meds].filter(Boolean) as string[],
    })
  }

  // ── Process Lab Reports ──────────────────────────────────────
  for (const lab of labs.data || []) {
    const isAbnormal = lab.results && typeof lab.results === 'object' &&
      Object.values(lab.results).some((r: any) => r?.flag === 'abnormal' || r?.flag === 'high' || r?.flag === 'low')

    events.push({
      id: lab.id,
      type: 'lab',
      date: lab.report_date || lab.created_at?.split('T')[0] || '',
      title: `Lab: ${lab.test_name || 'Test'}`,
      subtitle: [
        `Status: ${lab.status || 'pending'}`,
        lab.lab_partner ? `Lab: ${lab.lab_partner}` : null,
        isAbnormal ? '⚠️ Abnormal values' : null,
      ].filter(Boolean).join(' · '),
      icon: '🔬',
      color: isAbnormal ? 'red' : 'teal',
      data: lab,
      isCritical: isAbnormal,
      tags: ['lab', lab.test_name, lab.status].filter(Boolean) as string[],
    })
  }

  // ── Process Bills ────────────────────────────────────────────
  for (const bill of bills.data || []) {
    const amount = Number(bill.net_amount || bill.total || 0)
    const isPending = bill.status === 'pending' || bill.status === 'unpaid' || bill.status === 'partial'

    events.push({
      id: bill.id,
      type: 'bill',
      date: bill.created_at?.split('T')[0] || '',
      title: `Bill — ₹${amount.toLocaleString('en-IN')}`,
      subtitle: [
        `Status: ${bill.status}`,
        bill.payment_mode ? `Mode: ${bill.payment_mode}` : null,
        bill.due && Number(bill.due) > 0 ? `Due: ₹${Number(bill.due).toLocaleString('en-IN')}` : null,
      ].filter(Boolean).join(' · '),
      icon: isPending ? '⏳' : '💰',
      color: bill.status === 'paid' ? 'green' : isPending ? 'amber' : 'gray',
      data: bill,
      isCritical: isPending && amount > 5000,
      tags: ['bill', bill.status, bill.payment_mode].filter(Boolean) as string[],
    })
  }

  // ── Process IPD Admissions ───────────────────────────────────
  for (const adm of admissions.data || []) {
    events.push({
      id: adm.id,
      type: 'admission',
      date: adm.admission_date,
      title: `IPD Admission — ${adm.ward} (Bed ${adm.bed_number})`,
      subtitle: [
        `Doctor: ${adm.admitting_doctor || '—'}`,
        adm.diagnosis_on_admission ? `Dx: ${adm.diagnosis_on_admission}` : null,
        `Status: ${adm.status}`,
      ].filter(Boolean).join(' · '),
      icon: '🏥',
      color: adm.status === 'active' ? 'red' : 'indigo',
      data: adm,
      isCritical: adm.status === 'active',
      tags: ['ipd', 'admission', adm.ward, adm.status].filter(Boolean) as string[],
    })
  }

  // ── Process Discharge Summaries ──────────────────────────────
  for (const ds of dischargeSummaries.data || []) {
    const hasDelivery = !!ds.delivery_type

    events.push({
      id: ds.id,
      type: 'discharge',
      date: ds.discharge_date,
      title: hasDelivery
        ? `Delivery + Discharge — ${ds.delivery_type}`
        : `Discharge — ${ds.condition_at_discharge || 'Satisfactory'}`,
      subtitle: [
        ds.final_diagnosis ? `Dx: ${ds.final_diagnosis}` : null,
        ds.follow_up_date ? `Follow-up: ${ds.follow_up_date}` : null,
        hasDelivery ? `Baby: ${ds.baby_sex || '—'}, ${ds.baby_weight || '—'}` : null,
        `Signed by: ${ds.signed_by || '—'}`,
      ].filter(Boolean).join(' · '),
      icon: hasDelivery ? '👶' : '🏠',
      color: hasDelivery ? 'pink' : 'green',
      data: ds,
      tags: ['discharge', ds.final_diagnosis, hasDelivery ? 'delivery' : ''].filter(Boolean) as string[],
    })
  }

  // ── Process Appointments ─────────────────────────────────────
  for (const appt of appointments.data || []) {
    // Skip completed appointments that overlap with encounters
    if (appt.status === 'completed') continue

    events.push({
      id: appt.id,
      type: 'appointment',
      date: appt.date,
      title: `Appointment — ${appt.type || 'Visit'}`,
      subtitle: [
        `Time: ${appt.time || '—'}`,
        `Status: ${appt.status}`,
        appt.notes ? `Note: ${appt.notes.slice(0, 60)}` : null,
      ].filter(Boolean).join(' · '),
      icon: appt.status === 'cancelled' ? '❌' : appt.status === 'no-show' ? '⚠️' : '📅',
      color: appt.status === 'scheduled' ? 'blue' : appt.status === 'cancelled' ? 'gray' : 'amber',
      data: appt,
      tags: ['appointment', appt.type, appt.status].filter(Boolean) as string[],
    })
  }

  // ── Process OT Schedules ─────────────────────────────────────
  for (const ot of otSchedules.data || []) {
    events.push({
      id: ot.id,
      type: 'surgery',
      date: ot.surgery_date,
      title: `Surgery — ${ot.surgery_name || 'Procedure'}`,
      subtitle: [
        `Surgeon: ${ot.surgeon || '—'}`,
        `OT: ${ot.ot_room || '—'}`,
        ot.start_time && ot.end_time ? `${ot.start_time}-${ot.end_time}` : null,
        `Status: ${ot.status}`,
        ot.priority === 'emergency' ? '🚨 EMERGENCY' : null,
      ].filter(Boolean).join(' · '),
      icon: '🔪',
      color: ot.priority === 'emergency' ? 'red' : 'violet',
      data: ot,
      isCritical: ot.priority === 'emergency',
      tags: ['surgery', 'ot', ot.surgery_name, ot.status].filter(Boolean) as string[],
    })
  }

  // ── Sort by date descending (most recent first) ──────────────
  events.sort((a, b) => {
    const dateA = new Date(a.date || '1970-01-01').getTime()
    const dateB = new Date(b.date || '1970-01-01').getTime()
    return dateB - dateA
  })

  // ── Apply limit ──────────────────────────────────────────────
  return events.slice(0, limit)
}

// ── Filter Helpers ───────────────────────────────────────────────

/**
 * Filter timeline events by type.
 */
export function filterTimelineByType(
  events: TimelineEvent[],
  types: TimelineEvent['type'][]
): TimelineEvent[] {
  return events.filter(e => types.includes(e.type))
}

/**
 * Filter timeline events by date range.
 */
export function filterTimelineByDateRange(
  events: TimelineEvent[],
  from: string,
  to: string
): TimelineEvent[] {
  const fromDate = new Date(from).getTime()
  const toDate = new Date(to + 'T23:59:59').getTime()
  return events.filter(e => {
    const d = new Date(e.date).getTime()
    return d >= fromDate && d <= toDate
  })
}

/**
 * Search timeline events by text (checks title, subtitle, tags).
 */
export function searchTimeline(events: TimelineEvent[], query: string): TimelineEvent[] {
  const q = query.toLowerCase().trim()
  if (!q) return events

  return events.filter(e => {
    if (e.title.toLowerCase().includes(q)) return true
    if (e.subtitle?.toLowerCase().includes(q)) return true
    if (e.tags?.some(t => t.toLowerCase().includes(q))) return true
    return false
  })
}

/**
 * Get critical/highlighted events only.
 */
export function getCriticalEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events.filter(e => e.isCritical)
}

/**
 * Get timeline summary stats.
 */
export function getTimelineStats(events: TimelineEvent[]): {
  totalEvents: number
  byType: Record<string, number>
  criticalCount: number
  dateRange: { earliest: string; latest: string }
} {
  const byType: Record<string, number> = {}
  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1
  }

  const dates = events.map(e => e.date).filter(Boolean).sort()

  return {
    totalEvents: events.length,
    byType,
    criticalCount: events.filter(e => e.isCritical).length,
    dateRange: {
      earliest: dates[0] || '',
      latest: dates[dates.length - 1] || '',
    },
  }
}