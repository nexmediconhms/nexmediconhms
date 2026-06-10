/**
 * src/lib/encounters.ts
 *
 * Helper functions for the encounters table — the central spine of every
 * OPD visit. Used by API routes and page components.
 *
 * NON-BREAKING: This is a NEW file. No existing code is modified.
 * Other modules can opt-in to using encounter_id at their own pace.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EncounterCreateInput {
  patient_id: string;
  doctor_id?: string;
  visit_type?: 'OPD' | 'ANC' | 'Follow-up' | 'Procedure' | 'Emergency';
  visit_date?: string;  // ISO date string, defaults to today
  queue_entry_id?: string;
  created_by?: string;
  chief_complaint?: string;
  clinic_id?: string;
}

export interface EncounterUpdateInput {
  status?: string;
  chief_complaint?: string;
  examination_notes?: string;
  diagnosis?: string;
  diagnosis_code?: string;
  treatment_plan?: string;
  clinical_notes?: Record<string, unknown>;
  gynae_data?: Record<string, unknown>;
  procedures?: Array<Record<string, unknown>>;
  follow_up_date?: string;
  follow_up_notes?: string;
  follow_up_created?: boolean;
  referral_to?: string;
  referral_notes?: string;
  admission_id?: string;
  started_at?: string;
  ended_at?: string;
  duration_mins?: number;
  doctor_id?: string;
  updated_by?: string;
}

export interface Encounter {
  id: string;
  patient_id: string;
  doctor_id: string | null;
  clinic_id: string | null;
  visit_type: string;
  visit_date: string;
  visit_number: number;
  status: string;
  chief_complaint: string | null;
  examination_notes: string | null;
  diagnosis: string | null;
  diagnosis_code: string | null;
  treatment_plan: string | null;
  clinical_notes: Record<string, unknown>;
  gynae_data: Record<string, unknown>;
  procedures: Array<Record<string, unknown>>;
  follow_up_date: string | null;
  follow_up_notes: string | null;
  follow_up_created: boolean;
  referral_to: string | null;
  referral_notes: string | null;
  queue_entry_id: string | null;
  admission_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_mins: number | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

// ─── Encounter Status Constants ─────────────────────────────────────────────

export const ENCOUNTER_STATUS = {
  REGISTERED: 'registered',
  VITALS_IN_PROGRESS: 'vitals_in_progress',
  VITALS_DONE: 'vitals_done',
  WITH_DOCTOR: 'with_doctor',
  CONSULTATION_DONE: 'consultation_done',
  AT_PHARMACY: 'at_pharmacy',
  AT_BILLING: 'at_billing',
  COMPLETED: 'completed',
  ADMITTED_TO_IPD: 'admitted_to_ipd',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show',
} as const;

// ─── Create Encounter ───────────────────────────────────────────────────────

/**
 * Create a new encounter for a patient visit.
 * Called when a patient is added to the OPD queue or starts a walk-in visit.
 */
export async function createEncounter(
  supabase: SupabaseClient,
  input: EncounterCreateInput
): Promise<{ data: Encounter | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('encounters')
      .insert({
        patient_id: input.patient_id,
        doctor_id: input.doctor_id || null,
        visit_type: input.visit_type || 'OPD',
        visit_date: input.visit_date || new Date().toISOString().split('T')[0],
        status: ENCOUNTER_STATUS.REGISTERED,
        queue_entry_id: input.queue_entry_id || null,
        created_by: input.created_by || null,
        clinic_id: input.clinic_id || null,
      })
      .select('*')
      .single();

    if (error) {
      console.error('[encounters] Create error:', error.message);
      return { data: null, error: error.message };
    }

    return { data: data as Encounter, error: null };
  } catch (err) {
    console.error('[encounters] Create exception:', err);
    return { data: null, error: String(err) };
  }
}

// ─── Get Encounter ──────────────────────────────────────────────────────────

/**
 * Fetch a single encounter by ID, optionally with related vitals.
 */
