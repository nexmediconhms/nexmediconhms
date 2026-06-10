/**
 * src/lib/menstrual-tracking.ts
 *
 * Menstrual cycle tracking and analysis for gynaecological OPD.
 * Period logging, cycle regularity analysis, prediction, symptom tracking.
 *
 * NON-BREAKING: New file.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CycleInput {
  patient_id: string;
  period_start_date: string;     // ISO date
  period_end_date?: string;
  flow_intensity?: 'light' | 'moderate' | 'heavy' | 'very_heavy';
  pad_count_per_day?: number;
  clots?: boolean;
  pain_level?: number;           // 0-10
  pain_type?: string;
  symptoms?: string[];
  medications_taken?: string[];
  spotting_before?: boolean;
  spotting_after?: boolean;
  notes?: string;
  encounter_id?: string;
  recorded_by?: string;
}

export interface MenstrualCycle extends CycleInput {
  id: string;
  duration_days: number | null;
  cycle_length: number | null;
  is_irregular: boolean;
  created_at: string;
  updated_at: string;
}

export interface CycleAnalysis {
  totalCycles: number;
  avgCycleLength: number | null;
  avgDuration: number | null;
  shortestCycle: number | null;
  longestCycle: number | null;
  regularity: 'regular' | 'mildly_irregular' | 'irregular' | 'oligomenorrhea' | 'polymenorrhea' | 'insufficient_data';
  regularityNote: string;
  nextPredictedDate: string | null;
  ovulationWindow: { start: string; end: string } | null;
  alerts: string[];
}

// ─── Symptom Options ────────────────────────────────────────────────────────

export const MENSTRUAL_SYMPTOMS = [
  'Cramps',
  'Back pain',
  'Headache',
  'Bloating',
  'Breast tenderness',
  'Nausea',
  'Fatigue',
  'Mood swings',
  'Irritability',
  'Acne',
  'Diarrhea',
  'Constipation',
  'Dizziness',
  'Hot flashes',
  'Insomnia',
  'Food cravings',
  'Leg pain',
  'Heavy flow',
  'Intermenstrual bleeding',
  'Vaginal discharge',
];

export const FLOW_OPTIONS = [
  { value: 'light', label: 'Light', description: '1-2 pads/day', color: 'text-green-600' },
  { value: 'moderate', label: 'Moderate', description: '3-4 pads/day', color: 'text-blue-600' },
  { value: 'heavy', label: 'Heavy', description: '5-6 pads/day', color: 'text-orange-600' },
  { value: 'very_heavy', label: 'Very Heavy', description: '7+ pads/day or soaking in <2hrs', color: 'text-red-600' },
];

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function logPeriod(
  supabase: SupabaseClient,
  input: CycleInput
): Promise<{ data: MenstrualCycle | null; error: string | null }> {
  try {
    // Calculate duration if both dates provided
    let duration_days: number | null = null;
    if (input.period_start_date && input.period_end_date) {
      const start = new Date(input.period_start_date);
      const end = new Date(input.period_end_date);
      duration_days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    }

    // Calculate cycle_length from previous period
    let cycle_length: number | null = null;
    const { data: prev } = await supabase
      .from('menstrual_cycles')
      .select('period_start_date')
      .eq('patient_id', input.patient_id)
      .lt('period_start_date', input.period_start_date)
      .order('period_start_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (prev) {
      const prevDate = new Date(prev.period_start_date);
      const currDate = new Date(input.period_start_date);
      cycle_length = Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
    }

    // Determine irregularity
    const is_irregular = cycle_length !== null && (cycle_length < 21 || cycle_length > 35);

    const { data, error } = await supabase
      .from('menstrual_cycles')
      .insert({
        ...input,
        duration_days,
        cycle_length,
        is_irregular,
        symptoms: input.symptoms || [],
        medications_taken: input.medications_taken || [],
      })
      .select('*')
      .single();

    if (error) return { data: null, error: error.message };
    return { data: data as MenstrualCycle, error: null };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

export async function updatePeriod(
  supabase: SupabaseClient,
  id: string,
  updates: Partial<CycleInput>
): Promise<{ data: MenstrualCycle | null; error: string | null }> {
  try {
    const updatePayload: Record<string, unknown> = { ...updates };

    // Recalculate duration if dates change
    if (updates.period_start_date && updates.period_end_date) {
      const start = new Date(updates.period_start_date);
      const end = new Date(updates.period_end_date);
      updatePayload.duration_days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    }

    const { data, error } = await supabase
      .from('menstrual_cycles')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .single();

    if (error) return { data: null, error: error.message };
    return { data: data as MenstrualCycle, error: null };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

export async function getPatientCycles(
  supabase: SupabaseClient,
  patientId: string,
  limit = 24
): Promise<{ data: MenstrualCycle[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('menstrual_cycles')
      .select('*')
      .eq('patient_id', patientId)
      .order('period_start_date', { ascending: false })
      .limit(limit);

    if (error) return { data: [], error: error.message };
    return { data: (data || []) as MenstrualCycle[], error: null };
  } catch (err) {
    return { data: [], error: String(err) };
  }
}

// ─── Cycle Analysis ─────────────────────────────────────────────────────────

export function analyzeCycles(cycles: MenstrualCycle[]): CycleAnalysis {
  const result: CycleAnalysis = {
    totalCycles: cycles.length,
    avgCycleLength: null,
    avgDuration: null,
    shortestCycle: null,
    longestCycle: null,
    regularity: 'insufficient_data',
    regularityNote: '',
    nextPredictedDate: null,
    ovulationWindow: null,
    alerts: [],
  };

  if (cycles.length < 2) {
    result.regularityNote = 'Need at least 2 periods logged for analysis';
    return result;
  }

  // Calculate averages from cycles that have cycle_length
  const withLength = cycles.filter(c => c.cycle_length && c.cycle_length > 0);
  const withDuration = cycles.filter(c => c.duration_days && c.duration_days > 0);

  if (withLength.length > 0) {
    const lengths = withLength.map(c => c.cycle_length!);
    result.avgCycleLength = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
    result.shortestCycle = Math.min(...lengths);
    result.longestCycle = Math.max(...lengths);

    const variance = result.longestCycle - result.shortestCycle;

    if (result.avgCycleLength < 21) {
      result.regularity = 'polymenorrhea';
      result.regularityNote = 'Cycles are shorter than normal (< 21 days)';
      result.alerts.push('Short cycles detected — may need hormonal evaluation');
    } else if (result.avgCycleLength > 35) {
      result.regularity = 'oligomenorrhea';
      result.regularityNote = 'Cycles are longer than normal (> 35 days)';
      result.alerts.push('Long cycles detected — consider PCOS/thyroid evaluation');
    } else if (variance <= 7) {
      result.regularity = 'regular';
      result.regularityNote = `Regular cycles (${result.shortestCycle}–${result.longestCycle} days)`;
    } else if (variance <= 14) {
      result.regularity = 'mildly_irregular';
      result.regularityNote = `Mildly irregular (${result.shortestCycle}–${result.longestCycle} days)`;
    } else {
      result.regularity = 'irregular';
      result.regularityNote = `Irregular cycles (${result.shortestCycle}–${result.longestCycle} days, variance ${variance} days)`;
      result.alerts.push('Significant cycle irregularity — may need investigation');
    }

    // Predict next period
    const lastPeriod = cycles[0]; // newest first
    if (lastPeriod.period_start_date) {
      const lastDate = new Date(lastPeriod.period_start_date);
      const predicted = new Date(lastDate.getTime() + result.avgCycleLength * 24 * 60 * 60 * 1000);
      result.nextPredictedDate = predicted.toISOString().split('T')[0];

      // Estimate ovulation window (cycle length - 14, ±2 days)
      const ovDay = result.avgCycleLength - 14;
      const ovStart = new Date(lastDate.getTime() + (ovDay - 2) * 24 * 60 * 60 * 1000);
      const ovEnd = new Date(lastDate.getTime() + (ovDay + 2) * 24 * 60 * 60 * 1000);
      result.ovulationWindow = {
        start: ovStart.toISOString().split('T')[0],
        end: ovEnd.toISOString().split('T')[0],
      };
    }
  }

  if (withDuration.length > 0) {
    const durations = withDuration.map(c => c.duration_days!);
    result.avgDuration = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);

    if (result.avgDuration > 7) {
      result.alerts.push('Average period duration > 7 days — evaluate for menorrhagia');
    }
  }

  // Check for heavy flow pattern
  const heavyCount = cycles.filter(c => c.flow_intensity === 'heavy' || c.flow_intensity === 'very_heavy').length;
  if (heavyCount > cycles.length / 2) {
    result.alerts.push('Consistently heavy flow — consider iron studies and further evaluation');
  }

  return result;
}
