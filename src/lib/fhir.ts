/**
 * HL7 FHIR R4 Resource Mappers
 * 
 * Converts internal HMS data models to FHIR R4 compliant resources.
 * Spec: https://hl7.org/fhir/R4/
 * 
 * Supported Resources:
 * - Patient (from Patient model)
 * - Encounter (from Encounter model)
 * - Observation (vitals from Encounter)
 * - Condition (diagnosis from Encounter)
 * - MedicationRequest (from Prescription)
 * - Bundle (collection of resources)
 * - Composition (discharge summary)
 */

import type { Patient, Encounter, Prescription, Medication, DischargeSummary } from '@/types'

// ── FHIR Resource Types ──────────────────────────────────────

interface FHIRResource {
  resourceType: string
  id?:          string
  meta?:        { lastUpdated?: string; profile?: string[] }
  [key: string]: any
}

interface FHIRIdentifier {
  system:  string
  value:   string
  type?:   { coding: { system: string; code: string; display: string }[] }
}

interface FHIRReference {
  reference: string
  display?:  string
}

interface FHIRCoding {
  system:   string
  code:     string
  display?: string
}

interface FHIRCodeableConcept {
  coding?: FHIRCoding[]
  text?:   string
}

// ── Constants ────────────────────────────────────────────────

const FHIR_SYSTEMS = {
  ABHA:       'https://healthid.abdm.gov.in',
  AADHAAR:    'https://uidai.gov.in',
  MRN:        'urn:oid:2.16.840.1.113883.2.18',  // India OID for local MRN
  LOINC:      'http://loinc.org',
  SNOMED:     'http://snomed.info/sct',
  ICD10:      'http://hl7.org/fhir/sid/icd-10',
  RXNORM:     'http://www.nlm.nih.gov/research/umls/rxnorm',
  UCUM:       'http://unitsofmeasure.org',
  V3_ROLE:    'http://terminology.hl7.org/CodeSystem/v3-RoleCode',
  ENCOUNTER:  'http://terminology.hl7.org/CodeSystem/v3-ActCode',
  OBS_CAT:    'http://terminology.hl7.org/CodeSystem/observation-category',
  CONDITION:  'http://terminology.hl7.org/CodeSystem/condition-clinical',
  NDHM_PROFILE: 'https://nrces.in/ndhm/fhir/r4/StructureDefinition',
} as const

// ── Patient → FHIR Patient ──────────────────────────────────

export function toFHIRPatient(patient: Patient, hospitalName?: string): FHIRResource {
  const identifiers: FHIRIdentifier[] = [
    {
      system: `${FHIR_SYSTEMS.MRN}/${encodeURIComponent(hospitalName || 'NexMedicon')}`,
      value:  patient.mrn,
      type:   { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'MR', display: 'Medical Record Number' }] },
    },
  ]

  if (patient.abha_id) {
    identifiers.push({
      system: FHIR_SYSTEMS.ABHA,
      value:  patient.abha_id.replace(/[-\s]/g, ''),
      type:   { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'NH', display: 'National Health ID' }] },
    })
  }

  if (patient.aadhaar_no) {
    identifiers.push({
      system: FHIR_SYSTEMS.AADHAAR,
      value:  patient.aadhaar_no.replace(/\s/g, ''),
      type:   { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'NI', display: 'National Identifier' }] },
    })
  }

  const resource: FHIRResource = {
    resourceType: 'Patient',
    id:           patient.id,
    meta: {
      lastUpdated: patient.created_at,
      profile:     [`${FHIR_SYSTEMS.NDHM_PROFILE}/Patient`],
    },
    identifier: identifiers,
    name: [{
      text:   patient.full_name,
      family: patient.full_name.split(' ').pop() || '',
      given:  patient.full_name.split(' ').slice(0, -1),
    }],
    gender: mapGenderToFHIR(patient.gender),
    telecom: [
      { system: 'phone', value: patient.mobile, use: 'mobile' },
    ],
  }

  if (patient.date_of_birth) {
    resource.birthDate = patient.date_of_birth
  }

  if (patient.age && !patient.date_of_birth) {
    resource.extension = [{
      url: 'http://hl7.org/fhir/StructureDefinition/patient-age',
      valueAge: { value: patient.age, unit: 'years', system: FHIR_SYSTEMS.UCUM, code: 'a' },
    }]
  }

  if (patient.blood_group) {
    resource.extension = resource.extension || []
    resource.extension.push({
      url: 'http://hl7.org/fhir/StructureDefinition/patient-bloodGroup',
      valueString: patient.blood_group,
    })
  }

  if (patient.address) {
    resource.address = [{ text: patient.address, use: 'home' }]
  }

  if (patient.emergency_contact_name || patient.emergency_contact_phone) {
    resource.contact = [{
      relationship: [{ coding: [{ system: FHIR_SYSTEMS.V3_ROLE, code: 'ECON', display: 'Emergency Contact' }] }],
      name: patient.emergency_contact_name ? { text: patient.emergency_contact_name } : undefined,
      telecom: patient.emergency_contact_phone ? [{ system: 'phone', value: patient.emergency_contact_phone }] : undefined,
    }]
  }

  return resource
}