export async function getEncounter(
  supabase: SupabaseClient,
  encounterId: string,
  includeVitals = false
): Promise<{ data: Encounter | null; vitals?: unknown[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('encounters')
      .select('*')
      .eq('id', encounterId)
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    let vitals: unknown[] | undefined;
    if (includeVitals) {
      const { data: vitalsData } = await supabase
        .from('vitals')
        .select('*')
        .eq('encounter_id', encounterId)
        .order('recorded_at', { ascending: false });
      vitals = vitalsData || [];
    }

    return { data: data as Encounter, vitals, error: null };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

// ─── Update Encounter ───────────────────────────────────────────────────────

/**
 * Update an encounter. Used throughout the OPD flow:
 * - When vitals are recorded → status changes
 * - When doctor starts consultation → status + started_at
 * - When doctor saves notes → clinical fields
 * - When consultation ends → status + ended_at
 */
export async function updateEncounter(
  supabase: SupabaseClient,
  encounterId: string,
  updates: EncounterUpdateInput
): Promise<{ data: Encounter | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('encounters')
      .update(updates)
      .eq('id', encounterId)
      .select('*')
      .single();

    if (error) {
      console.error('[encounters] Update error:', error.message);
      return { data: null, error: error.message };
    }

    return { data: data as Encounter, error: null };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

// ─── List Encounters for Patient ────────────────────────────────────────────

/**
 * Get all encounters for a patient, newest first.
 * Used in patient timeline / history view.
 */
export async function getPatientEncounters(
  supabase: SupabaseClient,
  patientId: string,
  options: {
    limit?: number;
    offset?: number;
    visitType?: string;
    dateFrom?: string;
    dateTo?: string;
  } = {}
): Promise<{ data: Encounter[]; count: number; error: string | null }> {
  try {
    let query = supabase
      .from('encounters')
      .select('*', { count: 'exact' })
      .eq('patient_id', patientId)
      .order('visit_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (options.visitType) {
      query = query.eq('visit_type', options.visitType);
    }
    if (options.dateFrom) {
      query = query.gte('visit_date', options.dateFrom);
    }
    if (options.dateTo) {
      query = query.lte('visit_date', options.dateTo);
    }
    if (options.limit) {
      query = query.limit(options.limit);
    }
    if (options.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 20) - 1);
    }

    const { data, count, error } = await query;

    if (error) {
      return { data: [], count: 0, error: error.message };
    }

    return { data: (data || []) as Encounter[], count: count || 0, error: null };
  } catch (err) {
    return { data: [], count: 0, error: String(err) };
  }
}

// ─── Today's Encounters ─────────────────────────────────────────────────────

/**
 * Get all encounters for today, optionally filtered by doctor.
 * Used in the doctor's dashboard.
 */
export async function getTodaysEncounters(
  supabase: SupabaseClient,
  doctorId?: string,
  activeOnly = true
): Promise<{ data: Encounter[]; error: string | null }> {
  try {
    const today = new Date().toISOString().split('T')[0];
    let query = supabase
      .from('encounters')
      .select('*, patients(id, name, age, gender, phone, mrn)')
      .eq('visit_date', today)
      .order('created_at', { ascending: true });

    if (doctorId) {
      query = query.eq('doctor_id', doctorId);
    }

    if (activeOnly) {
      query = query.not('status', 'in', '("completed","cancelled","no_show")');
    }

    const { data, error } = await query;

    if (error) {
      return { data: [], error: error.message };
    }

    return { data: (data || []) as Encounter[], error: null };
  } catch (err) {
    return { data: [], error: String(err) };
  }
}

// ─── Get Last Encounter for Patient ─────────────────────────────────────────

/**
 * Get the most recent encounter for a patient.
 * Useful for "Copy from last visit" and prefilling.
 */
export async function getLastEncounter(
  supabase: SupabaseClient,
  patientId: string,
  visitType?: string
): Promise<{ data: Encounter | null; error: string | null }> {
  try {
    let query = supabase
      .from('encounters')
      .select('*')
      .eq('patient_id', patientId)
      .order('visit_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);

    if (visitType) {
      query = query.eq('visit_type', visitType);
    }

    const { data, error } = await query;

    if (error || !data || data.length === 0) {
      return { data: null, error: error?.message || null };
    }

    return { data: data[0] as Encounter, error: null };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

// ─── Link Encounter to Queue ────────────────────────────────────────────────

/**
 * After creating an encounter, link it back to the OPD queue entry.
 * This creates the bidirectional link: queue → encounter and encounter → queue.
 */
export async function linkEncounterToQueue(
  supabase: SupabaseClient,
  encounterId: string,
  queueEntryId: string
): Promise<{ error: string | null }> {
  try {
    // Update queue entry with encounter_id
    const { error: queueError } = await supabase
      .from('opd_queue')
      .update({ encounter_id: encounterId })
      .eq('id', queueEntryId);

    if (queueError) {
      return { error: queueError.message };
    }

    // Update encounter with queue_entry_id
    const { error: encounterError } = await supabase
      .from('encounters')
      .update({ queue_entry_id: queueEntryId })
      .eq('id', encounterId);

    if (encounterError) {
      return { error: encounterError.message };
    }

    return { error: null };
  } catch (err) {
    return { error: String(err) };
  }
}

// ─── Link Encounter to Bill ─────────────────────────────────────────────────

/**
 * Link a bill to an encounter. Called when a bill is generated during OPD flow.
 * Non-breaking: bills without encounter_id continue to work.
 */
export async function linkEncounterToBill(
  supabase: SupabaseClient,
  encounterId: string,
  billId: string
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase
      .from('bills')
      .update({ encounter_id: encounterId })
      .eq('id', billId);

    return { error: error?.message || null };
  } catch (err) {
    return { error: String(err) };
  }
}

// ─── Calculate Encounter Duration ───────────────────────────────────────────

/**
 * Auto-calculate duration when encounter ends.
 */
export function calculateDurationMins(startedAt: string, endedAt: string): number {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  return Math.round((end - start) / 60000);
}
