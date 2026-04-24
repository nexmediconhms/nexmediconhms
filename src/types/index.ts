export interface Patient {
  id: string
  mrn: string
  full_name: string
  date_of_birth?: string
  age?: number
  gender?: string
  mobile: string
  blood_group?: string
  address?: string
  abha_id?: string
  aadhaar_no?: string
  emergency_contact_name?: string
  emergency_contact_phone?: string
  mediclaim?: boolean
  cashless?: boolean
  reference_source?: string
  // ── Insurance policy details (added v12) ─────────────────────
  policy_tpa_name?: string   // e.g. "Medi Assist", "Star Health"
  policy_number?:   string   // actual policy / card number
  created_at: string
}

export interface Procedure {
  name: string
  indication?: string
  findings?: string
  complications?: string
  surgeon?: string
  anaesthesia?: string
  notes?: string
}

export interface Encounter {
  id: string
  patient_id: string
  encounter_date: string
  encounter_type: string
  chief_complaint?: string
  pulse?: number
  bp_systolic?: number
  bp_diastolic?: number
  temperature?: number
  spo2?: number
  weight?: number
  height?: number
  diagnosis?: string
  notes?: string
  ob_data?: OBData
  procedures?: Procedure[]
  doctor_name?: string
  created_at: string
  patients?: Patient
}

export interface ObstetricEntry {
  pregnancy_no:   number
  type:           'Full Term' | 'Preterm' | ''
  delivery_mode?: 'Normal' | 'CS' | ''
  outcome?:       'Live' | 'Expired' | ''
  baby_gender?:   'M' | 'F' | ''
  age_of_child?:  string
}

export interface AbortionEntry {
  type?:      'Spontaneous' | 'Induced' | ''
  weeks?:     string
  method?:    'Medicines' | 'Surgery' | ''
  years_ago?: string
}

export interface OBData {
  lmp?: string
  edd?: string
  gestational_age?: string
  gravida?: number
  para?: number
  abortion?: number
  living?: number
  fhs?: number
  liquor?: string
  fundal_height?: number
  presentation?: string
  engagement?: string
  uterus_size?: string
  scar_tenderness?: string
  fetal_movement?: string
  per_abdomen?: string
  cervix_speculum?: string
  discharge_speculum?: string
  bleeding_speculum?: string
  per_speculum?: string
  cervix_pv?: string
  os_pv?: string
  uterus_position?: string
  adnexa?: string
  per_vaginum?: string
  right_ovary?: string
  left_ovary?: string
  previous_cs?: number
  multiple_pregnancy?: boolean
  gestational_diabetes?: boolean
  haemoglobin?: number
  blood_sugar_fasting?: number
  blood_sugar_pp?: number
  usg_date?: string
  usg_ga?: string
  bpd?: number
  hc?: number
  ac?: number
  fl?: number
  efw?: number
  afi?: number
  placenta?: string
  placenta_grade?: string
  cord_loops?: string
  usg_remarks?: string
  menstrual_regularity?:     'Regular' | 'Irregular' | ''
  menstrual_flow?:           'Scanty' | 'Normal' | 'Heavy' | ''
  post_menstrual_days?:      string
  post_menstrual_pain?:      'Mild' | 'Moderate' | 'Severe' | ''
  urine_pregnancy_result?:   string
  obstetric_history?:        ObstetricEntry[]
  abortion_entries?:         AbortionEntry[]
  past_diabetes?:            boolean
  past_hypertension?:        boolean
  past_thyroid?:             boolean
  past_surgery?:             boolean
  past_surgery_detail?:      string
  income?:                   string
  expenditure?:              string
}

export interface Medication {
  drug: string
  dose: string
  route: string
  frequency: string
  duration: string
  instructions?: string
}

export interface Prescription {
  id: string
  encounter_id: string
  patient_id: string
  medications: Medication[]
  advice?: string
  dietary_advice?: string
  reports_needed?: string
  follow_up_date?: string
  created_at: string
  patients?: Patient
  encounters?: Encounter
}

export interface Bed {
  id: string
  bed_number: string
  ward: string
  status: 'available' | 'occupied' | 'cleaning' | 'reserved'
  patient_id?: string
  patient_name?: string
  admission_date?: string
  expected_discharge?: string
}

export interface DischargeSummary {
  id: string
  patient_id: string
  admission_date?: string
  discharge_date?: string
  final_diagnosis?: string
  secondary_diagnosis?: string
  clinical_summary?: string
  investigations?: string
  treatment_given?: string
  condition_at_discharge?: string
  discharge_advice?: string
  diet_advice?: string
  medications_at_discharge?: string
  follow_up_date?: string
  follow_up_note?: string
  delivery_type?: string
  baby_sex?: string
  baby_weight?: string
  baby_birth_time?: string
  apgar_score?: string
  delivery_date?: string
  complications?: string
  lactation_advice?: string
  version: number
  is_final: boolean
  signed_by?: string
  updated_at: string
  encounter_id?: string
}