// ── Encounter → FHIR Encounter ──────────────────────────────

export function toFHIREncounter(encounter: Encounter, patient: Patient): FHIRResource {
  const resource: FHIRResource = {
    resourceType: 'Encounter',
    id:           encounter.id,
    meta: {
      lastUpdated: encounter.created_at,
      profile:     [`${FHIR_SYSTEMS.NDHM_PROFILE}/Encounter`],
    },
    status: 'finished',
    class: {
      system:  FHIR_SYSTEMS.ENCOUNTER,
      code:    encounter.encounter_type === 'IPD' ? 'IMP' : 'AMB',
      display: encounter.encounter_type === 'IPD' ? 'Inpatient' : 'Ambulatory',
    },
    type: [{
      coding: [{
        system:  FHIR_SYSTEMS.SNOMED,
        code:    encounter.encounter_type === 'IPD' ? '32485007' : '185349003',
        display: encounter.encounter_type === 'IPD' ? 'Hospital admission' : 'Encounter for check up',
      }],
      text: encounter.encounter_type,
    }],
    subject: {
      reference: `Patient/${patient.id}`,
      display:   patient.full_name,
    },
    period: {
      start: encounter.encounter_date,
    },
  }

  if (encounter.chief_complaint) {
    resource.reasonCode = [{
      text: encounter.chief_complaint,
    }]
  }

  if (encounter.doctor_name) {
    resource.participant = [{
      type: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType', code: 'ATND', display: 'Attender' }] }],
      individual: { display: encounter.doctor_name },
    }]
  }

  return resource
}

// ── Vitals → FHIR Observations ──────────────────────────────

interface VitalMapping {
  field:   keyof Encounter
  loinc:   string
  display: string
  unit:    string
  ucum:    string
  snomed?: string
}

const VITAL_MAPPINGS: VitalMapping[] = [
  { field: 'pulse',        loinc: '8867-4',  display: 'Heart rate',                unit: 'bpm',  ucum: '/min'   },
  { field: 'bp_systolic',  loinc: '8480-6',  display: 'Systolic blood pressure',   unit: 'mmHg', ucum: 'mm[Hg]' },
  { field: 'bp_diastolic', loinc: '8462-4',  display: 'Diastolic blood pressure',  unit: 'mmHg', ucum: 'mm[Hg]' },
  { field: 'temperature',  loinc: '8310-5',  display: 'Body temperature',          unit: '°C',   ucum: 'Cel'    },
  { field: 'spo2',         loinc: '2708-6',  display: 'Oxygen saturation',         unit: '%',    ucum: '%'      },
  { field: 'weight',       loinc: '29463-7', display: 'Body weight',               unit: 'kg',   ucum: 'kg'     },
  { field: 'height',       loinc: '8302-2',  display: 'Body height',               unit: 'cm',   ucum: 'cm'     },
]

