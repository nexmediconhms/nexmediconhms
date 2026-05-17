/**
 * src/lib/lab-alerts.ts
 *
 * Lab Report Abnormal Value Alerts
 * - Checks lab entries against reference ranges
 * - Flags HIGH/LOW values
 * - Generates alerts for doctor notification
 * - Integrates with WhatsApp notification for patients
 */

import { supabase } from './supabase'
import { loadSettings } from './settings'

// ── Types ─────────────────────────────────────────────────────

export interface LabAlert {
  id?: string
  patient_id: string
  patient_name: string
  lab_report_id: string
  test_name: string
  value: string
  unit: string
  reference_range: string
  severity: 'high' | 'low' | 'critical_high' | 'critical_low'
  status: 'new' | 'seen' | 'acknowledged'
  created_at?: string
}

// ── Reference Ranges (with critical thresholds) ──────────────

const CRITICAL_RANGES: Record<string, { criticalLow?: number; low: number; high: number; criticalHigh?: number; unit: string }> = {
  'Haemoglobin (Hb)': { criticalLow: 7, low: 11.5, high: 16.5, criticalHigh: 20, unit: 'g/dL' },
  'WBC (Total Count)': { criticalLow: 2000, low: 4000, high: 11000, criticalHigh: 30000, unit: 'cells/µL' },
  'Platelet Count': { criticalLow: 50000, low: 150000, high: 400000, criticalHigh: 1000000, unit: 'cells/µL' },
  'Blood Sugar Fasting': { criticalLow: 40, low: 70, high: 100, criticalHigh: 400, unit: 'mg/dL' },
  'Blood Sugar PP': { low: 0, high: 140, criticalHigh: 400, unit: 'mg/dL' },
  'HbA1c': { low: 0, high: 5.7, criticalHigh: 14, unit: '%' },
  'TSH': { criticalLow: 0.05, low: 0.4, high: 4.0, criticalHigh: 50, unit: 'mIU/L' },
  'Serum Ferritin': { criticalLow: 5, low: 12, high: 150, criticalHigh: 1000, unit: 'ng/mL' },
  'Vitamin D3': { criticalLow: 5, low: 30, high: 100, unit: 'ng/mL' },
  'Beta-hCG': { low: 0, high: 5, unit: 'mIU/mL' },
}

// ── Alert Generation ──────────────────────────────────────────

/**
 * Check a lab report's entries for abnormal values and create alerts
 */
export async function checkAndCreateAlerts(
  labReportId: string,
  patientId: string,
  patientName: string,
  entries: Array<{ testName: string; value: string; unit: string; referenceRange: string; status: string }>
): Promise<LabAlert[]> {
  const alerts: LabAlert[] = []

  for (const entry of entries) {
    if (!entry.value || entry.status === 'pending' || entry.status === 'normal') continue

    const numValue = parseFloat(entry.value)
    if (isNaN(numValue)) continue

    const critRange = CRITICAL_RANGES[entry.testName]
    let severity: LabAlert['severity'] = entry.status === 'high' ? 'high' : 'low'

    // Check critical thresholds
    if (critRange) {
      if (critRange.criticalHigh && numValue >= critRange.criticalHigh) severity = 'critical_high'
      else if (critRange.criticalLow && numValue <= critRange.criticalLow) severity = 'critical_low'
    }

    if (entry.status === 'high' || entry.status === 'low') {
      alerts.push({
        patient_id: patientId,
        patient_name: patientName,
        lab_report_id: labReportId,
        test_name: entry.testName,
        value: entry.value,
        unit: entry.unit,
        reference_range: entry.referenceRange,
        severity,
        status: 'new',
      })
    }
  }

  // Store alerts in database (if table exists)
  if (alerts.length > 0) {
    try {
      await supabase.from('lab_alerts').insert(alerts)
    } catch (err) {
      // Table might not exist yet — log and continue
      console.warn('[Lab Alerts] Could not store alerts:', err)
    }
  }

  return alerts
}

/**
 * Get unacknowledged alerts for the dashboard
 */
export async function getActiveAlerts(limit = 20): Promise<LabAlert[]> {
  try {
    const { data } = await supabase
      .from('lab_alerts')
      .select('*')
      .in('status', ['new', 'seen'])
      .order('created_at', { ascending: false })
      .limit(limit)
    return (data || []) as LabAlert[]
  } catch {
    return []
  }
}

/**
 * Mark alerts as acknowledged
 */
export async function acknowledgeAlerts(alertIds: string[]): Promise<void> {
  try {
    await supabase
      .from('lab_alerts')
      .update({ status: 'acknowledged' })
      .in('id', alertIds)
  } catch (err) {
    console.warn('[Lab Alerts] Could not acknowledge:', err)
  }
}

// ── WhatsApp Notification ─────────────────────────────────────

/**
 * Generate WhatsApp notification URL for "Your report is ready" message
 */
export function generateReportReadyWhatsApp(
  patientMobile: string,
  patientName: string,
  labName?: string
): string {
  const settings = loadSettings()
  const hospitalName = settings.hospitalName || 'Hospital'

  const message = `Dear ${patientName},\n\nYour lab report${labName ? ` from ${labName}` : ''} is now ready.\n\nPlease visit ${hospitalName} or call us at ${settings.phone || ''} for your results.\n\nThank you,\n${hospitalName}`

  const cleanMobile = patientMobile.replace(/\D/g, '')
  const mobile = cleanMobile.startsWith('91') ? cleanMobile : `91${cleanMobile}`

  return `https://wa.me/${mobile}?text=${encodeURIComponent(message)}`
}

/**
 * Generate WhatsApp notification for abnormal values (doctor alert)
 */
export function generateDoctorAlertWhatsApp(
  doctorMobile: string,
  alert: LabAlert
): string {
  const severityLabel = alert.severity.includes('critical') ? '🚨 CRITICAL' : '⚠️ Abnormal'
  const direction = alert.severity.includes('high') ? 'HIGH' : 'LOW'

  const message = `${severityLabel} Lab Alert\n\nPatient: ${alert.patient_name}\nTest: ${alert.test_name}\nValue: ${alert.value} ${alert.unit} (${direction})\nRef: ${alert.reference_range}\n\nPlease review at your earliest.\n— NexMedicon HMS`

  const cleanMobile = doctorMobile.replace(/\D/g, '')
  const mobile = cleanMobile.startsWith('91') ? cleanMobile : `91${cleanMobile}`

  return `https://wa.me/${mobile}?text=${encodeURIComponent(message)}`
}
