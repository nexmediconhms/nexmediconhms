/**
 * src/lib/infertility-wizard.ts
 *
 * Step-by-step infertility workup tracker.
 * Guides the doctor through a systematic evaluation pathway.
 *
 * NON-BREAKING: New file.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WorkupInput {
  patient_id: string;
  partner_id?: string;
  encounter_id?: string;
  infertility_type?: 'primary' | 'secondary';
  duration_months?: number;
  female_age?: number;
  male_age?: number;
  doctor_id?: string;
}

export interface InfertilityWorkup extends WorkupInput {
  id: string;
  status: string;
  history_complete: boolean;
  history_data: Record<string, unknown>;
  female_hormonal: Record<string, unknown>;
  female_imaging: Record<string, unknown>;
  female_tubal: Record<string, unknown>;
  male_semen: Record<string, unknown>;
  male_hormonal: Record<string, unknown>;
  additional_tests: Record<string, unknown>;
  diagnosis: Array<{ code: string; label: string }>;
  treatment_plan: string | null;
  treatment_type: string | null;
  treatment_cycles: Array<Record<string, unknown>>;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Workup Steps Definition ────────────────────────────────────────────────

export interface WorkupStep {
  key: string;
  title: string;
  description: string;
  order: number;
  category: 'history' | 'female' | 'male' | 'combined' | 'treatment';
  checklistItems: Array<{
    key: string;
    label: string;
    type: 'checkbox' | 'text' | 'select' | 'date' | 'result';
    options?: string[];
    labCode?: string;    // links to lab catalog
    required?: boolean;
  }>;
}

export const INFERTILITY_WORKUP_STEPS: WorkupStep[] = [
  {
    key: 'history',
    title: 'Detailed History',
    description: 'Complete reproductive and medical history for both partners',
    order: 1,
    category: 'history',
    checklistItems: [
      { key: 'marriage_duration', label: 'Duration of marriage (years)', type: 'text', required: true },
      { key: 'trying_duration', label: 'Duration of trying to conceive (months)', type: 'text', required: true },
      { key: 'previous_pregnancies', label: 'Previous pregnancies (if secondary)', type: 'text' },
      { key: 'menstrual_history', label: 'Menstrual history (regular/irregular/absent)', type: 'select', options: ['Regular', 'Irregular', 'Oligomenorrhea', 'Amenorrhea'] },
      { key: 'coital_history', label: 'Coital frequency and timing', type: 'text' },
      { key: 'contraception_history', label: 'Previous contraception used', type: 'text' },
      { key: 'medical_history_female', label: 'Female medical/surgical history', type: 'text' },
      { key: 'medical_history_male', label: 'Male medical/surgical history', type: 'text' },
      { key: 'family_history', label: 'Family history of infertility', type: 'text' },
      { key: 'lifestyle', label: 'Lifestyle (smoking, alcohol, stress)', type: 'text' },
      { key: 'bmi_female', label: 'Female BMI', type: 'text' },
      { key: 'bmi_male', label: 'Male BMI', type: 'text' },
    ],
  },
  {
    key: 'female_hormonal',
    title: 'Female Hormonal Assessment',
    description: 'Day 2-3 hormonal panel and thyroid function',
    order: 2,
    category: 'female',
    checklistItems: [
      { key: 'fsh', label: 'FSH (Day 2-3)', type: 'result', labCode: 'FSH', required: true },
      { key: 'lh', label: 'LH (Day 2-3)', type: 'result', labCode: 'LH', required: true },
      { key: 'estradiol', label: 'Estradiol (Day 2-3)', type: 'result', labCode: 'E2' },
      { key: 'amh', label: 'AMH (any day)', type: 'result', labCode: 'AMH', required: true },
      { key: 'tsh', label: 'TSH', type: 'result', labCode: 'TSH', required: true },
      { key: 'prolactin', label: 'Prolactin', type: 'result', labCode: 'PRL', required: true },
      { key: 'progesterone', label: 'Day 21 Progesterone (ovulation confirmation)', type: 'result', labCode: 'PROG' },
      { key: 'testosterone', label: 'Testosterone (if PCOS suspected)', type: 'result', labCode: 'TESTO' },
      { key: 'dheas', label: 'DHEA-S (if hirsutism)', type: 'result', labCode: 'DHEAS' },
      { key: 'insulin_fasting', label: 'Fasting Insulin (if PCOS)', type: 'result', labCode: 'INS-F' },
    ],
  },
  {
    key: 'female_imaging',
    title: 'Female Imaging',
    description: 'Ultrasound assessment of ovaries and uterus',
    order: 3,
    category: 'female',
    checklistItems: [
      { key: 'tvs_done', label: 'TVS (Transvaginal Sonography)', type: 'checkbox', required: true },
      { key: 'tvs_date', label: 'TVS Date', type: 'date' },
      { key: 'antral_follicle_count', label: 'AFC (Antral Follicle Count)', type: 'text' },
      { key: 'ovarian_volume_right', label: 'Right ovary volume (ml)', type: 'text' },
      { key: 'ovarian_volume_left', label: 'Left ovary volume (ml)', type: 'text' },
      { key: 'pcos_morphology', label: 'PCOS morphology present?', type: 'select', options: ['No', 'Yes - Right', 'Yes - Left', 'Yes - Both'] },
      { key: 'uterine_cavity', label: 'Uterine cavity', type: 'select', options: ['Normal', 'Fibroid', 'Polyp', 'Septum', 'Adhesions', 'Abnormal'] },
      { key: 'endometrial_thickness', label: 'Endometrial thickness (mm)', type: 'text' },
      { key: 'follicular_tracking', label: 'Follicular monitoring done?', type: 'checkbox' },
      { key: 'follicular_result', label: 'Dominant follicle / ovulation confirmed?', type: 'text' },
    ],
  },
  {
    key: 'female_tubal',
    title: 'Tubal Assessment',
    description: 'Evaluation of fallopian tube patency',
    order: 4,
    category: 'female',
    checklistItems: [
      { key: 'hsg_done', label: 'HSG performed?', type: 'checkbox' },
      { key: 'hsg_date', label: 'HSG Date', type: 'date' },
      { key: 'right_tube', label: 'Right tube', type: 'select', options: ['Patent', 'Blocked - proximal', 'Blocked - distal', 'Hydrosalpinx', 'Not visualized'] },
      { key: 'left_tube', label: 'Left tube', type: 'select', options: ['Patent', 'Blocked - proximal', 'Blocked - distal', 'Hydrosalpinx', 'Not visualized'] },
      { key: 'uterine_cavity_hsg', label: 'Uterine cavity on HSG', type: 'select', options: ['Normal', 'Filling defect', 'Irregular', 'T-shaped'] },
      { key: 'peritoneal_spill', label: 'Free peritoneal spill', type: 'select', options: ['Both sides', 'Right only', 'Left only', 'None'] },
      { key: 'laparoscopy_done', label: 'Diagnostic laparoscopy done?', type: 'checkbox' },
      { key: 'laparoscopy_findings', label: 'Laparoscopy findings', type: 'text' },
    ],
  },
  {
    key: 'male_semen',
    title: 'Male Semen Analysis',
    description: 'Semen analysis (WHO 2021 criteria)',
    order: 5,
    category: 'male',
    checklistItems: [
      { key: 'sa_done', label: 'Semen analysis performed?', type: 'checkbox', required: true },
      { key: 'sa_date', label: 'SA Date', type: 'date' },
      { key: 'abstinence_days', label: 'Days of abstinence', type: 'text' },
      { key: 'volume', label: 'Volume (ml) [≥ 1.4]', type: 'text' },
      { key: 'concentration', label: 'Concentration (million/ml) [≥ 16]', type: 'text' },
      { key: 'total_count', label: 'Total sperm count (million) [≥ 39]', type: 'text' },
      { key: 'motility_progressive', label: 'Progressive motility (%) [≥ 30]', type: 'text' },
      { key: 'motility_total', label: 'Total motility (%) [≥ 42]', type: 'text' },
      { key: 'morphology', label: 'Normal morphology (%) [≥ 4]', type: 'text' },
      { key: 'sa_interpretation', label: 'Interpretation', type: 'select', options: ['Normal', 'Oligozoospermia', 'Asthenozoospermia', 'Teratozoospermia', 'Oligoasthenoteratozoospermia (OAT)', 'Azoospermia', 'Severe OAT'] },
      { key: 'repeat_sa_needed', label: 'Repeat SA needed?', type: 'checkbox' },
    ],
  },
  {
    key: 'diagnosis',
    title: 'Diagnosis & Plan',
    description: 'Final diagnosis and treatment decision',
    order: 6,
    category: 'combined',
    checklistItems: [
      { key: 'primary_diagnosis', label: 'Primary diagnosis', type: 'select', options: [
        'Anovulation / PCOS',
        'Tubal factor',
        'Male factor',
        'Unexplained infertility',
        'Endometriosis',
        'Uterine factor (fibroid/polyp/septum)',
        'Diminished ovarian reserve',
        'Combined male + female factor',
        'Hyperprolactinemia',
        'Thyroid dysfunction',
        'Other',
      ]},
      { key: 'secondary_diagnosis', label: 'Secondary diagnosis (if any)', type: 'text' },
      { key: 'treatment_decision', label: 'Treatment decision', type: 'select', options: [
        'Ovulation induction (OI)',
        'OI + Timed intercourse (TI)',
        'OI + IUI',
        'IVF/ICSI',
        'Surgery first then reassess',
        'Lifestyle modification + watchful waiting',
        'Refer to IVF center',
        'Donor program',
        'Other',
      ]},
      { key: 'treatment_notes', label: 'Treatment notes', type: 'text' },
    ],
  },
];

// ─── Completion Tracker ─────────────────────────────────────────────────────

export function getWorkupProgress(workup: InfertilityWorkup): {
  steps: Array<{ key: string; title: string; completed: boolean; percentage: number }>;
  overallPercentage: number;
} {
  const steps = INFERTILITY_WORKUP_STEPS.map(step => {
    let filled = 0;
    let total = step.checklistItems.length;

    const dataSource = (() => {
      switch (step.key) {
        case 'history': return workup.history_data;
        case 'female_hormonal': return workup.female_hormonal;
        case 'female_imaging': return workup.female_imaging;
        case 'female_tubal': return workup.female_tubal;
        case 'male_semen': return workup.male_semen;
        case 'diagnosis': return workup.diagnosis?.length > 0 ? { primary_diagnosis: 'set' } : {};
        default: return {};
      }
    })();

    for (const item of step.checklistItems) {
      const val = (dataSource as Record<string, unknown>)?.[item.key];
      if (val !== null && val !== undefined && val !== '' && val !== false) {
        filled++;
      }
    }

    const percentage = total > 0 ? Math.round((filled / total) * 100) : 0;

    return {
      key: step.key,
      title: step.title,
      completed: percentage === 100,
      percentage,
    };
  });

  const overallPercentage = Math.round(
    steps.reduce((sum, s) => sum + s.percentage, 0) / steps.length
  );

  return { steps, overallPercentage };
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function createWorkup(
  supabase: SupabaseClient,
  input: WorkupInput
): Promise<{ data: InfertilityWorkup | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('infertility_workups')
      .insert({
        ...input,
        status: 'in_progress',
      })
      .select('*')
      .single();

    if (error) return { data: null, error: error.message };
    return { data: data as InfertilityWorkup, error: null };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

export async function updateWorkupStep(
  supabase: SupabaseClient,
  workupId: string,
  stepKey: string,
  stepData: Record<string, unknown>
): Promise<{ error: string | null }> {
  try {
    const columnMap: Record<string, string> = {
      history: 'history_data',
      female_hormonal: 'female_hormonal',
      female_imaging: 'female_imaging',
      female_tubal: 'female_tubal',
      male_semen: 'male_semen',
      male_hormonal: 'male_hormonal',
      additional_tests: 'additional_tests',
    };

    const column = columnMap[stepKey];
    if (!column) return { error: `Unknown step: ${stepKey}` };

    const updatePayload: Record<string, unknown> = { [column]: stepData };

    if (stepKey === 'history') {
      updatePayload.history_complete = true;
    }

    const { error } = await supabase
      .from('infertility_workups')
      .update(updatePayload)
      .eq('id', workupId);

    return { error: error?.message || null };
  } catch (err) {
    return { error: String(err) };
  }
}

export async function getPatientWorkups(
  supabase: SupabaseClient,
  patientId: string
): Promise<{ data: InfertilityWorkup[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('infertility_workups')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });

    if (error) return { data: [], error: error.message };
    return { data: (data || []) as InfertilityWorkup[], error: null };
  } catch (err) {
    return { data: [], error: String(err) };
  }
}
