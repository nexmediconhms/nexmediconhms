/**
 * src/lib/whatsapp-notify.ts
 *
 * WhatsApp notification helper for "Report Ready" auto-notifications.
 * Provides functions to notify doctor, patient, and staff when:
 *  - Lab report is ready
 *  - Discharge summary is ready
 *  - Any document/report is uploaded
 *
 * Also handles abnormal value alerts to doctor dashboard.
 */

import { supabase } from './supabase'

export interface NotifyOptions {
  patientName: string
  patientId: string
  patientMobile?: string
  mrn: string
  reportType: 'lab_report' | 'discharge_summary' | 'prescription' | 'document'
  reportDetails?: string
  abnormalValues?: string[]
  labPartner?: string
}

/**
 * Send "Report Ready" WhatsApp notifications to relevant parties.
 * Returns WhatsApp URLs that can be opened on the client.
 */
export async function sendReportReadyNotification(options: NotifyOptions): Promise<{
  doctorUrl?: string
  patientUrl?: string
  staffUrl?: string
}> {
  const { patientName, patientId, patientMobile, mrn, reportType, reportDetails, abnormalValues, labPartner } = options

  try {
    const res = await fetch('/api/labs/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientName,
        patientId,
        mrn,
        abnormalValues: abnormalValues || [],
        labPartner: labPartner || '',
        reportType,
      }),
    })

    if (res.ok) {
      const data = await res.json()
      const urls: any = {}
      for (const n of data.notifications || []) {
        if (n.whatsappUrl) {
          if (n.recipient === 'doctor') urls.doctorUrl = n.whatsappUrl
          if (n.recipient === 'patient') urls.patientUrl = n.whatsappUrl
          if (n.recipient === 'staff') urls.staffUrl = n.whatsappUrl
        }
      }
      return urls
    }
  } catch (err) {
    console.error('[whatsapp-notify] error:', err)
  }

  return {}
}

/**
 * Check if a lab value is abnormal based on reference ranges.
 * Returns list of abnormal values with their details.
 */
export function detectAbnormalValues(results: Array<{ name: string; value: string | number; unit?: string }>): string[] {
  const RANGES: Record<string, { low: number; high: number; unit: string }> = {
    'haemoglobin': { low: 11.5, high: 16.5, unit: 'g/dL' },
    'hb': { low: 11.5, high: 16.5, unit: 'g/dL' },
    'wbc': { low: 4000, high: 11000, unit: 'cells/µL' },
    'platelet': { low: 150000, high: 400000, unit: 'cells/µL' },
    'blood sugar fasting': { low: 70, high: 100, unit: 'mg/dL' },
    'fasting sugar': { low: 70, high: 100, unit: 'mg/dL' },
    'blood sugar pp': { low: 0, high: 140, unit: 'mg/dL' },
    'pp sugar': { low: 0, high: 140, unit: 'mg/dL' },
    'hba1c': { low: 0, high: 5.7, unit: '%' },
    'tsh': { low: 0.4, high: 4.0, unit: 'mIU/L' },
    'creatinine': { low: 0.6, high: 1.2, unit: 'mg/dL' },
    'uric acid': { low: 2.4, high: 7.0, unit: 'mg/dL' },
    'sgpt': { low: 7, high: 56, unit: 'U/L' },
    'sgot': { low: 10, high: 40, unit: 'U/L' },
    'cholesterol': { low: 0, high: 200, unit: 'mg/dL' },
    'triglycerides': { low: 0, high: 150, unit: 'mg/dL' },
    'esr': { low: 0, high: 20, unit: 'mm/hr' },
  }

  const abnormals: string[] = []

  for (const result of results) {
    const numVal = parseFloat(String(result.value))
    if (isNaN(numVal)) continue

    const nameKey = result.name.toLowerCase().trim()
    for (const [refKey, range] of Object.entries(RANGES)) {
      if (nameKey.includes(refKey)) {
        if (numVal < range.low || numVal > range.high) {
          const status = numVal < range.low ? 'LOW' : 'HIGH'
          abnormals.push(`${result.name}: ${result.value} ${result.unit || range.unit} [${status}] (Normal: ${range.low}–${range.high})`)
        }
        break
      }
    }
  }

  return abnormals
}

/**
 * Create a doctor alert for abnormal values.
 * Shown in the doctor's dashboard.
 */
export async function createDoctorAlert(
  patientId: string,
  patientName: string,
  mrn: string,
  alertType: string,
  alertData: Record<string, any>
): Promise<void> {
  try {
    await supabase.from('doctor_alerts').insert({
      patient_id: patientId,
      patient_name: patientName,
      mrn,
      alert_type: alertType,
      alert_data: alertData,
      is_read: false,
      created_at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[createDoctorAlert] error:', err)
  }
}
