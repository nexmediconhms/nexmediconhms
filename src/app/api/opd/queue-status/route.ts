/**
 * src/app/api/opd/queue-status/route.ts
 *
 * API for updating OPD queue status with transition validation.
 *
 * PUT /api/opd/queue-status — update queue entry status
 *   body: { queue_id, new_status, doctor_id?, notes? }
 *
 * NON-BREAKING: New endpoint alongside existing /api/opd/queue-token.
 * The existing queue-token route continues to work unchanged.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isValidTransition, getStatusConfig, QUEUE_STATUS } from '@/lib/queue-status';
import { updateEncounter, createEncounter, linkEncounterToQueue } from '@/lib/encounters';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key);
}

export async function PUT(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();

    const {
      queue_id,
      new_status,
      doctor_id,
      notes,
    } = body;

    if (!queue_id || !new_status) {
      return NextResponse.json(
        { error: 'queue_id and new_status are required' },
        { status: 400 }
      );
    }

    // Fetch current queue entry
    const { data: queueEntry, error: fetchError } = await supabase
      .from('opd_queue')
      .select('*')
      .eq('id', queue_id)
      .single();

    if (fetchError || !queueEntry) {
      return NextResponse.json(
        { error: 'Queue entry not found' },
        { status: 404 }
      );
    }

    // Validate transition
    const currentStatus = queueEntry.status || 'registered';
    if (!isValidTransition(currentStatus, new_status)) {
      return NextResponse.json(
        {
          error: `Invalid status transition: ${currentStatus} → ${new_status}`,
          currentStatus,
          allowedTransitions: getStatusConfig(currentStatus),
        },
        { status: 400 }
      );
    }

    // Build update payload
    const updatePayload: Record<string, unknown> = {
      status: new_status,
    };

    // Status-specific side effects
    switch (new_status) {
      case QUEUE_STATUS.VITALS_IN_PROGRESS:
        // Create encounter if not yet created
        if (!queueEntry.encounter_id) {
          const encResult = await createEncounter(supabase, {
            patient_id: queueEntry.patient_id,
            doctor_id: doctor_id || queueEntry.doctor_id || null,
            visit_type: queueEntry.visit_type || 'OPD',
            queue_entry_id: queue_id,
          });
          if (encResult.data) {
            updatePayload.encounter_id = encResult.data.id;
            await linkEncounterToQueue(supabase, encResult.data.id, queue_id);
          }
        }
        break;

      case QUEUE_STATUS.VITALS_DONE:
        updatePayload.vitals_done = true;
        updatePayload.vitals_done_at = new Date().toISOString();
        break;

      case QUEUE_STATUS.WITH_DOCTOR:
        updatePayload.called_at = new Date().toISOString();
        if (doctor_id) updatePayload.doctor_id = doctor_id;

        // Create encounter if not yet created (walk-in without vitals)
        if (!queueEntry.encounter_id) {
          const encResult = await createEncounter(supabase, {
            patient_id: queueEntry.patient_id,
            doctor_id: doctor_id || queueEntry.doctor_id || null,
            visit_type: queueEntry.visit_type || 'OPD',
            queue_entry_id: queue_id,
          });
          if (encResult.data) {
            updatePayload.encounter_id = encResult.data.id;
          }
        }

        // Update encounter status + started_at
        const encId1 = (updatePayload.encounter_id as string) || queueEntry.encounter_id;
        if (encId1) {
          await updateEncounter(supabase, encId1, {
            status: 'with_doctor',
            started_at: new Date().toISOString(),
            doctor_id: doctor_id || undefined,
          });
        }
        break;

      case QUEUE_STATUS.CONSULTATION_DONE:
        // Update encounter
        if (queueEntry.encounter_id) {
          await updateEncounter(supabase, queueEntry.encounter_id, {
            status: 'consultation_done',
            ended_at: new Date().toISOString(),
          });
        }
        break;

      case QUEUE_STATUS.COMPLETED:
      case QUEUE_STATUS.DONE:
        updatePayload.done_at = new Date().toISOString();
        // Update encounter to completed
        if (queueEntry.encounter_id) {
          await updateEncounter(supabase, queueEntry.encounter_id, {
            status: 'completed',
          });
        }
        break;

      case QUEUE_STATUS.SKIPPED:
        updatePayload.skipped_count = (queueEntry.skipped_count || 0) + 1;
        break;

      case QUEUE_STATUS.RECALLED:
        updatePayload.recalled_at = new Date().toISOString();
        break;

      case QUEUE_STATUS.ADMITTED_TO_IPD:
        if (queueEntry.encounter_id) {
          await updateEncounter(supabase, queueEntry.encounter_id, {
            status: 'admitted_to_ipd',
          });
        }
        break;

      case QUEUE_STATUS.CANCELLED:
      case QUEUE_STATUS.NO_SHOW:
        updatePayload.done_at = new Date().toISOString();
        if (queueEntry.encounter_id) {
          await updateEncounter(supabase, queueEntry.encounter_id, {
            status: new_status,
          });
        }
        break;
    }

    // Add notes if provided
    if (notes) {
      updatePayload.notes = notes;
    }

    // Execute queue update
    const { data: updatedEntry, error: updateError } = await supabase
      .from('opd_queue')
      .update(updatePayload)
      .eq('id', queue_id)
      .select('*')
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      queue_entry: updatedEntry,
      previous_status: currentStatus,
      new_status,
      encounter_id: updatedEntry.encounter_id,
    });
  } catch (err) {
    console.error('[API /opd/queue-status PUT]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
