/**
 * Clinical Risk Assessment Engine for NexMedicon HMS
 *
 * Automatically flags high-risk obstetric and general patients based on
 * clinical data already captured in the system.
 *
 * RISK FACTORS (evidence-based, India-specific):
 *
 * 1. BP ≥ 140/90  → Pregnancy-induced hypertension / Pre-eclampsia
 *    - #1 cause of maternal death in India
 *    - BP data is in encounters (bp_systolic, bp_diastolic)
 *
 * 2. Haemoglobin < 10 g/dL → Anaemia
 *    - Affects 50-60% of pregnant women in India
 *    - Stored in ob_data.haemoglobin or lab results
 *
 * 3. Previous Caesarean Section → Uterine rupture risk
 *    - ob_data.previous_cs field
 *
 * 4. Gestational Diabetes → Blood sugar values
 *    - ob_data.gestational_diabetes or blood_sugar_fasting > 95 / pp > 140
 *
 * 5. Twins / Multiple Pregnancy
 *    - ob_data.multiple_pregnancy
 *
 * 6. GA > 40 weeks → Post-dates pregnancy
 *    - Calculated from EDD
 *
 * 7. Advanced Maternal Age (≥ 35)
 *    - From patient.age
 *
 * 8. Grand Multigravida (G5+)
 *    - From ob_data.gravida
 *
 * 9. Abnormal FHS (< 110 or > 160 bpm)
 *    - From ob_data.fhs
 *
 * 10. Abnormal liquor / Malpresentation
 *     - From ob_data.liquor, ob_data.presentation
 */

// ─── Types ────────────────────────────────────────────────────

export type RiskLevel = 'critical' | 'high' | 'watch' | 'normal'

export interface RiskFlag {
  level: RiskLevel
  category: string        // e.g., 'Hypertension', 'Anaemia'
  message: string         // human-readable description
  value?: string          // the actual value that triggered the flag
  action?: string         // recommended clinical action
}

export interface RiskAssessment {
  overall: RiskLevel
  flags: RiskFlag[]
  score: number           // 0-100, higher = more risk
}

// ─── Risk Assessment Functions ────────────────────────────────

/**
 * Assess obstetric risk from encounter vitals + OB data.
 * Call this with the latest encounter data for a pregnant patient.
 */
