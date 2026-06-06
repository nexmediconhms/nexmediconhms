/**
 * src/app/api/opd/queue-token/route.ts
 *
 * Atomic OPD Queue Token Allocation API
 *
 * POST /api/opd/queue-token
 *
 * ═══════════════════════════════════════════════════════════════════════
 * FIX: OPD Queue — Token Race Condition
 *
 * PROBLEM:
 *   The client-side insertQueueEntryWithRetry() retries on 23505
 *   (unique violation), but:
 *     1. There's still a window where two concurrent requests can
 *        read the same MAX(token_number) before either inserts.
 *     2. If MAX_TOKEN_RETRIES is exhausted, the patient disappears
 *        from the queue silently.
 *     3. The retry loop runs on the browser — network interruptions
 *        can leave partial state.
 *
 * SOLUTION:
 *   This server-side endpoint uses the Postgres function
 *   allocate_queue_token() which:
 *     1. Acquires an advisory lock on the queue date
 *     2. Reads MAX(token_number) inside the lock
 *     3. Inserts with the next token number
 *     4. Returns the queue entry ID and token number
 *     5. Also checks for duplicate patient entries (same patient,
 *        same date, non-cancelled) and returns existing if found.
 *
 * FALLBACK:
 *   If the RPC doesn't exist, falls back to client-side retry
 *   with proper error reporting.
 *
 * Auth: Any authenticated active clinic user.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Valid queue statuses (single source of truth)
const VALID_STATUSES = ['waiting', 'vitals_done', 'in_progress', 'done', 'cancelled'] as const

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    patient_id,
    queue_date,
    status = 'waiting',
    priority = 'normal',
    notes,
    patient_name,
    mrn,
    encounter_id,
  } = body ?? {}

  // ── Validation ─────────────────────────────────────────────────

  if (!patient_id || typeof patient_id !== 'string') {
    return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })
  }

  if (!queue_date || typeof queue_date !== 'string') {
    return NextResponse.json({ error: 'queue_date is required (YYYY-MM-DD)' }, { status: 400 })
  }

  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRegex.test(queue_date)) {
    return NextResponse.json({ error: 'queue_date must be YYYY-MM-DD format' }, { status: 400 })
  }

  // ── FIX: Normalize status to prevent 'completed' vs 'done' mismatch ──
  let normalizedStatus = (status || 'waiting').trim().toLowerCase()
  if (normalizedStatus === 'completed' || normalizedStatus === 'complete' || normalizedStatus === 'finished') {
    normalizedStatus = 'done' // Canonical value
  }
  if (!(VALID_STATUSES as readonly string[]).includes(normalizedStatus)) {
    return NextResponse.json({
      error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
    }, { status: 400 })
  }

  // ── Get admin client ───────────────────────────────────────────
  let sb: ReturnType<typeof getSupabaseAdmin>
  try {
    sb = getSupabaseAdmin()
  } catch (err) {
    console.error('[queue-token] Admin client error:', err)
    return NextResponse.json(
      { error: 'Server misconfigured. Contact administrator.' },
      { status: 500 },
    )
  }

  // ── Try atomic allocation (DB function) ────────────────────────
  try {
    const { data: result, error: rpcErr } = await sb.rpc('allocate_queue_token', {
      p_patientid: patient_id,
      p_queuedate: queue_date,
      p_status: normalizedStatus,
      p_priority: priority || 'normal',
      p_notes: notes || null,
      p_patientname: patient_name || null,
      p_mrn: mrn || null,
      p_encounterid: encounter_id || null,
    })

    if (rpcErr) {
      const msg = rpcErr.message?.toLowerCase() || ''
      const code = (rpcErr as any).code || ''
      if (code === '42883' || msg.includes('does not exist') || msg.includes('function')) {
        // Fall through to legacy path
        console.warn('[queue-token] allocate_queue_token not found, using legacy insert')
      } else {
        throw rpcErr
      }
    } else if (result && result.length > 0) {
      const row = result[0]
      return NextResponse.json({
        ok: true,
        queue_id: row.queue_id,
        token_number: row.token_number,
        already_exists: row.already_exists,
        message: row.already_exists
          ? 'Patient already in queue for this date.'
          : `Token #${row.token_number} assigned successfully.`,
      }, { status: row.already_exists ? 200 : 201 })
    }
  } catch (rpcEx: any) {
    console.warn('[queue-token] Atomic allocation failed, trying legacy:', rpcEx?.message)
  }

  // ── Legacy fallback: retry loop with unique constraint ─────────
  const MAX_RETRIES = 7

  // Check for existing entry first
  const { data: existing } = await sb
    .from('opdqueue')
    .select('id, queuenumber')
    .eq('patientid', patient_id)
    .eq('date', queue_date)
    .not('status', 'eq', 'cancelled')
    .maybeSingle()

  // Also try snake_case table name
  if (!existing) {
    try {
      const { data: existing2 } = await sb
        .from('opd_queue')
        .select('id, token_number')
        .eq('patient_id', patient_id)
        .eq('queue_date', queue_date)
        .not('status', 'eq', 'cancelled')
        .maybeSingle()

      if (existing2) {
        return NextResponse.json({
          ok: true,
          queue_id: existing2.id,
          token_number: existing2.token_number,
          already_exists: true,
          message: 'Patient already in queue for this date.',
        })
      }
    } catch { /* table may not exist */ }
  } else {
    return NextResponse.json({
      ok: true,
      queue_id: existing.id,
      token_number: existing.queuenumber,
      already_exists: true,
      message: 'Patient already in queue for this date.',
    })
  }

  // Retry loop
  let lastErr: any = null
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Try the primary table name first (opdqueue), then fallback
    for (const tableConfig of [
      { table: 'opdqueue', cols: { patientid: patient_id, date: queue_date, queuenumber: 0, patientname: patient_name, mrn } },
      { table: 'opd_queue', cols: { patient_id, queue_date, token_number: 0, patient_name, mrn } },
    ]) {
      try {
        const tokenCol = tableConfig.table === 'opdqueue' ? 'queuenumber' : 'token_number'
        const dateCol = tableConfig.table === 'opdqueue' ? 'date' : 'queue_date'

        // Read latest token
        const { data: maxRow } = await sb
          .from(tableConfig.table)
          .select(tokenCol)
          .eq(dateCol, queue_date)
          .order(tokenCol, { ascending: false })
          .limit(1)
          .maybeSingle()

        const nextToken = ((maxRow as any)?.[tokenCol] || 0) + 1

        const insertPayload = { ...tableConfig.cols, status: normalizedStatus, notes: notes || null }
        ;(insertPayload as any)[tokenCol] = nextToken

        const { data: inserted, error: insErr } = await sb
          .from(tableConfig.table)
          .insert(insertPayload)
          .select('id, ' + tokenCol)
          .single()

        if (!insErr && inserted) {
          return NextResponse.json({
            ok: true,
            queue_id: inserted.id,
            token_number: (inserted as any)[tokenCol],
            already_exists: false,
            message: `Token #${(inserted as any)[tokenCol]} assigned successfully.`,
          }, { status: 201 })
        }

        if (insErr) {
          lastErr = insErr
          const code = String((insErr as any)?.code || '')
          const msg = String(insErr.message || '').toLowerCase()
          if (code === '23505' || msg.includes('duplicate') || msg.includes('unique')) {
            // Retry with jitter
            await new Promise(r => setTimeout(r, 15 + Math.floor(Math.random() * 50)))
            break // break inner loop, retry outer
          }
          // Non-retryable but maybe wrong table; try next table config
          if (msg.includes('relation') || msg.includes('does not exist')) {
            continue
          }
        }
      } catch (e: any) {
        lastErr = e
        continue // try next table config
      }
    }
  }

  // All retries exhausted
  console.error('[queue-token] Token allocation failed after retries:', lastErr?.message)
  return NextResponse.json({
    error: 'Failed to allocate queue token after multiple attempts. Please try again or add the patient manually.',
    details: lastErr?.message,
  }, { status: 500 })
}
