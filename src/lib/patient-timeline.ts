// src/lib/patient-timeline.ts
import { supabase } from './supabase'
export interface TimelineEvent {
  id: string
  type: 'encounter' | 'prescription' | 'lab' | 'bill' | 'admission' | 'discharge' | 'anc_visit' | 'appointment'
  date: string
  title: string
  subtitle?: string
  icon: string        // emoji or icon name
  color: string       // tailwind color class
  data: Record<string, any>
  isCritical?: boolean
}

export async function buildPatientTimeline(patientId: string): Promise<TimelineEvent[]> {
  const [encounters, prescriptions, labs, bills, admissions, ancVisits] = await Promise.all([
    supabase.from('encounters').select('*').eq('patient_id', patientId).order('encounter_date', { ascending: false }),
    supabase.from('prescriptions').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
    supabase.from('lab_reports').select('*').eq('patient_id', patientId).order('report_date', { ascending: false }),
    supabase.from('bills').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
    supabase.from('ipd_admissions').select('*').eq('patient_id', patientId).order('admission_date', { ascending: false }),
    supabase.from('anc_visits').select('*').eq('patient_id', patientId).order('visit_date', { ascending: false }),
  ])

  const events: TimelineEvent[] = []

  for (const enc of encounters.data || []) {
    events.push({
      id: enc.id,
      type: 'encounter',
      date: enc.date,
      title: `OPD Visit — ${enc.doctorname || 'Dr.'}`,
      subtitle: enc.diagnosis,
      icon: '🩺',
      color: 'blue',
      data: enc,
      isCritical: enc.diagnosis?.toLowerCase().includes('high risk'),
    })
  }

  // ... similar for other types

  // Sort all by date descending
  return events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}