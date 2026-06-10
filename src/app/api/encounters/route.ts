/**
 * src/app/api/encounters/route.ts
 *
 * API for creating, reading, and updating OPD encounters.
 *
 * GET  /api/encounters?patient_id=... — list encounters for a patient
 * GET  /api/encounters?id=...        — get single encounter
 * GET  /api/encounters?today=true    — get today's encounters
 * POST /api/encounters               — create a new encounter
 * PUT  /api/encounters               — update an encounter
 *
 * NON-BREAKING: New API endpoint. No existing routes affected.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  createEncounter,
  getEncounter,
  getPatientEncounters,
  getTodaysEncounters,
  updateEncounter,
  linkEncounterToQueue,
  calculateDurationMins,
} from '@/lib/encounters';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key);
}

// ─── GET ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(req.url);

    const id = searchParams.get('id');
    const patientId = searchParams.get('patient_id');
    const today = searchParams.get('today');
    const doctorId = searchParams.get('doctor_id');
    const includeVitals = searchParams.get('include_vitals') === 'true';

    // Single encounter by ID
    if (id) {
      const result = await getEncounter(supabase, id, includeVitals);
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 404 });
      }
      return NextResponse.json({ encounter: result.data, vitals: result.vitals });
    }

    // Today's encounters
    if (today === 'true') {
      const activeOnly = searchParams.get('active_only') !== 'false';
      const result = await getTodaysEncounters(supabase, doctorId || undefined, activeOnly);
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
      return NextResponse.json({ encounters: result.data });
    }

    // Patient encounters
    if (patientId) {
      const limit = parseInt(searchParams.get('limit') || '20', 10);
      const offset = parseInt(searchParams.get('offset') || '0', 10);
      const visitType = searchParams.get('visit_type') || undefined;
      const dateFrom = searchParams.get('date_from') || undefined;
      const dateTo = searchParams.get('date_to') || undefined;

      const result = await getPatientEncounters(supabase, patientId, {
        limit, offset, visitType, dateFrom, dateTo,
      });
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
      return NextResponse.json({
        encounters: result.data,
        total: result.count,
        limit,
        offset,
      });
    }

    return NextResponse.json(
      { error: 'Provide id, patient_id, or today=true' },
      { status: 400 }
    );
  } catch (err) {
    console.error('[API /encounters GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── POST ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();

    const {
      patient_id,
      doctor_id,
      visit_type,
      visit_date,
      queue_entry_id,
      created_by,
      chief_complaint,
      clinic_id,
    } = body;

    if (!patient_id) {
      return NextResponse.json(
        { error: 'patient_id is required' },
        { status: 400 }
      );
    }

    // Create the encounter
    const result = await createEncounter(supabase, {
      patient_id,
      doctor_id,
      visit_type,
      visit_date,
      queue_entry_id,
      created_by,
      chief_complaint,
      clinic_id,
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // If queue_entry_id provided, link them bidirectionally
    if (queue_entry_id && result.data) {
      const linkResult = await linkEncounterToQueue(
        supabase,
        result.data.id,
        queue_entry_id
      );
      if (linkResult.error) {
        console.warn('[API /encounters POST] Queue link warning:', linkResult.error);
        // Non-fatal: encounter was created, queue link is best-effort
      }
    }

    return NextResponse.json(
      { encounter: result.data },
      { status: 201 }
    );
  } catch (err) {
    console.error('[API /encounters POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── PUT ────────────────────────────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'id is required' },
        { status: 400 }
      );
    }

    // Auto-calculate duration if started_at and ended_at are both provided
    if (updates.ended_at && !updates.duration_mins) {
      // Fetch started_at from existing encounter if not in updates
      if (!updates.started_at) {
        const existing = await getEncounter(supabase, id);
        if (existing.data?.started_at) {
          updates.duration_mins = calculateDurationMins(
            existing.data.started_at,
            updates.ended_at
          );
        }
      } else {
        updates.duration_mins = calculateDurationMins(
          updates.started_at,
          updates.ended_at
        );
      }
    }

    const result = await updateEncounter(supabase, id, updates);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // If status changed to 'consultation_done' or 'completed', update queue too
    if (
      updates.status &&
      ['consultation_done', 'completed'].includes(updates.status) &&
      result.data?.queue_entry_id
    ) {
      const queueStatus = updates.status === 'completed' ? 'done' : updates.status;
      await supabase
        .from('opd_queue')
        .update({
          status: queueStatus,
          done_at: updates.status === 'completed' ? new Date().toISOString() : undefined,
        })
        .eq('id', result.data.queue_entry_id);
    }

    return NextResponse.json({ encounter: result.data });
  } catch (err) {
    console.error('[API /encounters PUT]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