export function assessObstetricRisk(params: {
  age?: number
  bp_systolic?: number
  bp_diastolic?: number
  ob_data?: any
  haemoglobin?: number
}): RiskAssessment {
  const flags: RiskFlag[] = []
  const { age, bp_systolic, bp_diastolic, ob_data, haemoglobin } = params
  const ob = ob_data || {}

  // ── 1. Hypertension / Pre-eclampsia ────────────────────────
  if (bp_systolic && bp_diastolic) {
    if (bp_systolic >= 160 || bp_diastolic >= 110) {
      flags.push({
        level: 'critical',
        category: 'Severe Hypertension',
        message: `BP ${bp_systolic}/${bp_diastolic} mmHg — Severe hypertension / Eclampsia risk`,
        value: `${bp_systolic}/${bp_diastolic}`,
        action: 'Immediate evaluation. Consider MgSO₄ and antihypertensives. Refer to higher centre if needed.',
      })
    } else if (bp_systolic >= 140 || bp_diastolic >= 90) {
      flags.push({
        level: 'high',
        category: 'Hypertension',
        message: `BP ${bp_systolic}/${bp_diastolic} mmHg — Pregnancy-induced hypertension / Pre-eclampsia risk`,
        value: `${bp_systolic}/${bp_diastolic}`,
        action: 'Monitor BP closely. Check urine protein. Consider antihypertensives.',
      })
    }
  }

  // ── 2. Anaemia ─────────────────────────────────────────────
  const hb = haemoglobin || ob.haemoglobin
  if (hb) {
    if (hb < 7) {
      flags.push({
        level: 'critical',
        category: 'Severe Anaemia',
        message: `Hb ${hb} g/dL — Severe anaemia (< 7 g/dL)`,
        value: `${hb} g/dL`,
        action: 'Blood transfusion may be needed. IV iron. Refer if facilities unavailable.',
      })
    } else if (hb < 10) {
      flags.push({
        level: 'high',
        category: 'Anaemia',
        message: `Hb ${hb} g/dL — Anaemia (< 10 g/dL)`,
        value: `${hb} g/dL`,
        action: 'Start iron + folic acid supplementation. Recheck Hb in 4 weeks.',
      })
    } else if (hb < 11) {
      flags.push({
        level: 'watch',
        category: 'Mild Anaemia',
        message: `Hb ${hb} g/dL — Mild anaemia (< 11 g/dL)`,
        value: `${hb} g/dL`,
        action: 'Ensure iron supplementation. Dietary counselling.',
      })
    }
  }

  // ── 3. Previous Caesarean Section ──────────────────────────
  if (ob.previous_cs && ob.previous_cs > 0) {
    flags.push({
      level: ob.previous_cs >= 2 ? 'high' : 'watch',
      category: 'Previous CS',
      message: `${ob.previous_cs} previous caesarean section${ob.previous_cs > 1 ? 's' : ''} — Uterine rupture risk`,
      value: `${ob.previous_cs} CS`,
      action: ob.previous_cs >= 2
        ? 'Plan elective CS. Monitor for scar tenderness. Avoid oxytocin induction.'
        : 'Monitor scar tenderness. Discuss VBAC vs repeat CS.',
    })
  }

  // ── 4. Gestational Diabetes ────────────────────────────────
  if (ob.gestational_diabetes) {
    flags.push({
      level: 'high',
      category: 'Gestational Diabetes',
      message: 'Gestational diabetes mellitus (GDM)',
      action: 'Diet control. Monitor blood sugar. Consider insulin if uncontrolled. Watch for macrosomia.',
    })
  }
  // Also check blood sugar values
  if (ob.blood_sugar_fasting && ob.blood_sugar_fasting > 95) {
    flags.push({
      level: 'high',
      category: 'High Fasting Sugar',
      message: `Fasting blood sugar ${ob.blood_sugar_fasting} mg/dL (> 95)`,
      value: `${ob.blood_sugar_fasting} mg/dL`,
      action: 'Screen for GDM. OGTT if not done. Diet counselling.',
    })
  }
  if (ob.blood_sugar_pp && ob.blood_sugar_pp > 140) {
    flags.push({
      level: 'high',
      category: 'High PP Sugar',
      message: `Post-prandial blood sugar ${ob.blood_sugar_pp} mg/dL (> 140)`,
      value: `${ob.blood_sugar_pp} mg/dL`,
      action: 'Confirm GDM. Diet + exercise. Consider insulin.',
    })
  }

  // ── 5. Multiple Pregnancy (Twins/Triplets) ─────────────────
  if (ob.multiple_pregnancy) {
    flags.push({
      level: 'high',
      category: 'Multiple Pregnancy',
      message: 'Twins / Multiple pregnancy — Higher risk for preterm labour, pre-eclampsia',
      action: 'Frequent monitoring. Plan delivery at 37-38 weeks. Watch for preterm signs.',
    })
  }

  // ── 6. Post-dates (GA > 40 weeks) ─────────────────────────
  if (ob.edd) {
    const eddDate = new Date(ob.edd)
    const now = new Date()
    const daysOverdue = Math.floor((now.getTime() - eddDate.getTime()) / (24 * 60 * 60 * 1000))
    if (daysOverdue > 14) {
      flags.push({
        level: 'critical',
        category: 'Post-dates',
        message: `${Math.floor(daysOverdue / 7)} weeks past EDD — Significantly post-dates`,
        value: `EDD was ${ob.edd}`,
        action: 'Urgent: Consider induction or CS. NST + AFI assessment.',
      })
    } else if (daysOverdue > 7) {
      flags.push({
        level: 'high',
        category: 'Post-dates',
        message: `${daysOverdue} days past EDD — Post-dates pregnancy`,
        value: `EDD was ${ob.edd}`,
        action: 'Plan induction. NST + AFI. Daily fetal movement count.',
      })
    } else if (daysOverdue > 0) {
      flags.push({
        level: 'watch',
        category: 'Near Post-dates',
        message: `${daysOverdue} day${daysOverdue > 1 ? 's' : ''} past EDD`,
        value: `EDD was ${ob.edd}`,
        action: 'Monitor closely. NST if not in labour by 41 weeks.',
      })
    }
  }

  // ── 7. Advanced Maternal Age ───────────────────────────────
  if (age && age >= 35) {
    flags.push({
      level: age >= 40 ? 'high' : 'watch',
      category: 'Advanced Maternal Age',
      message: `Age ${age} years — ${age >= 40 ? 'Very advanced' : 'Advanced'} maternal age`,
      value: `${age}y`,
      action: 'Screen for chromosomal abnormalities. Monitor for GDM, pre-eclampsia.',
    })
  }

  // ── 8. Grand Multigravida ──────────────────────────────────
  if (ob.gravida && ob.gravida >= 5) {
    flags.push({
      level: 'watch',
      category: 'Grand Multigravida',
      message: `Gravida ${ob.gravida} — Grand multigravida`,
      value: `G${ob.gravida}`,
      action: 'Watch for PPH, malpresentation, uterine atony.',
    })
  }

  // ── 9. Abnormal FHS ────────────────────────────────────────
  if (ob.fhs) {
    if (ob.fhs < 100) {
      flags.push({
        level: 'critical',
        category: 'Fetal Bradycardia',
        message: `FHS ${ob.fhs} bpm — Severe fetal bradycardia`,
        value: `${ob.fhs} bpm`,
        action: 'Immediate evaluation. Left lateral position. Consider emergency delivery.',
      })
    } else if (ob.fhs < 110 || ob.fhs > 160) {
      flags.push({
        level: 'high',
        category: 'Abnormal FHS',
        message: `FHS ${ob.fhs} bpm — ${ob.fhs < 110 ? 'Bradycardia' : 'Tachycardia'}`,
        value: `${ob.fhs} bpm`,
        action: 'Continuous monitoring. NST. Evaluate for fetal distress.',
      })
    }
  }

  // ── 10. Abnormal Liquor / Malpresentation ──────────────────
  if (ob.liquor === 'Reduced' || ob.liquor === 'Absent') {
    flags.push({
      level: ob.liquor === 'Absent' ? 'critical' : 'high',
      category: 'Oligohydramnios',
      message: `${ob.liquor} liquor — Oligohydramnios`,
      action: 'AFI measurement. Evaluate fetal well-being. Consider delivery if severe.',
    })
  }
  if (ob.liquor === 'Increased') {
    flags.push({
      level: 'watch',
      category: 'Polyhydramnios',
      message: 'Increased liquor — Polyhydramnios',
      action: 'Screen for GDM, fetal anomalies. Monitor.',
    })
  }
  if (ob.presentation === 'Breech') {
    flags.push({
      level: 'watch',
      category: 'Breech',
      message: 'Breech presentation',
      action: 'ECV if > 36 weeks. Plan CS if persists at term.',
    })
  }
  if (ob.presentation === 'Transverse') {
    flags.push({
      level: 'high',
      category: 'Transverse Lie',
      message: 'Transverse lie — Cannot deliver vaginally',
      action: 'Plan CS. Admit if near term.',
    })
  }

  // ── 11. Scar Tenderness (previous CS) ──────────────────────
  if (ob.scar_tenderness === 'Present' || ob.scar_tenderness === 'Yes') {
    flags.push({
      level: 'critical',
      category: 'Scar Tenderness',
      message: 'Scar tenderness present — Impending uterine rupture risk',
      action: 'EMERGENCY: Prepare for immediate CS. Do NOT induce labour.',
    })
  }

  // ── 12. Reduced Fetal Movement ─────────────────────────────
  if (ob.fetal_movement === 'Reduced' || ob.fetal_movement === 'Absent') {
    flags.push({
      level: ob.fetal_movement === 'Absent' ? 'critical' : 'high',
      category: 'Fetal Movement',
      message: `${ob.fetal_movement} fetal movements`,
      action: 'Urgent NST. Evaluate for fetal distress. Consider delivery if non-reassuring.',
    })
  }

  // ── 13. AFI-based Oligohydramnios / Polyhydramnios ─────────
  if (ob.afi !== undefined && ob.afi !== null) {
    if (ob.afi < 5) {
      flags.push({
        level: 'critical',
        category: 'Oligohydramnios (AFI)',
        message: `AFI ${ob.afi} cm — Severe oligohydramnios (< 5 cm)`,
        value: `${ob.afi} cm`,
        action: 'Urgent: Evaluate fetal well-being. NST + BPP. Consider delivery.',
      })
    } else if (ob.afi < 8) {
      flags.push({
        level: 'high',
        category: 'Low AFI',
        message: `AFI ${ob.afi} cm — Borderline low (< 8 cm)`,
        value: `${ob.afi} cm`,
        action: 'Close monitoring. Repeat AFI in 1 week. Ensure adequate hydration.',
      })
    } else if (ob.afi > 25) {
      flags.push({
        level: 'high',
        category: 'Polyhydramnios (AFI)',
        message: `AFI ${ob.afi} cm — Polyhydramnios (> 25 cm)`,
        value: `${ob.afi} cm`,
        action: 'Screen for GDM, fetal anomalies (TEF, duodenal atresia). Detailed anomaly scan.',
      })
    }
  }

  // ── 14. Placenta Previa ────────────────────────────────────
  if (ob.placenta === 'Previa') {
    flags.push({
      level: 'critical',
      category: 'Placenta Previa',
      message: 'Placenta previa — High risk for antepartum haemorrhage',
      action: 'No PV exam. Plan elective CS at 37-38 weeks. Admit if bleeding.',
    })
  } else if (ob.placenta === 'Low-lying') {
    flags.push({
      level: 'high',
      category: 'Low-lying Placenta',
      message: 'Low-lying placenta — May migrate. Repeat scan at 32-34 weeks.',
      action: 'Repeat TVS at 32-34 weeks. Avoid strenuous activity.',
    })
  }

  // ── 15. Macrosomia (large baby) ────────────────────────────
  if (ob.efw && ob.efw > 4000) {
    flags.push({
      level: 'high',
      category: 'Macrosomia',
      message: `EFW ${ob.efw}g (${(ob.efw/1000).toFixed(1)} kg) — Macrosomia risk`,
      value: `${ob.efw}g`,
      action: 'Screen for GDM. Consider CS if > 4.5 kg. Watch for shoulder dystocia.',
    })
  }

  // ── 16. IUGR (small baby) ─────────────────────────────────
  // Very rough check — EFW < 10th percentile varies by GA
  // Using simplified threshold: < 2000g after 34 weeks
  if (ob.efw && ob.efw < 2000 && ob.edd) {
    const eddDate = new Date(ob.edd)
    const now = new Date()
    const weeksToEDD = Math.round((eddDate.getTime() - now.getTime()) / (7 * 24 * 60 * 60 * 1000))
    if (weeksToEDD <= 6) { // roughly > 34 weeks
      flags.push({
        level: 'high',
        category: 'Possible IUGR',
        message: `EFW ${ob.efw}g at near-term — Possible intrauterine growth restriction`,
        value: `${ob.efw}g`,
        action: 'Doppler study. NST. Consider early delivery if compromised.',
      })
    }
  }

  // ── Calculate overall risk ─────────────────────────────────
  const overall = calculateOverallRisk(flags)
  const score = calculateRiskScore(flags)

  return { overall, flags, score }
}

