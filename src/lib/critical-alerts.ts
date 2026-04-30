/**
 * src/lib/critical-alerts.ts  — UPDATED
 *
 * Critical Value Detection — wired into OPD edit page on every save and blur.
 *
 * Changes vs original:
 *  - Consistent return type { hasCritical, alerts }
 *  - alerts[] now has { level, message, value } for audit logging
 *  - Added lab-result critical values (Hb, glucose, K+, Na+)
 *  - Added pregnancy-specific thresholds
 */

export interface CriticalValueAlert {
  level:   'critical' | 'warning'
  message: string
  value:   string | number
  field:   string
}

export interface CriticalCheckResult {
  hasCritical: boolean
  hasWarning:  boolean
  alerts:      CriticalValueAlert[]
}

export interface VitalsInput {
  bp_systolic?:  number
  bp_diastolic?: number
  pulse?:        number
  spo2?:         number
  temperature?:  number
  weight?:       number
  rr?:           number    // respiratory rate
  // Lab values (optional)
  hemoglobin?:   number
  glucose?:      number
  potassium?:    number
  sodium?:       number
}

export interface PatientContext {
  patientAge?:  number
  isPregnant?:  boolean
  gestWeeks?:   number
}

/**
 * Check vitals (and optional lab values) for critical/warning values.
 * Thresholds based on Indian AHA/ESC/FOGSI guidelines.
 */
