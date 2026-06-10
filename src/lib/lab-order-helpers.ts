/**
 * src/lib/lab-order-helpers.ts
 *
 * Lab order management — ordering from OPD, tracking,
 * result linkage, and common gynaecology test catalog.
 *
 * NON-BREAKING: New file. Existing labs page untouched.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LabOrderInput {
  patient_id: string;
  encounter_id?: string;
  test_name: string;
  test_code?: string;
  test_category?: string;
  urgency?: 'routine' | 'urgent' | 'stat';
  clinical_notes?: string;
  ordered_by?: string;
  lab_partner_id?: string;
}

export interface LabOrder extends LabOrderInput {
  id: string;
  ordered_at: string;
  status: string;
  sample_collected: boolean;
  sample_collected_at: string | null;
  sent_to_lab: boolean;
  sent_to_lab_at: string | null;
  result_received: boolean;
  result_received_at: string | null;
  result_id: string | null;
  is_abnormal: boolean | null;
  doctor_reviewed: boolean;
  doctor_reviewed_at: string | null;
  bill_item_id: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Lab Order Status Flow ──────────────────────────────────────────────────

export const LAB_ORDER_STATUS = {
  ORDERED: 'ordered',
  SAMPLE_COLLECTED: 'sample_collected',
  SENT_TO_LAB: 'sent_to_lab',
  IN_PROGRESS: 'in_progress',
  RESULT_AVAILABLE: 'result_available',
  REVIEWED: 'reviewed',
  CANCELLED: 'cancelled',
} as const;

export const LAB_STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: string }> = {
  ordered:          { label: 'Ordered',          color: 'text-blue-700',   bgColor: 'bg-blue-50',   icon: '📋' },
  sample_collected: { label: 'Sample Collected', color: 'text-orange-700', bgColor: 'bg-orange-50', icon: '🧪' },
  sent_to_lab:      { label: 'Sent to Lab',      color: 'text-purple-700', bgColor: 'bg-purple-50', icon: '📤' },
  in_progress:      { label: 'In Progress',      color: 'text-yellow-700', bgColor: 'bg-yellow-50', icon: '⏳' },
  result_available: { label: 'Result Available',  color: 'text-green-700',  bgColor: 'bg-green-50',  icon: '✅' },
  reviewed:         { label: 'Reviewed',          color: 'text-gray-700',   bgColor: 'bg-gray-100',  icon: '👁' },
  cancelled:        { label: 'Cancelled',         color: 'text-gray-400',   bgColor: 'bg-gray-50',   icon: '❌' },
};

// ─── Common Gynaecology Lab Test Catalog ─────────────────────────────────────

export interface LabTestCatalogItem {
  code: string;
  name: string;
  category: string;
  shortName?: string;
  sampleType: string;
  turnaround: string;       // expected TAT
  fasting: boolean;
  commonFor: string[];       // when typically ordered
}

export const GYNAE_LAB_CATALOG: LabTestCatalogItem[] = [
  // Routine Antenatal
  { code: 'CBC', name: 'Complete Blood Count', category: 'Hematology', shortName: 'CBC', sampleType: 'EDTA blood', turnaround: 'Same day', fasting: false, commonFor: ['anc_booking', 'anemia', 'infection'] },
  { code: 'BG-RH', name: 'Blood Group & Rh Typing', category: 'Blood Bank', sampleType: 'EDTA blood', turnaround: 'Same day', fasting: false, commonFor: ['anc_booking'] },
  { code: 'RBS', name: 'Random Blood Sugar', category: 'Biochemistry', sampleType: 'Fluoride blood', turnaround: '1 hour', fasting: false, commonFor: ['anc_booking', 'gdm_screening'] },
  { code: 'FBS', name: 'Fasting Blood Sugar', category: 'Biochemistry', sampleType: 'Fluoride blood', turnaround: '1 hour', fasting: true, commonFor: ['gdm_screening', 'pcos'] },
  { code: 'PPBS', name: 'Post Prandial Blood Sugar', category: 'Biochemistry', sampleType: 'Fluoride blood', turnaround: '1 hour', fasting: false, commonFor: ['gdm_screening'] },
  { code: 'GTT', name: 'Glucose Tolerance Test (75g OGTT)', category: 'Biochemistry', sampleType: 'Fluoride blood (3 samples)', turnaround: 'Same day', fasting: true, commonFor: ['gdm_screening'] },
  { code: 'HBA1C', name: 'Glycosylated Hemoglobin (HbA1c)', category: 'Biochemistry', sampleType: 'EDTA blood', turnaround: 'Same day', fasting: false, commonFor: ['gdm_monitoring', 'pcos'] },
  { code: 'TSH', name: 'Thyroid Stimulating Hormone', category: 'Endocrine', sampleType: 'Serum', turnaround: 'Same day', fasting: false, commonFor: ['anc_booking', 'infertility', 'pcos', 'menstrual_disorder'] },
  { code: 'FT3-FT4', name: 'Free T3 & Free T4', category: 'Endocrine', sampleType: 'Serum', turnaround: 'Same day', fasting: false, commonFor: ['thyroid_disorder'] },
  { code: 'URINE-R', name: 'Urine Routine & Microscopy', category: 'Urine', sampleType: 'Mid-stream urine', turnaround: '1 hour', fasting: false, commonFor: ['anc_booking', 'uti', 'preeclampsia'] },
  { code: 'URINE-CS', name: 'Urine Culture & Sensitivity', category: 'Microbiology', sampleType: 'Mid-stream urine (sterile)', turnaround: '48-72 hours', fasting: false, commonFor: ['uti', 'recurrent_uti'] },
  { code: 'HIV', name: 'HIV I & II (ELISA)', category: 'Serology', sampleType: 'Serum', turnaround: 'Same day', fasting: false, commonFor: ['anc_booking', 'pre_surgical'] },
  { code: 'HBSAG', name: 'Hepatitis B Surface Antigen', category: 'Serology', sampleType: 'Serum', turnaround: 'Same day', fasting: false, commonFor: ['anc_booking', 'pre_surgical'] },
  { code: 'HCV', name: 'Hepatitis C Antibody', category: 'Serology', sampleType: 'Serum', turnaround: 'Same day', fasting: false, commonFor: ['anc_booking', 'pre_surgical'] },
  { code: 'VDRL', name: 'VDRL / RPR (Syphilis)', category: 'Serology', sampleType: 'Serum', turnaround: 'Same day', fasting: false, commonFor: ['anc_booking'] },
  { code: 'TORCH', name: 'TORCH Panel (IgG + IgM)', category: 'Serology', sampleType: 'Serum', turnaround: '1-2 days', fasting: false, commonFor: ['anc_booking', 'bad_obstetric_history'] },

  // Hormonal
  { code: 'FSH', name: 'Follicle Stimulating Hormone', category: 'Endocrine', sampleType: 'Serum', turnaround: 'Same day', fasting: false, commonFor: ['infertility', 'menopause', 'pcos'] },
  { code: 'LH', name: 'Luteinizing Hormone', category: 'Endocrine', sampleType: 'Serum', turnaround: 'Same day', fasting: false, commonFor: ['infertility', 'pcos'] },
  { code: 'E2', name: 'Estradiol (E2)', category: 'Endocrine', sampleType: 'Serum', turnaround: 'Same day', fasting: false, commonFor: ['infertility', 'menopause'] },
  { code: 'PROG', name: 'Serum Progesterone', category: 'Endocrine', sampleType: 'Serum', turnaround: 'Same day', fasting: false, commonFor: ['infertility', 'luteal_phase'] },
  { code: 'PRL', name: 'Serum Prolactin', category: 'Endocrine', sampleType: 'Serum', turnaround: 'Same day', fasting: false, commonFor: ['infertility', 'amenorrhea', 'galactorrhea'] },
  { code: 'AMH', name: 'Anti-Mullerian Hormone', category: 'Endocrine', sampleType: 'Serum', turnaround: '1-2 days', fasting: false, commonFor: ['infertility', 'ovarian_reserve'] },
  { code: 'TESTO', name: 'Total & Free Testosterone', category: 'Endocrine', sampleType: 'Serum', turnaround: '1-2 days', fasting: false, commonFor: ['pcos', 'hirsutism'] },
  { code: 'DHEAS', name: 'DHEA-Sulfate', category: 'Endocrine', sampleType: 'Serum', turnaround: '1-2 days', fasting: false, commonFor: ['pcos', 'hirsutism', 'adrenal'] },
  { code: 'INS-F', name: 'Fasting Insulin', category: 'Endocrine', sampleType: 'Serum', turnaround: '1-2 days', fasting: true, commonFor: ['pcos', 'insulin_resistance'] },

  // Pregnancy-specific
  { code: 'BHCG', name: 'Beta hCG (Quantitative)', category: 'Endocrine', sampleType: 'Serum', turnaround: 'Same day', fasting: false, commonFor: ['pregnancy_confirmation', 'ectopic', 'molar'] },
  { code: 'DUAL', name: 'Dual Marker (PAPP-A + Free Beta hCG)', category: 'Prenatal Screening', sampleType: 'Serum', turnaround: '3-5 days', fasting: false, commonFor: ['anc_first_trimester'] },
  { code: 'QUAD', name: 'Quadruple Marker Screen', category: 'Prenatal Screening', sampleType: 'Serum', turnaround: '3-5 days', fasting: false, commonFor: ['anc_second_trimester'] },
  { code: 'ICT', name: 'Indirect Coombs Test', category: 'Blood Bank', sampleType: 'Serum', turnaround: 'Same day', fasting: false, commonFor: ['rh_negative_pregnancy'] },
  { code: 'COAG', name: 'Coagulation Profile (PT/INR/aPTT)', category: 'Hematology', sampleType: 'Citrated blood', turnaround: 'Same day', fasting: false, commonFor: ['pre_surgical', 'pih', 'hellp'] },

  // Cancer screening
  { code: 'PAP', name: 'PAP Smear (Cytology)', category: 'Cytology', shortName: 'PAP', sampleType: 'Cervical cells', turnaround: '5-7 days', fasting: false, commonFor: ['cervical_screening'] },
  { code: 'HPV-DNA', name: 'HPV DNA Test', category: 'Molecular', sampleType: 'Cervical swab', turnaround: '5-7 days', fasting: false, commonFor: ['cervical_screening'] },
  { code: 'CA125', name: 'CA-125', category: 'Tumor Marker', sampleType: 'Serum', turnaround: '1-2 days', fasting: false, commonFor: ['ovarian_mass', 'endometriosis'] },

  // Infection
  { code: 'HVS', name: 'High Vaginal Swab (Culture)', category: 'Microbiology', sampleType: 'Vaginal swab', turnaround: '48-72 hours', fasting: false, commonFor: ['vaginitis', 'discharge'] },
  { code: 'GBS', name: 'Group B Streptococcus Screen', category: 'Microbiology', sampleType: 'Vaginal-rectal swab', turnaround: '48 hours', fasting: false, commonFor: ['anc_35_37_weeks'] },
];

// ─── Lab Order Panels (Pre-defined groups) ──────────────────────────────────

export const LAB_PANELS: Record<string, { name: string; tests: string[] }> = {
  anc_booking: {
    name: 'ANC Booking Panel',
    tests: ['CBC', 'BG-RH', 'RBS', 'TSH', 'URINE-R', 'HIV', 'HBSAG', 'VDRL'],
  },
  anc_first_trimester: {
    name: 'First Trimester Screening',
    tests: ['DUAL', 'TSH', 'FBS', 'URINE-R'],
  },
  anc_second_trimester: {
    name: 'Second Trimester Panel',
    tests: ['QUAD', 'GTT', 'CBC', 'URINE-R'],
  },
  anc_third_trimester: {
    name: 'Third Trimester Panel',
    tests: ['CBC', 'COAG', 'RBS', 'URINE-R', 'GBS'],
  },
  pcos_workup: {
    name: 'PCOS Workup',
    tests: ['FSH', 'LH', 'TESTO', 'DHEAS', 'TSH', 'INS-F', 'FBS', 'HBA1C', 'PRL'],
  },
  infertility_basic: {
    name: 'Infertility Basic Workup',
    tests: ['FSH', 'LH', 'E2', 'PRL', 'TSH', 'AMH'],
  },
  pre_surgical: {
    name: 'Pre-Surgical Panel',
    tests: ['CBC', 'BG-RH', 'RBS', 'COAG', 'HIV', 'HBSAG', 'HCV', 'URINE-R'],
  },
  cervical_screening: {
    name: 'Cervical Screening',
    tests: ['PAP', 'HPV-DNA'],
  },
};

// ─── CRUD Functions ─────────────────────────────────────────────────────────

export async function createLabOrder(
  supabase: SupabaseClient,
  input: LabOrderInput
): Promise<{ data: LabOrder | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('lab_orders')
      .insert({
        ...input,
        status: 'ordered',
        ordered_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error) return { data: null, error: error.message };
    return { data: data as LabOrder, error: null };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

/**
 * Create multiple lab orders at once (e.g., from a panel).
 */
