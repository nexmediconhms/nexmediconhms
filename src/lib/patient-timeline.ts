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
    supabase.from('encounters').select('*').eq('patientid', patientId).order('date', { ascending: false }),
    supabase.from('prescriptions').select('*').eq('patientid', patientId).order('createdat', { ascending: false }),
    supabase.from('labreports').select('*').eq('patientid', patientId).order('reportdate', { ascending: false }),
    supabase.from('bills').select('*').eq('patientid', patientId).order('createdat', { ascending: false }),
    supabase.from('ipdadmissions').select('*').eq('patientid', patientId).order('admissiondate', { ascending: false }),
    supabase.from('ancvisits').select('*').eq('patientid', patientId).order('visitdate', { ascending: false }),
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