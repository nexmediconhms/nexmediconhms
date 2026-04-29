/**
 * src/lib/critical-alerts.ts
 *
 * Critical Value Alert & Escalation Workflow
 *
 * Monitors vital signs and lab values for critical thresholds.
 * When a critical value is detected:
 *   1. Alert is created in the database
 *   2. On-screen notification shown to the doctor
 *   3. If not acknowledged within timeout → escalation (SMS/WhatsApp to senior doctor)
 *
 * Critical thresholds based on:
 *   - WHO guidelines
 *   - Indian NMC clinical standards
 *   - Standard medical practice
 */

import { supabase } from './supabase'

// ─── Types ────────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'high' | 'medium'
export type AlertStatus = 'open' | 'acknowledged' | 'resolved' | 'escalated'

export interface CriticalAlert {
  id?: string
  patient_id: string
  encounter_id?: string
  alert_type: 'vital' | 'lab' | 'drug_interaction' | 'allergy'
  parameter: string
  value: string
  threshold: string
  severity: AlertSeverity
  message: string
  action_required: string
  status: AlertStatus
}

export interface CriticalValueCheck {
  parameter: string
  value: number
  unit: string
  severity: AlertSeverity
  message: string
  action: string
  threshold: string
}

// ─── Critical Value Thresholds ────────────────────────────────

interface ThresholdRange {
  parameter: string
  unit: string
  criticalLow?: number
  criticalHigh?: number
  highLow?: number       // "high severity" low threshold
  highHigh?: number      // "high severity" high threshold
  messageLow: string
  messageHigh: string
  actionLow: string
  actionHigh: string
}

const VITAL_THRESHOLDS: ThresholdRange[] = [
  {
    parameter: 'bp_systolic',
    unit: 'mmHg',
    criticalLow: 70,
    criticalHigh: 200,
    highLow: 80,
    highHigh: 180,
    messageLow: 'Severe hypotension — possible shock',
    messageHigh: 'Hypertensive emergency',
    actionLow: 'EMERGENCY: IV fluids, vasopressors. Check for bleeding, sepsis, anaphylaxis.',
    actionHigh: 'EMERGENCY: IV antihypertensives (labetalol/hydralazine). Check for end-organ damage. CT head if neurological symptoms.',
  },
  {
    parameter: 'bp_diastolic',
    unit: 'mmHg',
    criticalLow: 40,
    criticalHigh: 130,
    highLow: 50,
    highHigh: 120,
    messageLow: 'Severe diastolic hypotension',
    messageHigh: 'Diastolic hypertensive emergency',
    actionLow: 'Assess for shock. IV access. Fluid resuscitation.',
    actionHigh: 'IV antihypertensives. Monitor for aortic dissection, stroke, eclampsia.',
  },
  {
    parameter: 'pulse',
    unit: 'bpm',
    criticalLow: 35,
    criticalHigh: 180,
    highLow: 45,
    highHigh: 150,
    messageLow: 'Severe bradycardia — risk of cardiac arrest',
    messageHigh: 'Severe tachycardia — hemodynamic compromise risk',
    actionLow: 'EMERGENCY: Atropine 0.5mg IV. Prepare for transcutaneous pacing. ECG stat.',
    actionHigh: 'ECG stat. Check for SVT/VT. Consider adenosine (SVT) or cardioversion (unstable).',
  },
  {
    parameter: 'spo2',
    unit: '%',
    criticalLow: 85,
    highLow: 90,
    messageLow: 'Severe hypoxemia — respiratory failure',
    messageHigh: 'Hypoxemia',
    actionLow: 'EMERGENCY: High-flow O₂. Prepare for intubation. ABG stat. CXR.',
    actionHigh: 'Supplemental O₂. ABG. Investigate cause (PE, pneumonia, asthma, COPD).',
  },
  {
    parameter: 'temperature',
    unit: '°C',
    criticalLow: 34,
    criticalHigh: 41,
    highLow: 35,
    highHigh: 40,
    messageLow: 'Hypothermia — risk of cardiac arrhythmia',
    messageHigh: 'Hyperpyrexia — risk of seizures, organ damage',
    actionLow: 'Active rewarming. Warm IV fluids. Continuous cardiac monitoring.',
    actionHigh: 'Aggressive cooling. Antipyretics. Blood cultures. Check for meningitis, sepsis.',
  },
]