/**
 * Assess general (non-obstetric) clinical risk from encounter vitals.
 * Used for all patients, not just pregnant ones.
 */
export function assessVitalRisk(params: {
  bp_systolic?: number
  bp_diastolic?: number
  pulse?: number
  temperature?: number
  spo2?: number
}): RiskFlag[] {
  const flags: RiskFlag[] = []
  const { bp_systolic, bp_diastolic, pulse, temperature, spo2 } = params

  // Hypertension
  if (bp_systolic && bp_diastolic) {
    if (bp_systolic >= 180 || bp_diastolic >= 120) {
      flags.push({
        level: 'critical',
        category: 'Hypertensive Crisis',
        message: `BP ${bp_systolic}/${bp_diastolic} — Hypertensive crisis`,
        value: `${bp_systolic}/${bp_diastolic}`,
        action: 'Immediate treatment. Consider IV antihypertensives.',
      })
    } else if (bp_systolic >= 140 || bp_diastolic >= 90) {
      flags.push({
        level: 'high',
        category: 'Hypertension',
        message: `BP ${bp_systolic}/${bp_diastolic} — Hypertension`,
        value: `${bp_systolic}/${bp_diastolic}`,
      })
    }
    // Hypotension
    if (bp_systolic < 90 || bp_diastolic < 60) {
      flags.push({
        level: 'high',
        category: 'Hypotension',
        message: `BP ${bp_systolic}/${bp_diastolic} — Low blood pressure`,
        value: `${bp_systolic}/${bp_diastolic}`,
        action: 'Check for dehydration, bleeding, sepsis.',
      })
    }
  }

  // Tachycardia / Bradycardia
  if (pulse) {
    if (pulse > 120) {
      flags.push({
        level: 'high',
        category: 'Tachycardia',
        message: `Pulse ${pulse} bpm — Tachycardia`,
        value: `${pulse} bpm`,
      })
    } else if (pulse < 50) {
      flags.push({
        level: 'high',
        category: 'Bradycardia',
        message: `Pulse ${pulse} bpm — Bradycardia`,
        value: `${pulse} bpm`,
      })
    }
  }

  // Fever
  if (temperature) {
    if (temperature >= 39) {
      flags.push({
        level: 'high',
        category: 'High Fever',
        message: `Temperature ${temperature}°C — High fever`,
        value: `${temperature}°C`,
        action: 'Investigate cause. Antipyretics. Blood culture if sepsis suspected.',
      })
    } else if (temperature >= 38) {
      flags.push({
        level: 'watch',
        category: 'Fever',
        message: `Temperature ${temperature}°C — Fever`,
        value: `${temperature}°C`,
      })
    }
  }

  // Low SpO2
  if (spo2) {
    if (spo2 < 90) {
      flags.push({
        level: 'critical',
        category: 'Severe Hypoxia',
        message: `SpO₂ ${spo2}% — Severe hypoxia`,
        value: `${spo2}%`,
        action: 'Immediate oxygen. Consider intubation. Investigate cause.',
      })
    } else if (spo2 < 94) {
      flags.push({
        level: 'high',
        category: 'Low Oxygen',
        message: `SpO₂ ${spo2}% — Low oxygen saturation`,
        value: `${spo2}%`,
        action: 'Supplemental oxygen. Monitor closely.',
      })
    }
  }

  return flags
}

