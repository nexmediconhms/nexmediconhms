/**
 * src/app/api/queue/add/route.ts
 *
 * Race-free OPD-queue add endpoint.
 *
 * 2026-06-04 audit fix (§3.1): the previous code did `SELECT max(token_number)
 * + 1` then `INSERT` on the BROWSER, in three different places. Two reception
 * desks (or registration + queue page) computing tokens concurrently both
 * read the same max and both inserted `max+1` — DUPLICATE TOKEN NUMBERS for
 * the same `queue_date`. The unique index `uniq_opd_queue_date_token`
 * (added in fresh-install/04) catches it as a 23505, but only after the
 * race already happened.
 *
 * This route uses `next_queue_token(queue_date)` (an SQL function with a
 * per-date advisory lock — see fresh-install/03 §1) so token allocation
 * is provably race-free. If the RPC isn't installed yet, we fall back to
 * SELECT-MAX + INSERT with retry-on-23505.
 *
 * Also (§3.3): `queue_date` is stamped SERVER-SIDE in IST so a
 * mis-configured client clock can't put a token in the wrong day's
 * sequence.
 *
 * ENDPOINT
 *   POST /api/queue/add
 *
 * REQUEST  (application/json)
 *   {
 *     patient_id:      string  (UUID, REQUIRED),
 *     patient_name?:   string,
 *     mrn?:            string,
 *     priority?:       'normal' | 'urgent' | 'emergency'   (default 'normal'),
 *     notes?:          string,
 *     encounter_id?:   string,
 *     // queue_date is OPTIONAL — server uses today's IST date if absent.
 *     queue_date?:     string  (YYYY-MM-DD)
 *   }
 *
 * RESPONSE  (200 OK)
 *   { success: true, entry: { id, token_number, queue_date, … } }
 *
 * ERRORS
 *   400 — missing/invalid fields
 *   409 — patient already has an active queue entry for this date
 *         (caught by unique idx_opd_queue_patient_day_active)
 *   503 — DB unavailable
 *   500 — unexpected
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_PRIORITIES = new Set(['normal', 'urgent', 'emergency'])

/** YYYY-MM-DD in Asia/Kolkata. */
function getIndiaTodayISO(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
  return ist.toISOString().split('T')[0]
}

/** Strict YYYY-MM-DD validator. */
function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + 'T00:00:00')
  return !isNaN(d.getTime())
}

export async function POST(req: NextRequest) {
  // 1) Auth (any active clinic user; they're already on the queue page)
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  // 2) Parse body
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const patientId    = String(body.patient_id    ?? '').trim()
  const patientName  = String(body.patient_name  ?? '').trim()
  const mrn          = String(body.mrn           ?? '').trim()
  const encounterId  = body.encounter_id ? String(body.encounter_id).trim() : null
  const priority     = String(body.priority      ?? 'normal').trim()
  const notes        = String(body.notes         ?? '').trim() || null

  if (!patientId) {
    return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })
  }
  if (!VALID_PRIORITIES.has(priority)) {
    return NextResponse.json({ error: `priority must be one of ${[...VALID_PRIORITIES].join(', ')}` }, { status: 400 })
  }

  // FIX (§3.3): server-stamped queue_date. Clients may pass it for
  // back-dated entries (rare admin use), but we validate strictly.
  let queueDate = body.queue_date && isValidDateString(String(body.queue_date))
    ? String(body.queue_date)
    : getIndiaTodayISO()

  const sb = getSupabaseAdmin()

  // 3) Allocate token via the race-free DB function. Fall back gracefully.
  let tokenNumber: number | null = null
  let usedFallback = false

  try {
    const { data: tok, error: tokErr } = await sb.rpc('next_queue_token', { p_queue_date: queueDate })
    if (!tokErr && tok !== null && tok !== undefined) {
      tokenNumber = Number(tok)
    }
  } catch (e: any) {
    console.warn('[queue/add] next_queue_token RPC unavailable, falling back to retry-on-conflict:', e?.message)
  }

  // Fallback: SELECT MAX + INSERT with retry on 23505 unique violation
  // (the unique index uniq_opd_queue_date_token catches simultaneous
  // fallback attempts and we just retry).
  const MAX_RETRIES = 5
  let lastErr: any = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (tokenNumber === null) {
      const { data: maxRow } = await sb
        .from('opd_queue')
        .select('token_number')
        .eq('queue_date', queueDate)
        .order('token_number', { ascending: false })
        .limit(1)
        .maybeSingle()
      tokenNumber = ((maxRow?.token_number as number) || 0) + 1 + attempt
      usedFallback = true
    }

    const { data: entry, error: insErr } = await sb
      .from('opd_queue')
      .insert({
        patient_id:   patientId,
        patient_name: patientName || null,
        mrn:          mrn || null,
        encounter_id: encounterId,
        queue_date:   queueDate,
        token_number: tokenNumber,
        status:       'waiting',
        priority,
        notes,
      })
      .select('id, token_number, queue_date, status, priority')
      .single()

    if (!insErr && entry) {
      // Audit (non-fatal)
      try {
        await sb.rpc('insert_audit_entry', {
          p_user_id:      auth.clinicUserId,
          p_user_email:   auth.email,
          p_user_role:    auth.role,
          p_action:       'create',
          p_entity_type:  'encounter',
          p_entity_id:    entry.id,
          p_entity_label: `Queue token #${entry.token_number} — ${patientName || mrn || patientId}`,
          p_changes:      JSON.stringify({ after: { ...entry, fallback: usedFallback } }),
        })
      } catch { /* non-fatal */ }

      return NextResponse.json({ success: true, entry })
    }

    lastErr = insErr

    // 23505: either the (queue_date, token_number) collided with a
    // concurrent fallback, OR (patient_id, queue_date) collided
    // because the patient already has an active queue entry today.
    if (insErr?.code === '23505') {
      const msg = (insErr.message || '').toLowerCase()
      if (msg.includes('patient_day_active') || msg.includes('patient_id, queue_date')) {
        return NextResponse.json(
          { error: 'This patient already has an active queue entry for today.' },
          { status: 409 },
        )
      }
      // Token-number collision — retry with a freshly-read max
      tokenNumber = null
      const jitterMs = 10 + Math.floor(Math.random() * 30)
      await new Promise(resolve => setTimeout(resolve, jitterMs))
      continue
    }

    // Any other error — bail
    console.error('[queue/add] insert error:', insErr?.message)
    return NextResponse.json({ error: insErr?.message || 'Insert failed' }, { status: 500 })
  }

  return NextResponse.json(
    { error: `Token allocation failed after ${MAX_RETRIES} retries. ${lastErr?.message || ''}` },
    { status: 500 },
  )
}