const LAB_THRESHOLDS: ThresholdRange[] = [
  {
    parameter: 'haemoglobin',
    unit: 'g/dL',
    criticalLow: 5,
    highLow: 7,
    messageLow: 'Life-threatening anaemia — immediate transfusion needed',
    messageHigh: 'Severe anaemia',
    actionLow: 'EMERGENCY: Type & crossmatch. Transfuse packed RBCs. Check for active bleeding.',
    actionHigh: 'Urgent: Prepare for transfusion. IV iron. Investigate cause (bleeding, hemolysis, nutritional).',
  },
  {
    parameter: 'platelet_count',
    unit: '×10³/μL',
    criticalLow: 20,
    highLow: 50,
    criticalHigh: 1000,
    messageLow: 'Severe thrombocytopenia — spontaneous bleeding risk',
    messageHigh: 'Thrombocytosis — thrombotic risk',
    actionLow: 'EMERGENCY: Platelet transfusion if bleeding. Avoid IM injections, NSAIDs. Check for DIC, ITP, HUS.',
    actionHigh: 'Investigate cause. Check for myeloproliferative disorder. Aspirin if thrombotic risk.',
  },
  {
    parameter: 'blood_sugar_random',
    unit: 'mg/dL',
    criticalLow: 40,
    criticalHigh: 500,
    highLow: 54,
    highHigh: 400,
    messageLow: 'Severe hypoglycemia — risk of seizures, brain damage',
    messageHigh: 'Severe hyperglycemia — DKA/HHS risk',
    actionLow: 'EMERGENCY: 25ml of 50% dextrose IV push. Recheck in 15 min. Identify cause.',
    actionHigh: 'Check for DKA (ketones, ABG). IV insulin infusion. Aggressive hydration.',
  },
  {
    parameter: 'blood_sugar_fasting',
    unit: 'mg/dL',
    criticalLow: 40,
    criticalHigh: 400,
    highLow: 54,
    highHigh: 300,
    messageLow: 'Severe fasting hypoglycemia',
    messageHigh: 'Severe fasting hyperglycemia',
    actionLow: 'IV dextrose. Investigate insulinoma, medication error.',
    actionHigh: 'Start/adjust insulin. Check HbA1c. Screen for DKA.',
  },
  {
    parameter: 'serum_potassium',
    unit: 'mEq/L',
    criticalLow: 2.5,
    criticalHigh: 6.5,
    highLow: 3.0,
    highHigh: 5.5,
    messageLow: 'Severe hypokalemia — cardiac arrhythmia risk',
    messageHigh: 'Severe hyperkalemia — cardiac arrest risk',
    actionLow: 'EMERGENCY: IV KCl infusion (max 20 mEq/hr). Continuous ECG monitoring.',
    actionHigh: 'EMERGENCY: Calcium gluconate IV (cardioprotection). Insulin + dextrose. Nebulized salbutamol. Kayexalate.',
  },
  {
    parameter: 'serum_sodium',
    unit: 'mEq/L',
    criticalLow: 120,
    criticalHigh: 160,
    highLow: 125,
    highHigh: 155,
    messageLow: 'Severe hyponatremia — seizure risk, cerebral edema',
    messageHigh: 'Severe hypernatremia — altered consciousness, seizures',
    actionLow: 'Fluid restriction. If symptomatic: 3% NaCl (max 1-2 mEq/L/hr correction).',
    actionHigh: 'Free water replacement. Correct slowly (max 10 mEq/L/day).',
  },
  {
    parameter: 'serum_creatinine',
    unit: 'mg/dL',
    criticalHigh: 10,
    highHigh: 5,
    messageLow: '',
    messageHigh: 'Severe renal failure — possible need for dialysis',
    actionLow: '',
    actionHigh: 'Nephrology consult. Check for uremia symptoms. Prepare for dialysis if indicated.',
  },
  {
    parameter: 'inr',
    unit: '',
    criticalHigh: 5,
    highHigh: 4,
    messageLow: '',
    messageHigh: 'Supratherapeutic INR — major bleeding risk',
    actionLow: '',
    actionHigh: 'Hold warfarin. Vitamin K if INR > 9 or bleeding. FFP if active bleeding.',
  },
]

// ─── Check Functions ──────────────────────────────────────────

/**
 * Check a single vital sign against critical thresholds.
 */
function checkThreshold(
  parameter: string,
  value: number,
  thresholds: ThresholdRange[]
): CriticalValueCheck | null {
  const threshold = thresholds.find(t => t.parameter === parameter)
  if (!threshold) return null

  // Critical low
  if (threshold.criticalLow !== undefined && value <= threshold.criticalLow) {
    return {
      parameter,
      value,
      unit: threshold.unit,
      severity: 'critical',
      message: `🚨 CRITICAL: ${parameter.replace(/_/g, ' ')} = ${value} ${threshold.unit} — ${threshold.messageLow}`,
      action: threshold.actionLow,
      threshold: `≤ ${threshold.criticalLow} ${threshold.unit}`,
    }
  }

  // Critical high
  if (threshold.criticalHigh !== undefined && value >= threshold.criticalHigh) {
    return {
      parameter,
      value,
      unit: threshold.unit,
      severity: 'critical',
      message: `🚨 CRITICAL: ${parameter.replace(/_/g, ' ')} = ${value} ${threshold.unit} — ${threshold.messageHigh}`,
      action: threshold.actionHigh,
      threshold: `≥ ${threshold.criticalHigh} ${threshold.unit}`,
    }
  }

  // High severity low
  if (threshold.highLow !== undefined && value <= threshold.highLow) {
    return {
      parameter,
      value,
      unit: threshold.unit,
      severity: 'high',
      message: `⚠️ HIGH: ${parameter.replace(/_/g, ' ')} = ${value} ${threshold.unit} — ${threshold.messageLow}`,
      action: threshold.actionLow,
      threshold: `≤ ${threshold.highLow} ${threshold.unit}`,
    }
  }

  // High severity high
  if (threshold.highHigh !== undefined && value >= threshold.highHigh) {
    return {
      parameter,
      value,
      unit: threshold.unit,
      severity: 'high',
      message: `⚠️ HIGH: ${parameter.replace(/_/g, ' ')} = ${value} ${threshold.unit} — ${threshold.messageHigh}`,
      action: threshold.actionHigh,
      threshold: `≥ ${threshold.highHigh} ${threshold.unit}`,
    }
  }

  return null
}