export function checkCriticalValues(
  vitals:  VitalsInput,
  context: PatientContext = {},
): CriticalCheckResult {
  const alerts: CriticalValueAlert[] = []

  const { bp_systolic, bp_diastolic, pulse, spo2, temperature, hemoglobin, glucose, potassium, sodium } = vitals
  const { isPregnant, gestWeeks } = context

  // ── Blood Pressure ──────────────────────────────────────────

  if (bp_systolic !== undefined && !isNaN(bp_systolic)) {
    if (bp_systolic >= 180) {
      alerts.push({
        level:   'critical',
        field:   'bp_systolic',
        value:   bp_systolic,
        message: `Hypertensive Crisis: Systolic BP ${bp_systolic} mmHg (≥180). Immediate action required.`,
      })
    } else if (bp_systolic >= 160) {
      alerts.push({
        level:   isPregnant ? 'critical' : 'warning',
        field:   'bp_systolic',
        value:   bp_systolic,
        message: isPregnant
          ? `Severe Hypertension in Pregnancy: Systolic ${bp_systolic} mmHg. Risk of eclampsia — start MgSO₄ protocol.`
          : `Severe Hypertension: Systolic ${bp_systolic} mmHg (≥160). Urgent treatment needed.`,
      })
    } else if (bp_systolic <= 80) {
      alerts.push({
        level:   'critical',
        field:   'bp_systolic',
        value:   bp_systolic,
        message: `Hypotension: Systolic BP ${bp_systolic} mmHg (≤80). Shock possible — check perfusion.`,
      })
    }
  }

  if (bp_diastolic !== undefined && !isNaN(bp_diastolic)) {
    if (bp_diastolic >= 110) {
      alerts.push({
        level:   'critical',
        field:   'bp_diastolic',
        value:   bp_diastolic,
        message: isPregnant
          ? `Severe Diastolic Hypertension: ${bp_diastolic} mmHg in pregnancy. Pre-eclampsia risk — assess immediately.`
          : `Hypertensive Crisis: Diastolic BP ${bp_diastolic} mmHg (≥110). Immediate intervention required.`,
      })
    } else if (bp_diastolic >= 100 && isPregnant) {
      alerts.push({
        level:   'warning',
        field:   'bp_diastolic',
        value:   bp_diastolic,
        message: `Diastolic BP ${bp_diastolic} mmHg in pregnancy. Monitor closely for pre-eclampsia.`,
      })
    }
  }

  // ── Pulse ────────────────────────────────────────────────────

  if (pulse !== undefined && !isNaN(pulse)) {
    if (pulse < 40) {
      alerts.push({
        level:   'critical',
        field:   'pulse',
        value:   pulse,
        message: `Severe Bradycardia: Pulse ${pulse} bpm (<40). Cardiac monitoring required immediately.`,
      })
    } else if (pulse < 50) {
      alerts.push({
        level:   'warning',
        field:   'pulse',
        value:   pulse,
        message: `Bradycardia: Pulse ${pulse} bpm. Check for medications, cardiac cause.`,
      })
    } else if (pulse > 140) {
      alerts.push({
        level:   'critical',
        field:   'pulse',
        value:   pulse,
        message: `Severe Tachycardia: Pulse ${pulse} bpm (>140). Evaluate for arrhythmia, sepsis, haemorrhage.`,
      })
    } else if (pulse > 100) {
      alerts.push({
        level:   'warning',
        field:   'pulse',
        value:   pulse,
        message: `Tachycardia: Pulse ${pulse} bpm. Investigate cause (pain, fever, anaemia, anxiety).`,
      })
    }
  }

  // ── SpO₂ ─────────────────────────────────────────────────────

  if (spo2 !== undefined && !isNaN(spo2)) {
    if (spo2 < 90) {
      alerts.push({
        level:   'critical',
        field:   'spo2',
        value:   spo2,
        message: `Critical Hypoxia: SpO₂ ${spo2}% (<90). Start oxygen immediately — risk of organ damage.`,
      })
    } else if (spo2 < 94) {
      alerts.push({
        level:   'warning',
        field:   'spo2',
        value:   spo2,
        message: `Low SpO₂: ${spo2}% (94–90 range). Consider supplemental oxygen, monitor respiratory status.`,
      })
    }
  }

  // ── Temperature ──────────────────────────────────────────────

  if (temperature !== undefined && !isNaN(temperature)) {
    if (temperature >= 39.5) {
      alerts.push({
        level:   'critical',
        field:   'temperature',
        value:   temperature,
        message: `High Fever: ${temperature}°C. Possible sepsis — blood cultures, IV antibiotics, sepsis protocol.`,
      })
    } else if (temperature >= 38.5) {
      alerts.push({
        level:   'warning',
        field:   'temperature',
        value:   temperature,
        message: `Fever: ${temperature}°C. Investigate infection source. ${isPregnant ? 'Chorioamnionitis risk in pregnancy.' : ''}`,
      })
    } else if (temperature < 35) {
      alerts.push({
        level:   'critical',
        field:   'temperature',
        value:   temperature,
        message: `Hypothermia: ${temperature}°C (<35°C). Active rewarming required.`,
      })
    }
  }

  // ── Haemoglobin (if provided from labs) ──────────────────────

  if (hemoglobin !== undefined && !isNaN(hemoglobin)) {
    const critThreshold  = isPregnant ? 7.0 : 6.0
    const warnThreshold  = isPregnant ? 9.0 : 8.0

    if (hemoglobin < critThreshold) {
      alerts.push({
        level:   'critical',
        field:   'hemoglobin',
        value:   hemoglobin,
        message: `Severe Anaemia: Hb ${hemoglobin} g/dL. ${isPregnant ? 'Blood transfusion likely needed in pregnancy.' : 'Transfusion threshold — evaluate immediately.'}`,
      })
    } else if (hemoglobin < warnThreshold) {
      alerts.push({
        level:   'warning',
        field:   'hemoglobin',
        value:   hemoglobin,
        message: `Anaemia: Hb ${hemoglobin} g/dL. Iron supplementation / investigation needed.`,
      })
    }
  }

  // ── Blood Glucose ─────────────────────────────────────────────

  if (glucose !== undefined && !isNaN(glucose)) {
    if (glucose > 400) {
      alerts.push({
        level:   'critical',
        field:   'glucose',
        value:   glucose,
        message: `Severe Hyperglycaemia: Blood glucose ${glucose} mg/dL. Possible DKA — urgent insulin & hydration.`,
      })
    } else if (glucose < 50) {
      alerts.push({
        level:   'critical',
        field:   'glucose',
        value:   glucose,
        message: `Severe Hypoglycaemia: Blood glucose ${glucose} mg/dL. Immediate IV dextrose required.`,
      })
    }
  }

  // ── Electrolytes ──────────────────────────────────────────────

  if (potassium !== undefined && !isNaN(potassium)) {
    if (potassium > 6.0) {
      alerts.push({ level: 'critical', field: 'potassium', value: potassium, message: `Hyperkalaemia: K⁺ ${potassium} mEq/L (>6.0). Cardiac arrhythmia risk — ECG immediately.` })
    } else if (potassium < 2.5) {
      alerts.push({ level: 'critical', field: 'potassium', value: potassium, message: `Severe Hypokalaemia: K⁺ ${potassium} mEq/L (<2.5). IV replacement with cardiac monitoring.` })
    }
  }

  if (sodium !== undefined && !isNaN(sodium)) {
    if (sodium > 155) {
      alerts.push({ level: 'critical', field: 'sodium', value: sodium, message: `Severe Hypernatraemia: Na⁺ ${sodium} mEq/L. IV free water replacement needed.` })
    } else if (sodium < 120) {
      alerts.push({ level: 'critical', field: 'sodium', value: sodium, message: `Severe Hyponatraemia: Na⁺ ${sodium} mEq/L. Risk of cerebral oedema — gradual correction required.` })
    }
  }

  return {
    hasCritical: alerts.some(a => a.level === 'critical'),
    hasWarning:  alerts.some(a => a.level === 'warning'),
    alerts,
  }
}