/**
 * src/app/api/ot-schedule/sync/route.ts
 *
 * Syncs OT Schedule with:
 *  1. Appointments — creates appointment record when OT is scheduled
 *  2. Reminders — patients get reminded 1 day before surgery
 *  3. Doctor notification — WhatsApp alert about upcoming surgeries
 *
 * Called when:
 *  - New OT schedule is created
 *  - OT schedule status changes (rescheduled, cancelled)
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
    const { action, schedule } = body

    if (!schedule || !schedule.patient_id) {
      return NextResponse.json({ error: 'Missing schedule data' }, { status: 400 })
    }

    const results: any = { appointment: null, reminder: null, notification: null }

    // 1. Create/update appointment linked to OT schedule
    if (action === 'create' || action === 'reschedule') {
      // Check if appointment already exists for this OT
      const { data: existing } = await supabase
        .from('appointments')
        .select('id')
        .eq('patient_id', schedule.patient_id)
        .eq('date', schedule.surgery_date)
        .eq('type', 'Pre-Surgery Assessment')
        .limit(1)

      if (!existing || existing.length === 0) {
        // Create a pre-surgery appointment
        const { data: appt, error: apptErr } = await supabase
          .from('appointments')
          .insert({
            patient_id: schedule.patient_id,
            patient_name: schedule.patient_name,
            mrn: schedule.mrn || '',
            mobile: schedule.mobile || '',
            date: schedule.surgery_date,
            time: schedule.start_time || '08:00',
            type: 'Pre-Surgery Assessment',
            notes: `OT: ${schedule.surgery_name} with Dr. ${schedule.surgeon}`,
            status: 'confirmed',
          })
          .select()
          .single()

        if (!apptErr && appt) {
          results.appointment = appt
        }
      }
    }

    // 2. Cancel appointment if OT is cancelled
    if (action === 'cancel') {
      await supabase
        .from('appointments')
        .update({ status: 'cancelled' })
        .eq('patient_id', schedule.patient_id)
        .eq('date', schedule.surgery_date)
        .eq('type', 'Pre-Surgery Assessment')
    }

    // 3. Create reminder notification for the surgery
    if (action === 'create' || action === 'reschedule') {
      // Get hospital settings for notification
      const { data: settings } = await supabase
        .from('clinic_settings')
        .select('key, value')
        .in('key', ['hospitalName', 'doctorMobile', 'staffMobile', 'phone'])

      const settingsMap: Record<string, string> = {}
      for (const s of settings || []) settingsMap[s.key] = s.value

      // Get patient mobile
      const { data: patient } = await supabase
        .from('patients')
        .select('mobile')
        .eq('id', schedule.patient_id)
        .single()

      const patientMobile = patient?.mobile || schedule.mobile || ''
      const hospitalName = settingsMap.hospitalName || 'NexMedicon Hospital'

      // Build surgery reminder message
      if (patientMobile) {
        const patientMsg = `*${hospitalName}*\n\nNamaste ${schedule.patient_name} ji 🙏\n\n` +
          `Your surgery/procedure is scheduled:\n\n` +
          `🏥 *Procedure:* ${schedule.surgery_name}\n` +
          `📅 *Date:* ${schedule.surgery_date}\n` +
          `🕐 *Time:* ${schedule.start_time || 'Morning'}\n` +
          `👨‍⚕️ *Surgeon:* Dr. ${schedule.surgeon}\n\n` +
          `*Pre-surgery instructions:*\n` +
          `${schedule.fasting_confirmed ? '✅' : '⚠️'} Fasting from midnight (no food/water)\n` +
          `✅ Bring all previous reports\n` +
          `✅ Bring consent form\n` +
          `✅ Arrive 1 hour before scheduled time\n\n` +
          `📞 Contact: ${settingsMap.phone || ''}\n\n` +
          `— ${hospitalName}`

        results.notification = {
          patientMobile,
          message: patientMsg,
          whatsappUrl: `https://wa.me/${patientMobile.replace(/\D/g, '').replace(/^0/, '91')}?text=${encodeURIComponent(patientMsg)}`,
        }
      }

      // Doctor notification
      if (settingsMap.doctorMobile) {
        const doctorMsg = `📋 *OT Schedule Alert*\n\n` +
          `*Patient:* ${schedule.patient_name} (${schedule.mrn || ''})\n` +
          `*Surgery:* ${schedule.surgery_name}\n` +
          `*Date:* ${schedule.surgery_date} at ${schedule.start_time || ''}\n` +
          `*Priority:* ${schedule.priority || 'Elective'}\n` +
          `${schedule.consent_taken ? '✅ Consent taken' : '⚠️ Consent PENDING'}\n` +
          `${schedule.blood_arranged ? '✅ Blood arranged' : '⚠️ Blood NOT arranged'}\n` +
          `${schedule.fasting_confirmed ? '✅ Fasting confirmed' : '⚠️ Fasting NOT confirmed'}`

        results.doctorNotification = {
          mobile: settingsMap.doctorMobile,
          whatsappUrl: `https://wa.me/${settingsMap.doctorMobile.replace(/\D/g, '').replace(/^0/, '91')}?text=${encodeURIComponent(doctorMsg)}`,
        }
      }
    }

    return NextResponse.json({ ok: true, ...results })
  } catch (err: any) {
    console.error('[ot-schedule/sync] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