export function toFHIRVitalObservations(encounter: Encounter, patient: Patient): FHIRResource[] {
  const observations: FHIRResource[] = []

  // Blood pressure as a single composite observation
  if (encounter.bp_systolic || encounter.bp_diastolic) {
    const bpObs: FHIRResource = {
      resourceType: 'Observation',
      id:           `${encounter.id}-bp`,
      meta:         { profile: [`${FHIR_SYSTEMS.NDHM_PROFILE}/Observation`] },
      status:       'final',
      category:     [{ coding: [{ system: FHIR_SYSTEMS.OBS_CAT, code: 'vital-signs', display: 'Vital Signs' }] }],
      code: {
        coding: [{ system: FHIR_SYSTEMS.LOINC, code: '85354-9', display: 'Blood pressure panel' }],
        text: 'Blood Pressure',
      },
      subject:       { reference: `Patient/${patient.id}`, display: patient.full_name },
      encounter:     { reference: `Encounter/${encounter.id}` },
      effectiveDateTime: encounter.encounter_date,
      component: [],
    }
    if (encounter.bp_systolic) {
      bpObs.component.push({
        code: { coding: [{ system: FHIR_SYSTEMS.LOINC, code: '8480-6', display: 'Systolic blood pressure' }] },
        valueQuantity: { value: encounter.bp_systolic, unit: 'mmHg', system: FHIR_SYSTEMS.UCUM, code: 'mm[Hg]' },
      })
    }
    if (encounter.bp_diastolic) {
      bpObs.component.push({
        code: { coding: [{ system: FHIR_SYSTEMS.LOINC, code: '8462-4', display: 'Diastolic blood pressure' }] },
        valueQuantity: { value: encounter.bp_diastolic, unit: 'mmHg', system: FHIR_SYSTEMS.UCUM, code: 'mm[Hg]' },
      })
    }
    observations.push(bpObs)
  }

  // Individual vital signs
  for (const mapping of VITAL_MAPPINGS) {
    if (mapping.field === 'bp_systolic' || mapping.field === 'bp_diastolic') continue // handled above
    const value = encounter[mapping.field]
    if (value == null) continue

    observations.push({
      resourceType: 'Observation',
      id:           `${encounter.id}-${mapping.field}`,
      meta:         { profile: [`${FHIR_SYSTEMS.NDHM_PROFILE}/Observation`] },
      status:       'final',
      category:     [{ coding: [{ system: FHIR_SYSTEMS.OBS_CAT, code: 'vital-signs', display: 'Vital Signs' }] }],
      code: {
        coding: [{ system: FHIR_SYSTEMS.LOINC, code: mapping.loinc, display: mapping.display }],
        text: mapping.display,
      },
      subject:           { reference: `Patient/${patient.id}`, display: patient.full_name },
      encounter:         { reference: `Encounter/${encounter.id}` },
      effectiveDateTime: encounter.encounter_date,
      valueQuantity: {
        value:  value,
        unit:   mapping.unit,
        system: FHIR_SYSTEMS.UCUM,
        code:   mapping.ucum,
      },
    })
  }

  return observations
}

// ── Diagnosis → FHIR Condition ──────────────────────────────

export function toFHIRCondition(encounter: Encounter, patient: Patient): FHIRResource | null {
  if (!encounter.diagnosis) return null

  return {
    resourceType: 'Condition',
    id:           `${encounter.id}-dx`,
    meta:         { profile: [`${FHIR_SYSTEMS.NDHM_PROFILE}/Condition`] },
    clinicalStatus: {
      coding: [{ system: FHIR_SYSTEMS.CONDITION, code: 'active', display: 'Active' }],
    },
    code: {
      text: encounter.diagnosis,
    },
    subject:     { reference: `Patient/${patient.id}`, display: patient.full_name },
    encounter:   { reference: `Encounter/${encounter.id}` },
    recordedDate: encounter.encounter_date,
    note: encounter.notes ? [{ text: encounter.notes }] : undefined,
  }
}

// ── Prescription → FHIR MedicationRequests ──────────────────

export function toFHIRMedicationRequests(
  prescription: Prescription,
  patient: Patient,
  encounter: Encounter
): FHIRResource[] {
  if (!Array.isArray(prescription.medications)) return []

  return prescription.medications.map((med: Medication, idx: number) => ({
    resourceType: 'MedicationRequest',
    id:           `${prescription.id}-med-${idx}`,
    meta:         { profile: [`${FHIR_SYSTEMS.NDHM_PROFILE}/MedicationRequest`] },
    status:       'active',
    intent:       'order',
    medicationCodeableConcept: {
      text: med.drug,
    },
    subject:   { reference: `Patient/${patient.id}`, display: patient.full_name },
    encounter: { reference: `Encounter/${encounter.id}` },
    authoredOn: prescription.created_at,
    dosageInstruction: [{
      text:  `${med.dose} ${med.route} ${med.frequency} for ${med.duration}`,
      route: med.route ? { text: med.route } : undefined,
      timing: med.frequency ? {
        code: { text: med.frequency },
      } : undefined,
      doseAndRate: med.dose ? [{
        doseQuantity: { value: parseFloat(med.dose) || undefined, unit: med.dose },
      }] : undefined,
    }],
    note: med.instructions ? [{ text: med.instructions }] : undefined,
  }))
}

// ── Discharge Summary → FHIR Composition ────────────────────

