/**
 * src/app/api/discharge/finalize/route.ts
 *
 * Discharge Summary Finalization API
 *
 * POST /api/discharge/finalize
 *   Body: { dischargeId: uuid, version?: number }
 *   → Marks a discharge summary as final (locked).
 *   → Sets signed_by / signed_at from the AUTHENTICATED user
 *     (caller can NOT impersonate someone else by sending signedBy
 *     in the body — that field is now ignored).
 *
 * POST /api/discharge/finalize?action=unfinalize
 *   Body: { dischargeId: uuid, reason: string }
 *   → ADMIN ONLY: reverts finalization with reason audit trail.
 *
 * SECURITY/CORRECTNESS CHANGES (this revision):
 *   1. Finalize  : requireRole(['admin','doctor']) — staff cannot sign.
 *      Unfinalize: requireRole('admin')             — admin only.
 *      Previously the route used plain requireAuth, so any logged-in
 *      user (incl. inactive accounts that slipped through) could fire
 *      either endpoint.
 *   2. signed_by / unfinalized_by are derived from the auth context
 *      (auth.fullName || auth.email), NOT from the request body. The
 *      `signedBy`/`unfinalizedBy` body fields are now ignored to stop
 *      one user from signing as another.
 *   3. Optimistic concurrency: if the caller sends `version`, the API
 *      verifies it matches the current DB row and returns 409 if not
 *      — preventing two clinicians from finalising the same draft and
 *      one silently overwriting the other's edits.
 *   4. Idempotent finalize: if the row is already final, the API
 *      returns 200 with `alreadyFinal: true` instead of bumping the
 *      version again. Accidental double-clicks no longer churn the
 *      version counter / signed_at timestamps.
 *   5. Service-role Supabase client is used server-side only. The
 *      service-role key is never sent to the browser.
 *   6. Internal Supabase errors are logged with class+message only;
 *      the client receives generic 4xx/5xx responses.
 *   7. runtime='nodejs' (jose / pg client) and dynamic='force-dynamic'
 *      so this never gets statically pre-rendered or edge-cached.
 *
 * UI CONTRACT (paired patches in this same change):
 *   The DischargeFinalizeButton previously sent `dischargeSummaryId`
 *   instead of `dischargeId` (route silently 400'd) and called the
 *   non-existent `/api/discharge/unfinalize` URL (always 404'd). Both
 *   bugs are fixed in src/components/shared/DischargeFinalizeButton.tsx
 *   alongside this route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireRole }   from '@/lib/api-auth'
import { getSupabaseAdmin }           from '@/lib/supabase-admin'

export const runtime  = 'nodejs'
export const dynamic  = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// PHI-safe error logger.
function logErr(scope: string, err: unknown) {
  const klass = (err as any)?.constructor?.name || 'Error'
  const msg   = (err as any)?.message            || String(err)
  console.error(`[discharge.finalize] ${scope}: ${klass} ${msg}`)
}

// ─────────────────────────────────────────────────────────────────
// Common body parser — defensive against malformed JSON.
// ─────────────────────────────────────────────────────────────────
async function parseBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const j = await req.json()
    return (j && typeof j === 'object') ? (j as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export async function POST(req: NextRequest) {
  // We do per-action role checks below (admin for unfinalize, admin/doctor
  // for finalize), but we still gate the whole route at requireAuth first
  // so callers without ANY token get a clean 401 before we parse anything.
  const baseAuth = await requireAuth(req)
  if (baseAuth instanceof Response) return baseAuth

  const action = req.nextUrl.searchParams.get('action')
  const body   = await parseBody(req)

  // ════════════════════════════════════════════════════════════════
  // UNFINALIZE — admin only
  // ════════════════════════════════════════════════════════════════
  if (action === 'unfinalize') {
    const auth = await requireRole(req, 'admin')
    if (auth instanceof Response) return auth

    const dischargeId = String(body.dischargeId ?? '').trim()
    const reason      = String(body.reason       ?? '').trim()

    if (!UUID_RE.test(dischargeId)) {
      return NextResponse.json(
        { error: 'A valid dischargeId is required.' },
        { status: 400 }
      )
    }
    if (reason.length < 5) {
      return NextResponse.json(
        { error: 'A reason of at least 5 characters is required to unfinalize.' },
        { status: 400 }
      )
    }
    if (reason.length > 1000) {
      return NextResponse.json(
        { error: 'Reason is too long (max 1000 characters).' },
        { status: 400 }
      )
    }

    const supabase = getSupabaseAdmin()

    // Pull the existing row so we can verify state and capture pre-image
    const { data: ds, error: fetchErr } = await supabase
      .from('discharge_summaries')
      .select('id, is_final')
      .eq('id', dischargeId)
      .single()

    if (fetchErr || !ds) {
      if (fetchErr && fetchErr.code !== 'PGRST116') logErr('unfinalize.select', fetchErr)
      return NextResponse.json({ error: 'Discharge summary not found.' }, { status: 404 })
    }

    if (!ds.is_final) {
      // Already a draft — nothing to do, return 200 to keep the UI flow simple.
      return NextResponse.json({
        ok: true,
        alreadyDraft: true,
        message: 'Discharge summary was already a draft.',
      })
    }

    const now      = new Date().toISOString()
    const actorTag = auth.fullName?.trim() || auth.email || 'Admin'

    const { error: updErr } = await supabase
      .from('discharge_summaries')
      .update({
        is_final:           false,
        unfinalized_reason: reason,
        unfinalized_by:     actorTag,
        unfinalized_at:     now,
        updated_at:         now,
      })
      .eq('id', dischargeId)

    if (updErr) {
      logErr('unfinalize.update', updErr)
      return NextResponse.json(
        { error: 'Could not unfinalize discharge summary. Please retry.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      message: 'Discharge summary unfinalized. It can now be edited.',
    })
  }

  // ════════════════════════════════════════════════════════════════
  // FINALIZE — admin or doctor
  // ════════════════════════════════════════════════════════════════
  const auth = await requireRole(req, ['admin', 'doctor'])
  if (auth instanceof Response) return auth

  const dischargeId    = String(body.dischargeId ?? '').trim()
  const expectedVersion = (typeof body.version === 'number' && Number.isFinite(body.version))
    ? Math.floor(body.version)
    : undefined

  if (!UUID_RE.test(dischargeId)) {
    return NextResponse.json(
      { error: 'A valid dischargeId is required.' },
      { status: 400 }
    )
  }

  const supabase = getSupabaseAdmin()

  const { data: ds, error: fetchErr } = await supabase
    .from('discharge_summaries')
    .select('*')
    .eq('id', dischargeId)
    .single()

  if (fetchErr || !ds) {
    if (fetchErr && fetchErr.code !== 'PGRST116') logErr('finalize.select', fetchErr)
    return NextResponse.json({ error: 'Discharge summary not found.' }, { status: 404 })
  }

  // Idempotent: already finalised → return success without churning version
  if (ds.is_final) {
    return NextResponse.json({
      ok:           true,
      alreadyFinal: true,
      version:      ds.version || 1,
      message:      'Discharge summary is already finalised.',
    })
  }

  // Optimistic concurrency: caller saw version N; verify it's still N
  if (typeof expectedVersion === 'number') {
    const dbVersion = ds.version ?? 1
    if (expectedVersion !== dbVersion) {
      return NextResponse.json(
        {
          error: `This summary was modified by another user (you saw v${expectedVersion}, current is v${dbVersion}).`,
          currentVersion: dbVersion,
        },
        { status: 409 }
      )
    }
  }

  // Validate required fields before finalising. The schema has both
  // snake_case and the legacy lowercase concatenated names — accept either.
  const missingFields: string[] = []
  if (!ds.final_diagnosis        && !ds.finaldiagnosis)        missingFields.push('Final Diagnosis')
  if (!ds.condition_at_discharge && !ds.conditionatdischarge)  missingFields.push('Condition at Discharge')
  if (!ds.discharge_advice       && !ds.dischargeadvice)       missingFields.push('Discharge Advice')

  if (missingFields.length > 0) {
    return NextResponse.json(
      {
        error: `Cannot finalize — missing required fields: ${missingFields.join(', ')}`,
        missingFields,
      },
      { status: 400 }
    )
  }

  const now        = new Date().toISOString()
  const newVersion = (ds.version || 1) + 1
  const signerTag  = auth.fullName?.trim() || auth.email || 'Doctor'

  const { error: updErr } = await supabase
    .from('discharge_summaries')
    .update({
      is_final:     true,
      signed_by:    signerTag,
      signed_at:    now,
      finalized_at: now,
      version:      newVersion,
      updated_at:   now,
    })
    .eq('id', dischargeId)

  if (updErr) {
    logErr('finalize.update', updErr)
    return NextResponse.json(
      { error: 'Could not finalize discharge summary. Please retry.' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok:       true,
    message:  'Discharge summary finalized and locked.',
    version:  newVersion,
    signedBy: signerTag,
    signedAt: now,
  })
}
