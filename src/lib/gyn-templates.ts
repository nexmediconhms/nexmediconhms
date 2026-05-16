// src/lib/gyn-templates.ts
export const GYN_OPD_TEMPLATE = {
  chiefComplaint: '',
  menstrualHistory: {
    lmp: '',
    cycleLength: '28',
    cycleDuration: '5',
    flow: 'normal', // scanty | normal | heavy
    dysmenorrhea: false,
    irregular: false,
  },
  obstetricHistory: {
    gravida: 0, para: 0, abortion: 0, living: 0,
    lastDeliveryType: '', // normal | LSCS | forceps
  },
  contraceptive: '',
  clinicalExamination: {
    uterusSize: '',
    adnexa: 'Normal',
    discharge: 'Nil',
    cervix: 'Healthy',
  },
  commonDiagnoses: [
    'Irregular menstrual cycle',
    'Polycystic ovarian disease (PCOD)',
    'Uterine fibroid',
    'Pelvic inflammatory disease (PID)',
    'Urinary tract infection (UTI)',
    'Cervicitis',
    'Primary dysmenorrhea',
    'Menorrhagia',
    'Amenorrhea',
    'Vaginitis',
  ],
  commonMedications: [
    { drug: 'Norethisterone 5mg', dose: '1 tab', frequency: 'TDS', duration: '5 days' },
    { drug: 'Mefenamic Acid 500mg', dose: '1 tab', frequency: 'TDS', duration: '3 days', instructions: 'After food' },
    { drug: 'Metronidazole 400mg', dose: '1 tab', frequency: 'TDS', duration: '5 days' },
    { drug: 'Fluconazole 150mg', dose: '1 tab', frequency: 'Single dose', duration: '1 day' },
    { drug: 'Folic Acid 5mg', dose: '1 tab', frequency: 'OD', duration: '3 months' },
    { drug: 'Iron + Folic Acid', dose: '1 tab', frequency: 'OD', duration: '3 months' },
  ],
}

export const GYN_DISCHARGE_TEMPLATE = {
  sections: [
    { key: 'finaldiagnosis',        label: 'Final Diagnosis',          required: true  },
    { key: 'secondarydiagnosis',    label: 'Secondary Diagnosis',      required: false },
    { key: 'clinicalsummary',       label: 'Clinical Summary',         required: true  },
    { key: 'investigations',        label: 'Investigations Done',      required: false },
    { key: 'treatmentgiven',        label: 'Treatment Given',          required: true  },
    { key: 'conditionatdischarge',  label: 'Condition at Discharge',   required: true  },
    { key: 'dischargeadvice',       label: 'Discharge Advice',         required: true  },
    { key: 'medicationsatdischarge',label: 'Medications at Discharge', required: true  },
    { key: 'dietadvice',            label: 'Diet Advice',              required: false },
    { key: 'followupdate',          label: 'Follow-up Date',           required: true  },
    // Obstetric-specific (shown only for delivery cases)
    { key: 'deliverytype',          label: 'Delivery Type',            obstetric: true },
    { key: 'babysex',               label: 'Baby Sex',                 obstetric: true },
    { key: 'babyweight',            label: 'Baby Weight (kg)',         obstetric: true },
    { key: 'apgarscore',            label: 'APGAR Score',              obstetric: true },
    { key: 'babybirthtime',         label: 'Time of Birth',            obstetric: true },
    { key: 'complications',         label: 'Complications',            obstetric: true },
    { key: 'lactationadvice',       label: 'Lactation Advice',         obstetric: true },
  ],
  quickFillOptions: {
    conditionatdischarge: ['Satisfactory', 'Stable', 'Fair', 'Poor', 'Critical'],
    dietadvice: [
      'High protein diet. Avoid spicy food for 2 weeks.',
      'Iron and calcium rich diet. Adequate fluid intake.',
      'Light diet. Small frequent meals.',
    ],
    dischargeadvice: [
      'Rest for 2 weeks. Avoid heavy lifting.',
      'Suture removal after 7 days.',
      'Report immediately if fever, bleeding, or severe pain.',
      'Exclusive breastfeeding. Wash hands before feeding.',
    ],
    deliverytype: ['Normal Vaginal Delivery', 'LSCS - Elective', 'LSCS - Emergency', 'Forceps Delivery', 'Vacuum Delivery'],
  }
}