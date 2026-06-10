/**
 * src/app/api/lab-orders/route.ts
 *
 * GET  /api/lab-orders?encounter_id=...  — orders for encounter
 * GET  /api/lab-orders?patient_id=...    — patient order history
 * GET  /api/lab-orders?pending=true      — pending results
 * POST /api/lab-orders                   — create order(s)
 * PUT  /api/lab-orders                   — update status
 *
 * NON-BREAKING: New endpoint. Existing /api/labs routes untouched.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  createLabOrder,
  createLabOrderBatch,
  updateLabOrderStatus,
  getEncounterLabOrders,
  getPatientLabOrders,
  getPendingLabOrders,
} from '@/lib/lab-order-helpers';

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

    const encounterId = searchParams.get('encounter_id');
    const patientId = searchParams.get('patient_id');
    const pending = searchParams.get('pending');
    const doctorId = searchParams.get('doctor_id');

    if (pending === 'true') {
      const result = await getPendingLabOrders(supabase, doctorId || undefined);
      if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
      return NextResponse.json({ lab_orders: result.data });
    }

    if (encounterId) {
      const result = await getEncounterLabOrders(supabase, encounterId);
      if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
      return NextResponse.json({ lab_orders: result.data });
    }

    if (patientId) {
      const status = searchParams.get('status') || undefined;
      const limit = parseInt(searchParams.get('limit') || '50', 10);
      const result = await getPatientLabOrders(supabase, patientId, { status, limit });
      if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
      return NextResponse.json({ lab_orders: result.data });
    }

    return NextResponse.json({ error: 'Provide encounter_id, patient_id, or pending=true' }, { status: 400 });
  } catch (err) {
    console.error('[API /lab-orders GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();

    // Batch mode: create multiple orders at once (from panel)
    if (Array.isArray(body.orders)) {
      if (body.orders.length === 0) {
        return NextResponse.json({ error: 'orders array is empty' }, { status: 400 });
      }
      const result = await createLabOrderBatch(supabase, body.orders);
      return NextResponse.json({
        lab_orders: result.data,
        errors: result.errors.length > 0 ? result.errors : undefined,
        count: result.data.length,
      }, { status: 201 });
    }

    // Single order mode
    if (!body.patient_id || !body.test_name) {
      return NextResponse.json(
        { error: 'patient_id and test_name are required' },
        { status: 400 }
      );
    }

    const result = await createLabOrder(supabase, body);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });

    return NextResponse.json({ lab_order: result.data }, { status: 201 });
  } catch (err) {
    console.error('[API /lab-orders POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();
    const { id, status, ...extra } = body;

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    // If just updating status
    if (status) {
      const result = await updateLabOrderStatus(supabase, id, status, extra);
      if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
      return NextResponse.json({ lab_order: result.data });
    }

    // Generic update
    const { data, error } = await supabase
      .from('lab_orders')
      .update({ ...extra })
      .eq('id', id)
      .select('*')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ lab_order: data });
  } catch (err) {
    console.error('[API /lab-orders PUT]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
