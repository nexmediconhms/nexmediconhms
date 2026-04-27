import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

// ── Date helpers (IST-aware) ──────────────────────────────────
const IST = 'Asia/Kolkata'

function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: IST })
}

function tomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA', { timeZone: IST })
}

function daysFromNow(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-CA', { timeZone: IST })
}

function parseISTDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00+05:30')
}

function daysUntil(dateStr: string): number {
  const todayIST = parseISTDate(today())
  const target = parseISTDate(dateStr)
  return Math.round((target.getTime() - todayIST.getTime()) / (1000 * 60 * 60 * 24))
}

function daysSince(dateStr: string): number {
  const todayIST = parseISTDate(today())
  const target = parseISTDate(dateStr)
  return Math.floor((todayIST.getTime() - target.getTime()) / (1000 * 60 * 60 * 24))
}

// ANC schedule
const ANC_SCHEDULE_WEEKS = [16, 20, 24, 28, 32, 36, 38, 40]

// Vaccination schedule
const VAX_SCHEDULE: { name: string; days: number }[] = [
  { name: 'OPV / DPT / Hep-B (6 weeks)', days: 42 },
  { name: 'OPV / DPT / Hep-B (10 weeks)', days: 70 },
  { name: 'OPV / DPT / Hep-B (14 weeks)', days: 98 },
  { name: 'Measles / MMR (9 months)', days: 270 },
]

interface AutoReminder {
  patientId: string
  patientName: string
  mobile: string
  type: string
  sourceTable: string
  sourceId: string
  message: string
  priority: string
}