/**
 * Check all vitals from an encounter for critical values.
 */
export function checkVitals(vitals: {
  bp_systolic?: number
  bp_diastolic?: number
  pulse?: number
  spo2?: number
  temperature?: number
}): CriticalValueCheck[] {
  const alerts: CriticalValueCheck[] = []

  if (vitals.bp_systolic) {
    const check = checkThreshold('bp_systolic', vitals.bp_systolic, VITAL_THRESHOLDS)
    if (check) alerts.push(check)
  }
  if (vitals.bp_diastolic) {
    const check = checkThreshold('bp_diastolic', vitals.bp_diastolic, VITAL_THRESHOLDS)
    if (check) alerts.push(check)
  }
  if (vitals.pulse) {
    const check = checkThreshold('pulse', vitals.pulse, VITAL_THRESHOLDS)
    if (check) alerts.push(check)
  }
  if (vitals.spo2) {
    const check = checkThreshold('spo2', vitals.spo2, VITAL_THRESHOLDS)
    if (check) alerts.push(check)
  }
  if (vitals.temperature) {
    const check = checkThreshold('temperature', vitals.temperature, VITAL_THRESHOLDS)
    if (check) alerts.push(check)
  }

  return alerts
}

/**
 * Check lab values for critical results.
 */
export function checkLabValues(labs: Record<string, number>): CriticalValueCheck[] {
  const alerts: CriticalValueCheck[] = []

  for (const [param, value] of Object.entries(labs)) {
    if (typeof value !== 'number' || isNaN(value)) continue
    const check = checkThreshold(param, value, LAB_THRESHOLDS)
    if (check) alerts.push(check)
  }

  return alerts
}

// ─── Database Operations ──────────────────────────────────────

/**
 * Save a critical alert to the database.
 */
export async function createCriticalAlert(alert: Omit<CriticalAlert, 'id'>): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('critical_alerts')
      .insert(alert)
      .select('id')
      .single()

    if (error) {
      console.error('[CriticalAlert] Failed to create:', error.message)
      return null
    }
    return data?.id || null
  } catch {
    return null
  }
}

/**
 * Acknowledge a critical alert.
 */
export async function acknowledgeCriticalAlert(
  alertId: string,
  userId: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('critical_alerts')
      .update({
        status: 'acknowledged',
        acknowledged_by: userId,
        acknowledged_at: new Date().toISOString(),
      })
      .eq('id', alertId)

    return !error
  } catch {
    return false
  }
}

/**
 * Resolve a critical alert with notes.
 */
export async function resolveCriticalAlert(
  alertId: string,
  userId: string,
  notes: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('critical_alerts')
      .update({
        status: 'resolved',
        resolved_by: userId,
        resolved_at: new Date().toISOString(),
        resolution_notes: notes,
      })
      .eq('id', alertId)

    return !error
  } catch {
    return false
  }
}

/**
 * Get all open critical alerts for a patient.
 */
export async function getOpenAlerts(patientId?: string): Promise<CriticalAlert[]> {
  try {
    let query = supabase
      .from('critical_alerts')
      .select('*')
      .in('status', ['open', 'acknowledged'])
      .order('created_at', { ascending: false })

    if (patientId) {
      query = query.eq('patient_id', patientId)
    }

    const { data, error } = await query
    if (error) return []
    return (data || []) as CriticalAlert[]
  } catch {
    return []
  }
}

/**
 * Auto-create critical alerts from vitals check.
 * Call this when saving an encounter with vitals.
 */
export async function autoCreateVitalAlerts(
  patientId: string,
  encounterId: string,
  vitals: {
    bp_systolic?: number
    bp_diastolic?: number
    pulse?: number
    spo2?: number
    temperature?: number
  }
): Promise<CriticalValueCheck[]> {
  const checks = checkVitals(vitals)

  for (const check of checks) {
    if (check.severity === 'critical' || check.severity === 'high') {
      await createCriticalAlert({
        patient_id: patientId,
        encounter_id: encounterId,
        alert_type: 'vital',
        parameter: check.parameter,
        value: `${check.value} ${check.unit}`,
        threshold: check.threshold,
        severity: check.severity,
        message: check.message,
        action_required: check.action,
        status: 'open',
      })
    }
  }

  return checks
}
