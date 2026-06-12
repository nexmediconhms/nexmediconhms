/**
 * src/app/api/billing/fee-status/route.ts
 *
 * GET  /api/billing/fee-status?patient_id=...&encounter_id=...  — check fee status
 * POST /api/billing/fee-status  — mark fee as paid / skip billing
 *
 * NON-BREAKING: New endpoint alongside existing billing routes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  checkFeeStatus,
  markFeeAsPaid,
  skipBillingForEncounter,
  getBillingGuardLog,
} from '@/lib/billing-workflow';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(req.url);

    const patientId = searchParams.get('patient_id');
    const encounterId = searchParams.get('encounter_id');
    const queueEntryId = searchParams.get('queue_id');

    // Audit log query
    if (searchParams.get('log') === 'true') {
      const date = searchParams.get('date') || undefined;
      const result = await getBillingGuardLog(supabase, {
        date,
        patientId: patientId || undefined,
      });
      return NextResponse.json({ log: result.data });
    }

    // Fee status check
    if (!patientId) {
      return NextResponse.json({ error: 'patient_id is required' }, { status: 400 });
    }

    const result = await checkFeeStatus(supabase, {
      patientId,
      encounterId: encounterId || undefined,
      queueEntryId: queueEntryId || undefined,
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ fee_status: result.data });
  } catch (err) {
    console.error('[API /billing/fee-status GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();
    const { action } = body;

    // Mark fee as paid at registration
    if (action === 'mark_paid') {
      if (!body.patient_id || !body.amount) {
        return NextResponse.json(
          { error: 'patient_id and amount are required' },
          { status: 400 }
        );
      }

      const result = await markFeeAsPaid(supabase, {
        encounterId: body.encounter_id,
        queueEntryId: body.queue_id,
        patientId: body.patient_id,
        amount: body.amount,
        receiptNumber: body.receipt_number,
        paymentMode: body.payment_mode || 'cash',
        collectedBy: body.collected_by,
      });

      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'Fee marked as paid' });
    }

    // Skip billing (no additional services needed)
    if (action === 'skip_billing') {
      if (!body.encounter_id || !body.patient_id) {
        return NextResponse.json(
          { error: 'encounter_id and patient_id are required' },
          { status: 400 }
        );
      }

      const result = await skipBillingForEncounter(
        supabase,
        body.encounter_id,
        body.patient_id,
        body.reason || 'No additional services',
        body.performed_by
      );

      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'Billing skipped' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    console.error('[API /billing/fee-status POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
