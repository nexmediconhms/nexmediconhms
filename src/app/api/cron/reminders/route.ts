/**
 * src/app/api/cron/reminders/route.ts
 *
 * MASTER CRON: Automated Clinical Reminders
 *
 * Runs daily (recommended: 8:00 AM IST via Vercel Cron / Supabase Edge Function / external cron).
 * Handles ALL automated reminder types:
 *
 *   1. Appointment reminders (day before + morning of)
 *   2. Follow-up reminders (due today + 1-day overdue)
 *   3. ANC visit reminders (based on LMP schedule)
 *   4. Post-delivery 42-day follow-up
 *   5. Newborn vaccination reminders
 *   6. Medication reminders (active prescriptions)
 *   7. OT Surgery pre-op reminders (day before)
 *   8. Post-discharge insurance document readiness
 *   9. Pending bill reminders (>3 days unpaid)
 *   10. IPD discharge follow-up
 *
 * Auth: CRON_SECRET header or query parameter
 *
 * GET  /api/cron/reminders?dryRun=true   → preview without sending
 * POST /api/cron/reminders               → execute and log
 *
 * All generated reminders are logged to `whatsapp_notifications` table
 * and can be viewed in the Reminder Queue UI.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

const IST = 'Asia/Kolkata'

function todayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: IST })
}
function tomorrowIST(): string {
  const d = new Date(); d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA', { timeZone: IST })
}
function daysFromNowIST(n: number): string {
  const d = new Date(); d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-CA', { timeZone: IST })
}
function daysUntil(dateStr: string): number {
  const today = new Date(todayIST() + 'T00:00:00+05:30')
  const target = new Date(dateStr + 'T00:00:00+05:30')
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

// Auth validation
function validateCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    if (process.env.NODE_ENV === 'production') return false
    return true // Allow in dev without secret
  }
  const authHeader = req.headers.get('authorization') ?? ''
  const querySecret = new URL(req.url).searchParams.get('secret') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim()
  return token === cronSecret || querySecret === cronSecret
}

// Prevent duplicate reminders — check if already sent today for same patient+type
async function alreadySentToday(patientId: string, notificationType: string): Promise<boolean> {
  const today = todayIST()
  const { count } = await supabase
    .from('whatsapp_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('patient_id', patientId)
    .eq('notification_type', notificationType)
    .gte('created_at', today + 'T00:00:00+05:30')
    .lte('created_at', today + 'T23:59:59+05:30')

  return (count || 0) > 0
}

interface ReminderGenerated {
  patientId: string
  patientName: string
  mobile: string
  type: string
  message: string
  scheduledFor?: string
}

export async function GET(req: NextRequest) {
  if (!validateCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = req.nextUrl.searchParams.get('dryRun') === 'true'
  return await processReminders(dryRun)
}

export async function POST(req: NextRequest) {
  if (!validateCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return await processReminders(false)
}

async function processReminders(dryRun: boolean) {
  const startTime = Date.now()
  const reminders: ReminderGenerated[] = []
  const errors: string[] = []
  const today = todayIST()
  const tomorrow = tomorrowIST()

  // Log the cron job start
  let cronLogId: string | null = null
  if (!dryRun) {
    const { data: logEntry } = await supabase
      .from('cron_job_log')
      .insert({ job_name: 'daily_reminders', status: 'running' })
      .select('id')
      .single()
    cronLogId = logEntry?.id || null
  }

  try {
    // ═══════════════════════════════════════════════════════════
    // 1. APPOINTMENT REMINDERS (tomorrow + today unconfirmed)
    // ═══════════════════════════════════════════════════════════
    try {
      const { data: appts } = await supabase
        .from('appointments')
        .select('id, patient_id, patient_name, mobile, date, time, type, status')
        .in('date', [today, tomorrow])
        .neq('status', 'cancelled')
        .neq('status', 'completed')

      for (const a of appts || []) {
        if (!a.mobile || !a.patient_id) continue
        if (await alreadySentToday(a.patient_id, `appointment_${a.date}`)) continue

        const isToday = a.date === today
        const msg = isToday
          ? `Reminder: Your appointment is TODAY at ${a.time || 'scheduled time'}. Please arrive 10 min early.`
          : `Reminder: Your appointment is TOMORROW (${a.date}) at ${a.time || 'scheduled time'}. Please bring previous reports.`

        reminders.push({
          patientId: a.patient_id,
          patientName: a.patient_name || '',
          mobile: a.mobile,
          type: `appointment_${a.date}`,
          message: msg,
        })
      }
    } catch (e: any) {
      errors.push(`appointments: ${e.message}`)
    }

    // ═══════════════════════════════════════════════════════════
    // 2. FOLLOW-UP REMINDERS (due today + 1-3 days overdue)
    // ═══════════════════════════════════════════════════════════
    try {
      const threeDaysAgo = daysFromNowIST(-3)
      const { data: rxs } = await supabase
        .from('prescriptions')
        .select('id, patient_id, follow_up_date, diagnosis, medications')
        .gte('follow_up_date', threeDaysAgo)
        .lte('follow_up_date', today)

      // Get patient details — FIX: Flatten Set into Array using Array.from()
      const patientIds = Array.from(new Set((rxs || []).map(r => r.patient_id).filter(Boolean)))
      const patientMap = new Map<string, any>()
      if (patientIds.length > 0) {
        const { data: patients } = await supabase
          .from('patients').select('id, full_name, mobile').in('id', patientIds)
        for (const p of patients || []) patientMap.set(p.id, p)
      }

      for (const rx of rxs || []) {
        if (!rx.patient_id || !rx.follow_up_date) continue
        const patient = patientMap.get(rx.patient_id)
        if (!patient?.mobile) continue
        if (await alreadySentToday(rx.patient_id, 'follow_up')) continue

        const daysAway = daysUntil(rx.follow_up_date)
        const medNames = Array.isArray(rx.medications)
          ? rx.medications.map((m: any) => m.drug || m.name || '').filter(Boolean).slice(0, 3).join(', ')
          : ''

        const msg = daysAway < 0
          ? `Your follow-up was due ${Math.abs(daysAway)} days ago. Please visit at the earliest.${medNames ? ` Meds: ${medNames}` : ''}${rx.diagnosis ? ` For: ${rx.diagnosis}` : ''}`
          : `Your follow-up visit is due TODAY.${medNames ? ` Current medications: ${medNames}` : ''}${rx.diagnosis ? ` For: ${rx.diagnosis}` : ''} Please bring your previous prescription.`

        reminders.push({
          patientId: rx.patient_id,
          patientName: patient.full_name || '',
          mobile: patient.mobile,
          type: 'follow_up',
          message: msg,
        })
      }
    } catch (e: any) {
      errors.push(`follow_up: ${e.message}`)
    }

    // ═══════════════════════════════════════════════════════════
    // 3. ANC VISIT REMINDERS
    // ═══════════════════════════════════════════════════════════
    try {
      const ANC_WEEKS = [16, 20, 24, 28, 32, 36, 38, 40]
      const ancLookback = new Date()
      ancLookback.setMonth(ancLookback.getMonth() - 10)
      const ancFrom = ancLookback.toLocaleDateString('en-CA', { timeZone: IST })

      const { data: encs } = await supabase
        .from('encounters')
        .select('id, patient_id, ob_data, patients!inner(full_name, mobile, mrn)')
        .not('ob_data', 'is', null)
        .gte('encounter_date', ancFrom)
        .order('encounter_date', { ascending: false })
        .limit(500)

      const latestByPatient = new Map<string, any>()
      for (const enc of encs || []) {
        if (!latestByPatient.has(enc.patient_id)) {
          latestByPatient.set(enc.patient_id, enc)
        }
      }

      // FIX: Wrap Map values iterator into Array.from() for safe downlevel iteration
      const encountersToProcess = Array.from(latestByPatient.values())
      for (const enc of encountersToProcess) {
        const ob = enc.ob_data
        const pat = enc.patients as any
        if (!ob?.lmp || !pat?.mobile) continue

        const lmpDate = new Date(ob.lmp + 'T00:00:00+05:30')
        const nowMs = Date.now()
        const weeksNow = (nowMs - lmpDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
        if (weeksNow > 42) continue

        for (const targetWeek of ANC_WEEKS) {
          const targetMs = lmpDate.getTime() + targetWeek * 7 * 24 * 60 * 60 * 1000
          const targetStr = new Date(targetMs).toLocaleDateString('en-CA', { timeZone: IST })
          const daysAway = daysUntil(targetStr)

          if (daysAway >= 0 && daysAway <= 2) {
            if (await alreadySentToday(enc.patient_id, `anc_week_${targetWeek}`)) continue

            reminders.push({
              patientId: enc.patient_id,
              patientName: pat.full_name || '',
              mobile: pat.mobile,
              type: `anc_week_${targetWeek}`,
              message: `ANC check-up reminder: Your Week ${targetWeek} visit is ${daysAway === 0 ? 'TODAY' : `in ${daysAway} day(s)`}. Current GA: ${Math.floor(weeksNow)} weeks. Please bring ANC card, urine sample, and previous reports.`,
            })
            break
          }
        }
      }
    } catch (e: any) {
      errors.push(`anc: ${e.message}`)
    }

    // ═══════════════════════════════════════════════════════════
    // 4. POST-DELIVERY 42-DAY FOLLOW-UP
    // ═══════════════════════════════════════════════════════════
    try {
      const { data: dsList } = await supabase
        .from('discharge_summaries')
        .select('id, patient_id, delivery_date, patients!inner(full_name, mobile)')
        .not('delivery_date', 'is', null)
        .limit(200)

      for (const ds of dsList || []) {
        const pat = ds.patients as any
        if (!ds.delivery_date || !pat?.mobile) continue

        const followUpMs = new Date(ds.delivery_date).getTime() + 42 * 24 * 60 * 60 * 1000
        const followUpStr = new Date(followUpMs).toLocaleDateString('en-CA', { timeZone: IST })
        const daysAway = daysUntil(followUpStr)

        if (daysAway >= 0 && daysAway <= 2) {
          if (await alreadySentToday(ds.patient_id, 'post_delivery_42')) continue

          reminders.push({
            patientId: ds.patient_id,
            patientName: pat.full_name || '',
            mobile: pat.mobile,
            type: 'post_delivery_42',
            message: `Post-delivery follow-up reminder: Your 6-week (42-day) check-up is ${daysAway === 0 ? 'due TODAY' : `due in ${daysAway} day(s)`}. Please bring discharge summary and baby's vaccination card.`,
          })
        }
      }
    } catch (e: any) {
      errors.push(`post_delivery: ${e.message}`)
    }

    // ═══════════════════════════════════════════════════════════
    // 5. VACCINATION REMINDERS
    // ═══════════════════════════════════════════════════════════
    try {
      const VAX_SCHEDULE = [
        { name: 'OPV/DPT/Hep-B (6 weeks)', days: 42 },
        { name: 'OPV/DPT/Hep-B (10 weeks)', days: 70 },
        { name: 'OPV/DPT/Hep-B (14 weeks)', days: 98 },
        { name: 'Measles/MMR (9 months)', days: 270 },
        { name: 'DPT Booster (16 months)', days: 480 },
      ]

      const { data: dsList } = await supabase
        .from('discharge_summaries')
        .select('id, patient_id, delivery_date, patients!inner(full_name, mobile)')
        .not('delivery_date', 'is', null)
        .limit(200)

      for (const ds of dsList || []) {
        const pat = ds.patients as any
        if (!ds.delivery_date || !pat?.mobile) continue
        const delivMs = new Date(ds.delivery_date).getTime()

        for (const vax of VAX_SCHEDULE) {
          const vaxDueStr = new Date(delivMs + vax.days * 24 * 60 * 60 * 1000)
            .toLocaleDateString('en-CA', { timeZone: IST })
          const daysAway = daysUntil(vaxDueStr)

          if (daysAway >= 0 && daysAway <= 3) {
            if (await alreadySentToday(ds.patient_id, `vax_${vax.days}`)) continue

            reminders.push({
              patientId: ds.patient_id,
              patientName: pat.full_name || '',
              mobile: pat.mobile,
              type: `vax_${vax.days}`,
              message: `Vaccination reminder: Your baby's ${vax.name} vaccination is ${daysAway === 0 ? 'due TODAY' : `due in ${daysAway} day(s)`}. Please bring the vaccination card. Do NOT skip vaccinations — they protect your baby from serious diseases.`,
            })
            break
          }
        }
      }
    } catch (e: any) {
      errors.push(`vaccination: ${e.message}`)
    }

    // ═══════════════════════════════════════════════════════════
    // 6. MEDICATION REMINDERS (for patients with active prescriptions)
    // ═══════════════════════════════════════════════════════════
    try {
      // Get recent prescriptions (last 30 days) that have medications
      const thirtyDaysAgo = daysFromNowIST(-30)
      const { data: rxs } = await supabase
        .from('prescriptions')
        .select('id, patient_id, medications, created_at')
        .gte('created_at', thirtyDaysAgo + 'T00:00:00')
        .not('medications', 'is', null)
        .order('created_at', { ascending: false })
        .limit(100)

      // Latest prescription per patient
      const latestRx = new Map<string, any>()
      for (const rx of rxs || []) {
        if (!latestRx.has(rx.patient_id)) latestRx.set(rx.patient_id, rx)
      }

      // FIX: Convert Map keys to flat Array with Array.from()
      const rxPatientIds = Array.from(latestRx.keys())
      const patientMap = new Map<string, any>()
      if (rxPatientIds.length > 0) {
        const { data: patients } = await supabase
          .from('patients').select('id, full_name, mobile').in('id', rxPatientIds)
        for (const p of patients || []) patientMap.set(p.id, p)
      }

      // FIX: Convert Map entries to sequential Array for ES5-safe downlevel iteration
      const rxEntries = Array.from(latestRx.entries())
      for (const [pid, rx] of rxEntries) {
        const patient = patientMap.get(pid)
        if (!patient?.mobile) continue
        if (await alreadySentToday(pid, 'medication')) continue

        const meds = Array.isArray(rx.medications)
          ? rx.medications.map((m: any) => `${m.drug || ''} ${m.dose || ''} (${m.frequency || ''})`).filter((s: string) => s.trim().length > 3).slice(0, 4)
          : []

        if (meds.length === 0) continue

        reminders.push({
          patientId: pid,
          patientName: patient.full_name || '',
          mobile: patient.mobile,
          type: 'medication',
          message: `Medication reminder:\n${meds.map((m: string, i: number) => `${i + 1}. ${m}`).join('\n')}\n\nPlease take your medicines on time as prescribed. Contact us for any side effects.`,
        })
      }
    } catch (e: any) {
      errors.push(`medication: ${e.message}`)
    }

    // ═══════════════════════════════════════════════════════════
    // 7. OT SURGERY PRE-OP REMINDERS (day before)
    // ═══════════════════════════════════════════════════════════
    try {
      const { data: otSchedules } = await supabase
        .from('ot_schedules')
        .select('id, patient_id, patient_name, mrn, surgery_name, surgery_date, start_time, surgeon')
        .eq('surgery_date', tomorrow)
        .eq('status', 'scheduled')

      // FIX: Flatten Set into Array using Array.from()
      const otPatientIds = Array.from(new Set((otSchedules || []).map(s => s.patient_id).filter(Boolean)))
      const otMobileMap = new Map<string, string>()
      if (otPatientIds.length > 0) {
        const { data: pats } = await supabase
          .from('patients').select('id, mobile').in('id', otPatientIds)
        for (const p of pats || []) if (p.mobile) otMobileMap.set(p.id, p.mobile)
      }

      for (const ot of otSchedules || []) {
        const mobile = otMobileMap.get(ot.patient_id)
        if (!mobile) continue
        if (await alreadySentToday(ot.patient_id, `ot_preop_${ot.id}`)) continue

        reminders.push({
          patientId: ot.patient_id,
          patientName: ot.patient_name || '',
          mobile,
          type: `ot_preop_${ot.id}`,
          message: `Surgery reminder: Your surgery "${ot.surgery_name}" is scheduled for TOMORROW at ${ot.start_time}. Pre-op instructions:\n• Nothing to eat/drink after midnight (NPO)\n• Bring all previous reports\n• Arrive 2 hours before scheduled time\n• Bring one attendant\nSurgeon: Dr. ${ot.surgeon}`,
        })
      }
    } catch (e: any) {
      errors.push(`ot_surgery: ${e.message}`)
    }

    // ═══════════════════════════════════════════════════════════
    // 8. POST-DISCHARGE INSURANCE DOCUMENT NOTIFICATION
    // ═══════════════════════════════════════════════════════════
    try {
      // Patients discharged in last 7 days who have insurance_details
      const sevenDaysAgo = daysFromNowIST(-7)
      const { data: recentDischarges } = await supabase
        .from('ipd_admissions')
        .select('id, patient_id, patient_name, mobile, insurance_details, updated_at')
        .eq('status', 'discharged')
        .not('insurance_details', 'is', null)
        .neq('insurance_details', '')
        .gte('updated_at', sevenDaysAgo + 'T00:00:00')

      for (const adm of recentDischarges || []) {
        if (!adm.mobile || !adm.insurance_details) continue
        if (await alreadySentToday(adm.patient_id, 'insurance_docs')) continue

        reminders.push({
          patientId: adm.patient_id,
          patientName: adm.patient_name || '',
          mobile: adm.mobile,
          type: 'insurance_docs',
          message: `Insurance claim update: Your insurance documents for ${adm.insurance_details} are being processed. Please visit the hospital billing counter with:\n• Original discharge summary\n• Insurance card\n• ID proof\n• Claim form (if received)\nTimely submission ensures faster claim settlement.`,
        })
      }
    } catch (e: any) {
      errors.push(`insurance_docs: ${e.message}`)
    }

    // ═══════════════════════════════════════════════════════════
    // 9. PENDING BILL REMINDERS (> 3 days unpaid)
    // ═══════════════════════════════════════════════════════════
    try {
      const threeDaysAgo = daysFromNowIST(-3)
      const { data: bills } = await supabase
        .from('bills')
        .select('id, patient_id, patient_name, total, paid, due, created_at')
        .in('status', ['pending', 'unpaid', 'partial'])
        .lt('created_at', threeDaysAgo + 'T00:00:00')
        .limit(50)

      // FIX: Flatten Set into Array using Array.from()
      const billPatientIds = Array.from(new Set((bills || []).map(b => b.patient_id).filter(Boolean)))
      const billMobileMap = new Map<string, string>()
      if (billPatientIds.length > 0) {
        const { data: pats } = await supabase
          .from('patients').select('id, mobile').in('id', billPatientIds)
        for (const p of pats || []) if (p.mobile) billMobileMap.set(p.id, p.mobile)
      }

      for (const bill of bills || []) {
        const mobile = billMobileMap.get(bill.patient_id)
        if (!mobile) continue
        if (await alreadySentToday(bill.patient_id, 'pending_bill')) continue

        const dueAmt = Number(bill.due || (Number(bill.total || 0) - Number(bill.paid || 0)))
        if (dueAmt <= 0) continue

        reminders.push({
          patientId: bill.patient_id,
          patientName: bill.patient_name || '',
          mobile,
          type: 'pending_bill',
          message: `Payment reminder: Your pending bill of ₹${dueAmt.toLocaleString('en-IN')} is overdue. Please visit the billing counter or contact us to arrange payment. We accept Cash, UPI, Card, and Insurance.`,
        })
      }
    } catch (e: any) {
      errors.push(`pending_bill: ${e.message}`)
    }

    // ═══════════════════════════════════════════════════════════
    // 10. NO-SHOW AUTO-DETECTION
    // Mark past appointments as 'no-show' if time+60min passed
    // and still in 'scheduled' or 'confirmed' status
    // ═══════════════════════════════════════════════════════════
    try {
      const nowIST = new Date().toLocaleTimeString('en-IN', {
        timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: false,
      })
      // Only run for today's appointments
      const { data: overdueAppts } = await supabase
        .from('appointments')
        .select('id, patient_id, patient_name, mobile, time, type')
        .eq('date', today)
        .in('status', ['scheduled', 'confirmed'])

      let noShowCount = 0
      for (const appt of overdueAppts || []) {
        if (!appt.time) continue
        // Calculate if appointment time + 60 minutes has passed
        const [h, m] = appt.time.split(':').map(Number)
        const apptMinutes = (h || 0) * 60 + (m || 0)
        const [nowH, nowM] = nowIST.split(':').map(Number)
        const nowMinutes = (nowH || 0) * 60 + (nowM || 0)

        if (nowMinutes > apptMinutes + 60) {
          // Mark as no-show
          await supabase
            .from('appointments')
            .update({
              status: 'no-show',
              updated_at: new Date().toISOString(),
            })
            .eq('id', appt.id)
            .in('status', ['scheduled', 'confirmed']) // double-check status hasn't changed

          noShowCount++

          // Queue a follow-up reminder for no-show patients
          if (appt.mobile && appt.patient_id) {
            if (!(await alreadySentToday(appt.patient_id, `noshow_${appt.id}`))) {
              reminders.push({
                patientId: appt.patient_id,
                patientName: appt.patient_name || '',
                mobile: appt.mobile,
                type: `noshow_${appt.id}`,
                message: `We noticed you missed your ${appt.type || 'appointment'} today at ${appt.time}. Please reschedule at your earliest convenience. Your health is important to us.`,
              })
            }
          }
        }
      }
      if (noShowCount > 0) {
        console.log(`[cron/reminders] Auto-marked ${noShowCount} appointments as no-show`)
      }
    } catch (e: any) {
      errors.push(`no_show_detection: ${e.message}`)
    }

    // ═══════════════════════════════════════════════════════════
    // SAVE ALL REMINDERS TO DB (unless dry run)
    // ═══════════════════════════════════════════════════════════
    if (!dryRun && reminders.length > 0) {
      const records = reminders.map(r => ({
        patient_id: r.patientId,
        patient_name: r.patientName,
        mobile: r.mobile,
        notification_type: r.type,
        message_preview: r.message.slice(0, 300),
        recipient_type: 'patient',
        status: 'queued',
        scheduled_for: new Date().toISOString(),
        metadata: JSON.stringify({ auto_generated: true, cron_run: todayIST() }),
      }))

      const { error: insertErr } = await supabase
        .from('whatsapp_notifications')
        .insert(records)

      if (insertErr) {
        errors.push(`insert: ${insertErr.message}`)
      }

      // Also log to reminder_log for history tracking
      const logRecords = reminders.map(r => ({
        patient_id: r.patientId,
        patient_name: r.patientName,
        mobile: r.mobile,
        reminder_type: r.type.replace(/_\d+$/, '').replace(/^(appointment|vax|anc_week|ot_preop).*/, '$1'),
        message_preview: r.message.slice(0, 200),
        channel: 'whatsapp',
        status: 'queued',
        sent_by: 'auto',
        batch_id: `cron-${todayIST()}`,
      }))

      await supabase.from('reminder_log').insert(logRecords)
    }

    // Update cron log
    if (cronLogId && !dryRun) {
      await supabase.from('cron_job_log').update({
        status: errors.length > 0 ? 'completed_with_errors' : 'completed',
        finished_at: new Date().toISOString(),
        result: {
          total: reminders.length,
          errors: errors.length,
          error_details: errors,
          duration_ms: Date.now() - startTime,
        },
      }).eq('id', cronLogId)
    }

  } catch (err: any) {
    errors.push(`fatal: ${err.message}`)
    if (cronLogId && !dryRun) {
      await supabase.from('cron_job_log').update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error: err.message,
      }).eq('id', cronLogId)
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    total: reminders.length,
    reminders: reminders.map(r => ({
      patientName: r.patientName,
      mobile: r.mobile,
      type: r.type,
      message: r.message.slice(0, 150) + (r.message.length > 150 ? '...' : ''),
    })),
    errors: errors.length > 0 ? errors : undefined,
    duration_ms: Date.now() - startTime,
    generatedAt: new Date().toISOString(),
  })
}