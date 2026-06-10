/**
 * src/app/api/opd/procedures/route.ts
 *
 * GET  /api/opd/procedures?encounter_id=...  — procedures for encounter
 * GET  /api/opd/procedures?patient_id=...    — procedure history
 * POST /api/opd/procedures                   — log new procedure
 * PUT  /api/opd/procedures                   — update procedure record
 *
 * NON-BREAKING: New endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  createProcedure,
  updateProcedure,
  getEncounterProcedures,
  getPatientProcedures,
} from '@/lib/opd-procedures';

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
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    if (encounterId) {
      const result = await getEncounterProcedures(supabase, encounterId);
      if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
      return NextResponse.json({ procedures: result.data });
    }

    if (patientId) {
      const result = await getPatientProcedures(supabase, patientId, limit);
      if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
      return NextResponse.json({ procedures: result.data });
    }

    return NextResponse.json({ error: 'Provide encounter_id or patient_id' }, { status: 400 });
  } catch (err) {
    console.error('[API /opd/procedures GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();

    if (!body.encounter_id || !body.patient_id || !body.procedure_name) {
      return NextResponse.json(
        { error: 'encounter_id, patient_id, and procedure_name are required' },
        { status: 400 }
      );
    }

    const result = await createProcedure(supabase, body);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });

    // Also update encounter.procedures JSONB array
    if (result.data) {
      const { data: encounter } = await supabase
        .from('encounters')
        .select('procedures')
        .eq('id', body.encounter_id)
        .single();

      if (encounter) {
        const existing = Array.isArray(encounter.procedures) ? encounter.procedures : [];
        existing.push({
          id: result.data.id,
          name: body.procedure_name,
          code: body.procedure_code,
          consent_taken: !!body.consent_id,
          timestamp: new Date().toISOString(),
        });
        await supabase
          .from('encounters')
          .update({ procedures: existing })
          .eq('id', body.encounter_id);
      }
    }

    return NextResponse.json({ procedure: result.data }, { status: 201 });
  } catch (err) {
    console.error('[API /opd/procedures POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const result = await updateProcedure(supabase, id, updates);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });

    return NextResponse.json({ procedure: result.data });
  } catch (err) {
    console.error('[API /opd/procedures PUT]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
