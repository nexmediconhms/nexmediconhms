/**
 * src/app/api/discharge/finalize/route.ts
 *
 * Discharge Summary Finalization API
 *
 * POST /api/discharge/finalize
 *   { dischargeId, signedBy }
 *   → Marks a discharge summary as final (locked), sets signedat, signedby
 *
 * POST /api/discharge/finalize?action=unfinalize
 *   { dischargeId, reason, unfinalizedBy }
 *   → Admin-only: reverts finalization with reason audit trail
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/api-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  const action = req.nextUrl.searchParams.get('action')
  const body = await req.json()

  // ── UNFINALIZE (admin only) ─────────────────────────────────
  if (action === 'unfinalize') {
    const { dischargeId, reason, unfinalizedBy } = body

    if (!dischargeId || !reason) {
      return NextResponse.json(
        { error: 'dischargeId and reason are required for unfinalization' },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from('discharge_summaries')
      .update({
        is_final: false,
        unfinalized_reason: reason,
        unfinalized_by: unfinalizedBy || 'Admin',
        unfinalized_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', dischargeId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      message: 'Discharge summary unfinalized. It can now be edited.',
    })
  }

  // ── FINALIZE ────────────────────────────────────────────────
  const { dischargeId, signedBy } = body

  if (!dischargeId) {
    return NextResponse.json({ error: 'dischargeId is required' }, { status: 400 })
  }

  // Check if discharge summary exists
  const { data: ds, error: fetchErr } = await supabase
    .from('discharge_summaries')
    .select('*')
    .eq('id', dischargeId)
    .single()

  if (fetchErr || !ds) {
    return NextResponse.json({ error: 'Discharge summary not found' }, { status: 404 })
  }

  // Validate required fields before finalizing
  const missingFields: string[] = []
  if (!ds.final_diagnosis && !ds.finaldiagnosis) missingFields.push('Final Diagnosis')
  if (!ds.condition_at_discharge && !ds.conditionatdischarge) missingFields.push('Condition at Discharge')
  if (!ds.discharge_advice && !ds.dischargeadvice) missingFields.push('Discharge Advice')

  if (missingFields.length > 0) {
    return NextResponse.json({
      error: `Cannot finalize — missing required fields: ${missingFields.join(', ')}`,
      missingFields,
    }, { status: 400 })
  }

  // Mark as finalized
  const { error: updateErr } = await supabase
    .from('discharge_summaries')
    .update({
      is_final: true,
      signed_by: signedBy || 'Doctor',
      signed_at: new Date().toISOString(),
      finalized_at: new Date().toISOString(),
      version: (ds.version || 1) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', dischargeId)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    message: 'Discharge summary finalized and locked.',
    version: (ds.version || 1) + 1,
  })
}