export async function createLabOrderBatch(
  supabase: SupabaseClient,
  orders: LabOrderInput[]
): Promise<{ data: LabOrder[]; errors: string[] }> {
  const results: LabOrder[] = [];
  const errors: string[] = [];

  for (const order of orders) {
    const result = await createLabOrder(supabase, order);
    if (result.data) results.push(result.data);
    if (result.error) errors.push(`${order.test_name}: ${result.error}`);
  }

  return { data: results, errors };
}

export async function updateLabOrderStatus(
  supabase: SupabaseClient,
  id: string,
  status: string,
  extra: Record<string, unknown> = {}
): Promise<{ data: LabOrder | null; error: string | null }> {
  try {
    const updates: Record<string, unknown> = { status, ...extra };

    // Auto-set timestamps
    if (status === 'sample_collected') {
      updates.sample_collected = true;
      updates.sample_collected_at = new Date().toISOString();
    }
    if (status === 'sent_to_lab') {
      updates.sent_to_lab = true;
      updates.sent_to_lab_at = new Date().toISOString();
    }
    if (status === 'result_available') {
      updates.result_received = true;
      updates.result_received_at = new Date().toISOString();
    }
    if (status === 'reviewed') {
      updates.doctor_reviewed = true;
      updates.doctor_reviewed_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('lab_orders')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) return { data: null, error: error.message };
    return { data: data as LabOrder, error: null };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

export async function getEncounterLabOrders(
  supabase: SupabaseClient,
  encounterId: string
): Promise<{ data: LabOrder[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('lab_orders')
      .select('*')
      .eq('encounter_id', encounterId)
      .order('ordered_at', { ascending: true });

    if (error) return { data: [], error: error.message };
    return { data: (data || []) as LabOrder[], error: null };
  } catch (err) {
    return { data: [], error: String(err) };
  }
}

export async function getPatientLabOrders(
  supabase: SupabaseClient,
  patientId: string,
  options: { status?: string; limit?: number } = {}
): Promise<{ data: LabOrder[]; error: string | null }> {
  try {
    let query = supabase
      .from('lab_orders')
      .select('*')
      .eq('patient_id', patientId)
      .order('ordered_at', { ascending: false })
      .limit(options.limit || 50);

    if (options.status) query = query.eq('status', options.status);

    const { data, error } = await query;
    if (error) return { data: [], error: error.message };
    return { data: (data || []) as LabOrder[], error: null };
  } catch (err) {
    return { data: [], error: String(err) };
  }
}

/**
 * Get pending lab orders (ordered but results not yet received).
 * Useful for doctor's dashboard "Awaiting Results" widget.
 */
export async function getPendingLabOrders(
  supabase: SupabaseClient,
  doctorId?: string
): Promise<{ data: LabOrder[]; error: string | null }> {
  try {
    let query = supabase
      .from('lab_orders')
      .select('*, patients(id, name, phone, mrn)')
      .in('status', ['ordered', 'sample_collected', 'sent_to_lab', 'in_progress'])
      .order('ordered_at', { ascending: true });

    if (doctorId) query = query.eq('ordered_by', doctorId);

    const { data, error } = await query;
    if (error) return { data: [], error: error.message };
    return { data: (data || []) as LabOrder[], error: null };
  } catch (err) {
    return { data: [], error: String(err) };
  }
}

/**
 * Get catalog item by code.
 */
export function getLabTestInfo(code: string): LabTestCatalogItem | undefined {
  return GYNAE_LAB_CATALOG.find(t => t.code === code);
}

/**
 * Search lab catalog by name (fuzzy).
 */
export function searchLabCatalog(query: string): LabTestCatalogItem[] {
  const q = query.toLowerCase();
  return GYNAE_LAB_CATALOG.filter(
    t => t.name.toLowerCase().includes(q) ||
         t.code.toLowerCase().includes(q) ||
         (t.shortName && t.shortName.toLowerCase().includes(q)) ||
         t.category.toLowerCase().includes(q)
  );
}

/**
 * Get tests for a panel by panel key.
 */
export function getLabPanel(panelKey: string): { name: string; tests: LabTestCatalogItem[] } | null {
  const panel = LAB_PANELS[panelKey];
  if (!panel) return null;
  const tests = panel.tests
    .map(code => GYNAE_LAB_CATALOG.find(t => t.code === code))
    .filter(Boolean) as LabTestCatalogItem[];
  return { name: panel.name, tests };
}
