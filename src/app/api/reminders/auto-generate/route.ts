/**
 * src/app/api/reminders/auto-generate/route.ts
 *
 * ═══════════════════════════════════════════════════════════════
 * CRITICAL BUG FIXES applied in this version:
 *
 * FIX A — Cron endpoint was unauthenticated (no secret).
 *   Anyone who discovered the URL could trigger bulk WhatsApp
 *   reminder generation for all patients on demand — or flood
 *   patients with repeated reminders by hitting the URL repeatedly.
 *   FIX: Validates Authorization: Bearer ${CRON_SECRET} header.
 *        Falls back to checking ?secret= query param (for Vercel
 *        cron which can't easily set headers in vercel.json).
 *        Returns 401 if neither matches.
 *
 * FIX B — N+1 database queries in alreadySentToday().
 *   Original code called `await alreadySentToday(table, id)`
 *   inside a for-loop for every reminder candidate. For a clinic
 *   with 50 ANC patients + 30 pending bills + 20 vaccinations,
 *   this fired 100+ sequential DB calls per cron run — causing
 *   Vercel function timeouts and silent reminder failures.
 *   FIX: Batch-load all today's sent reminder log entries upfront
 *        into a Set<string>, then check membership in-memory.
 *        O(n) queries → O(1) lookups after a single batch fetch.
 *
 * All original logic preserved:
 * - IST date helpers, dryRun mode, typesFilter query param
 * - ANC_LOOKBACK_MONTHS, ANC_MAX_ROWS constants
 * - ANC schedule (16,20,24,28,32,36,38,40 weeks)
 * - Vaccination schedule (42/70/98/270 days)
 * - Post-delivery 42-day follow-up
 * - Pending bills (> 3 days, unpaid)
 * - High-risk ANC detection
 * - buildMessage() template calls
 * - reminder_log batch insert with batchId
 * - reminder_sent_at update on source tables
 * ═══════════════════════════════════════════════════════════════
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Use service role key for cron jobs — bypasses RLS intentionally
// since this is a server-side background job, not a user request.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

// ── IST date helpers ─────────────────────────────────────────
const IST = 'Asia/Kolkata'

function todayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: IST })
}
function parseISTDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00+05:30')
}
function daysUntil(dateStr: string): number {
  const todayD = parseISTDate(todayIST())
  const target = parseISTDate(dateStr)
  return Math.round((target.getTime() - todayD.getTime()) / (1000 * 60 * 60 * 24))
}
function daysSince(dateStr: string): number {
  const todayD = parseISTDate(todayIST())
  const target = parseISTDate(typeof dateStr === 'string' && dateStr.includes('T')
    ? dateStr.split('T')[0]
    : dateStr)
  return Math.floor((todayD.getTime() - target.getTime()) / (1000 * 60 * 60 * 24))
}
function isoDateMonthsAgo(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ── ANC/Vax constants (unchanged from original) ──────────────
const ANC_LOOKBACK_MONTHS = 18
const ANC_MAX_ROWS         = 2000
const ANC_SCHEDULE_WEEKS   = [16, 20, 24, 28, 32, 36, 38, 40]
const VAX_SCHEDULE: { name: string; days: number }[] = [
  { name: 'OPV / DPT / Hep-B (6 weeks)',  days: 42  },
  { name: 'OPV / DPT / Hep-B (10 weeks)', days: 70  },
  { name: 'OPV / DPT / Hep-B (14 weeks)', days: 98  },
  { name: 'Measles / MMR (9 months)',      days: 270 },
]

// ── WhatsApp message builder (unchanged logic) ───────────────
function buildMessage(
  type: string,
  patientName: string,
  ctx: Record<string, string> = {}
): string {
  switch (type) {
    case 'appointment':
      return `Namaste ${patientName} ji,\n\nYour appointment is scheduled on ${ctx.apptDate || ''}${ctx.apptTime ? ' at ' + ctx.apptTime : ''}.\n\nPlease arrive 10 minutes early.\n\nThank you!`
    case 'follow_up':
      return `Namaste ${patientName} ji,\n\nYour follow-up visit is due on ${ctx.followUpDate || ''}.${ctx.diagnosis ? '\nDiagnosis: ' + ctx.diagnosis : ''}${ctx.medications ? '\n\nMedications to continue:\n' + ctx.medications : ''}\n\nPlease don't miss your follow-up.\n\nThank you!`
    case 'anc':
      return `Namaste ${patientName} ji,\n\nYour antenatal check-up is due (GA: ${ctx.weeksGA || ''}).\n\nPlease visit the clinic for your ANC visit.\n\nThank you!`
    case 'post_delivery':
      return `Namaste ${patientName} ji,\n\nYour 42-day post-delivery check-up is due on ${ctx.followUpDate || ''}.\n\nPlease visit for mother & baby check-up.\n\nThank you!`
    case 'vaccination':
      return `Namaste ${patientName} ji,\n\nVaccination due for your baby: ${ctx.vaxName || ''} on ${ctx.dueDate || ''}.\n\nPlease don't miss this important vaccine.\n\nThank you!`
    case 'pending_bill':
      return `Namaste ${patientName} ji,\n\nYou have a pending bill of ₹${ctx.amount || ''} at our clinic.\n\nKindly clear the dues at your earliest convenience.\n\nThank you!`
    default:
      return `Namaste ${patientName} ji,\n\nYou have a reminder from our clinic.\n\nThank you!`
  }
}

// ─────────────────────────────────────────────────────────────
// FIX B: Batch-load already-sent entries for today.
// Returns a Set of strings keyed as "sourceTable:sourceId".
// This replaces per-item DB calls in the original alreadySentToday().
// ─────────────────────────────────────────────────────────────
async function loadTodaySentSet(): Promise<Set<string>> {
  const startOfDay = todayIST() + 'T00:00:00+05:30'
  const endOfDay   = todayIST() + 'T23:59:59+05:30'

  try {
    const { data, error } = await supabase
      .from('reminder_log')
      .select('source_table, source_id')
      .gte('sent_at', startOfDay)
      .lte('sent_at', endOfDay)
      .eq('channel', 'whatsapp')
      .eq('status', 'sent')

    if (error) {
      // If reminder_log table doesn't exist yet, return empty set
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return new Set()
      }
      console.error('[auto-gen] loadTodaySentSet error:', error)
      return new Set()
    }

    const sent = new Set<string>()
    for (const row of data || []) {
      if (row.source_table && row.source_id) {
        sent.add(`${row.source_table}:${row.source_id}`)
      }
    }
    return sent
  } catch (e) {
    console.error('[auto-gen] loadTodaySentSet exception:', e)
    return new Set()
  }
}

// In-memory check using the pre-loaded Set (O(1) vs O(n) DB calls)
function alreadySent(sentSet: Set<string>, sourceTable: string, sourceId: string): boolean {
  return sentSet.has(`${sourceTable}:${sourceId}`)
}

interface AutoReminder {
  patientId:    string
  patientName:  string
  mobile:       string
  type:         string
  sourceTable:  string
  sourceId:     string
  priority:     string
  message:      string
}

// ─────────────────────────────────────────────────────────────
// POST — Vercel cron handler
// GET  — Manual trigger from Reminders page "Auto-Send" button
// ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // GET handler is called from the UI "Auto-Send Today's Reminders" button.
  // No CRON_SECRET needed — just let it through (the page is behind auth anyway).
  return handleAutoGenerate(req)
}

export async function POST(req: NextRequest) {
  return handleAutoGenerate(req)
}

async function handleAutoGenerate(req: NextRequest) {
  // ── FIX A: Cron secret validation ────────────────────────────
  // Vercel cron passes the secret in Authorization header.
  // We also accept ?secret= for testing via browser/curl.
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret) {
    const authHeader = req.headers.get('authorization') ?? ''
    const querySecret = new URL(req.url).searchParams.get('secret') ?? ''

    const headerToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : authHeader.trim()

    if (headerToken !== cronSecret && querySecret !== cronSecret) {
      console.warn('[auto-gen] Unauthorized cron attempt from:', req.headers.get('x-forwarded-for') ?? 'unknown')
      return NextResponse.json(
        { error: 'Unauthorized. Valid CRON_SECRET required.' },
        { status: 401 }
      )
    }
  } else {
    // CRON_SECRET not configured.
    //
    // FIX (May 2026): in production this is a critical mis-configuration
    // — the endpoint can spam patients with reminders if left open.
    // Fail closed in production; log a warning in non-production so
    // local dev still works without the secret set.
    if (process.env.NODE_ENV === 'production') {
      console.error('[auto-gen] CRON_SECRET not configured in production — request denied')
      return NextResponse.json(
        { error: 'Server misconfigured: CRON_SECRET is required in production.' },
        { status: 401 }
      )
    }
    console.warn('[auto-gen] WARNING: CRON_SECRET env var is not set. Endpoint is unprotected (non-production only)!')
  }
  // ─────────────────────────────────────────────────────────────

  const { searchParams } = new URL(req.url)
  const dryRun      = searchParams.get('dryRun') === 'true'
  const typesFilter = (searchParams.get('types') ?? '').split(',').filter(Boolean)

  // FIX B: Load all today's sent entries in ONE query upfront
  const sentSet = await loadTodaySentSet()

  const autoReminders: AutoReminder[] = []

  // ── 1. Appointments ─────────────────────────────────────────
  if (!typesFilter.length || typesFilter.includes('appointment')) {
    try {
      const tod  = todayIST()
      const in3  = (() => { const d = new Date(); d.setDate(d.getDate() + 3); return d.toLocaleDateString('en-CA', { timeZone: IST }) })()

      const { data: appts } = await supabase
        .from('appointments')
        .select('id, patient_id, patient_name, mrn, mobile, date, time, type, status, reminder_sent, reminder_sent_at')
        .gte('date', tod)
        .lte('date', in3)
        .neq('status', 'cancelled')
        .neq('status', 'completed')
        .order('date', { ascending: true })

      for (const a of appts || []) {
        if (!a.mobile) continue
        if (a.reminder_sent) continue // already sent (boolean flag)
        if (alreadySent(sentSet, 'appointments', a.id)) continue

        const daysAway = daysUntil(a.date)
        const priority = daysAway === 0 ? 'today' : daysAway === 1 ? 'tomorrow' : 'upcoming'

        autoReminders.push({
          patientId:   a.patient_id ?? '',
          patientName: a.patient_name ?? '',
          mobile:      a.mobile,
          type:        'appointment',
          sourceTable: 'appointments',
          sourceId:    a.id,
          priority,
          message:     buildMessage('appointment', a.patient_name ?? '', { apptDate: a.date, apptTime: a.time ?? '' }),
        })
      }
    } catch (e) { console.error('[auto-gen] appointments error:', e) }
  }

  // ── 2. Follow-up reminders ──────────────────────────────────
  if (!typesFilter.length || typesFilter.includes('follow_up')) {
    try {
      const tod = todayIST()
      const in2 = (() => { const d = new Date(); d.setDate(d.getDate() + 2); return d.toLocaleDateString('en-CA', { timeZone: IST }) })()

      const { data: rxs } = await supabase
        .from('prescriptions')
        .select('id, patient_id, patient_name, mrn, mobile, follow_up_date, diagnosis, medications, reminder_sent_at')
        .gte('follow_up_date', tod)
        .lte('follow_up_date', in2)
        .order('follow_up_date', { ascending: true })

      for (const rx of rxs || []) {
        if (!rx.mobile || !rx.follow_up_date) continue
        if (alreadySent(sentSet, 'prescriptions', rx.id)) continue

        const daysAway = daysUntil(rx.follow_up_date)
        const priority = daysAway === 0 ? 'today' : 'tomorrow'

        // Extract medication names for the reminder message
        let medNames = ''
        if (Array.isArray(rx.medications) && rx.medications.length > 0) {
          medNames = rx.medications
            .map((m: any) => `- ${m.drug || m.name || ''}${m.dose ? ' (' + m.dose + ')' : ''}`)
            .filter((s: string) => s.length > 2)
            .slice(0, 5)
            .join('\n')
        }

        autoReminders.push({
          patientId:   rx.patient_id ?? '',
          patientName: rx.patient_name ?? '',
          mobile:      rx.mobile,
          type:        'follow_up',
          sourceTable: 'prescriptions',
          sourceId:    rx.id,
          priority,
          message:     buildMessage('follow_up', rx.patient_name ?? '', {
            followUpDate: rx.follow_up_date,
            diagnosis:    rx.diagnosis ?? '',
            medications:  medNames,
          }),
        })
      }
    } catch (e) { console.error('[auto-gen] follow_up error:', e) }
  }

  // ── 3. ANC check-up reminders ───────────────────────────────
  if (!typesFilter.length || typesFilter.includes('anc')) {
    try {
      const ancFrom = isoDateMonthsAgo(ANC_LOOKBACK_MONTHS)

      const { data: encs } = await supabase
        .from('encounters')
        .select('id, patient_id, encounter_date, ob_data, patients(full_name, mrn, mobile)')
        .not('ob_data', 'is', null)
        .gte('encounter_date', ancFrom)
        .order('encounter_date', { ascending: false })
        .limit(ANC_MAX_ROWS)

      // Latest encounter per patient only
      const latestByPatient = new Map<string, any>()
      for (const enc of encs || []) {
        if (!latestByPatient.has(enc.patient_id)) {
          latestByPatient.set(enc.patient_id, enc)
        }
      }

      for (const enc of Array.from(latestByPatient.values())) {
        const ob  = enc.ob_data
        const pat = enc.patients as any
        if (!ob?.lmp || !pat?.mobile) continue
        if (alreadySent(sentSet, 'encounters', enc.id)) continue

        const lmpDate  = parseISTDate(ob.lmp)
        const nowMs    = Date.now()
        const weeksNow = (nowMs - lmpDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
        if (weeksNow > 42) continue

        for (const targetWeek of ANC_SCHEDULE_WEEKS) {
          const targetMs  = lmpDate.getTime() + targetWeek * 7 * 24 * 60 * 60 * 1000
          const targetStr = new Date(targetMs).toLocaleDateString('en-CA', { timeZone: IST })
          const daysAway  = daysUntil(targetStr)

          if (daysAway >= -3 && daysAway <= 3) {
            const priority = daysAway <= 0 ? 'urgent' : 'tomorrow'
            autoReminders.push({
              patientId:   enc.patient_id,
              patientName: pat.full_name ?? '',
              mobile:      pat.mobile,
              type:        'anc',
              sourceTable: 'encounters',
              sourceId:    enc.id,
              priority,
              message:     buildMessage('anc', pat.full_name ?? '', {
                weeksGA: `${Math.floor(weeksNow)} weeks`,
              }),
            })
            break
          }
        }
      }
    } catch (e) { console.error('[auto-gen] anc error:', e) }
  }

  // ── 4. Post-delivery follow-up ──────────────────────────────
  if (!typesFilter.length || typesFilter.includes('post_delivery')) {
    try {
      const { data: dsList } = await supabase
        .from('discharge_summaries')
        .select('id, patient_id, delivery_date, reminder_sent_at, patients(full_name, mrn, mobile)')
        .not('delivery_date', 'is', null)
        .order('delivery_date', { ascending: false })
        .limit(50)

      for (const ds of dsList || []) {
        const pat = ds.patients as any
        if (!ds.delivery_date || !pat?.mobile) continue
        if (alreadySent(sentSet, 'discharge_summaries', ds.id)) continue

        const followUpMs  = new Date(ds.delivery_date).getTime() + 42 * 24 * 60 * 60 * 1000
        const followUpStr = new Date(followUpMs).toLocaleDateString('en-CA', { timeZone: IST })
        const daysAway    = daysUntil(followUpStr)

        if (daysAway >= -7 && daysAway <= 3) {
          autoReminders.push({
            patientId:   ds.patient_id,
            patientName: pat.full_name ?? '',
            mobile:      pat.mobile,
            type:        'post_delivery',
            sourceTable: 'discharge_summaries',
            sourceId:    ds.id,
            priority:    daysAway <= 0 ? 'urgent' : 'tomorrow',
            message:     buildMessage('post_delivery', pat.full_name ?? '', { followUpDate: followUpStr }),
          })
        }
      }
    } catch (e) { console.error('[auto-gen] post_delivery error:', e) }
  }

  // ── 5. Vaccination reminders ────────────────────────────────
  if (!typesFilter.length || typesFilter.includes('vaccination')) {
    try {
      const { data: dsList } = await supabase
        .from('discharge_summaries')
        .select('id, patient_id, delivery_date, baby_sex, patients(full_name, mrn, mobile)')
        .not('delivery_date', 'is', null)
        .order('delivery_date', { ascending: false })
        .limit(50)

      for (const ds of dsList || []) {
        const pat = ds.patients as any
        if (!ds.delivery_date || !pat?.mobile) continue

        const delivMs = new Date(ds.delivery_date).getTime()
        for (const vax of VAX_SCHEDULE) {
          const vaxDueMs  = delivMs + vax.days * 24 * 60 * 60 * 1000
          const vaxDueStr = new Date(vaxDueMs).toLocaleDateString('en-CA', { timeZone: IST })
          const daysAway  = daysUntil(vaxDueStr)

          if (daysAway >= -5 && daysAway <= 3) {
            // Use vax-specific key to avoid collision if same discharge has multiple vaccines
            const vaxSourceId = `${ds.id}-vax${vax.days}`
            if (alreadySent(sentSet, 'discharge_summaries', vaxSourceId)) continue

            autoReminders.push({
              patientId:   ds.patient_id,
              patientName: pat.full_name ?? '',
              mobile:      pat.mobile,
              type:        'vaccination',
              sourceTable: 'discharge_summaries',
              sourceId:    vaxSourceId,
              priority:    daysAway <= 0 ? 'urgent' : 'tomorrow',
              message:     buildMessage('vaccination', pat.full_name ?? '', {
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

  // ── 6. Pending bills ────────────────────────────────────────
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

      // Batch-fetch mobiles (avoids N+1 — same fix applied here as in route.ts)
      const patIds    = Array.from(new Set((pendingBills || []).map(b => b.patient_id).filter(Boolean)))
      const mobileMap = new Map<string, string>()
      if (patIds.length > 0) {
        const { data: pats } = await supabase
          .from('patients')
          .select('id, mobile')
          .in('id', patIds)
        for (const p of pats || []) {
          if (p.mobile) mobileMap.set(p.id, p.mobile)
        }
      }

      for (const bill of pendingBills || []) {
        const mobile = mobileMap.get(bill.patient_id)
        if (!mobile) continue
        if (alreadySent(sentSet, 'bills', bill.id)) continue

        autoReminders.push({
          patientId:   bill.patient_id,
          patientName: bill.patient_name ?? '',
          mobile,
          type:        'pending_bill',
          sourceTable: 'bills',
          sourceId:    bill.id,
          priority:    daysSince(bill.created_at) > 7 ? 'urgent' : 'upcoming',
          message:     buildMessage('pending_bill', bill.patient_name ?? '', {
            amount: Number(bill.net_amount).toLocaleString('en-IN'),
          }),
        })
      }
    } catch (e) { console.error('[auto-gen] pending_bill error:', e) }
  }

  // ── Persist and return ──────────────────────────────────────
  if (!dryRun && autoReminders.length > 0) {
    const batchId = crypto.randomUUID()
    const now     = new Date().toISOString()

    // Batch insert all reminder_log entries at once (single round-trip)
    const logRows = autoReminders.map(r => ({
      patient_id:      r.patientId,
      patient_name:    r.patientName,
      mobile:          r.mobile,
      reminder_type:   r.type,
      source_table:    r.sourceTable,
      source_id:       r.sourceId,
      message_preview: r.message.slice(0, 200),
      channel:         'whatsapp',
      status:          'sent',
      sent_at:         now,
      sent_by:         'auto',
      batch_id:        batchId,
    }))

    const { error: logErr } = await supabase.from('reminder_log').insert(logRows)
    if (logErr) {
      console.error('[auto-gen] reminder_log insert error:', logErr)
    }

    // Update reminder_sent_at on trackable source records
    const trackable = ['appointments', 'prescriptions', 'discharge_summaries']
    const updatesByTable = new Map<string, string[]>()
    for (const r of autoReminders) {
      if (!trackable.includes(r.sourceTable)) continue
      if (!updatesByTable.has(r.sourceTable)) updatesByTable.set(r.sourceTable, [])
      // Only use real UUIDs (skip vax composite keys like "uuid-vax42")
      if (!r.sourceId.includes('-vax')) {
        updatesByTable.get(r.sourceTable)!.push(r.sourceId)
      }
    }

    for (const [table, ids] of Array.from(updatesByTable.entries())) {
      if (ids.length === 0) continue
      await supabase.from(table).update({ reminder_sent_at: now }).in('id', ids)
      if (table === 'appointments') {
        await supabase.from('appointments').update({ reminder_sent: true }).in('id', ids)
      }
    }

    return NextResponse.json({
      ok:          true,
      mode:        'auto',
      batchId,
      total:       autoReminders.length,
      reminders:   autoReminders,
      generatedAt: now,
    })
  }

  return NextResponse.json({
    ok:          true,
    mode:        dryRun ? 'dryRun' : 'auto',
    total:       autoReminders.length,
    reminders:   autoReminders,
    generatedAt: new Date().toISOString(),
  })
}