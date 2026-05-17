/**
 * src/lib/smart-visit.ts
 * 
 * Smart Visit Detection System
 * 
 * Problem: Staff doesn't know if patient is coming for a NEW case or follow-up.
 * This affects consultation fees and reduces time at reception.
 * 
 * Solution:
 * 1. Auto-detect visit type based on patient history
 * 2. Suggest appropriate fee (new consultation vs follow-up)
 * 3. Pre-fill relevant data from last visit
 * 4. One-click queue addition with correct fee
 * 
 * Rules:
 * - If last visit was within 7 days for SAME complaint → Follow-up (reduced fee)
 * - If last visit was 7-30 days ago for same/related complaint → Follow-up
 * - If last visit > 30 days ago OR different complaint → New consultation
 * - If patient is in ANC registry (active pregnancy) → ANC follow-up (fixed fee)
 * - If patient has scheduled follow-up today → Auto-detect as follow-up
 */

import { supabase } from './supabase'

export interface VisitDetectionResult {
  visitType: 'new' | 'follow-up' | 'anc-followup' | 'post-op' | 'procedure'
  confidence: 'high' | 'medium' | 'low'
  suggestedFee: number
  reason: string
  lastVisit?: {
    date: string
    complaint: string
    diagnosis: string
    daysSince: number
    doctorName: string
  }
  scheduledFollowUp?: {
    date: string
    notes: string
    prescriptionId: string
  }
  ancData?: {
    gestationalAge: string
    edd: string
    visitNumber: number
  }
  suggestedActions: string[]
}

export interface FeeConfig {
  newConsultation: number
  followUp7Days: number
  followUp30Days: number
  ancVisit: number
  postOpVisit: number
  procedureFee: number
}

const DEFAULT_FEES: FeeConfig = {
  newConsultation: 500,
  followUp7Days: 200,
  followUp30Days: 300,
  ancVisit: 400,
  postOpVisit: 0,  // Usually included in package
  procedureFee: 500,
}

/**
 * Load fee configuration from clinic settings or use defaults
 */
export async function loadFeeConfig(): Promise<FeeConfig> {
  try {
    const { data } = await supabase
      .from('clinic_settings')
      .select('value')
      .eq('key', 'fee_config')
      .single()
    
    if (data?.value) {
      return { ...DEFAULT_FEES, ...(data.value as Partial<FeeConfig>) }
    }
  } catch { /* use defaults */ }
  return DEFAULT_FEES
}

/**
 * Save fee configuration to clinic settings
 */
