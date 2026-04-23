// ─────────────────────────────────────────────────────────────
// OCR extraction result types
// These are the structured objects Claude Vision returns
// after reading a scanned/photographed form image.
// ─────────────────────────────────────────────────────────────

export interface OCRPatientData {
  full_name?: string
  age?: string
  date_of_birth?: string      // ISO format: YYYY-MM-DD
  gender?: string             // Female | Male | Other
  mobile?: string
  blood_group?: string        // A+ | A- | B+ | B- | O+ | O- | AB+ | AB-
  address?: string
  abha_id?: string
  aadhaar_no?: string
  emergency_contact_name?: string
  emergency_contact_phone?: string
  mediclaim?: string          // "Yes" | "No"
  cashless?: string           // "Yes" | "No"
  policy_tpa_name?: string    // Insurance company / TPA name
  reference_source?: string   // How patient found us: "Doctor Referral" | "Patient Referral" | "Advertisement" | "Google / Internet" | "Social Media" | "Walk-in" | "Camp / Outreach" | "Other"
  reference_detail?: string   // Specific referral name (e.g. doctor name)
}

export interface OCRVitalsData {
  pulse?: string
  bp_systolic?: string
  bp_diastolic?: string
  temperature?: string
  spo2?: string
  weight?: string
  height?: string
  chief_complaint?: string
  diagnosis?: string
  notes?: string
}

export interface OCROBData {
  lmp?: string                // ISO date
  gravida?: string
  para?: string
  abortion?: string
  living?: string
  fhs?: string
  liquor?: string
  fundal_height?: string
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
  per_vaginum?: string
  right_ovary?: string
  left_ovary?: string

  // ── Menstrual History (NEW) ──────────────────────────────────
  menstrual_regularity?:    string   // "Regular" | "Irregular"
  menstrual_flow?:          string   // "Scanty" | "Normal" | "Heavy"
  post_menstrual_days?:     string   // number of days as string e.g. "3"
  post_menstrual_pain?:     string   // "Mild" | "Moderate" | "Severe"
  urine_pregnancy_result?:  string   // e.g. "Positive", "Negative", "Not done"

  // ── Per-pregnancy obstetric history (NEW) ────────────────────
  obstetric_history?: Array<{
    pregnancy_no?:  string   // "1", "2", "3", "4"
    type?:          string   // "Full Term" | "Preterm"
    delivery_mode?: string   // "Normal" | "CS"
    outcome?:       string   // "Live" | "Expired"
    baby_gender?:   string   // "M" | "F"
    age_of_child?:  string   // e.g. "3 years", "8 months"
  }>

  // ── Abortion details (NEW) ───────────────────────────────────
  abortion_entries?: Array<{
    type?:      string   // "Spontaneous" | "Induced"
    weeks?:     string   // gestational age e.g. "8"
    method?:    string   // "Medicines" | "Surgery"
    years_ago?: string   // how many years back e.g. "2"
  }>

  // ── Past Medical & Surgical History (NEW) ────────────────────
  past_diabetes?:        boolean
  past_hypertension?:    boolean
  past_thyroid?:         boolean
  past_surgery?:         boolean
  past_surgery_detail?:  string

  // ── Socioeconomic / CA Data (NEW) ────────────────────────────
  income?:      string   // monthly income ₹ as string
  expenditure?: string   // monthly expenditure ₹ as string
}

export interface OCRLabData {
  test_name?: string
  result_value?: string
  unit?: string
  reference_range?: string
  remarks?: string
  // For multiple results as free text
  all_results?: string
}

export interface OCRPrescriptionData {
  medications?: Array<{
    drug: string
    dose?: string
    route?: string
    frequency?: string
    duration?: string
    instructions?: string
  }>
  advice?: string
  follow_up_date?: string
}

// Union type — the OCR API returns one of these based on form_type
export type OCRFormType = 'patient_registration' | 'opd_consultation' | 'anc_card' | 'lab_report' | 'prescription'

export interface OCRResult {
  form_type: OCRFormType
  confidence: 'high' | 'medium' | 'low'
  language_detected: string    // e.g. "Gujarati", "English", "Mixed Gujarati-English"
  raw_text: string             // full raw OCR text for debugging
  patient?: OCRPatientData
  vitals?: OCRVitalsData
  ob_data?: OCROBData
  lab?: OCRLabData
  prescription?: OCRPrescriptionData
  unrecognised_fields?: string // anything on the form that didn't map to a known field
}