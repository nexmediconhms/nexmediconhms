/**
 * src/app/api/reminders/history/route.ts  — UPDATED
 *
 * CHANGE: Added requireAuth() guard. All original query params (limit, days,
 * type filter), batch grouping, graceful missing-table handling preserved.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/api-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

export async function GET(req: NextRequest) {
  // ── Auth gate ────────────────────────────────────────────────
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth
  // ────────────────────────────────────────────────────────────

  const { searchParams } = new URL(req.url)
  const limit      = parseInt(searchParams.get('limit') || '50', 10)
  const days       = parseInt(searchParams.get('days')  || '1',  10)
  const typeFilter = searchParams.get('type')

  // Calculate start date
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)
  const startISO = startDate.toISOString()

  try {
    let query = supabase
      .from('reminder_log')
      .select('*')
      .gte('sent_at', startISO)
      .order('sent_at', { ascending: false })
      .limit(limit)

    if (typeFilter) {
      query = query.eq('reminder_type', typeFilter)
    }

    const { data, error } = await query

    if (error) {
      console.error('[reminder-history] DB error:', error)
      // If table doesn't exist yet, return empty gracefully
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return NextResponse.json({ logs: [], total: 0 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Group by batch for summary
    const batches = new Map<string, { count: number; sentBy: string; sentAt: string }>()
    for (const log of data || []) {
      if (log.batch_id) {
        const existing = batches.get(log.batch_id)
        if (existing) {
          existing.count++
        } else {
          batches.set(log.batch_id, { count: 1, sentBy: log.sent_by || 'manual', sentAt: log.sent_at })
        }
      }
    }

    return NextResponse.json({
      logs:    data || [],
      total:   data?.length || 0,
      batches: Object.fromEntries(batches),
    })
  } catch (err: any) {
    console.error('[reminder-history] Error:', err)
    return NextResponse.json({ logs: [], total: 0 })
  }
}