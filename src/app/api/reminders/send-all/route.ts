/**
 * src/app/api/reminders/send-all/route.ts  — UPDATED
 *
 * CHANGE: Added requireAuth() guard. The full original body shape, batch ID
 * generation, per-reminder source-table update, reminder_log insert, and
 * success/failure count response are preserved exactly.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/api-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

export async function POST(req: NextRequest) {
  // ── Auth gate ────────────────────────────────────────────────
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth
  // ────────────────────────────────────────────────────────────

  try {
    const body = await req.json().catch(() => ({}))
    const { reminders = [], sentBy = 'bulk' } = body as {
      reminders?: {
        id: string
        type: string
        patientId: string
        patientName: string
        mobile: string
        sourceId: string
        sourceTable: string
        messagePreview?: string
      }[]
      sentBy?: string
    }

    if (!reminders.length) {
      return NextResponse.json({ error: 'No reminders provided' }, { status: 400 })
    }

    const batchId = crypto.randomUUID()
    const now     = new Date().toISOString()
    const results: { id: string; success: boolean; error?: string }[] = []

    for (const r of reminders) {
      try {
        // 1. Update source table's reminder_sent_at (if applicable)
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

        // 2. Log in reminder_log
        await supabase.from('reminder_log').insert({
          patient_id:      r.patientId,
          patient_name:    r.patientName,
          mobile:          r.mobile,
          reminder_type:   r.type,
          source_table:    r.sourceTable,
          source_id:       r.sourceId,
          message_preview: (r.messagePreview || '').slice(0, 200),
          channel:         'whatsapp',
          status:          'sent',
          sent_at:         now,
          sent_by:         sentBy,
          batch_id:        batchId,
        })

        results.push({ id: r.id, success: true })
      } catch (err: any) {
        results.push({ id: r.id, success: false, error: err?.message || 'Unknown error' })
      }
    }

    const successCount = results.filter(r => r.success).length
    const failCount    = results.filter(r => !r.success).length

    return NextResponse.json({
      ok: true,
      batchId,
      total:  reminders.length,
      sent:   successCount,
      failed: failCount,
      results,
    })
  } catch (err: any) {
    console.error('[send-all] Error:', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}