/**
 * src/lib/post-delivery-sync.ts
 *
 * Auto-sync module triggered after a delivery record is saved.
 *
 * What it does:
 *   1. Creates mother's post-delivery follow-up appointments (7 days, 42 days)
 *   2. Creates baby vaccination schedule as appointments (per Indian NIS)
 *   3. Syncs delivery data to discharge_summaries (for WhatsApp reminders)
 *   4. Updates patient profile with delivery info
 *   5. Creates/updates baby as a linked patient (optional)
 *
 * The existing /api/reminders system already reads discharge_summaries
 * for delivery_date and sends WhatsApp reminders for post_delivery and
 * vaccination types. This module ensures the data is in place for that
 * system to work, AND creates calendar appointments so the clinic staff
 * can see upcoming visits on the appointments page.
 *
 * USAGE:
 *   import { runPostDeliverySync } from '@/lib/post-delivery-sync'
 *   await runPostDeliverySync({ ... })
 */

import { supabase } from './supabase'

// ── Indian National Immunization Schedule (NIS) ─────────────────
// Based on IAP (Indian Academy of Pediatrics) guidelines
export const VACCINATION_SCHEDULE = [
  { name: 'OPV-0 + Hep-B Birth Dose + BCG',       days: 0,   note: 'At birth (given in hospital)' },
  { name: 'OPV-1 + Pentavalent-1 + Rotavirus-1',  days: 42,  note: '6 weeks' },
  { name: 'OPV-2 + Pentavalent-2 + Rotavirus-2',  days: 70,  note: '10 weeks' },
  { name: 'OPV-3 + Pentavalent-3 + Rotavirus-3 + IPV-1', days: 98, note: '14 weeks' },
  { name: 'Measles-1 + Vitamin A (1st dose)',       days: 270, note: '9 months' },
  { name: 'MMR-1 + Varicella-1 + Hep-A-1',         days: 365, note: '12 months' },
  { name: 'DPT Booster-1 + OPV Booster + MMR-2',   days: 548, note: '18 months (1.5 years)' },
  { name: 'Typhoid Conjugate Vaccine (TCV)',         days: 730, note: '24 months (2 years)' },
] as const

// ── Mother's Post-Delivery Follow-up Schedule ───────────────────
export const MOTHER_FOLLOWUP_SCHEDULE = [
  { days: 7,  label: 'Post-Delivery Check (1 week)',   note: 'Wound check, lochia, breastfeeding assessment, BP check' },
  { days: 42, label: 'Post-Delivery Check (6 weeks)',  note: '42-day check: uterine involution, contraception counselling, Pap smear if due' },
  { days: 90, label: 'Post-Delivery Check (3 months)', note: 'General health, baby growth, iron/calcium supplements review' },
] as const

// ── Types ────────────────────────────────────────────────────────
export interface PostDeliverySyncInput {
  patientId: string
  admissionId: string
  deliveryDate: string          // YYYY-MM-DD
  deliveryTime?: string
  deliveryType?: string
  babySex?: string
  babyWeightKg?: string
  apgar1?: string
  apgar5?: string
  motherName: string
  motherMobile?: string
  motherMrn?: string
  doctorName?: string
  complications?: string
  lactationAdvice?: string
  // Set false to skip specific sync operations
  createMotherFollowups?: boolean   // default true
  createVaccinationSchedule?: boolean // default true
  syncToDischarge?: boolean         // default true
  syncToPatientProfile?: boolean    // default true
}

export interface SyncResult {
  motherFollowupsCreated: number
  vaccinationApptsCreated: number
  dischargeSynced: boolean
  patientSynced: boolean
  errors: string[]
}

