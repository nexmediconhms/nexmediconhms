import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getIndiaToday } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Stale Detection Cron Job
 *
 * Detects stale queue entries, unbilled visits, and pending bills.
 * Inserts notifications into clinic_notifications for staff awareness.
 *
 * Triggered by external cron (e.g., Vercel cron) via GET /api/cron/stale-detection
 * Protected by CRON_SECRET header validation.
 */
export async function GET(request: Request) {
  // Validate CRON_SECRET
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()
  const today = getIndiaToday()
  const now = new Date()

  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
  const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString()
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()

  const notifications: Array<{
    title: string
    message: string
    type: string
    severity: string
    source: string
    metadata: Record<string, unknown>
  }> = []

  let staleWaiting = 0
  let staleInProgress = 0
  let unbilledVisits = 0
  let stalePendingBills = 0

  try {
    // (a) Queue entries status='waiting' where created_at < 2 hours ago today
    const { data: waitingStale, error: waitErr } = await supabase
      .from('opd_queue')
      .select('id, patient_name, token_number, mrn')
      .eq('status', 'waiting')
      .eq('queue_date', today)
      .lt('created_at', twoHoursAgo)

    if (!waitErr && waitingStale && waitingStale.length > 0) {
      staleWaiting = waitingStale.length
      notifications.push({
        title: 'Patients waiting too long',
        message: `${staleWaiting} patient(s) have been waiting for more than 2 hours: ${waitingStale.slice(0, 3).map(p => p.patient_name || `Token #${p.token_number}`).join(', ')}${staleWaiting > 3 ? ` and ${staleWaiting - 3} more` : ''}`,
        type: 'system',
        severity: 'warning',
        source: 'stale_detection',
        metadata: {
          detection_type: 'stale_waiting',
          count: staleWaiting,
          patient_ids: waitingStale.map(p => p.id),
          detected_at: now.toISOString(),
        },
      })
    }

    // (b) Queue entries status='in_progress' where called_at < 1 hour ago today
    const { data: inProgressStale, error: ipErr } = await supabase
      .from('opd_queue')
      .select('id, patient_name, token_number, mrn')
      .eq('status', 'in_progress')
      .eq('queue_date', today)
      .lt('called_at', oneHourAgo)

    if (!ipErr && inProgressStale && inProgressStale.length > 0) {
      staleInProgress = inProgressStale.length
      notifications.push({
        title: 'Consultations running long',
        message: `${staleInProgress} patient(s) have been in-progress for more than 1 hour: ${inProgressStale.slice(0, 3).map(p => p.patient_name || `Token #${p.token_number}`).join(', ')}${staleInProgress > 3 ? ` and ${staleInProgress - 3} more` : ''}`,
        type: 'system',
        severity: 'info',
        source: 'stale_detection',
        metadata: {
          detection_type: 'stale_in_progress',
          count: staleInProgress,
          patient_ids: inProgressStale.map(p => p.id),
          detected_at: now.toISOString(),
        },
      })
    }

    // (c) Encounters created today with no matching bill
    const { data: todayEncounters, error: encErr } = await supabase
      .from('encounters')
      .select('id, patient_id')
      .eq('encounter_date', today)

    if (!encErr && todayEncounters && todayEncounters.length > 0) {
      const { data: todayBills, error: billErr } = await supabase
        .from('bills')
        .select('patientid')
        .gte('createdat', `${today}T00:00:00`)
        .lte('createdat', `${today}T23:59:59`)

      if (!billErr) {
        const billedPatients = new Set((todayBills || []).map(b => b.patientid))
        const unbilledEncounters = todayEncounters.filter(e => !billedPatients.has(e.patient_id))
        unbilledVisits = unbilledEncounters.length

        if (unbilledVisits > 0) {
          notifications.push({
            title: 'Unbilled consultations today',
            message: `${unbilledVisits} patient(s) were seen today but have no bill generated. Potential revenue leakage.`,
            type: 'system',
            severity: 'warning',
            source: 'stale_detection',
            metadata: {
              detection_type: 'unbilled_visits',
              count: unbilledVisits,
              encounter_ids: unbilledEncounters.slice(0, 10).map(e => e.id),
              detected_at: now.toISOString(),
            },
          })
        }
      }
    }

    // (d) Bills with status='pending' older than 3 days
    const { data: staleBills, error: sbErr } = await supabase
      .from('bills')
      .select('id, patientid, net_amount')
      .eq('status', 'pending')
      .lt('createdat', threeDaysAgo)

    if (!sbErr && staleBills && staleBills.length > 0) {
      stalePendingBills = staleBills.length
      const totalAmount = staleBills.reduce((sum, b) => sum + (Number(b.net_amount) || 0), 0)
      notifications.push({
        title: 'Stale pending bills',
        message: `${stalePendingBills} bill(s) have been pending for more than 3 days (total: ₹${totalAmount.toLocaleString('en-IN')}). Please follow up for payment collection.`,
        type: 'system',
        severity: 'high',
        source: 'stale_detection',
        metadata: {
          detection_type: 'stale_pending_bills',
          count: stalePendingBills,
          total_amount: totalAmount,
          bill_ids: staleBills.slice(0, 20).map(b => b.id),
          detected_at: now.toISOString(),
        },
      })
    }

    // Insert all notifications
    if (notifications.length > 0) {
      const { error: insertErr } = await supabase
        .from('clinic_notifications')
        .insert(notifications.map(n => ({
          ...n,
          metadata: JSON.stringify(n.metadata),
          created_at: now.toISOString(),
          is_read: false,
        })))

      if (insertErr) {
        console.error('[stale-detection] Failed to insert notifications:', insertErr.message)
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: now.toISOString(),
      staleWaiting,
      staleInProgress,
      unbilledVisits,
      stalePendingBills,
      notificationsInserted: notifications.length,
    })
  } catch (err) {
    console.error('[stale-detection] Unexpected error:', err)
    return NextResponse.json(
      { error: 'Internal server error', details: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}