export async function saveFeeConfig(config: FeeConfig): Promise<boolean> {
  const { error } = await supabase
    .from('clinic_settings')
    .upsert({ key: 'fee_config', value: config as any, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  return !error
}

/**
 * Main detection function: Determines visit type for a patient
 */
export async function detectVisitType(patientId: string): Promise<VisitDetectionResult> {
  const feeConfig = await loadFeeConfig()
  const today = new Date().toISOString().split('T')[0]

  // Parallel fetch: last encounters, scheduled follow-ups, ANC status, recent admissions
  const [encountersRes, followUpsRes, ancRes, admissionsRes] = await Promise.all([
    // Last 5 encounters
    supabase
      .from('encounters')
      .select('id, encounter_date, chief_complaint, diagnosis, doctor_name, ob_data')
      .eq('patient_id', patientId)
      .order('encounter_date', { ascending: false })
      .limit(5),

    // Scheduled follow-ups for today
    supabase
      .from('prescriptions')
      .select('id, follow_up_date, advice, encounter_id')
      .eq('patient_id', patientId)
      .eq('follow_up_date', today),

    // Active ANC (check recent encounters with ob_data containing lmp/edd)
    supabase
      .from('encounters')
      .select('ob_data, encounter_date')
      .eq('patient_id', patientId)
      .not('ob_data', 'eq', '{}')
      .order('encounter_date', { ascending: false })
      .limit(1),

    // Recent IPD admissions (post-op check)
    supabase
      .from('ipd_admissions')
      .select('id, admission_date, diagnosis_on_admission, status')
      .eq('patient_id', patientId)
      .eq('status', 'discharged')
      .order('admission_date', { ascending: false })
      .limit(1),
  ])

  const encounters = encountersRes.data || []
  const followUps = followUpsRes.data || []
  const ancEncounters = ancRes.data || []
  const recentAdmissions = admissionsRes.data || []

  // ── Case 1: Scheduled follow-up today ──────────────────────
  if (followUps.length > 0) {
    const lastEnc = encounters[0]
    const daysSince = lastEnc ? daysBetween(lastEnc.encounter_date, today) : 999

    return {
      visitType: 'follow-up',
      confidence: 'high',
      suggestedFee: daysSince <= 7 ? feeConfig.followUp7Days : feeConfig.followUp30Days,
      reason: `Scheduled follow-up from prescription (${followUps[0].advice || 'Review'})`,
      lastVisit: lastEnc ? {
        date: lastEnc.encounter_date,
        complaint: lastEnc.chief_complaint || '',
        diagnosis: lastEnc.diagnosis || '',
        daysSince,
        doctorName: lastEnc.doctor_name || '',
      } : undefined,
      scheduledFollowUp: {
        date: followUps[0].follow_up_date,
        notes: followUps[0].advice || '',
        prescriptionId: followUps[0].id,
      },
      suggestedActions: [
        'Pre-fill last vitals',
        'Show previous prescription',
        'Add to queue with follow-up fee',
      ],
    }
  }

  // ── Case 2: Active ANC patient ─────────────────────────────
  if (ancEncounters.length > 0) {
    const obData = ancEncounters[0].ob_data as any
    if (obData?.edd) {
      const edd = new Date(obData.edd)
      const now = new Date()
      if (edd > now) {
        // Active pregnancy
        const ancEncCount = encounters.filter(e => {
          const ob = e.ob_data as any
          return ob && ob.lmp
        }).length

        return {
          visitType: 'anc-followup',
          confidence: 'high',
          suggestedFee: feeConfig.ancVisit,
          reason: `Active ANC patient (EDD: ${obData.edd}). Visit #${ancEncCount + 1}`,
          lastVisit: encounters[0] ? {
            date: encounters[0].encounter_date,
            complaint: encounters[0].chief_complaint || '',
            diagnosis: encounters[0].diagnosis || '',
            daysSince: daysBetween(encounters[0].encounter_date, today),
            doctorName: encounters[0].doctor_name || '',
          } : undefined,
          ancData: {
            gestationalAge: obData.gestational_age || '',
            edd: obData.edd,
            visitNumber: ancEncCount + 1,
          },
          suggestedActions: [
            'Open ANC form with pre-filled data',
            'Show growth charts',
            'Add to queue as ANC',
          ],
        }
      }
    }
  }

  // ── Case 3: Post-operative follow-up ───────────────────────
  if (recentAdmissions.length > 0) {
    const lastAdm = recentAdmissions[0]
    const daysSinceDischarge = daysBetween(lastAdm.admission_date, today)
    if (daysSinceDischarge <= 30) {
      return {
        visitType: 'post-op',
        confidence: 'high',
        suggestedFee: feeConfig.postOpVisit,
        reason: `Post-operative follow-up (discharged ${daysSinceDischarge} days ago: ${lastAdm.diagnosis_on_admission})`,
        lastVisit: encounters[0] ? {
          date: encounters[0].encounter_date,
          complaint: encounters[0].chief_complaint || '',
          diagnosis: encounters[0].diagnosis || '',
          daysSince: daysBetween(encounters[0].encounter_date, today),
          doctorName: encounters[0].doctor_name || '',
        } : undefined,
        suggestedActions: [
          'Show discharge summary',
          'Check wound/recovery status',
          'Add to queue as post-op (no fee / package)',
        ],
      }
    }
  }

  // ── Case 4: Recent visit (within 7 days) ───────────────────
  if (encounters.length > 0) {
    const lastEnc = encounters[0]
    const daysSince = daysBetween(lastEnc.encounter_date, today)

    if (daysSince <= 7) {
      return {
        visitType: 'follow-up',
        confidence: 'high',
        suggestedFee: feeConfig.followUp7Days,
        reason: `Last visit was ${daysSince} day${daysSince !== 1 ? 's' : ''} ago for: ${lastEnc.chief_complaint || lastEnc.diagnosis || 'consultation'}`,
        lastVisit: {
          date: lastEnc.encounter_date,
          complaint: lastEnc.chief_complaint || '',
          diagnosis: lastEnc.diagnosis || '',
          daysSince,
          doctorName: lastEnc.doctor_name || '',
        },
        suggestedActions: [
          'Apply follow-up fee (within 7 days)',
          'Show previous prescription',
          'Pre-fill complaint from last visit',
        ],
      }
    }

    if (daysSince <= 30) {
      return {
        visitType: 'follow-up',
        confidence: 'medium',
        suggestedFee: feeConfig.followUp30Days,
        reason: `Last visit was ${daysSince} days ago. Likely follow-up for: ${lastEnc.diagnosis || lastEnc.chief_complaint || 'previous condition'}`,
        lastVisit: {
          date: lastEnc.encounter_date,
          complaint: lastEnc.chief_complaint || '',
          diagnosis: lastEnc.diagnosis || '',
          daysSince,
          doctorName: lastEnc.doctor_name || '',
        },
        suggestedActions: [
          'Verify: Is this for same problem?',
          'Apply follow-up fee if same complaint',
          'Apply new consultation fee if different problem',
        ],
      }
    }

    // More than 30 days — likely new case
    return {
      visitType: 'new',
      confidence: 'medium',
      suggestedFee: feeConfig.newConsultation,
      reason: `Last visit was ${daysSince} days ago. Likely a new consultation.`,
      lastVisit: {
        date: lastEnc.encounter_date,
        complaint: lastEnc.chief_complaint || '',
        diagnosis: lastEnc.diagnosis || '',
        daysSince,
        doctorName: lastEnc.doctor_name || '',
      },
      suggestedActions: [
        'New consultation fee applies',
        'Ask if related to previous condition',
        'Register as new case',
      ],
    }
  }

  // ── Case 5: First-time patient ─────────────────────────────
  return {
    visitType: 'new',
    confidence: 'high',
    suggestedFee: feeConfig.newConsultation,
    reason: 'First-time visitor — no previous encounters found.',
    suggestedActions: [
      'New consultation fee applies',
      'Complete registration if needed',
      'Add to queue',
    ],
  }
}

// ── Utility ──────────────────────────────────────────────────

function daysBetween(dateStr: string, today: string): number {
  const d1 = new Date(dateStr)
  const d2 = new Date(today)
  const diff = d2.getTime() - d1.getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}