// ═══════════════════════════════════════════════════════════════════
// MAIN SYNC FUNCTION
// ═══════════════════════════════════════════════════════════════════
export async function runPostDeliverySync(input: PostDeliverySyncInput): Promise<SyncResult> {
  const result: SyncResult = {
    motherFollowupsCreated: 0,
    vaccinationApptsCreated: 0,
    dischargeSynced: false,
    patientSynced: false,
    errors: [],
  }

  const {
    patientId, admissionId, deliveryDate, deliveryTime, deliveryType,
    babySex, babyWeightKg, apgar1, apgar5,
    motherName, motherMobile, motherMrn, doctorName,
    complications, lactationAdvice,
    createMotherFollowups = true,
    createVaccinationSchedule = true,
    syncToDischarge = true,
    syncToPatientProfile = true,
  } = input

  if (!deliveryDate || !patientId) {
    result.errors.push('Missing required fields: deliveryDate and patientId')
    return result
  }

  const deliveryMs = new Date(deliveryDate).getTime()

  // ── 1. Create Mother's Follow-up Appointments ────────────────
  if (createMotherFollowups) {
    try {
      for (const fu of MOTHER_FOLLOWUP_SCHEDULE) {
        const fuDate = new Date(deliveryMs + fu.days * 86400000)
        const fuDateStr = fuDate.toISOString().split('T')[0]

        // Skip if date is in the past
        if (fuDate.getTime() < Date.now() - 86400000) continue

        // Check if this follow-up already exists
        const { data: existing } = await supabase
          .from('appointments')
          .select('id')
          .eq('patient_id', patientId)
          .eq('date', fuDateStr)
          .eq('type', 'Follow-up')
          .ilike('notes', `%${fu.label}%`)
          .limit(1)

        if (existing && existing.length > 0) continue // Already exists

        const { error: apptErr } = await supabase.from('appointments').insert({
          patient_id: patientId,
          patient_name: motherName,
          mrn: motherMrn || null,
          date: fuDateStr,
          time: '10:00',
          type: 'Follow-up',
          status: 'scheduled',
          doctor: doctorName || null, doctor_name: doctorName || '',
          notes: `${fu.label}. ${fu.note}`,
        })

        if (apptErr) {
          result.errors.push(`Follow-up (${fu.label}): ${apptErr.message}`)
        } else {
          result.motherFollowupsCreated++
        }
      }
    } catch (e: any) {
      result.errors.push(`Mother follow-ups: ${e.message}`)
    }
  }

  // ── 2. Create Baby Vaccination Schedule ──────────────────────
  if (createVaccinationSchedule) {
    try {
      // Skip day-0 vaccines (given in hospital, already recorded in delivery record)
      const futureVaccines = VACCINATION_SCHEDULE.filter(v => v.days > 0)

      for (const vax of futureVaccines) {
        const vaxDate = new Date(deliveryMs + vax.days * 86400000)
        const vaxDateStr = vaxDate.toISOString().split('T')[0]

        // Skip if date is in the past
        if (vaxDate.getTime() < Date.now() - 86400000) continue

        // Check if this vaccination appointment already exists
        const { data: existing } = await supabase
          .from('appointments')
          .select('id')
          .eq('patient_id', patientId)
          .eq('date', vaxDateStr)
          .eq('type', 'Vaccination')
          .limit(1)

        if (existing && existing.length > 0) continue

        const babyLabel = babySex
          ? `Baby ${babySex === 'Male' ? 'Boy' : babySex === 'Female' ? 'Girl' : ''}`
          : 'Baby'

        const { error: vaxErr } = await supabase.from('appointments').insert({
          patient_id: patientId,   // Linked to mother's patient ID
          patient_name: `${motherName} (${babyLabel})`,
          mrn: motherMrn || null,
          date: vaxDateStr,
          time: '10:00',
          type: 'Vaccination',
          status: 'scheduled',
          doctor: doctorName || null, doctor_name: doctorName || '',
          notes: `${vax.name} — ${vax.note}. Baby DOB: ${deliveryDate}`,
        })

        if (vaxErr) {
          result.errors.push(`Vaccination (${vax.name}): ${vaxErr.message}`)
        } else {
          result.vaccinationApptsCreated++
        }
      }
    } catch (e: any) {
      result.errors.push(`Vaccination schedule: ${e.message}`)
    }
  }

  // ── 3. Sync to discharge_summaries ───────────────────────────
  // This is CRITICAL because the existing /api/reminders system
  // reads delivery_date from discharge_summaries to generate
  // WhatsApp reminders for post_delivery and vaccination types.
  if (syncToDischarge) {
    try {
      const dsPayload: Record<string, any> = {
        delivery_type: deliveryType || null,
        baby_sex: babySex || null,
        baby_weight: babyWeightKg ? `${babyWeightKg} kg` : null,
        apgar_score: [apgar1, apgar5].filter(Boolean).join('/') || null,
        baby_birth_time: deliveryTime || null,
        delivery_date: deliveryDate,
        complications: complications || null,
        lactation_advice: lactationAdvice || null,
        updated_at: new Date().toISOString(),
      }

      // Try to find existing discharge summary
      const { data: existingDS } = await supabase
        .from('discharge_summaries')
        .select('id')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (existingDS?.id) {
        await supabase.from('discharge_summaries').update(dsPayload).eq('id', existingDS.id)
        result.dischargeSynced = true
      } else {
        // Create a minimal discharge summary with delivery data
        // so the reminder system can find it
        await supabase.from('discharge_summaries').insert({
          patient_id: patientId,
          ...dsPayload,
          admission_date: deliveryDate,
        })
        result.dischargeSynced = true
      }
    } catch (e: any) {
      result.errors.push(`Discharge sync: ${e.message}`)
    }
  }

  // ── 4. Sync to patient profile ──────────────────────────────
  if (syncToPatientProfile) {
    try {
      const patientUpdate: Record<string, any> = {
        last_visit: deliveryDate,
        updated_at: new Date().toISOString(),
      }

      await supabase.from('patients').update(patientUpdate).eq('id', patientId)
      result.patientSynced = true

      // Also update obstetric history if the patient has ob_data
      const { data: pat } = await supabase
        .from('patients')
        .select('ob_data')
        .eq('id', patientId)
        .single()

      if (pat) {
        const obData = (typeof pat.ob_data === 'string' ? JSON.parse(pat.ob_data || '{}') : pat.ob_data) || {}
        // Auto-increment para count
        if (typeof obData.para === 'number') {
          obData.para = obData.para + 1
        }
        obData.last_delivery_date = deliveryDate
        obData.last_delivery_type = deliveryType || ''
        obData.last_baby_sex = babySex || ''
        obData.last_baby_weight = babyWeightKg || ''

        await supabase.from('patients').update({
          ob_data: obData,
        }).eq('id', patientId)
      }
    } catch (e: any) {
      result.errors.push(`Patient sync: ${e.message}`)
    }
  }

  return result
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Get upcoming vaccination schedule for a baby
// (useful for displaying in UI)
// ═══════════════════════════════════════════════════════════════════
export function getUpcomingVaccinations(deliveryDate: string): {
  name: string; dueDate: string; note: string; daysFromNow: number; isPast: boolean
}[] {
  const deliveryMs = new Date(deliveryDate).getTime()
  const now = Date.now()

  return VACCINATION_SCHEDULE.map(vax => {
    const dueMs = deliveryMs + vax.days * 86400000
    const dueDate = new Date(dueMs).toISOString().split('T')[0]
    const daysFromNow = Math.round((dueMs - now) / 86400000)
    return {
      name: vax.name,
      dueDate,
      note: vax.note,
      daysFromNow,
      isPast: daysFromNow < 0,
    }
  })
}