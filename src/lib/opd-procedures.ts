/**
 * src/lib/opd-procedures.ts
 *
 * Helpers for minor OPD procedures performed by gynaecologists.
 * Includes a procedure catalog, templates, and CRUD functions.
 *
 * NON-BREAKING: New file. No existing code modified.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProcedureInput {
  encounter_id: string;
  patient_id: string;
  procedure_name: string;
  procedure_code?: string;
  procedure_category?: string;
  indication?: string;
  technique?: string;
  findings?: string;
  complications?: string;
  specimen_sent?: boolean;
  specimen_details?: string;
  anesthesia_type?: string;
  anesthesia_details?: string;
  materials_used?: Array<{ name: string; quantity?: number }>;
  post_procedure_instructions?: string;
  consent_id?: string;
  doctor_id?: string;
  assistant_id?: string;
  started_at?: string;
  ended_at?: string;
  duration_mins?: number;
  notes?: string;
}

export interface OpdProcedure extends ProcedureInput {
  id: string;
  status: string;
  bill_item_id: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Gynae Procedure Catalog ────────────────────────────────────────────────
// Common gynaecological OPD procedures with default templates

export interface ProcedureCatalogItem {
  code: string;
  name: string;
  category: 'diagnostic' | 'therapeutic' | 'contraception' | 'screening' | 'minor_surgery';
  requiresConsent: boolean;
  consentType: string;
  defaultAnesthesia: string;
  specimenExpected: boolean;
  defaultInstructions: string;
  defaultTechnique: string;
  estimatedDuration: number; // minutes
  billingCode?: string;
}

export const GYNAE_PROCEDURE_CATALOG: ProcedureCatalogItem[] = [
  {
    code: 'PROC-001',
    name: 'IUD Insertion (Copper-T / LNG-IUS)',
    category: 'contraception',
    requiresConsent: true,
    consentType: 'procedure_contraception',
    defaultAnesthesia: 'None',
    specimenExpected: false,
    defaultInstructions: '1. Avoid sexual intercourse for 48 hours\n2. Mild cramping and spotting is normal for 1-2 days\n3. Check for IUD strings after each period\n4. Return if: heavy bleeding, foul-smelling discharge, severe pain, fever\n5. Follow-up visit in 4-6 weeks',
    defaultTechnique: 'Patient in lithotomy position. Cervix visualized with Cusco speculum. Cervix grasped with vulsellum. Uterine sound passed — cavity length measured. IUD loaded in inserter and placed fundally. Threads trimmed to 3 cm. Hemostasis confirmed.',
    estimatedDuration: 15,
  },
  {
    code: 'PROC-002',
    name: 'IUD Removal',
    category: 'contraception',
    requiresConsent: true,
    consentType: 'procedure_contraception',
    defaultAnesthesia: 'None',
    specimenExpected: false,
    defaultInstructions: '1. Mild cramping may occur for a few hours\n2. Light spotting normal for 1-2 days\n3. Discuss alternative contraception if needed\n4. Return if heavy bleeding or fever',
    defaultTechnique: 'Patient in lithotomy position. Cusco speculum inserted. IUD threads identified. Threads grasped with artery forceps and gentle traction applied. IUD removed intact. Cavity checked.',
    estimatedDuration: 10,
  },
  {
    code: 'PROC-003',
    name: 'PAP Smear',
    category: 'screening',
    requiresConsent: true,
    consentType: 'procedure_examination',
    defaultAnesthesia: 'None',
    specimenExpected: true,
    defaultInstructions: '1. Minimal spotting may occur\n2. Avoid intercourse, douching, and tampons for 48 hours\n3. Results expected in 1-2 weeks\n4. Follow-up appointment will be scheduled for results',
    defaultTechnique: 'Patient in lithotomy position. Cusco speculum inserted. Cervix visualized. Endocervical brush and spatula used to collect cells from transformation zone. Smear fixed on glass slide / transferred to liquid-based cytology vial. Labelled and sent to lab.',
    estimatedDuration: 10,
  },
  {
    code: 'PROC-004',
    name: 'Endometrial Biopsy (Pipelle)',
    category: 'diagnostic',
    requiresConsent: true,
    consentType: 'procedure_biopsy',
    defaultAnesthesia: 'Paracervical block (optional)',
    specimenExpected: true,
    defaultInstructions: '1. Cramping may persist for 1-2 hours\n2. Light bleeding/spotting for 2-3 days is normal\n3. Take prescribed analgesic if needed\n4. Avoid intercourse and tampons for 48 hours\n5. Histopathology results expected in 5-7 days\n6. Return if: heavy bleeding, fever, severe pain',
    defaultTechnique: 'Patient in lithotomy position. Cusco speculum inserted. Cervix cleaned with antiseptic. Cervix grasped with vulsellum. Pipelle cannula inserted through cervical os into uterine cavity. Negative pressure created by withdrawing inner piston. Cannula rotated and moved up-down to sample endometrium. Specimen sent for histopathology.',
    estimatedDuration: 15,
  },
  {
    code: 'PROC-005',
    name: 'Colposcopy',
    category: 'diagnostic',
    requiresConsent: true,
    consentType: 'procedure_examination',
    defaultAnesthesia: 'None',
    specimenExpected: false,
    defaultInstructions: '1. Minimal discomfort expected\n2. Brownish discharge for 1-2 days (from acetic acid / iodine)\n3. If biopsy taken: avoid intercourse and tampons for 1 week\n4. Return if heavy bleeding or fever\n5. Results will be discussed at follow-up',
    defaultTechnique: 'Patient in lithotomy position. Cusco speculum inserted. Cervix visualized under colposcope. Saline applied — vascular pattern assessed. 3-5% acetic acid applied — acetowhite areas noted. Lugol iodine applied — Schiller test. Abnormal areas biopsied if indicated. Findings documented per modified Reid Colposcopic Index.',
    estimatedDuration: 20,
  },
  {
    code: 'PROC-006',
    name: 'Colposcopy with Cervical Biopsy',
    category: 'diagnostic',
    requiresConsent: true,
    consentType: 'procedure_biopsy',
    defaultAnesthesia: 'None / Local spray',
    specimenExpected: true,
    defaultInstructions: '1. Avoid intercourse and tampons for 1 week\n2. Light bleeding and brownish discharge for 3-5 days\n3. Avoid heavy lifting for 48 hours\n4. Biopsy results expected in 5-7 days\n5. Return if: heavy bleeding, foul discharge, fever, severe pain',
    defaultTechnique: 'Colposcopy performed as above. Abnormal area identified. Punch biopsy taken from most suspicious area using Tischler biopsy forceps. Hemostasis achieved with Monsel solution. Specimen in formalin sent for histopathology.',
    estimatedDuration: 25,
  },
  {
    code: 'PROC-007',
    name: 'Cervical Cauterization / Cryotherapy',
    category: 'therapeutic',
    requiresConsent: true,
    consentType: 'procedure_treatment',
    defaultAnesthesia: 'None / Local',
    specimenExpected: false,
    defaultInstructions: '1. Watery/blood-tinged discharge for 2-4 weeks\n2. Avoid intercourse and tampons for 4 weeks\n3. No douching\n4. Take prescribed analgesic if cramping occurs\n5. Follow-up PAP smear in 6 months\n6. Return if: heavy bleeding, fever, foul discharge',
    defaultTechnique: 'Patient in lithotomy position. Cervix visualized. Area of cervical ectopy/CIN identified. Cryotherapy probe / electrocautery applied to affected area. Adequate ice-ball / cauterization zone confirmed.',
    estimatedDuration: 15,
  },
  {
    code: 'PROC-008',
    name: 'Diagnostic / Office Hysteroscopy',
    category: 'diagnostic',
    requiresConsent: true,
    consentType: 'procedure_invasive',
    defaultAnesthesia: 'Paracervical block / Conscious sedation',
    specimenExpected: false,
    defaultInstructions: '1. Mild cramping for a few hours\n2. Light spotting for 1-2 days\n3. Avoid intercourse for 48 hours\n4. Take prescribed analgesic\n5. Return if: heavy bleeding, fever, severe pain\n6. Findings will be discussed at follow-up',
    defaultTechnique: 'Patient in lithotomy position. Paracervical block administered. Cervix dilated to 5mm. Hysteroscope introduced with distension medium (normal saline). Systematic inspection of cervical canal, uterine cavity, both ostia. Findings noted. Targeted biopsy if indicated.',
    estimatedDuration: 20,
  },
  {
    code: 'PROC-009',
    name: 'Incision & Drainage (Bartholin Abscess)',
    category: 'minor_surgery',
    requiresConsent: true,
    consentType: 'procedure_surgery',
    defaultAnesthesia: 'Local anesthesia (Lidocaine 2%)',
    specimenExpected: false,
    defaultInstructions: '1. Sitz baths 3-4 times daily for 1 week\n2. Keep area clean and dry\n3. Complete prescribed antibiotics\n4. Mild bleeding and discharge expected for 3-5 days\n5. Word catheter to remain in place for 4-6 weeks\n6. Return if: increasing pain, fever, recurrence',
    defaultTechnique: 'Area cleaned with antiseptic. Local anesthesia infiltrated. Stab incision made on inner mucosal surface of labia minora. Abscess drained. Cavity irrigated with saline. Word catheter / drain placed. Culture swab sent if indicated.',
    estimatedDuration: 20,
  },
  {
    code: 'PROC-010',
    name: 'Cervical Polypectomy',
    category: 'minor_surgery',
    requiresConsent: true,
    consentType: 'procedure_surgery',
    defaultAnesthesia: 'None / Local',
    specimenExpected: true,
    defaultInstructions: '1. Light spotting for 2-3 days\n2. Avoid intercourse and tampons for 1 week\n3. Histopathology results in 5-7 days\n4. Return if heavy bleeding or fever',
    defaultTechnique: 'Patient in lithotomy position. Cusco speculum inserted. Cervical polyp identified and grasped with polyp forceps. Polyp twisted at base and avulsed. Base cauterized if needed. Specimen sent for histopathology.',
    estimatedDuration: 10,
  },
  {
    code: 'PROC-011',
    name: 'Nexplanon / Implanon Insertion',
    category: 'contraception',
    requiresConsent: true,
    consentType: 'procedure_contraception',
    defaultAnesthesia: 'Local anesthesia (Lidocaine 2%)',
    specimenExpected: false,
    defaultInstructions: '1. Keep insertion site dry for 24 hours\n2. Bruising and soreness at site is normal for a few days\n3. Apply pressure bandage for 24 hours, adhesive bandage for 3-5 days\n4. Irregular bleeding pattern is common in first 3-6 months\n5. Effective for 3 years\n6. Return if: implant migration, severe arm pain, signs of infection',
    defaultTechnique: 'Non-dominant upper arm cleaned with antiseptic. Local anesthesia infiltrated subdermally at insertion site. Applicator loaded, needle inserted subdermally at 30° angle. Implant deployed. Palpation confirmed correct placement. Sterile strips and pressure bandage applied.',
    estimatedDuration: 10,
  },
  {
    code: 'PROC-012',
    name: 'Nexplanon / Implanon Removal',
    category: 'contraception',
    requiresConsent: true,
    consentType: 'procedure_contraception',
    defaultAnesthesia: 'Local anesthesia (Lidocaine 2%)',
    specimenExpected: false,
    defaultInstructions: '1. Keep wound dry for 48 hours\n2. Bruising and soreness normal for a few days\n3. Keep adhesive bandage for 3-5 days\n4. Discuss alternative contraception\n5. Return if: signs of infection, persistent bleeding',
    defaultTechnique: 'Implant palpated and marked. Area cleaned. Local anesthesia infiltrated. 2mm incision at distal tip. Implant pushed toward incision and grasped with mosquito forceps. Implant removed intact. Wound closed with sterile strips.',
    estimatedDuration: 15,
  },
];

// ─── CRUD Functions ─────────────────────────────────────────────────────────

export async function createProcedure(
  supabase: SupabaseClient,
  input: ProcedureInput
): Promise<{ data: OpdProcedure | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('opd_procedures')
      .insert({
        ...input,
        materials_used: input.materials_used || [],
        status: 'completed',
      })
      .select('*')
      .single();

    if (error) return { data: null, error: error.message };
    return { data: data as OpdProcedure, error: null };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

export async function updateProcedure(
  supabase: SupabaseClient,
  id: string,
  updates: Partial<ProcedureInput>
): Promise<{ data: OpdProcedure | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('opd_procedures')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) return { data: null, error: error.message };
    return { data: data as OpdProcedure, error: null };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

export async function getEncounterProcedures(
  supabase: SupabaseClient,
  encounterId: string
): Promise<{ data: OpdProcedure[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('opd_procedures')
      .select('*')
      .eq('encounter_id', encounterId)
      .order('created_at', { ascending: true });

    if (error) return { data: [], error: error.message };
    return { data: (data || []) as OpdProcedure[], error: null };
  } catch (err) {
    return { data: [], error: String(err) };
  }
}

export async function getPatientProcedures(
  supabase: SupabaseClient,
  patientId: string,
  limit = 20
): Promise<{ data: OpdProcedure[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('opd_procedures')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return { data: [], error: error.message };
    return { data: (data || []) as OpdProcedure[], error: null };
  } catch (err) {
    return { data: [], error: String(err) };
  }
}

/**
 * Get a catalog item by code for auto-filling the procedure form.
 */
export function getCatalogItem(code: string): ProcedureCatalogItem | undefined {
  return GYNAE_PROCEDURE_CATALOG.find(p => p.code === code);
}

/**
 * Search catalog by name (fuzzy).
 */
export function searchCatalog(query: string): ProcedureCatalogItem[] {
  const q = query.toLowerCase();
  return GYNAE_PROCEDURE_CATALOG.filter(
    p => p.name.toLowerCase().includes(q) || p.category.includes(q)
  );
}
