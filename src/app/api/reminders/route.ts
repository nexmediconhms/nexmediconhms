import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

// ── Date helpers ──────────────────────────────────────────────
function today(): string {
  return new Date().toISOString().split('T')[0]
}

function tomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

function daysFromNow(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

// Standard ANC visit schedule in weeks of gestation
const ANC_SCHEDULE_WEEKS = [16, 20, 24, 28, 32, 36, 38, 40]

// Vaccination schedule in days from delivery
const VAX_SCHEDULE: { name: string; days: number }[] = [
  { name: 'OPV / DPT / Hep-B (6 weeks)',    days: 42  },
  { name: 'OPV / DPT / Hep-B (10 weeks)',   days: 70  },
  { name: 'OPV / DPT / Hep-B (14 weeks)',   days: 98  },
  { name: 'Measles / MMR (9 months)',        days: 270 },
]

// ── Reminder item shape ───────────────────────────────────────
export interface ReminderItem {
  id:            string   // unique key for React
  type:          'appointment' | 'follow_up' | 'anc' | 'post_delivery' | 'vaccination' | 'pending_bill' | 'high_risk_anc'
  priority:      'urgent' | 'today' | 'tomorrow' | 'upcoming'
  patientId:     string
  patientName:   string
  mobile:        string
  mrn:           string
  sourceId:      string   // appointments.id, prescriptions.id, discharge_summaries.id, bills.id, encounters.id
  sourceTable:   'appointments' | 'prescriptions' | 'discharge_summaries' | 'bills' | 'encounters'
  title:         string
  subtitle:      string
  dueDate?:      string
  reminderSentAt?: string | null
  context: {     // raw data for WhatsApp message generation on the client
    lmp?:          string
    edd?:          string
    deliveryDate?: string
    babyName?:     string
    apptDate?:     string
    apptTime?:     string
    apptType?:     string
    followUpDate?: string
    diagnosis?:    string
    labTests?:     string
    billAmount?:   number
    vaxName?:      string
    daysOverdue?:  number
    weeksGA?:      string
    riskReasons?:  string[]
  }
}

// ── Route handler ─────────────────────────────────────────────
export async function GET(_req: NextRequest) {
  const tod = today()
  const tom = tomorrow()
  const in3  = daysFromNow(3)
  const in7  = daysFromNow(7)

  const reminders: ReminderItem[] = []

  // ── 1. Appointments — today, tomorrow, next 3 days ───────────
  try {
    const { data: appts } = await supabase
      .from('appointments')
      .select('id, patient_id, patient_name, mrn, mobile, date, time, type, notes, status, reminder_sent, reminder_sent_at')
      .gte('date', tod)
      .lte('date', in3)
      .neq('status', 'cancelled')
      .neq('status', 'completed')
      .order('date', { ascending: true })
      .order('time', { ascending: true })

    for (const a of appts || []) {
      const daysAway = daysUntil(a.date)
      reminders.push({
        id:          `appt-${a.id}`,
        type:        'appointment',
        priority:    daysAway === 0 ? 'today' : daysAway === 1 ? 'tomorrow' : 'upcoming',
        patientId:   a.patient_id,
        patientName: a.patient_name,
        mobile:      a.mobile,
        mrn:         a.mrn,
        sourceId:    a.id,
        sourceTable: 'appointments',
        title:       `Appointment — ${a.type}`,
        subtitle:    daysAway === 0 ? `Today at ${a.time}` : daysAway === 1 ? `Tomorrow at ${a.time}` : `${a.date} at ${a.time}`,
        dueDate:     a.date,
        reminderSentAt: a.reminder_sent_at,
        context: {
          apptDate: a.date,
          apptTime: a.time,
          apptType: a.type,
        },
      })
    }
  } catch {}

  // ── 2. Overdue + due-today follow-ups (from prescriptions) ───
  try {
    const { data: rxs } = await supabase
      .from('prescriptions')
      .select(`
        id, patient_id, follow_up_date, reminder_sent_at,
        patients(full_name, mrn, mobile),
        encounters(diagnosis)
      `)
      .not('follow_up_date', 'is', null)
      .lte('follow_up_date', in7)
      .order('follow_up_date', { ascending: true })
      .limit(60)

    for (const rx of rxs || []) {
      const pat  = rx.patients as any
      const enc  = rx.encounters as any
      const due  = rx.follow_up_date as string
      const days = daysUntil(due)

      // Only show overdue (negative) through next 7 days
      if (!pat?.mobile) continue

      const isOverdue = days < 0

      reminders.push({
        id:          `rx-${rx.id}`,
        type:        'follow_up',
        priority:    isOverdue ? 'urgent' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'upcoming',
        patientId:   rx.patient_id,
        patientName: pat.full_name,
        mobile:      pat.mobile,
        mrn:         pat.mrn,
        sourceId:    rx.id,
        sourceTable: 'prescriptions',
        title:       isOverdue ? `⚠️ Overdue Follow-up (${Math.abs(days)} days)` : 'Follow-up Appointment',
        subtitle:    `Due: ${due}${enc?.diagnosis ? ' · ' + enc.diagnosis : ''}`,
        dueDate:     due,
        reminderSentAt: rx.reminder_sent_at,
        context: {
          followUpDate: due,
          diagnosis:    enc?.diagnosis || '',
          daysOverdue:  isOverdue ? Math.abs(days) : 0,
        },
      })
    }
  } catch {}

  // ── 3. ANC patients — due for next visit ─────────────────────
  try {
    const { data: encs } = await supabase
      .from('encounters')
      .select(`
        id, patient_id, encounter_date, ob_data, bp_systolic, bp_diastolic,
        patients(full_name, mrn, mobile, age)
      `)
      .not('ob_data', 'is', null)
      .order('encounter_date', { ascending: false })
      .limit(200)

    // Deduplicate — latest encounter per patient
    const seen = new Set<string>()

    for (const enc of encs || []) {
      const ob  = enc.ob_data as any
      const pat = enc.patients as any
      if (!ob?.lmp || seen.has(enc.patient_id) || !pat?.mobile) continue
      seen.add(enc.patient_id)

      const lmpDate    = new Date(ob.lmp)
      const nowMs      = Date.now()
      const weeksNow   = (nowMs - lmpDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
      const eddDate    = ob.edd ? new Date(ob.edd) : null
      const weeksToEDD = eddDate ? daysUntil(ob.edd) / 7 : 999

      // Skip if delivered (EDD > 2 weeks ago)
      if (eddDate && weeksToEDD < -2) continue

      // High risk alert — always surface in the queue
      const highRiskFlags: string[] = []
      if (ob.liquor === 'Reduced' || ob.liquor === 'Absent') highRiskFlags.push('Oligohydramnios')
      if (ob.presentation === 'Breech' || ob.presentation === 'Transverse') highRiskFlags.push('Abnormal presentation')
      if (ob.fhs && (Number(ob.fhs) < 110 || Number(ob.fhs) > 160)) highRiskFlags.push('Abnormal FHS')
      if (ob.haemoglobin && Number(ob.haemoglobin) < 8) highRiskFlags.push('Severe anaemia')
      if (pat.age && pat.age >= 35) highRiskFlags.push('Advanced maternal age')

      if (highRiskFlags.length > 0) {
        reminders.push({
          id:          `anc-hr-${enc.id}`,
          type:        'high_risk_anc',
          priority:    'urgent',
          patientId:   enc.patient_id,
          patientName: pat.full_name,
          mobile:      pat.mobile,
          mrn:         pat.mrn,
          sourceId:    enc.id,
          sourceTable: 'encounters',
          title:       '🚨 High-Risk ANC — Urgent Follow-up',
          subtitle:    highRiskFlags.join(' · '),
          reminderSentAt: null,
          context: {
            lmp:         ob.lmp,
            edd:         ob.edd,
            weeksGA:     `${Math.floor(weeksNow)} weeks`,
            riskReasons: highRiskFlags,
          },
        })
      }

      // Find which ANC visit window she is in and when next one is due
      for (const schedWeek of ANC_SCHEDULE_WEEKS) {
        const visitDueMs  = lmpDate.getTime() + schedWeek * 7 * 24 * 60 * 60 * 1000
        const visitDueStr = new Date(visitDueMs).toISOString().split('T')[0]
        const daysAway    = daysUntil(visitDueStr)

        // Show upcoming ANC reminder if visit is due within 7 days
        if (daysAway >= -3 && daysAway <= 7) {
          reminders.push({
            id:          `anc-${enc.id}-w${schedWeek}`,
            type:        'anc',
            priority:    daysAway <= 0 ? 'today' : daysAway === 1 ? 'tomorrow' : 'upcoming',
            patientId:   enc.patient_id,
            patientName: pat.full_name,
            mobile:      pat.mobile,
            mrn:         pat.mrn,
            sourceId:    enc.id,
            sourceTable: 'encounters',
            title:       `ANC Visit Due — ${schedWeek} Weeks`,
            subtitle:    `GA: ${Math.floor(weeksNow)}w · EDD: ${ob.edd || '—'} · G${ob.gravida || 0}P${ob.para || 0}`,
            dueDate:     visitDueStr,
            reminderSentAt: null,
            context: {
              lmp:     ob.lmp,
              edd:     ob.edd,
              weeksGA: `${Math.floor(weeksNow)} weeks`,
            },
          })
          break // only show the next upcoming visit per patient
        }
      }
    }
  } catch {}

  // ── 4. Post-delivery follow-up (6 weeks after delivery) ──────
  try {
    const { data: dsList } = await supabase
      .from('discharge_summaries')
      .select(`
        id, patient_id, delivery_date, reminder_sent_at,
        patients(full_name, mrn, mobile)
      `)
      .not('delivery_date', 'is', null)
      .order('delivery_date', { ascending: false })
      .limit(50)

    for (const ds of dsList || []) {
      const pat = ds.patients as any
      if (!ds.delivery_date || !pat?.mobile) continue

      const delivMs     = new Date(ds.delivery_date).getTime()
      const followUpMs  = delivMs + 42 * 24 * 60 * 60 * 1000  // 6 weeks = 42 days
      const followUpStr = new Date(followUpMs).toISOString().split('T')[0]
      const daysAway    = daysUntil(followUpStr)

      // Show if within window: 3 days before to 7 days after
      if (daysAway >= -7 && daysAway <= 3) {
        reminders.push({
          id:          `postdel-${ds.id}`,
          type:        'post_delivery',
          priority:    daysAway <= 0 ? 'urgent' : daysAway === 1 ? 'tomorrow' : 'upcoming',
          patientId:   ds.patient_id,
          patientName: pat.full_name,
          mobile:      pat.mobile,
          mrn:         pat.mrn,
          sourceId:    ds.id,
          sourceTable: 'discharge_summaries',
          title:       '👶 Post-Delivery 6-Week Review',
          subtitle:    `Delivered: ${ds.delivery_date} · Review due: ${followUpStr}`,
          dueDate:     followUpStr,
          reminderSentAt: ds.reminder_sent_at,
          context: {
            deliveryDate: ds.delivery_date,
            followUpDate: followUpStr,
          },
        })
      }
    }
  } catch {}

  // ── 5. Vaccination reminders ──────────────────────────────────
  try {
    const { data: dsList } = await supabase
      .from('discharge_summaries')
      .select(`
        id, patient_id, delivery_date, baby_sex,
        patients(full_name, mrn, mobile)
      `)
      .not('delivery_date', 'is', null)
      .order('delivery_date', { ascending: false })
      .limit(50)

    for (const ds of dsList || []) {
      const pat = ds.patients as any
      if (!ds.delivery_date || !pat?.mobile) continue

      const delivMs = new Date(ds.delivery_date).getTime()

      for (const vax of VAX_SCHEDULE) {
        const vaxDueMs  = delivMs + vax.days * 24 * 60 * 60 * 1000
        const vaxDueStr = new Date(vaxDueMs).toISOString().split('T')[0]
        const daysAway  = daysUntil(vaxDueStr)

        // Show if within window: 3 days before to 5 days after
        if (daysAway >= -5 && daysAway <= 3) {
          reminders.push({
            id:          `vax-${ds.id}-${vax.days}`,
            type:        'vaccination',
            priority:    daysAway <= 0 ? 'urgent' : daysAway === 1 ? 'tomorrow' : 'upcoming',
            patientId:   ds.patient_id,
            patientName: pat.full_name,
            mobile:      pat.mobile,
            mrn:         pat.mrn,
            sourceId:    ds.id,
            sourceTable: 'discharge_summaries',
            title:       `💉 ${vax.name}`,
            subtitle:    `Mother: ${pat.full_name} · Delivered: ${ds.delivery_date} · Due: ${vaxDueStr}`,
            dueDate:     vaxDueStr,
            reminderSentAt: null,
            context: {
              deliveryDate: ds.delivery_date,
              vaxName:      vax.name,
              followUpDate: vaxDueStr,
            },
          })
          break // one upcoming vax per discharge summary
        }
      }
    }
  } catch {}

  // ── 6. Pending bills older than 3 days ───────────────────────
  try {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

    const { data: pendingBills } = await supabase
      .from('bills')
      .select('id, patient_id, patient_name, mrn, net_amount, created_at, items')
      .eq('status', 'pending')
      .lt('created_at', threeDaysAgo)
      .order('created_at', { ascending: true })
      .limit(30)

    for (const bill of pendingBills || []) {
      // Look up mobile number
      const { data: pat } = await supabase
        .from('patients')
        .select('mobile')
        .eq('id', bill.patient_id)
        .single()

      if (!pat?.mobile) continue

      const overdueDays = daysSince(bill.created_at)
      reminders.push({
        id:          `bill-${bill.id}`,
        type:        'pending_bill',
        priority:    overdueDays > 7 ? 'urgent' : 'upcoming',
        patientId:   bill.patient_id,
        patientName: bill.patient_name,
        mobile:      pat.mobile,
        mrn:         bill.mrn,
        sourceId:    bill.id,
        sourceTable: 'bills',
        title:       `💳 Pending Payment — ₹${Number(bill.net_amount).toLocaleString('en-IN')}`,
        subtitle:    `${overdueDays} days pending · ${Array.isArray(bill.items) ? bill.items.map((i: any) => i.label).join(', ').slice(0, 60) : ''}`,
        reminderSentAt: null,
        context: {
          billAmount: Number(bill.net_amount),
        },
      })
    }
  } catch {}

  // ── Sort: urgent first, then by dueDate ──────────────────────
  const priorityOrder = { urgent: 0, today: 1, tomorrow: 2, upcoming: 3 }
  reminders.sort((a, b) => {
    const po = priorityOrder[a.priority] - priorityOrder[b.priority]
    if (po !== 0) return po
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate)
    return 0
  })

  return NextResponse.json({ reminders, generatedAt: new Date().toISOString() })
}

// ── PATCH — mark a reminder as sent ──────────────────────────
export async function PATCH(req: NextRequest) {
  const { sourceTable, sourceId } = await req.json()
  if (!sourceTable || !sourceId) {
    return NextResponse.json({ error: 'sourceTable and sourceId required' }, { status: 400 })
  }

  // Only update tables that have reminder_sent_at
  const allowed = ['appointments', 'prescriptions', 'discharge_summaries']
  if (!allowed.includes(sourceTable)) {
    return NextResponse.json({ ok: true }) // bills / encounters don't track sent_at
  }

  await supabase
    .from(sourceTable)
    .update({ reminder_sent_at: new Date().toISOString() })
    .eq('id', sourceId)

  // Also mark appointments reminder_sent = true (existing field)
  if (sourceTable === 'appointments') {
    await supabase
      .from('appointments')
      .update({ reminder_sent: true })
      .eq('id', sourceId)
  }

  return NextResponse.json({ ok: true })
}