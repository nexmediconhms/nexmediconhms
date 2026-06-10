/**
 * src/app/api/vitals/route.ts
 *
 * API for saving, reading, and updating patient vitals.
 *
 * GET  /api/vitals?encounter_id=...  — get vitals for an encounter
 * GET  /api/vitals?patient_id=...    — get latest vitals for a patient
 * POST /api/vitals                   — save new vitals
 * PUT  /api/vitals                   — update existing vitals
 *
 * NON-BREAKING: New API endpoint. No existing routes affected.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  saveVitals,
  updateVitals,
  getEncounterVitals,
  getLatestVitals,
  validateVitals,
} from '@/lib/vitals-helpers';
import { updateEncounter } from '@/lib/encounters';

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

    const encounterId = searchParams.get('encounter_id');
    const patientId = searchParams.get('patient_id');

    // Vitals for a specific encounter
    if (encounterId) {
      const result = await getEncounterVitals(supabase, encounterId);
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
      return NextResponse.json({ vitals: result.data });
    }

    // Latest vitals for a patient (for prefill)
    if (patientId) {
      const result = await getLatestVitals(supabase, patientId);
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
      return NextResponse.json({ vitals: result.data });
    }

    return NextResponse.json(
      { error: 'Provide encounter_id or patient_id' },
      { status: 400 }
    );
  } catch (err) {
    console.error('[API /vitals GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── POST ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();

    const {
      encounter_id,
      patient_id,
      recorded_by,
      capture_type,
      ...vitalValues
    } = body;

    if (!encounter_id || !patient_id) {
      return NextResponse.json(
        { error: 'encounter_id and patient_id are required' },
        { status: 400 }
      );
    }

    // Client-side validation warnings (non-blocking)
    const warnings = validateVitals(vitalValues);

    // Save vitals (DB triggers handle BMI, gestational age, critical alerts)
    const result = await saveVitals(supabase, {
      encounter_id,
      patient_id,
      recorded_by: recorded_by || null,
      capture_type: capture_type || 'pre_consultation',
      ...vitalValues,
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // Update encounter status to reflect vitals are done
    // Only if it's a pre_consultation capture and encounter is in early status
    if (capture_type !== 'post_procedure' && capture_type !== 'monitoring') {
      const { data: encounter } = await supabase
        .from('encounters')
        .select('status')
        .eq('id', encounter_id)
        .single();

      if (
        encounter &&
        ['registered', 'vitals_in_progress'].includes(encounter.status)
      ) {
        await updateEncounter(supabase, encounter_id, {
          status: 'vitals_done',
        });

        // Also update queue entry
        const { data: queueEntry } = await supabase
          .from('opd_queue')
          .select('id')
          .eq('encounter_id', encounter_id)
          .single();

        if (queueEntry) {
          await supabase
            .from('opd_queue')
            .update({
              status: 'vitals_done',
              vitals_done: true,
              vitals_done_at: new Date().toISOString(),
            })
            .eq('id', queueEntry.id);
        }
      }
    }

    return NextResponse.json(
      {
        vitals: result.data,
        warnings: warnings.length > 0 ? warnings : undefined,
        critical: result.data?.is_critical || false,
        criticalAlerts: result.data?.critical_alerts || [],
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('[API /vitals POST]', err);
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

    // Validate
    const warnings = validateVitals(updates);

    const result = await updateVitals(supabase, id, updates);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      vitals: result.data,
      warnings: warnings.length > 0 ? warnings : undefined,
      critical: result.data?.is_critical || false,
      criticalAlerts: result.data?.critical_alerts || [],
    });
  } catch (err) {
    console.error('[API /vitals PUT]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