/**
 * GET /api/reminders/auto-generate
 *
 * Cron-callable endpoint that:
 * 1. Scans all modules for patients needing reminders
 * 2. Checks if a reminder was already sent today for each
 * 3. Auto-logs and returns the list of reminders that need sending
 *
 * Can be called by:
 * - Vercel Cron (vercel.json → crons)
 * - Manual trigger from the Reminders page
 * - External scheduler
 *
 * Query params:
 *   ?dryRun=true  — only return what would be sent, don't log
 *   ?types=appointment,anc  — filter specific types
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const dryRun = searchParams.get('dryRun') === 'true'
  const typesFilter = searchParams.get('types')?.split(',').filter(Boolean) || []

  const tod = today()
  const tom = tomorrow()
  const in3 = daysFromNow(3)
  const in7 = daysFromNow(7)

  const autoReminders: AutoReminder[] = []

  // ── Helper: check if reminder already sent today for this source ──
  async function alreadySentToday(sourceTable: string, sourceId: string): Promise<boolean> {
    const startOfDay = tod + 'T00:00:00+05:30'
    const { data } = await supabase
      .from('reminder_log')
      .select('id')
      .eq('source_table', sourceTable)
      .eq('source_id', sourceId)
      .gte('sent_at', startOfDay)
      .limit(1)
    return (data?.length || 0) > 0
  }

  // ── Helper: build simple message (server-side, no hospital settings) ──
  function buildMessage(type: string, patientName: string, context: Record<string, any>): string {
    const name = patientName || 'Patient'
    switch (type) {
      case 'appointment':
        return `Namaste ${name} ji, reminder for your appointment on ${context.date || ''} at ${context.time || ''}. Please arrive 10 min early.`
      case 'follow_up':
        return `Namaste ${name} ji, your follow-up visit is ${context.overdue ? `overdue by ${context.daysOverdue} days` : `due on ${context.followUpDate}`}. Please visit at the earliest.`
      case 'anc':
        return `Namaste ${name} ji, your ANC check-up is due. Current GA: ${context.weeksGA || ''}. Please bring reports & ANC card.`
      case 'high_risk_anc':
        return `URGENT: ${name} ji, your doctor has flagged concerns: ${(context.riskReasons || []).join(', ')}. Please visit immediately.`
      case 'post_delivery':
        return `Namaste ${name} ji, your 6-week post-delivery review is due on ${context.followUpDate || ''}. Please bring discharge summary.`
      case 'vaccination':
        return `Namaste ${name} ji, your baby's vaccination (${context.vaxName || ''}) is due on ${context.dueDate || ''}. Please bring vaccination card.`
      case 'pending_bill':
        return `Namaste ${name} ji, your payment of ₹${context.amount || ''} is pending. Please visit the billing counter.`
      default:
        return `Namaste ${name} ji, you have a pending reminder from the hospital. Please contact us.`
    }
  }

  // ── 1. Appointments (today + tomorrow) ────────────────────────
  if (!typesFilter.length || typesFilter.includes('appointment')) {
    try {
      const { data: appts } = await supabase
        .from('appointments')
        .select('id, patient_id, patient_name, mrn, mobile, date, time, type, status, reminder_sent_at')
        .gte('date', tod)
        .lte('date', tom)
        .neq('status', 'cancelled')
        .neq('status', 'completed')
        .order('date', { ascending: true })

      for (const a of appts || []) {
        if (!a.mobile) continue
        const alreadySent = await alreadySentToday('appointments', a.id)
        if (alreadySent) continue

        const daysAway = daysUntil(a.date)
        autoReminders.push({
          patientId: a.patient_id,
          patientName: a.patient_name,
          mobile: a.mobile,
          type: 'appointment',
          sourceTable: 'appointments',
          sourceId: a.id,
          priority: daysAway === 0 ? 'today' : 'tomorrow',
          message: buildMessage('appointment', a.patient_name, { date: a.date, time: a.time }),
        })
      }
    } catch (e) { console.error('[auto-gen] appointments error:', e) }
  }

  // ── 2. Follow-ups (overdue + due today/tomorrow) ──────────────
  if (!typesFilter.length || typesFilter.includes('follow_up')) {
    try {
      const { data: rxs } = await supabase
        .from('prescriptions')
        .select(`id, patient_id, follow_up_date, patients(full_name, mrn, mobile), encounters(diagnosis)`)
        .not('follow_up_date', 'is', null)
        .lte('follow_up_date', in7)
        .order('follow_up_date', { ascending: true })
        .limit(60)

      for (const rx of rxs || []) {
        const pat = rx.patients as any
        if (!pat?.mobile) continue
        const due = rx.follow_up_date as string
        const days = daysUntil(due)
        if (days > 1) continue // only overdue, today, tomorrow

        const alreadySent = await alreadySentToday('prescriptions', rx.id)
        if (alreadySent) continue

        const isOverdue = days < 0
        autoReminders.push({
          patientId: rx.patient_id,
          patientName: pat.full_name,
          mobile: pat.mobile,
          type: 'follow_up',
          sourceTable: 'prescriptions',
          sourceId: rx.id,
          priority: isOverdue ? 'urgent' : days === 0 ? 'today' : 'tomorrow',
          message: buildMessage('follow_up', pat.full_name, {
            followUpDate: due,
            overdue: isOverdue,
            daysOverdue: Math.abs(days),
          }),
        })
      }
    } catch (e) { console.error('[auto-gen] follow_up error:', e) }
  }

  // ── 3. ANC patients ───────────────────────────────────────────
  if (!typesFilter.length || typesFilter.includes('anc') || typesFilter.includes('high_risk_anc')) {
    try {
      const { data: encs } = await supabase
        .from('encounters')
        .select(`id, patient_id, encounter_date, ob_data, bp_systolic, bp_diastolic, patients(full_name, mrn, mobile, age)`)
        .not('ob_data', 'is', null)
        .order('encounter_date', { ascending: false })
        .limit(200)

      const seen = new Set<string>()
      for (const enc of encs || []) {
        const ob = enc.ob_data as any
        const pat = enc.patients as any
        if (!ob?.lmp || seen.has(enc.patient_id) || !pat?.mobile) continue
        seen.add(enc.patient_id)

        const lmpDate = new Date(ob.lmp)
        const nowMs = Date.now()
        const weeksNow = (nowMs - lmpDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
        const eddDate = ob.edd ? new Date(ob.edd) : null
        const weeksToEDD = eddDate ? daysUntil(ob.edd) / 7 : 999
        if (eddDate && weeksToEDD < -2) continue

        // High risk
        if (!typesFilter.length || typesFilter.includes('high_risk_anc')) {
          const highRiskFlags: string[] = []
          if (ob.liquor === 'Reduced' || ob.liquor === 'Absent') highRiskFlags.push('Oligohydramnios')
          if (ob.presentation === 'Breech' || ob.presentation === 'Transverse') highRiskFlags.push('Abnormal presentation')
          if (ob.fhs && (Number(ob.fhs) < 110 || Number(ob.fhs) > 160)) highRiskFlags.push('Abnormal FHS')
          if (ob.haemoglobin && Number(ob.haemoglobin) < 8) highRiskFlags.push('Severe anaemia')
          if (pat.age && pat.age >= 35) highRiskFlags.push('Advanced maternal age')

          if (highRiskFlags.length > 0) {
            const alreadySent = await alreadySentToday('encounters', enc.id)
            if (!alreadySent) {
              autoReminders.push({
                patientId: enc.patient_id,
                patientName: pat.full_name,
                mobile: pat.mobile,
                type: 'high_risk_anc',
                sourceTable: 'encounters',
                sourceId: enc.id,
                priority: 'urgent',
                message: buildMessage('high_risk_anc', pat.full_name, {
                  weeksGA: `${Math.floor(weeksNow)} weeks`,
                  riskReasons: highRiskFlags,
                }),
              })
            }
          }
        }

        // ANC visit schedule
        if (!typesFilter.length || typesFilter.includes('anc')) {
          for (const schedWeek of ANC_SCHEDULE_WEEKS) {
            const visitDueMs = lmpDate.getTime() + schedWeek * 7 * 24 * 60 * 60 * 1000
            const visitDueStr = new Date(visitDueMs).toLocaleDateString('en-CA', { timeZone: IST })
            const daysAway = daysUntil(visitDueStr)

            if (daysAway >= -3 && daysAway <= 3) {
              const alreadySent = await alreadySentToday('encounters', enc.id)
              if (!alreadySent) {
                autoReminders.push({
                  patientId: enc.patient_id,
                  patientName: pat.full_name,
                  mobile: pat.mobile,
                  type: 'anc',
                  sourceTable: 'encounters',
                  sourceId: enc.id,
                  priority: daysAway <= 0 ? 'today' : 'tomorrow',
                  message: buildMessage('anc', pat.full_name, {
                    weeksGA: `${Math.floor(weeksNow)} weeks`,
                  }),
                })
              }
              break
            }
          }
        }
      }
    } catch (e) { console.error('[auto-gen] anc error:', e) }
  }

  // ── 4. Post-delivery follow-up ────────────────────────────────
  if (!typesFilter.length || typesFilter.includes('post_delivery')) {
    try {
      const { data: dsList } = await supabase
        .from('discharge_summaries')
        .select(`id, patient_id, delivery_date, reminder_sent_at, patients(full_name, mrn, mobile)`)
        .not('delivery_date', 'is', null)
        .order('delivery_date', { ascending: false })
        .limit(50)

      for (const ds of dsList || []) {
        const pat = ds.patients as any
        if (!ds.delivery_date || !pat?.mobile) continue

        const delivMs = new Date(ds.delivery_date).getTime()
        const followUpMs = delivMs + 42 * 24 * 60 * 60 * 1000
        const followUpStr = new Date(followUpMs).toLocaleDateString('en-CA', { timeZone: IST })
        const daysAway = daysUntil(followUpStr)

        if (daysAway >= -7 && daysAway <= 3) {
          const alreadySent = await alreadySentToday('discharge_summaries', ds.id)
          if (alreadySent) continue

          autoReminders.push({
            patientId: ds.patient_id,
            patientName: pat.full_name,
            mobile: pat.mobile,
            type: 'post_delivery',
            sourceTable: 'discharge_summaries',
            sourceId: ds.id,
            priority: daysAway <= 0 ? 'urgent' : 'tomorrow',
            message: buildMessage('post_delivery', pat.full_name, { followUpDate: followUpStr }),
          })
        }
      }
    } catch (e) { console.error('[auto-gen] post_delivery error:', e) }
  }

  // ── 5. Vaccination reminders ──────────────────────────────────
  if (!typesFilter.length || typesFilter.includes('vaccination')) {
    try {
      const { data: dsList } = await supabase
        .from('discharge_summaries')
        .select(`id, patient_id, delivery_date, baby_sex, patients(full_name, mrn, mobile)`)
        .not('delivery_date', 'is', null)
        .order('delivery_date', { ascending: false })
        .limit(50)

      for (const ds of dsList || []) {
        const pat = ds.patients as any
        if (!ds.delivery_date || !pat?.mobile) continue

        const delivMs = new Date(ds.delivery_date).getTime()
        for (const vax of VAX_SCHEDULE) {
          const vaxDueMs = delivMs + vax.days * 24 * 60 * 60 * 1000
          const vaxDueStr = new Date(vaxDueMs).toLocaleDateString('en-CA', { timeZone: IST })
          const daysAway = daysUntil(vaxDueStr)

          if (daysAway >= -5 && daysAway <= 3) {
            const alreadySent = await alreadySentToday('discharge_summaries', ds.id)
            if (alreadySent) continue

            autoReminders.push({
              patientId: ds.patient_id,
              patientName: pat.full_name,
              mobile: pat.mobile,
              type: 'vaccination',
              sourceTable: 'discharge_summaries',
              sourceId: ds.id,
              priority: daysAway <= 0 ? 'urgent' : 'tomorrow',
              message: buildMessage('vaccination', pat.full_name, {
                vaxName: vax.name,
                dueDate: vaxDueStr,
              }),
            })
            break
          }
        }
      }
    } catch (e) { console.error('[auto-gen] vaccination error:', e) }
  }

  // ── 6. Pending bills ──────────────────────────────────────────
  if (!typesFilter.length || typesFilter.includes('pending_bill')) {
    try {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
      const { data: pendingBills } = await supabase
        .from('bills')
        .select('id, patient_id, patient_name, mrn, net_amount, created_at')
        .eq('status', 'pending')
        .lt('created_at', threeDaysAgo)
        .order('created_at', { ascending: true })
        .limit(30)

      for (const bill of pendingBills || []) {
        const { data: pat } = await supabase
          .from('patients')
          .select('mobile')
          .eq('id', bill.patient_id)
          .single()

        if (!pat?.mobile) continue

        const alreadySent = await alreadySentToday('bills', bill.id)
        if (alreadySent) continue

        autoReminders.push({
          patientId: bill.patient_id,
          patientName: bill.patient_name,
          mobile: pat.mobile,
          type: 'pending_bill',
          sourceTable: 'bills',
          sourceId: bill.id,
          priority: daysSince(bill.created_at) > 7 ? 'urgent' : 'upcoming',
          message: buildMessage('pending_bill', bill.patient_name, {
            amount: Number(bill.net_amount).toLocaleString('en-IN'),
          }),
        })
      }
    } catch (e) { console.error('[auto-gen] pending_bill error:', e) }
  }

  // ── If not dry run, log all and mark as sent ──────────────────
  if (!dryRun && autoReminders.length > 0) {
    const batchId = crypto.randomUUID()
    const now = new Date().toISOString()

    for (const r of autoReminders) {
      // Log
      await supabase.from('reminder_log').insert({
        patient_id: r.patientId,
        patient_name: r.patientName,
        mobile: r.mobile,
        reminder_type: r.type,
        source_table: r.sourceTable,
        source_id: r.sourceId,
        message_preview: r.message.slice(0, 200),
        channel: 'whatsapp',
        status: 'sent',
        sent_at: now,
        sent_by: 'auto',
        batch_id: batchId,
      })

      // Update source table
      const trackableTables = ['appointments', 'prescriptions', 'discharge_summaries']
      if (trackableTables.includes(r.sourceTable)) {
        await supabase
          .from(r.sourceTable)
          .update({ reminder_sent_at: now })
          .eq('id', r.sourceId)

        if (r.sourceTable === 'appointments') {
          await supabase
            .from('appointments')
            .update({ reminder_sent: true })
            .eq('id', r.sourceId)
        }
      }
    }

    return NextResponse.json({
      ok: true,
      mode: 'auto',
      batchId,
      total: autoReminders.length,
      reminders: autoReminders,
      generatedAt: now,
    })
  }

  return NextResponse.json({
    ok: true,
    mode: dryRun ? 'dryRun' : 'auto',
    total: autoReminders.length,
    reminders: autoReminders,
    generatedAt: new Date().toISOString(),
  })
}
