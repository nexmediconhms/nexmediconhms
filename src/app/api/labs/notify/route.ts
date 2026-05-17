/**
 * src/app/api/labs/notify/route.ts
 *
 * WhatsApp "Report Ready" notification for doctor, patient, and staff.
 * Also handles abnormal value alerts to doctor dashboard.
 *
 * Called when:
 *  1. Lab partner uploads a report (from Lab Partner Dashboard)
 *  2. Lab report is marked as complete
 *  3. AI detects abnormal values
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { patientName, patientId, mrn, abnormalValues, labPartner, reportType } = body

    // Get hospital settings for doctor info
    const { data: settings } = await supabase
      .from('clinic_settings')
      .select('key, value')
      .in('key', ['hospitalName', 'doctorName', 'phone', 'doctorMobile', 'staffMobile'])

    const settingsMap: Record<string, string> = {}
    for (const s of settings || []) {
      settingsMap[s.key] = s.value
    }

    // Get patient mobile
    let patientMobile = ''
    if (patientId) {
      const { data: patient } = await supabase
        .from('patients')
        .select('mobile')
        .eq('id', patientId)
        .single()
      patientMobile = patient?.mobile || ''
    }

    const hospitalName = settingsMap.hospitalName || 'NexMedicon Hospital'
    const doctorMobile = settingsMap.doctorMobile || settingsMap.phone || ''

    // Create notification records
    const notifications: any[] = []

    // 1. Doctor notification (always)
    if (doctorMobile) {
      const hasAbnormal = abnormalValues && abnormalValues.length > 0
      const doctorMsg = hasAbnormal
        ? `🚨 *ALERT — Abnormal Lab Values*\n\n*Patient:* ${patientName} (${mrn})\n*Lab:* ${labPartner || 'External'}\n\n*Abnormal Values:*\n${abnormalValues.map((v: string) => `⚠️ ${v}`).join('\n')}\n\n_Please review at earliest._\n\n— ${hospitalName}`
        : `📋 *Lab Report Ready*\n\n*Patient:* ${patientName} (${mrn})\n*Lab:* ${labPartner || 'External'}\n\nReport has been uploaded and is available for review.\n\n— ${hospitalName}`

      notifications.push({
        recipient: 'doctor',
        mobile: doctorMobile,
        message: doctorMsg,
        type: hasAbnormal ? 'abnormal_alert' : 'report_ready',
      })
    }

    // 2. Patient notification
    if (patientMobile) {
      const patientMsg = `*${hospitalName}*\n\nNamaste ${patientName} ji 🙏\n\nYour lab report is ready! 📋\n\nPlease visit the clinic to discuss your results with the doctor.\n\n📞 Contact: ${settingsMap.phone || ''}\n\n— ${hospitalName}`

      notifications.push({
        recipient: 'patient',
        mobile: patientMobile,
        message: patientMsg,
        type: 'report_ready',
      })
    }

    // 3. Staff notification (if staffMobile configured)
    if (settingsMap.staffMobile) {
      const staffMsg = `📋 New lab report uploaded for ${patientName} (${mrn}) by ${labPartner || 'External Lab'}.${abnormalValues?.length ? `\n\n⚠️ ${abnormalValues.length} abnormal value(s) detected.` : ''}`

      notifications.push({
        recipient: 'staff',
        mobile: settingsMap.staffMobile,
        message: staffMsg,
        type: 'report_ready',
      })
    }

    // Save to notifications table for dashboard display
    if (abnormalValues && abnormalValues.length > 0) {
      await supabase.from('doctor_alerts').insert({
        patient_id: patientId,
        patient_name: patientName,
        mrn: mrn,
        alert_type: 'abnormal_lab_values',
        alert_data: { abnormalValues, labPartner },
        is_read: false,
        created_at: new Date().toISOString(),
      }).catch(() => {}) // Non-critical if table doesn't exist
    }

    // Update lab_uploads notification_sent flag
    if (patientId) {
      await supabase
        .from('lab_uploads')
        .update({ notification_sent: true })
        .eq('patient_id', patientId)
        .eq('notification_sent', false)
        .catch(() => {})
    }

    return NextResponse.json({
      ok: true,
      notifications: notifications.map(n => ({
        recipient: n.recipient,
        mobile: n.mobile ? `${n.mobile.slice(0, 4)}****` : 'N/A',
        type: n.type,
        // Return WhatsApp URL for client to open
        whatsappUrl: n.mobile
          ? `https://wa.me/${n.mobile.replace(/\D/g, '').replace(/^0/, '91')}?text=${encodeURIComponent(n.message)}`
          : null,
      })),
    })
  } catch (err: any) {
    console.error('[labs/notify] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