export function toFHIRComposition(
  discharge: DischargeSummary,
  patient: Patient,
  encounter?: Encounter
): FHIRResource {
  const sections: any[] = []

  if (discharge.clinical_summary) {
    sections.push({
      title: 'Clinical Summary',
      code: { coding: [{ system: FHIR_SYSTEMS.LOINC, code: '51848-0', display: 'Assessment note' }] },
      text: { status: 'generated', div: `<div>${discharge.clinical_summary}</div>` },
    })
  }

  if (discharge.final_diagnosis) {
    sections.push({
      title: 'Diagnosis',
      code: { coding: [{ system: FHIR_SYSTEMS.LOINC, code: '29308-4', display: 'Diagnosis' }] },
      text: { status: 'generated', div: `<div>${discharge.final_diagnosis}${discharge.secondary_diagnosis ? '<br/>Secondary: ' + discharge.secondary_diagnosis : ''}</div>` },
    })
  }

  if (discharge.investigations) {
    sections.push({
      title: 'Investigations',
      code: { coding: [{ system: FHIR_SYSTEMS.LOINC, code: '30954-2', display: 'Relevant diagnostic tests' }] },
      text: { status: 'generated', div: `<div>${discharge.investigations}</div>` },
    })
  }

  if (discharge.treatment_given) {
    sections.push({
      title: 'Treatment Given',
      code: { coding: [{ system: FHIR_SYSTEMS.LOINC, code: '18776-5', display: 'Plan of care note' }] },
      text: { status: 'generated', div: `<div>${discharge.treatment_given}</div>` },
    })
  }

  if (discharge.medications_at_discharge) {
    sections.push({
      title: 'Medications at Discharge',
      code: { coding: [{ system: FHIR_SYSTEMS.LOINC, code: '10183-2', display: 'Hospital discharge medications' }] },
      text: { status: 'generated', div: `<div>${discharge.medications_at_discharge}</div>` },
    })
  }

  if (discharge.discharge_advice || discharge.diet_advice) {
    sections.push({
      title: 'Discharge Advice',
      code: { coding: [{ system: FHIR_SYSTEMS.LOINC, code: '8653-8', display: 'Hospital discharge instructions' }] },
      text: { status: 'generated', div: `<div>${discharge.discharge_advice || ''}${discharge.diet_advice ? '<br/>Diet: ' + discharge.diet_advice : ''}</div>` },
    })
  }

  if (discharge.follow_up_date || discharge.follow_up_note) {
    sections.push({
      title: 'Follow-up',
      code: { coding: [{ system: FHIR_SYSTEMS.LOINC, code: '18776-5', display: 'Plan of care note' }] },
      text: { status: 'generated', div: `<div>${discharge.follow_up_date ? 'Date: ' + discharge.follow_up_date : ''}${discharge.follow_up_note ? '<br/>' + discharge.follow_up_note : ''}</div>` },
    })
  }

  return {
    resourceType: 'Composition',
    id:           discharge.id,
    meta: {
      lastUpdated: discharge.updated_at,
      profile:     [`${FHIR_SYSTEMS.NDHM_PROFILE}/DischargeSummaryRecord`],
    },
    status: discharge.is_final ? 'final' : 'preliminary',
    type: {
      coding: [{ system: FHIR_SYSTEMS.LOINC, code: '18842-5', display: 'Discharge summary' }],
    },
    subject: { reference: `Patient/${patient.id}`, display: patient.full_name },
    encounter: encounter ? { reference: `Encounter/${encounter.id}` } : undefined,
    date:   discharge.updated_at,
    author: discharge.signed_by ? [{ display: discharge.signed_by }] : [],
    title:  'Discharge Summary',
    section: sections,
  }
}

// ── Bundle Builder ──────────────────────────────────────────

export function toFHIRBundle(
  resources: FHIRResource[],
  type: 'document' | 'collection' | 'searchset' = 'collection'
): FHIRResource {
  return {
    resourceType: 'Bundle',
    type,
    timestamp: new Date().toISOString(),
    total:     resources.length,
    entry:     resources.map(r => ({
      fullUrl:  `urn:uuid:${r.id || crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
      resource: r,
    })),
  }
}

// ── Complete Patient Record Bundle ──────────────────────────

export function buildPatientFHIRBundle(
  patient: Patient,
  encounters: Encounter[],
  prescriptions: Prescription[],
  hospitalName?: string
): FHIRResource {
  const resources: FHIRResource[] = []

  // Patient resource
  resources.push(toFHIRPatient(patient, hospitalName))

  // Encounters + vitals + conditions
  for (const enc of encounters) {
    resources.push(toFHIREncounter(enc, patient))
    resources.push(...toFHIRVitalObservations(enc, patient))
    const condition = toFHIRCondition(enc, patient)
    if (condition) resources.push(condition)
  }

  // Prescriptions
  for (const rx of prescriptions) {
    const enc = encounters.find(e => e.id === rx.encounter_id)
    if (enc) {
      resources.push(...toFHIRMedicationRequests(rx, patient, enc))
    }
  }

  return toFHIRBundle(resources, 'collection')
}

// ── Helpers ──────────────────────────────────────────────────

function mapGenderToFHIR(gender?: string): string {
  switch (gender) {
    case 'Male':   return 'male'
    case 'Female': return 'female'
    case 'Other':  return 'other'
    default:       return 'unknown'
  }
}

export function mapFHIRGenderToInternal(fhirGender: string): string {
  switch (fhirGender) {
    case 'male':   return 'Male'
    case 'female': return 'Female'
    case 'other':  return 'Other'
    default:       return 'Other'
  }
}
