/**
 * src/lib/vitals-helpers.ts
 *
 * Helper functions for the vitals table.
 * Vitals are captured by nurse/staff BEFORE the doctor consultation.
 *
 * NON-BREAKING: This is a NEW file. Existing vitals logic in OPD pages
 * (like LastvitalsPrefill) continues to work unchanged.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VitalsInput {
  encounter_id: string;
  patient_id: string;

  // Standard vitals
  weight_kg?: number | null;
  height_cm?: number | null;
  bp_systolic?: number | null;
  bp_diastolic?: number | null;
  pulse_rate?: number | null;
  temperature_f?: number | null;
  spo2?: number | null;
  respiratory_rate?: number | null;

  // Blood sugar
  blood_sugar_value?: number | null;
  blood_sugar_type?: 'fasting' | 'pp' | 'random' | null;

  // Gynae-specific
  lmp?: string | null;              // ISO date
  gestational_age_weeks?: number | null;
  gestational_age_days?: number | null;
  fundal_height_cm?: number | null;
  fetal_heart_rate?: number | null;
  presentation?: string | null;
  uterine_contractions?: string | null;
  edema?: string | null;
  urine_albumin?: string | null;
  urine_sugar?: string | null;
  hemoglobin?: number | null;

  // Meta
  notes?: string | null;
  capture_type?: 'pre_consultation' | 'post_procedure' | 'monitoring';
  recorded_by?: string | null;
}

export interface Vitals extends VitalsInput {
  id: string;
  bmi: number | null;
  is_critical: boolean;
  critical_alerts: Array<{
    field: string;
    value: number | string;
    severity: 'warning' | 'critical';
    message: string;
  }>;
  recorded_at: string;
  created_at: string;
}

// ─── Vitals Field Groups (for UI rendering) ─────────────────────────────────

export const VITALS_FIELD_GROUPS = {
  standard: {
    label: 'Standard Vitals',
    fields: [
      { key: 'weight_kg', label: 'Weight', unit: 'kg', type: 'number', step: 0.1, min: 1, max: 300 },
      { key: 'height_cm', label: 'Height', unit: 'cm', type: 'number', step: 0.5, min: 30, max: 250 },
      { key: 'bp_systolic', label: 'BP Systolic', unit: 'mmHg', type: 'number', step: 1, min: 50, max: 300 },
      { key: 'bp_diastolic', label: 'BP Diastolic', unit: 'mmHg', type: 'number', step: 1, min: 30, max: 200 },
      { key: 'pulse_rate', label: 'Pulse', unit: 'bpm', type: 'number', step: 1, min: 30, max: 250 },
      { key: 'temperature_f', label: 'Temperature', unit: '°F', type: 'number', step: 0.1, min: 90, max: 110 },
      { key: 'spo2', label: 'SpO₂', unit: '%', type: 'number', step: 1, min: 50, max: 100 },
      { key: 'respiratory_rate', label: 'Resp. Rate', unit: '/min', type: 'number', step: 1, min: 5, max: 60 },
    ],
  },
  bloodSugar: {
    label: 'Blood Sugar',
    fields: [
      { key: 'blood_sugar_value', label: 'Value', unit: 'mg/dL', type: 'number', step: 1, min: 10, max: 600 },
      { key: 'blood_sugar_type', label: 'Type', unit: '', type: 'select', options: ['fasting', 'pp', 'random'] },
    ],
  },
  gynae: {
    label: 'Gynae / Obstetric Vitals',
    fields: [
      { key: 'lmp', label: 'LMP', unit: '', type: 'date' },
      { key: 'gestational_age_weeks', label: 'Gest. Age', unit: 'weeks', type: 'number', step: 0.1, min: 0, max: 45 },
      { key: 'fundal_height_cm', label: 'Fundal Height', unit: 'cm', type: 'number', step: 0.5, min: 0, max: 50 },
      { key: 'fetal_heart_rate', label: 'FHR', unit: 'bpm', type: 'number', step: 1, min: 60, max: 220 },
      { key: 'presentation', label: 'Presentation', unit: '', type: 'select', options: ['cephalic', 'breech', 'transverse', 'oblique'] },
      { key: 'edema', label: 'Edema', unit: '', type: 'select', options: ['none', 'mild', 'moderate', 'severe'] },
      { key: 'urine_albumin', label: 'Urine Albumin', unit: '', type: 'select', options: ['nil', 'trace', '+1', '+2', '+3', '+4'] },
      { key: 'urine_sugar', label: 'Urine Sugar', unit: '', type: 'select', options: ['nil', 'trace', '+1', '+2', '+3', '+4'] },
      { key: 'hemoglobin', label: 'Hemoglobin', unit: 'g/dL', type: 'number', step: 0.1, min: 2, max: 25 },
    ],
  },
};

// ─── Save Vitals ────────────────────────────────────────────────────────────

/**
 * Save vitals for an encounter. BMI, gestational age, and critical alerts
 * are auto-calculated by database triggers.
 */
export async function saveVitals(
  supabase: SupabaseClient,
  input: VitalsInput
): Promise<{ data: Vitals | null; error: string | null }> {
  try {
    // Clean up null/undefined values — only send fields that have values
    const cleanInput: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined && value !== '' && value !== null) {
        cleanInput[key] = value;
      }
    }

    // Ensure required fields
    if (!cleanInput.encounter_id || !cleanInput.patient_id) {
      return { data: null, error: 'encounter_id and patient_id are required' };
    }

    const { data, error } = await supabase
      .from('vitals')
      .insert(cleanInput)
      .select('*')
      .single();

    if (error) {
      console.error('[vitals] Save error:', error.message);
      return { data: null, error: error.message };
    }

    return { data: data as Vitals, error: null };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

