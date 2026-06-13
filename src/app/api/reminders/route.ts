/**
 * src/app/api/reminders/route.ts
 *
 * ═══════════════════════════════════════════════════════════════
 * CRITICAL BUG FIX: GET endpoint was fully unauthenticated.
 * Comment in original code read:
 *   "// ── GET — build reminder list (public, no auth required)"
 *
 * This exposed patient names, mobile numbers, diagnosis data,
 * appointment dates, and outstanding bill amounts to anyone
 * who discovered the URL — a DISHA/HIPAA violation.
 *
 * FIX: Added requireAuth(req) guard to GET handler.
 *      All original query logic, IST date helpers, ANC schedule,
 *      vaccination schedule, ReminderItem shape, sorting, and
 *      PATCH reminder_log insert are 100% preserved.
 * ═══════════════════════════════════════════════════════════════
 *
 * PREVIOUS FIXES (preserved from earlier versions):
 * 1. Expanded appointment query date range from 3 days to 30 days
 *    so all upcoming appointments appear in the "All" filter.
 * 2. Appointments due TOMORROW now have priority 'tomorrow'.
 * 3. The 'today_only' filter correctly matches date == today.
 * 4. 'Send All Reminders' button disabled when pending.length === 0.
 *
 * All original logic preserved: IST date helpers, ANC schedule,
 * vaccination schedule, ReminderItem shape, sorting, PATCH
 * reminder_log insert.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/api-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

// ── Date helpers (IST-aware — Asia/Kolkata) ───────────────────
const IST = 'Asia/Kolkata'

function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: IST })
}
function tomorrow(): string {
  const d = new Date(); d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA', { timeZone: IST })
}
function daysFromNow(n: number): string {
  const d = new Date(); d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-CA', { timeZone: IST })
}
function parseISTDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00+05:30')
}
function daysSince(dateStr: string): number {
  const todayIST = parseISTDate(today())
  const target = parseISTDate(dateStr)
  return Math.floor((todayIST.getTime() - target.getTime()) / (1000 * 60 * 60 * 24))
}
function daysUntil(dateStr: string): number {
  const todayIST = parseISTDate(today())
  const target = parseISTDate(dateStr)
  return Math.round((target.getTime() - todayIST.getTime()) / (1000 * 60 * 60 * 24))
}

const ANC_SCHEDULE_WEEKS = [16, 20, 24, 28, 32, 36, 38, 40]

const VAX_SCHEDULE: { name: string; days: number }[] = [
  { name: 'OPV / DPT / Hep-B (6 weeks)', days: 42 },
  { name: 'OPV / DPT / Hep-B (10 weeks)', days: 70 },
  { name: 'OPV / DPT / Hep-B (14 weeks)', days: 98 },
  { name: 'Measles / MMR (9 months)', days: 270 },
]

export interface ReminderItem {
  id: string
  type: 'upcoming' | 'appointment' | 'follow_up' | 'anc' | 'post_delivery' | 'vaccination' | 'pending_bill' | 'high_risk_anc' | 'ot_surgery'
  priority: 'urgent' | 'today' | 'tomorrow' | 'upcoming'
  patientId: string
  patientName: string
  mobile: string
  mrn: string
  sourceId: string
  sourceTable: 'appointments' | 'prescriptions' | 'discharge_summaries' | 'bills' | 'encounters'
  title: string
  subtitle: string
  dueDate?: string
  reminderSentAt?: string | null
  context: {
    lmp?: string
    edd?: string
    deliveryDate?: string
    babyName?: string
    apptDate?: string
    apptTime?: string
    apptType?: string
    followUpDate?: string
    diagnosis?: string
    labTests?: string
    billAmount?: number
    vaxName?: string
    daysOverdue?: number
    weeksGA?: string
    riskReasons?: string[]
    medications?: string[]
  }
}

// ─────────────────────────────────────────────────────────────
// ── GET — build reminder list
//    CRITICAL FIX: Now requires authentication.
//    Previously this was marked "public, no auth required" which
//    exposed PHI (patient names, mobiles, diagnoses, bill amounts)
//    to unauthenticated callers.
// ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // ── CRITICAL FIX: Auth gate ──────────────────────────────
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth
  // ─────────────────────────────────────────────────────────

  const tod = today()
  const tom = tomorrow()
  // Expanded from 3 days to 30 days — so "All" tab shows all upcoming appointments
  const in30 = daysFromNow(30)
  const in7 = daysFromNow(7)

  const reminders: ReminderItem[] = []

  // 1. Appointments — today through next 30 days
  try {
    const { data: appts } = await supabase
      .from('appointments')
      .select('id, patient_id, patient_name, mrn, mobile, date, time, type, notes, status, reminder_sent, reminder_sent_at')
      .gte('date', tod)
      .lte('date', in30)
      .neq('status', 'cancelled')
      .neq('status', 'completed')
      .order('date', { ascending: true })
      .order('time', { ascending: true })

    for (const a of appts || []) {
      const daysAway = daysUntil(a.date)
      let priority: ReminderItem['priority']
      if (daysAway === 0) priority = 'today'
      else if (daysAway === 1) priority = 'tomorrow'
      else if (daysAway <= 7) priority = 'upcoming'
      else priority = 'upcoming'

      reminders.push({
        id: `appt-${a.id}`,
        type: 'appointment',
        priority,
        patientId: a.patient_id ?? '',
        patientName: a.patient_name ?? '',
        mobile: a.mobile ?? '',
        mrn: a.mrn ?? '',
        sourceId: a.id,
        sourceTable: 'appointments',
        title: `Appointment — ${a.type || 'OPD'}`,
        subtitle: `${a.date} at ${a.time || '—'}`,
        dueDate: a.date,
        reminderSentAt: a.reminder_sent_at ?? null,
        context: {
          apptDate: a.date,
          apptTime: a.time,
          apptType: a.type,
        },
      })
    }
  } catch (e) {
    console.error('[reminders] appointments error:', e)
  }

  // 2. Follow-up reminders from prescriptions
  try {
    // FIX: Include overdue follow-ups (up to 14 days past due) AND upcoming (7 days)
    const fourteenDaysAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 14); return d.toLocaleDateString('en-CA', { timeZone: IST }) })()
    const { data: rxs } = await supabase
      .from('prescriptions')
      .select('id, patient_id, patient_name, mrn, mobile, follow_up_date, diagnosis, lab_tests, medications, reminder_sent_at')
      .gte('follow_up_date', fourteenDaysAgo)
      .lte('follow_up_date', in7)
      .order('follow_up_date', { ascending: true })

    for (const rx of rxs || []) {
      if (!rx.follow_up_date) continue
      const daysAway = daysUntil(rx.follow_up_date)
      let priority: ReminderItem['priority']
      if (daysAway < 0) priority = 'urgent'  // Overdue
      else if (daysAway === 0) priority = 'today'
      else if (daysAway === 1) priority = 'tomorrow'
      else priority = 'upcoming'

      // Extract medication names for follow-up reminders
      let medNames: string[] = []
      if (Array.isArray(rx.medications) && rx.medications.length > 0) {
        medNames = rx.medications
          .map((m: any) => m.drug || m.name || '')
          .filter((s: string) => s.length > 0)
          .slice(0, 5)
      }

      reminders.push({
        id: `rx-${rx.id}`,
        type: 'follow_up',
        priority,
        patientId: rx.patient_id ?? '',
        patientName: rx.patient_name ?? '',
        mobile: rx.mobile ?? '',
        mrn: rx.mrn ?? '',
        sourceId: rx.id,
        sourceTable: 'prescriptions',
        title: daysAway < 0 ? `Follow-up OVERDUE (${Math.abs(daysAway)}d)` : 'Follow-up Due',
        subtitle: `${rx.follow_up_date}${rx.diagnosis ? ` — ${rx.diagnosis}` : ''}${medNames.length > 0 ? ` | Meds: ${medNames.join(', ')}` : ''}`,
        dueDate: rx.follow_up_date,
        reminderSentAt: rx.reminder_sent_at ?? null,
        context: {
          followUpDate: rx.follow_up_date,
          diagnosis: rx.diagnosis,
          labTests: rx.lab_tests,
          daysOverdue: daysAway < 0 ? Math.abs(daysAway) : undefined,
          medications: medNames,
        },
      })
    }
  } catch (e) {
    console.error('[reminders] follow_up error:', e)
  }

  // 3. ANC check-up reminders (from encounters with ob_data)
  try {
    const ancLookback = new Date()
    ancLookback.setMonth(ancLookback.getMonth() - 10)
    const ancFrom = ancLookback.toLocaleDateString('en-CA', { timeZone: IST })

    // src/app/api/reminders/route.ts — FIXED query
    const { data: encs } = await supabase
      .from('encounters')
      // Use 'encounter_date' — matches the actual DB schema (supabase_setup.sql)
      .select('id, patient_id, encounter_date, ob_data, patients!inner(full_name, mrn, mobile, date_of_birth)')
      .not('ob_data', 'is', null)
      .gte('encounter_date', ancFrom)
      .order('encounter_date', { ascending: false })
      .limit(500)

    // Keep only the most recent encounter per patient
    const latestByPatient = new Map<string, any>()
    for (const enc of encs || []) {
      if (!latestByPatient.has(enc.patient_id)) {
        latestByPatient.set(enc.patient_id, enc)
      }
    }

    for (const enc of Array.from(latestByPatient.values())) {
      const ob = enc.ob_data
      const pat = enc.patients as any
      if (!ob?.lmp || !pat?.mobile) continue

      const lmpDate = parseISTDate(ob.lmp)
      const nowMs = new Date().getTime()
      const weeksNow = (nowMs - lmpDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
      if (weeksNow > 42) continue  // delivered — skip

      for (const targetWeek of ANC_SCHEDULE_WEEKS) {
        const targetMs = lmpDate.getTime() + targetWeek * 7 * 24 * 60 * 60 * 1000
        const targetStr = new Date(targetMs).toLocaleDateString('en-CA', { timeZone: IST })
        const daysAway = daysUntil(targetStr)

        if (daysAway >= -3 && daysAway <= 7) {
          let priority: ReminderItem['priority']
          if (daysAway <= 0) priority = 'urgent'
          else if (daysAway <= 1) priority = 'tomorrow'
          else priority = 'upcoming'

          reminders.push({
            id: `anc-${enc.id}-w${targetWeek}`,
            type: 'anc',
            priority,
            patientId: enc.patient_id,
            patientName: pat.full_name ?? pat.fullname ?? '',
            mobile: pat.mobile ?? '',
            mrn: pat.mrn ?? '',
            sourceId: enc.id,
            sourceTable: 'encounters',
            title: `ANC Visit — Week ${targetWeek}`,
            subtitle: `Due ${targetStr} · GA ${Math.floor(weeksNow)}w`,
            dueDate: targetStr,
            reminderSentAt: null,
            context: {
              lmp: ob.lmp,
              edd: ob.edd,
              weeksGA: `${Math.floor(weeksNow)} weeks`,
            },
          })
          break // only the nearest upcoming visit per patient
        }
      }
    }
  } catch (e) {
    console.error('[reminders] anc error:', e)
  }

  // 4. Post-delivery follow-up (42 days)
  try {
    const { data: dsList } = await supabase
      .from('discharge_summaries')
      .select('id, patient_id, delivery_date, reminder_sent_at, patients!inner(full_name, mrn, mobile)')
      .not('delivery_date', 'is', null)
      .order('delivery_date', { ascending: false })
      .limit(100)

    for (const ds of dsList || []) {
      const pat = ds.patients as any
      if (!ds.delivery_date || !pat?.mobile) continue

      const followUpMs = new Date(ds.delivery_date).getTime() + 42 * 24 * 60 * 60 * 1000
      const followUpStr = new Date(followUpMs).toLocaleDateString('en-CA', { timeZone: IST })
      const daysAway = daysUntil(followUpStr)

      if (daysAway >= -7 && daysAway <= 7) {
        let priority: ReminderItem['priority']
        if (daysAway <= 0) priority = 'urgent'
        else if (daysAway === 1) priority = 'tomorrow'
        else priority = 'upcoming'

        reminders.push({
          id: `pnd-${ds.id}`,
          type: 'post_delivery',
          priority,
          patientId: ds.patient_id,
          patientName: pat.full_name ?? '',
          mobile: pat.mobile ?? '',
          mrn: pat.mrn ?? '',
          sourceId: ds.id,
          sourceTable: 'discharge_summaries',
          title: 'Post-Delivery Follow-up',
          subtitle: `42-day check · Due ${followUpStr}`,
          dueDate: followUpStr,
          reminderSentAt: ds.reminder_sent_at ?? null,
          context: {
            deliveryDate: ds.delivery_date,
            followUpDate: followUpStr,
          },
        })
      }
    }
  } catch (e) {
    console.error('[reminders] post_delivery error:', e)
  }

  // 5. Vaccination reminders
  try {
    const { data: dsList } = await supabase
      .from('discharge_summaries')
      .select('id, patient_id, delivery_date, baby_sex, reminder_sent_at, patients!inner(full_name, mrn, mobile)')
      .not('delivery_date', 'is', null)
      .order('delivery_date', { ascending: false })
      .limit(100)

    for (const ds of dsList || []) {
      const pat = ds.patients as any
      if (!ds.delivery_date || !pat?.mobile) continue

      const delivMs = new Date(ds.delivery_date).getTime()
      for (const vax of VAX_SCHEDULE) {
        const vaxDueMs = delivMs + vax.days * 24 * 60 * 60 * 1000
        const vaxDueStr = new Date(vaxDueMs).toLocaleDateString('en-CA', { timeZone: IST })
        const daysAway = daysUntil(vaxDueStr)

        if (daysAway >= -5 && daysAway <= 7) {
          let priority: ReminderItem['priority']
          if (daysAway <= 0) priority = 'urgent'
          else if (daysAway === 1) priority = 'tomorrow'
          else priority = 'upcoming'

          reminders.push({
            id: `vax-${ds.id}-${vax.days}`,
            type: 'vaccination',
            priority,
            patientId: ds.patient_id,
            patientName: pat.full_name ?? '',
            mobile: pat.mobile ?? '',
            mrn: pat.mrn ?? '',
            sourceId: ds.id,
            sourceTable: 'discharge_summaries',
            title: `Vaccination Due — ${vax.name}`,
            subtitle: `Due ${vaxDueStr}`,
            dueDate: vaxDueStr,
            reminderSentAt: ds.reminder_sent_at ?? null,
            context: {
              deliveryDate: ds.delivery_date,
              vaxName: vax.name,
            },
          })
          break // only the soonest vaccine per child
        }
      }
    }
  } catch (e) {
    console.error('[reminders] vaccination error:', e)
  }

  // 6. Pending bills (> 3 days old, unpaid)
  try {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const { data: bills } = await supabase
      .from('bills')
      .select('id, patient_id, patient_name, mrn, net_amount, created_at')
      .eq('status', 'pending')
      .lt('created_at', threeDaysAgo)
      .order('created_at', { ascending: true })
      .limit(50)

    // Batch-fetch mobiles to avoid N+1
    const patientIds = Array.from(new Set((bills || []).map((b: any) => b.patient_id).filter(Boolean)))
    const mobileMap = new Map<string, string>()
    if (patientIds.length > 0) {
      const { data: pats } = await supabase
        .from('patients')
        .select('id, mobile')
        .in('id', patientIds)
      for (const p of pats || []) {
        if (p.mobile) mobileMap.set(p.id, p.mobile)
      }
    }

    for (const bill of bills || []) {
      const mobile = mobileMap.get(bill.patient_id)
      if (!mobile) continue

      const overdue = daysSince(bill.created_at.split('T')[0])
      reminders.push({
        id: `bill-${bill.id}`,
        type: 'pending_bill',
        priority: overdue > 7 ? 'urgent' : 'upcoming',
        patientId: bill.patient_id,
        patientName: bill.patient_name ?? '',
        mobile,
        mrn: bill.mrn ?? '',
        sourceId: bill.id,
        sourceTable: 'bills',
        title: 'Pending Bill',
        subtitle: `₹${Number(bill.net_amount).toLocaleString('en-IN')} · ${overdue}d overdue`,
        reminderSentAt: null,
        context: {
          billAmount: Number(bill.net_amount),
          daysOverdue: overdue,
        },
      })
    }
  } catch (e) {
    console.error('[reminders] pending_bill error:', e)
  }

  // 7. OT Schedule reminders — upcoming surgeries within next 7 days
  try {
    const { data: otSchedules } = await supabase
      .from('ot_schedules')
      .select('id, patient_id, patient_name, mrn, surgery_name, surgery_date, start_time, end_time, surgeon, ot_room, priority, status')
      .gte('surgery_date', tod)
      .lte('surgery_date', in7)
      .in('status', ['scheduled'])
      .order('surgery_date', { ascending: true })
      .order('start_time', { ascending: true })

    // Batch-fetch patient mobiles
    const otPatientIds = Array.from(new Set((otSchedules || []).map((s: any) => s.patient_id).filter(Boolean)))
    const otMobileMap = new Map<string, string>()
    if (otPatientIds.length > 0) {
      const { data: pats } = await supabase
        .from('patients')
        .select('id, mobile')
        .in('id', otPatientIds)
      for (const p of pats || []) {
        if (p.mobile) otMobileMap.set(p.id, p.mobile)
      }
    }

    for (const ot of otSchedules || []) {
      const mobile = otMobileMap.get(ot.patient_id) || ''
      const daysAway = daysUntil(ot.surgery_date)
      let priority: ReminderItem['priority']
      if (daysAway === 0) priority = 'today'
      else if (daysAway === 1) priority = 'tomorrow'
      else priority = 'upcoming'

      // Emergency/urgent surgeries get higher priority
      if (ot.priority === 'emergency') priority = 'urgent'
      else if (ot.priority === 'urgent' && daysAway <= 1) priority = 'urgent'

      reminders.push({
        id: `ot-${ot.id}`,
        type: 'ot_surgery',
        priority,
        patientId: ot.patient_id ?? '',
        patientName: ot.patient_name ?? '',
        mobile,
        mrn: ot.mrn ?? '',
        sourceId: ot.id,
        sourceTable: 'appointments',
        title: `OT Surgery — ${ot.surgery_name}`,
        subtitle: `${ot.surgery_date} at ${ot.start_time}–${ot.end_time} · ${ot.ot_room} · Dr. ${ot.surgeon}`,
        dueDate: ot.surgery_date,
        reminderSentAt: null,
        context: {
          apptDate: ot.surgery_date,
          apptTime: ot.start_time,
          apptType: `OT: ${ot.surgery_name}`,
        },
      })
    }
  } catch (e) {
    console.error('[reminders] ot_schedule error:', e)
  }

  // Sort: urgent first, then today, tomorrow, upcoming; within each by dueDate
  const PRIORITY_ORDER = { urgent: 0, today: 1, tomorrow: 2, upcoming: 3 }
  reminders.sort((a, b) => {
    const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    if (pd !== 0) return pd
    return (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
  })

  return NextResponse.json({ reminders, total: reminders.length, generatedAt: new Date().toISOString() })
}

// ── PATCH — log a reminder as sent ──────────────────────────
// Auth required (was already auth-guarded via requireAuth in the original)
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  try {
    const body = await req.json()
    const { reminderId, patientId, patientName, mobile, reminderType, message, sourceTable, sourceId } = body

    // Validate required fields
    if (!patientId || !mobile || !reminderType) {
      return NextResponse.json(
        { error: 'Missing required fields: patientId, mobile, reminderType' },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    const batchId = crypto.randomUUID()

    // Insert into reminder_log
    const { error: logErr } = await supabase.from('reminder_log').insert({
      patient_id: patientId,
      patient_name: patientName ?? '',
      mobile,
      reminder_type: reminderType,
      source_table: sourceTable ?? null,
      source_id: sourceId ?? null,
      message_preview: (message ?? '').slice(0, 200),
      channel: 'whatsapp',
      status: 'sent',
      sent_at: now,
      sent_by: auth.userId ?? 'staff',
      batch_id: batchId,
    })

    if (logErr) {
      console.error('[reminders PATCH] log error:', logErr)
      return NextResponse.json({ error: logErr.message }, { status: 500 })
    }

    // Update reminder_sent_at on the source record (trackable tables only)
    const trackable = ['appointments', 'prescriptions', 'discharge_summaries']
    if (sourceTable && sourceId && trackable.includes(sourceTable)) {
      await supabase.from(sourceTable).update({ reminder_sent_at: now }).eq('id', sourceId)
      if (sourceTable === 'appointments') {
        await supabase.from('appointments').update({ reminder_sent: true }).eq('id', sourceId)
      }
    }

    return NextResponse.json({ ok: true, batchId, sentAt: now })
  } catch (err: any) {
    console.error('[reminders PATCH] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}