// ─── Helper Functions ─────────────────────────────────────────

function calculateOverallRisk(flags: RiskFlag[]): RiskLevel {
  if (flags.some(f => f.level === 'critical')) return 'critical'
  if (flags.some(f => f.level === 'high'))     return 'high'
  if (flags.some(f => f.level === 'watch'))    return 'watch'
  return 'normal'
}

function calculateRiskScore(flags: RiskFlag[]): number {
  const weights: Record<RiskLevel, number> = {
    critical: 30,
    high: 15,
    watch: 5,
    normal: 0,
  }
  const raw = flags.reduce((sum, f) => sum + weights[f.level], 0)
  return Math.min(100, raw)
}

/**
 * Get risk level badge styling
 */
export function riskLevelStyle(level: RiskLevel): { bg: string; text: string; border: string; emoji: string } {
  switch (level) {
    case 'critical': return { bg: 'bg-red-100',    text: 'text-red-800',    border: 'border-red-300',    emoji: '🚨' }
    case 'high':     return { bg: 'bg-red-50',     text: 'text-red-700',    border: 'border-red-200',    emoji: '⚠️' }
    case 'watch':    return { bg: 'bg-yellow-50',  text: 'text-yellow-700', border: 'border-yellow-200', emoji: '👁️' }
    case 'normal':   return { bg: 'bg-green-50',   text: 'text-green-700',  border: 'border-green-200',  emoji: '✅' }
  }
}

/**
 * Format risk level as a display label
 */
export function riskLevelLabel(level: RiskLevel): string {
  switch (level) {
    case 'critical': return '🚨 CRITICAL'
    case 'high':     return '⚠️ High Risk'
    case 'watch':    return '👁️ Watch'
    case 'normal':   return '✅ Normal'
  }
}
