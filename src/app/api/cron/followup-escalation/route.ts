/**
 * src/app/api/cron/followup-escalation/route.ts
 *
 * Smart Auto-Follow-up Detection & Escalation
 *
 * Called by cron (Vercel / Supabase) at 8:00 AM IST daily.
 * Detects patients who:
 *   1. Had a prescription with a follow_up_date that is NOW OVERDUE
 *   2. Have NOT visited (no encounter) since their follow-up date
 *   3. Have NOT already been reminded today
 *
 * Actions taken:
 *   - Flags overdue follow-ups in the `follow_ups` table (status → 'missed')
 *   - Generates WhatsApp reminder entries in `reminder_log`
 *   - Returns list of patients for staff to action
 *
 * Auth: Validates CRON_SECRET (same as auto-generate)
 *
 * GET  /api/cron/followup-escalation?dryRun=true  → preview without saving
 * POST /api/cron/followup-escalation              → execute escalation
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

const IST = 'Asia/Kolkata'

function todayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: IST })
}

function daysBetween(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00+05:30')
  const b = new Date(to + 'T00:00:00+05:30')
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24))
}

// Auth validation (same pattern as auto-generate)
function validateCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true // Allow in dev without secret

  const authHeader = req.headers.get('authorization') ?? ''
  const querySecret = new URL(req.url).searchParams.get('secret') ?? ''
  const headerToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : authHeader.trim()

  return headerToken === cronSecret || querySecret === cronSecret
}

interface OverdueFollowUp {
  patientId: string
  patientName: string
  mobile: string
  mrn: string
  followUpDate: string
  daysOverdue: number
  diagnosis: string
  prescriptionId: string
  lastVisitDate: string | null
  escalationLevel: 'mild' | 'moderate' | 'urgent' // 1-3 days, 4-7 days, 7+ days
}

export async function POST(req: NextRequest) {
  if (!validateCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const dryRun = searchParams.get('dryRun') === 'true'

  const today = todayIST()
  const overdueList: OverdueFollowUp[] = []

  // ── Step 1: Find prescriptions with overdue follow_up_date ────
  // Overdue = follow_up_date < today AND status not completed
  try {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 30) // Look back 30 days max
    const lookbackDate = sevenDaysAgo.toLocaleDateString('en-CA', { timeZone: IST })

    const { data: prescriptions } = await supabase
      .from('prescriptions')
      .select('id, patient_id, patient_name, mrn, mobile, follow_up_date, diagnosis')
      .lt('follow_up_date', today) // follow_up_date is in the past = OVERDUE
      .gte('follow_up_date', lookbackDate) // Don't look back more than 30 days
      .not('follow_up_date', 'is', null)
      .order('follow_up_date', { ascending: true })
      .limit(200)

    if (!prescriptions || prescriptions.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No overdue follow-ups found',
        overdueCount: 0,
        escalated: [],
      })
    }

    // ── Step 2: For each overdue prescription, check if patient visited AFTER the follow-up date ──
    const patientIds = [new Set(prescriptions.map((p: any) => p.patient_id).filter(Boolean))]

    // Batch-fetch latest encounter date per patient
    const latestVisitMap = new Map<string, string>()
    if (patientIds.length > 0) {
      const { data: encounters } = await supabase
        .from('encounters')
        .select('patient_id, encounter_date')
        .in('patient_id', patientIds)
        .order('encounter_date', { ascending: false })

      // Keep only the most recent encounter per patient
      for (const enc of encounters || []) {
        if (!latestVisitMap.has(enc.patient_id)) {
          latestVisitMap.set(enc.patient_id, enc.encounter_date)
        }
      }
    }

    // Batch-fetch mobiles for patients without mobile in prescription
    const mobileMissing = prescriptions.filter((p: any) => !p.mobile).map((p: any) => p.patient_id)
    const mobileMap = new Map<string, string>()
    if (mobileMissing.length > 0) {
      const { data: pats } = await supabase
        .from('patients')
        .select('id, mobile')
        .in('id', mobileMissing)
      for (const p of pats || []) {
        if (p.mobile) mobileMap.set(p.id, p.mobile)
      }
    }

    // Check already-sent today
    const startOfDay = today + 'T00:00:00+05:30'
    const { data: sentToday } = await supabase
      .from('reminder_log')
      .select('source_id')
      .eq('reminder_type', 'follow_up_overdue')
      .gte('sent_at', startOfDay)

    const sentTodaySet = new Set((sentToday || []).map((s: any) => s.source_id))

    // ── Step 3: Build overdue list ──────────────────────────────
    for (const rx of prescriptions) {
      if (!rx.patient_id || !rx.follow_up_date) continue
      if (sentTodaySet.has(rx.id)) continue // Already reminded today

      const lastVisit = latestVisitMap.get(rx.patient_id)

      // If patient visited AFTER the follow-up date, skip (they came!)
      if (lastVisit && lastVisit >= rx.follow_up_date) continue

      const daysOverdue = daysBetween(rx.follow_up_date, today)
      if (daysOverdue <= 0) continue

      const mobile = rx.mobile || mobileMap.get(rx.patient_id) || ''
      if (!mobile) continue // Can't send reminder without mobile

      const escalationLevel: OverdueFollowUp['escalationLevel'] =
        daysOverdue > 7 ? 'urgent' : daysOverdue > 3 ? 'moderate' : 'mild'

      overdueList.push({
        patientId: rx.patient_id,
        patientName: rx.patient_name || '',
        mobile,
        mrn: rx.mrn || '',
        followUpDate: rx.follow_up_date,
        daysOverdue,
        diagnosis: rx.diagnosis || '',
        prescriptionId: rx.id,
        lastVisitDate: lastVisit || null,
        escalationLevel,
      })
    }
  } catch (e: any) {
    console.error('[followup-escalation] Error:', e)
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 })
  }

  // ── Step 4: If dry run, return preview ──────────────────────
  if (dryRun) {
    return NextResponse.json({
      ok: true,
      mode: 'dryRun',
      overdueCount: overdueList.length,
      escalated: overdueList,
      breakdown: {
        mild: overdueList.filter(o => o.escalationLevel === 'mild').length,
        moderate: overdueList.filter(o => o.escalationLevel === 'moderate').length,
        urgent: overdueList.filter(o => o.escalationLevel === 'urgent').length,
      },
    })
  }

  // ── Step 5: Log reminders + update follow_ups status ────────
  if (overdueList.length > 0) {
    const batchId = crypto.randomUUID()
    const now = new Date().toISOString()

    // Insert reminder_log entries
    const logRows = overdueList.map(o => ({
      patient_id: o.patientId,
      patient_name: o.patientName,
      mobile: o.mobile,
      reminder_type: 'follow_up_overdue',
      source_table: 'prescriptions',
      source_id: o.prescriptionId,
      message_preview: `Follow-up overdue by ${o.daysOverdue} days. ${o.diagnosis ? 'For: ' + o.diagnosis : ''}`,
      channel: 'whatsapp',
      status: 'pending', // Staff will send via WhatsApp
      sent_at: now,
      sent_by: 'cron',
      batch_id: batchId,
    }))

    const { error: logErr } = await supabase.from('reminder_log').insert(logRows)
    if (logErr) {
      console.error('[followup-escalation] Log insert error:', logErr)
    }

    // Update follow_ups table: mark overdue ones as 'missed'
    const overduePatientIds = overdueList.map(o => o.patientId)
    await supabase
      .from('follow_ups')
      .update({ status: 'missed', updated_at: now })
      .in('patient_id', overduePatientIds)
      .eq('status', 'pending')
      .lt('recommended_date', today)
  }

  return NextResponse.json({
    ok: true,
    mode: 'live',
    overdueCount: overdueList.length,
    escalated: overdueList,
    breakdown: {
      mild: overdueList.filter(o => o.escalationLevel === 'mild').length,
      moderate: overdueList.filter(o => o.escalationLevel === 'moderate').length,
      urgent: overdueList.filter(o => o.escalationLevel === 'urgent').length,
    },
    message: overdueList.length > 0
      ? `${overdueList.length} overdue follow-ups detected and flagged for WhatsApp reminder.`
      : 'No overdue follow-ups found.',
  })
}

// GET handler — same as POST but defaults to dryRun for safety
export async function GET(req: NextRequest) {
  if (!validateCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Force dry run for GET requests (safe to preview)
  const url = new URL(req.url)
  url.searchParams.set('dryRun', 'true')
  const modifiedReq = new NextRequest(url, { headers: req.headers })
  return POST(modifiedReq)
}