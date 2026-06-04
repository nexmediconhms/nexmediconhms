/**
 * src/app/api/labs/notify/route.ts
 *
 * WhatsApp "Report Ready" auto-notification API
 * 
 * When a lab report is ready (uploaded, completed, or values extracted):
 *   1. Sends WhatsApp notification to patient (report ready, come collect)
 *   2. Sends WhatsApp notification to doctor (report results + any abnormal values)
 *   3. Sends WhatsApp notification to staff (new report available)
 *   4. If abnormal values detected → creates doctor_alert in dashboard
 *
 * POST body:
 *   patientName, patientId, mrn, abnormalValues[], labPartner, reportType
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolvePortalOrigin, generatePortalMagicLink } from '@/lib/portal-magic-link'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      patientName,
      patientId,
      mrn,
      abnormalValues = [],
      labPartner = '',
      reportType = 'lab_report',
      reportName = 'Lab Report',
    } = body

    if (!patientId && !patientName) {
      return NextResponse.json({ error: 'patientId or patientName required' }, { status: 400 })
    }

    // Fetch patient details for mobile
    let patientMobile = ''
    let resolvedName = patientName || ''
    let resolvedMrn = mrn || ''

    if (patientId) {
      const { data: patient } = await supabase
        .from('patients')
        .select('full_name, mobile, mrn')
        .eq('id', patientId)
        .single()
      if (patient) {
        patientMobile = patient.mobile || ''
        resolvedName = patient.full_name || patientName
        resolvedMrn = patient.mrn || mrn
      }
    }

    // Fetch hospital settings for doctor info
    const { data: settings } = await supabase
      .from('clinic_settings')
      .select('key, value')
      .in('key', ['hospitalName', 'phone', 'doctorName', 'doctorMobile', 'staffMobile'])

    const settingsMap: Record<string, string> = {}
    for (const s of settings || []) {
      settingsMap[s.key] = s.value
    }

    const hospitalName = settingsMap.hospitalName || 'NexMedicon Hospital'
    const hospitalPhone = settingsMap.phone || ''
    const doctorName = settingsMap.doctorName || 'Doctor'
    const doctorMobile = settingsMap.doctorMobile || ''
    const staffMobile = settingsMap.staffMobile || ''

    const notifications: any[] = []

    // ── ENHANCEMENT: generate a one-tap portal magic link ──────────
    // So the "report ready" WhatsApp message can include a direct link
    // that logs the patient in and shows the latest data instantly.
    let portalUrl = ''
    if (patientId) {
      const origin = resolvePortalOrigin(req)
      const magic = await generatePortalMagicLink(
        supabase,
        origin,
        { id: patientId, mrn: resolvedMrn, mobile: patientMobile },
        { validHours: 24 }
      )
      if (magic) portalUrl = magic.portalUrl
    }

    // Build patient WhatsApp message
    if (patientMobile) {
      const patientMsg = `*${hospitalName}*

Namaste ${resolvedName} ji 🙏

Your *${reportName}* is ready! ✅

📋 *Report:* ${reportName}
🏥 *Lab:* ${labPartner || hospitalName}
📅 *Date:* ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}

${abnormalValues.length > 0 ? `⚠️ *Some values need attention.* Please visit the doctor for review.\n` : ''}Please collect your report from the hospital or ask the doctor during your next visit.
${portalUrl ? `\n▶ *View your report online now:*\n${portalUrl}\n` : ''}
📞 Contact: ${hospitalPhone}

---
आપનો ${reportName} રિપોર્ટ તૈયાર છે. ડૉક્ટર પાસે સમીક્ષા માટે આવો.

_${hospitalName} — Caring for you_ 🙏`

      const pNum = patientMobile.replace(/\D/g, '')
      const fullPNum = pNum.length === 10 ? '91' + pNum : pNum
      const patientUrl = `https://wa.me/${fullPNum}?text=${encodeURIComponent(patientMsg)}`

      notifications.push({
        recipient: 'patient',
        mobile: patientMobile,
        whatsappUrl: patientUrl,
        message: patientMsg,
      })
    }

    // Build doctor WhatsApp message
    if (doctorMobile) {
      const abnormalSection = abnormalValues.length > 0
        ? `\n⚠️ *ABNORMAL VALUES:*\n${abnormalValues.map((v: string) => `• ${v}`).join('\n')}\n`
        : '\n✅ All values within normal range.\n'

      const doctorMsg = `*${hospitalName} — Lab Alert* 🔬

*Patient:* ${resolvedName} (${resolvedMrn})
*Report:* ${reportName}
*Lab:* ${labPartner || 'In-house'}
*Date:* ${new Date().toLocaleDateString('en-IN')}
${abnormalSection}
${abnormalValues.length > 0 ? '🚨 *Action needed:* Please review the results and advise the patient.' : ''}

_Auto-notification from ${hospitalName}_`

      const dNum = doctorMobile.replace(/\D/g, '')
      const fullDNum = dNum.length === 10 ? '91' + dNum : dNum
      const doctorUrl = `https://wa.me/${fullDNum}?text=${encodeURIComponent(doctorMsg)}`

      notifications.push({
        recipient: 'doctor',
        mobile: doctorMobile,
        whatsappUrl: doctorUrl,
        message: doctorMsg,
      })
    }

    // Build staff WhatsApp message
    if (staffMobile) {
      const staffMsg = `*Lab Report Ready* 📋

Patient: ${resolvedName} (${resolvedMrn})
Report: ${reportName}
Lab: ${labPartner || 'In-house'}
${abnormalValues.length > 0 ? `\n⚠️ ${abnormalValues.length} abnormal value(s) detected` : ''}

Please update the patient file.`

      const sNum = staffMobile.replace(/\D/g, '')
      const fullSNum = sNum.length === 10 ? '91' + sNum : sNum
      const staffUrl = `https://wa.me/${fullSNum}?text=${encodeURIComponent(staffMsg)}`

      notifications.push({
        recipient: 'staff',
        mobile: staffMobile,
        whatsappUrl: staffUrl,
        message: staffMsg,
      })
    }

    // Create doctor alert for abnormal values
    if (abnormalValues.length > 0 && patientId) {
      const severity = abnormalValues.some((v: string) => v.includes('CRITICAL') || v.includes('HIGH'))
        ? 'critical' : 'warning'

      await supabase.from('doctor_alerts').insert({
        patient_id: patientId,
        patient_name: resolvedName,
        mrn: resolvedMrn,
        alert_type: 'lab_abnormal',
        alert_data: {
          report_name: reportName,
          abnormal_values: abnormalValues,
          lab_partner: labPartner,
          report_type: reportType,
          total_abnormal: abnormalValues.length,
        },
        severity,
        source: labPartner || 'in-house',
        is_read: false,
        created_at: new Date().toISOString(),
      })
    }

    // Log WhatsApp notifications
    for (const n of notifications) {
      await supabase.from('whatsapp_notifications').insert({
        patient_id: patientId || null,
        patient_name: resolvedName,
        mobile: n.mobile,
        notification_type: 'report_ready',
        message_preview: n.message.slice(0, 200),
        recipient_type: n.recipient,
        status: 'generated',
        metadata: {
          report_name: reportName,
          lab_partner: labPartner,
          has_abnormals: abnormalValues.length > 0,
        },
      })
    }

    return NextResponse.json({
      success: true,
      notifications,
      portalUrl,
      patientWhatsappUrl: notifications.find(n => n.recipient === 'patient')?.whatsappUrl || null,
      alertCreated: abnormalValues.length > 0,
      message: `Notifications generated for ${notifications.length} recipient(s)`,
    })
  } catch (err: any) {
    console.error('[labs/notify] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}