// ─── Update Vitals ──────────────────────────────────────────────────────────

/**
 * Update an existing vitals record.
 */
export async function updateVitals(
  supabase: SupabaseClient,
  vitalsId: string,
  updates: Partial<VitalsInput>
): Promise<{ data: Vitals | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('vitals')
      .update(updates)
      .eq('id', vitalsId)
      .select('*')
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data as Vitals, error: null };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

// ─── Get Vitals for Encounter ───────────────────────────────────────────────

/**
 * Get all vitals recorded for an encounter.
 */
export async function getEncounterVitals(
  supabase: SupabaseClient,
  encounterId: string
): Promise<{ data: Vitals[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('vitals')
      .select('*')
      .eq('encounter_id', encounterId)
      .order('recorded_at', { ascending: false });

    if (error) {
      return { data: [], error: error.message };
    }

    return { data: (data || []) as Vitals[], error: null };
  } catch (err) {
    return { data: [], error: String(err) };
  }
}

// ─── Get Latest Vitals for Patient ──────────────────────────────────────────

/**
 * Get the most recent vitals for a patient (any encounter).
 * Useful for prefilling on new visits.
 */
export async function getLatestVitals(
  supabase: SupabaseClient,
  patientId: string
): Promise<{ data: Vitals | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('vitals')
      .select('*')
      .eq('patient_id', patientId)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data as Vitals | null, error: null };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

// ─── Client-Side Validation ─────────────────────────────────────────────────

/**
 * Validate vitals before saving. Returns array of warning/error messages.
 * This is client-side; the DB triggers handle server-side critical detection.
 */
export function validateVitals(input: Partial<VitalsInput>): string[] {
  const warnings: string[] = [];

  if (input.bp_systolic !== undefined && input.bp_systolic !== null) {
    if (input.bp_systolic < 60) warnings.push('Systolic BP seems too low (< 60 mmHg)');
    if (input.bp_systolic > 250) warnings.push('Systolic BP seems too high (> 250 mmHg)');
  }
  if (input.bp_diastolic !== undefined && input.bp_diastolic !== null) {
    if (input.bp_diastolic < 30) warnings.push('Diastolic BP seems too low (< 30 mmHg)');
    if (input.bp_diastolic > 180) warnings.push('Diastolic BP seems too high (> 180 mmHg)');
  }
  if (input.bp_systolic && input.bp_diastolic && input.bp_systolic <= input.bp_diastolic) {
    warnings.push('Systolic BP should be greater than Diastolic BP');
  }
  if (input.pulse_rate !== undefined && input.pulse_rate !== null) {
    if (input.pulse_rate < 30) warnings.push('Pulse rate seems too low (< 30 bpm)');
    if (input.pulse_rate > 200) warnings.push('Pulse rate seems too high (> 200 bpm)');
  }
  if (input.temperature_f !== undefined && input.temperature_f !== null) {
    if (input.temperature_f < 93) warnings.push('Temperature seems too low (< 93°F)');
    if (input.temperature_f > 107) warnings.push('Temperature seems too high (> 107°F)');
  }
  if (input.spo2 !== undefined && input.spo2 !== null) {
    if (input.spo2 < 70) warnings.push('SpO₂ seems too low (< 70%)');
    if (input.spo2 > 100) warnings.push('SpO₂ cannot exceed 100%');
  }
  if (input.weight_kg !== undefined && input.weight_kg !== null) {
    if (input.weight_kg < 2) warnings.push('Weight seems too low (< 2 kg)');
    if (input.weight_kg > 250) warnings.push('Weight seems too high (> 250 kg)');
  }
  if (input.fetal_heart_rate !== undefined && input.fetal_heart_rate !== null) {
    if (input.fetal_heart_rate < 80) warnings.push('FHR seems too low (< 80 bpm)');
    if (input.fetal_heart_rate > 200) warnings.push('FHR seems too high (> 200 bpm)');
  }
  if (input.hemoglobin !== undefined && input.hemoglobin !== null) {
    if (input.hemoglobin < 3) warnings.push('Hemoglobin seems too low (< 3 g/dL)');
    if (input.hemoglobin > 22) warnings.push('Hemoglobin seems too high (> 22 g/dL)');
  }

  return warnings;
}

// ─── Format Vitals for Display ──────────────────────────────────────────────

/**
 * Format vitals into a human-readable summary string.
 */
export function formatVitalsSummary(vitals: Partial<Vitals>): string {
  const parts: string[] = [];

  if (vitals.bp_systolic && vitals.bp_diastolic) {
    parts.push(`BP: ${vitals.bp_systolic}/${vitals.bp_diastolic} mmHg`);
  }
  if (vitals.pulse_rate) parts.push(`Pulse: ${vitals.pulse_rate} bpm`);
  if (vitals.temperature_f) parts.push(`Temp: ${vitals.temperature_f}°F`);
  if (vitals.spo2) parts.push(`SpO₂: ${vitals.spo2}%`);
  if (vitals.weight_kg) parts.push(`Wt: ${vitals.weight_kg} kg`);
  if (vitals.bmi) parts.push(`BMI: ${vitals.bmi}`);
  if (vitals.fetal_heart_rate) parts.push(`FHR: ${vitals.fetal_heart_rate} bpm`);
  if (vitals.hemoglobin) parts.push(`Hb: ${vitals.hemoglobin} g/dL`);

  return parts.join(' | ') || 'No vitals recorded';
}
