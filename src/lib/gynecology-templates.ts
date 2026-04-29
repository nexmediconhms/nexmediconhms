/**
 * src/lib/gynecology-templates.ts
 *
 * 20 Gynecology Consultation Templates
 *
 * Pre-filled templates for common gynecology conditions.
 * Doctor selects a template → form auto-fills with:
 *   - Chief complaint
 *   - Typical diagnosis
 *   - Standard medications
 *   - Recommended investigations
 *   - Standard advice
 *
 * Templates are evidence-based and follow Indian gynecology practice.
 */

import type { Medication } from '@/types'

// ─── Types ────────────────────────────────────────────────────

export interface ConsultationTemplate {
  id: string
  name: string
  category: 'ANC' | 'Gynecology' | 'Infertility' | 'Emergency' | 'Postpartum' | 'Adolescent'
  chiefComplaint: string
  diagnosis: string
  notes: string
  medications: Medication[]
  investigations: string
  advice: string
  dietaryAdvice: string
  obDataDefaults?: Record<string, any>
  icon: string
}

// ─── Templates ────────────────────────────────────────────────

export const GYNECOLOGY_TEMPLATES: ConsultationTemplate[] = [
  // ═══ ANC TEMPLATES ═════════════════════════════════════════

  {
    id: 'routine-anc',
    name: 'Routine ANC Visit',
    category: 'ANC',
    icon: '🤰',
    chiefComplaint: 'Routine antenatal check-up',
    diagnosis: 'Normal pregnancy — routine ANC',
    notes: 'Patient for routine ANC follow-up. Vitals stable. No complaints.',
    medications: [
      { drug: 'Folic Acid 5mg', dose: '5mg', route: 'Oral', frequency: 'Once daily', duration: 'Till delivery', instructions: 'Take in the morning' },
      { drug: 'Iron + Folic Acid', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', duration: 'Till delivery', instructions: 'Take after lunch with vitamin C' },
      { drug: 'Calcium 500mg', dose: '500mg', route: 'Oral', frequency: 'Twice daily', duration: 'Till delivery', instructions: 'Take after meals' },
    ],
    investigations: 'CBC, Blood sugar fasting, Urine routine & microscopy',
    advice: 'Regular ANC visits as scheduled. Adequate rest. Report any warning signs (bleeding, headache, blurred vision, reduced fetal movements).',
    dietaryAdvice: 'High protein diet. Green leafy vegetables. Adequate fluids (3L/day). Avoid raw/undercooked food.',
  },

  {
    id: 'anc-first-visit',
    name: 'ANC — First Visit (Booking)',
    category: 'ANC',
    icon: '📋',
    chiefComplaint: 'First antenatal visit — pregnancy confirmation and booking',
    diagnosis: 'Early pregnancy — booking visit',
    notes: 'First ANC visit. UPT positive. LMP noted. EDD calculated. Baseline investigations ordered.',
    medications: [
      { drug: 'Folic Acid 5mg', dose: '5mg', route: 'Oral', frequency: 'Once daily', duration: 'Till 12 weeks', instructions: 'Essential for neural tube development' },
      { drug: 'Progesterone 200mg', dose: '200mg', route: 'Oral', frequency: 'Twice daily', duration: '12 weeks', instructions: 'Vaginal route preferred. For luteal support.' },
    ],
    investigations: 'CBC, Blood group & Rh, Blood sugar fasting & PP, HbA1c, Thyroid (TSH), HIV, HBsAg, VDRL, Urine routine, USG dating scan',
    advice: 'Avoid heavy lifting. No smoking/alcohol. Take folic acid regularly. Next visit in 4 weeks.',
    dietaryAdvice: 'Balanced diet with adequate protein. Avoid papaya, pineapple in first trimester (traditional advice). Plenty of fluids.',
  },

  {
    id: 'anc-high-risk',
    name: 'ANC — High Risk Pregnancy',
    category: 'ANC',
    icon: '⚠️',
    chiefComplaint: 'High-risk pregnancy follow-up',
    diagnosis: 'High-risk pregnancy (specify: PIH / GDM / Previous CS / Twins / Advanced age)',
    notes: 'High-risk ANC. Close monitoring required. Discussed risks and plan with patient.',
    medications: [
      { drug: 'Folic Acid 5mg', dose: '5mg', route: 'Oral', frequency: 'Once daily', duration: 'Till delivery', instructions: '' },
      { drug: 'Iron + Folic Acid', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', duration: 'Till delivery', instructions: '' },
      { drug: 'Calcium 500mg', dose: '500mg', route: 'Oral', frequency: 'Twice daily', duration: 'Till delivery', instructions: '' },
      { drug: 'Aspirin 75mg', dose: '75mg', route: 'Oral', frequency: 'Once daily', duration: 'Till 36 weeks', instructions: 'Low-dose aspirin for pre-eclampsia prevention' },
    ],
    investigations: 'CBC, Blood sugar fasting & PP, Urine protein, Liver function, Kidney function, Coagulation profile, USG growth scan, Doppler study',
    advice: 'Fortnightly visits. Daily fetal movement count. Report immediately: headache, blurred vision, epigastric pain, reduced movements, bleeding.',
    dietaryAdvice: 'Low salt diet if hypertensive. Diabetic diet if GDM. High protein. Adequate fluids.',
  },

  {
    id: 'anc-gdm',
    name: 'ANC — Gestational Diabetes',
    category: 'ANC',
    icon: '🩸',
    chiefComplaint: 'Gestational diabetes mellitus — follow-up',
    diagnosis: 'Gestational Diabetes Mellitus (GDM)',
    notes: 'GDM diagnosed on OGTT. Diet counselling done. Blood sugar monitoring advised.',
    medications: [
      { drug: 'Metformin 500mg', dose: '500mg', route: 'Oral', frequency: 'Twice daily', duration: 'Till delivery', instructions: 'Take with meals. Start with 500mg OD, increase to BD after 1 week.' },
      { drug: 'Folic Acid 5mg', dose: '5mg', route: 'Oral', frequency: 'Once daily', duration: 'Till delivery', instructions: '' },
      { drug: 'Iron + Folic Acid', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', duration: 'Till delivery', instructions: '' },
    ],
    investigations: 'Blood sugar fasting & PP (weekly), HbA1c (monthly), USG growth scan (4-weekly), Fetal Doppler at 36 weeks',
    advice: 'Strict diabetic diet. Daily blood sugar monitoring (fasting + 2h post-meal). Walk 30 min after meals. Target: Fasting < 95, PP < 120.',
    dietaryAdvice: 'Small frequent meals (6/day). Avoid sugar, sweets, white rice, maida. Prefer whole grains, dal, vegetables. Limit fruits to 2/day.',
    obDataDefaults: { gestational_diabetes: true },
  },

  // ═══ GYNECOLOGY TEMPLATES ══════════════════════════════════

  {
    id: 'pcos-followup',
    name: 'PCOS Follow-up',
    category: 'Gynecology',
    icon: '🔄',
    chiefComplaint: 'Irregular periods / PCOS follow-up',
    diagnosis: 'Polycystic Ovarian Syndrome (PCOS)',
    notes: 'Known PCOS. Follow-up for menstrual regulation and metabolic parameters.',
    medications: [
      { drug: 'Ethinyl Estradiol + Desogestrel (Novelon)', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', duration: '21 days', instructions: 'Start on day 2 of period. 7-day pill-free interval.' },
      { drug: 'Metformin 500mg', dose: '500mg', route: 'Oral', frequency: 'Twice daily', duration: '3 months', instructions: 'For insulin resistance. Take with meals.' },
    ],
    investigations: 'USG Pelvis (TVS), LH/FSH ratio, Testosterone (free & total), DHEAS, Insulin fasting, HbA1c, Thyroid (TSH), Lipid profile',
    advice: 'Weight loss (even 5-10% helps). Regular exercise 30 min/day. Avoid processed food. Follow-up in 3 months.',
    dietaryAdvice: 'Low glycemic index diet. Avoid sugar, refined carbs. High protein, high fiber. Green tea. Cinnamon.',
  },

  {
    id: 'menorrhagia',
    name: 'Menorrhagia (Heavy Periods)',
    category: 'Gynecology',
    icon: '🩸',
    chiefComplaint: 'Heavy menstrual bleeding / menorrhagia',
    diagnosis: 'Menorrhagia — (specify: DUB / Fibroid / Adenomyosis / Endometrial pathology)',
    notes: 'Patient complains of heavy periods with clots. Pad count > 5/day. Duration > 7 days.',
    medications: [
      { drug: 'Tranexamic Acid 500mg', dose: '500mg', route: 'Oral', frequency: 'Thrice daily', duration: '5 days', instructions: 'Take during heavy bleeding days only' },
      { drug: 'Mefenamic Acid 500mg', dose: '500mg', route: 'Oral', frequency: 'Thrice daily', duration: '5 days', instructions: 'Take after food' },
      { drug: 'Iron + Folic Acid', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', duration: '3 months', instructions: 'To correct anaemia' },
    ],
    investigations: 'CBC (Hb), USG Pelvis (TVS), Thyroid (TSH), Coagulation profile, Endometrial biopsy (if > 40 years)',
    advice: 'Maintain menstrual diary. Report if soaking > 1 pad/hour. Follow-up after next period.',
    dietaryAdvice: 'Iron-rich foods: spinach, jaggery, dates, pomegranate. Vitamin C with iron for better absorption.',
  },

  {
    id: 'dysmenorrhea',
    name: 'Dysmenorrhea (Painful Periods)',
    category: 'Gynecology',
    icon: '😣',
    chiefComplaint: 'Painful periods / dysmenorrhea',
    diagnosis: 'Primary Dysmenorrhea (or Secondary — specify: Endometriosis / Adenomyosis)',
    notes: 'Severe menstrual cramps. Pain starts with period, lasts 2-3 days. Affecting daily activities.',
    medications: [
      { drug: 'Mefenamic Acid 500mg', dose: '500mg', route: 'Oral', frequency: 'Thrice daily', duration: '3 days', instructions: 'Start 1 day before expected period' },
      { drug: 'Drotaverine 80mg', dose: '80mg', route: 'Oral', frequency: 'Twice daily', duration: '3 days', instructions: 'Antispasmodic for cramps' },
    ],
    investigations: 'USG Pelvis (TVS) — to rule out endometriosis, adenomyosis, fibroids',
    advice: 'Hot water bottle on lower abdomen. Light exercise. Yoga. If not responding to NSAIDs, consider OCP for cycle regulation.',
    dietaryAdvice: 'Avoid caffeine and cold foods during periods. Ginger tea. Turmeric milk.',
  },

  {
    id: 'vaginal-discharge',
    name: 'Vaginal Discharge / Vaginitis',
    category: 'Gynecology',
    icon: '💧',
    chiefComplaint: 'White discharge / vaginal discharge / itching',
    diagnosis: 'Vaginal candidiasis / Bacterial vaginosis / Trichomoniasis (specify)',
    notes: 'Patient complains of vaginal discharge with/without itching. Per speculum examination done.',
    medications: [
      { drug: 'Clotrimazole 200mg pessary', dose: '200mg', route: 'Topical', frequency: 'At bedtime', duration: '3 days', instructions: 'Insert vaginally at bedtime' },
      { drug: 'Fluconazole 150mg', dose: '150mg', route: 'Oral', frequency: 'Once', duration: 'Single dose', instructions: 'For candidiasis. Repeat after 72h if needed.' },
      { drug: 'Metronidazole 400mg', dose: '400mg', route: 'Oral', frequency: 'Twice daily', duration: '7 days', instructions: 'For bacterial vaginosis. Avoid alcohol.' },
    ],
    investigations: 'High vaginal swab (HVS) culture & sensitivity, Wet mount, KOH preparation',
    advice: 'Wear cotton undergarments. Avoid douching. Keep area dry. Treat partner if Trichomonas.',
    dietaryAdvice: 'Probiotics (curd/yogurt). Avoid excess sugar.',
  },

  {
    id: 'uti',
    name: 'Urinary Tract Infection',
    category: 'Gynecology',
    icon: '🚽',
    chiefComplaint: 'Burning urination / frequency / UTI symptoms',
    diagnosis: 'Urinary Tract Infection (UTI)',
    notes: 'Dysuria, frequency, urgency. No fever. No loin pain.',
    medications: [
      { drug: 'Nitrofurantoin 100mg', dose: '100mg', route: 'Oral', frequency: 'Twice daily', duration: '5 days', instructions: 'Take with food. Complete full course.' },
      { drug: 'Paracetamol 500mg', dose: '500mg', route: 'Oral', frequency: 'Thrice daily', duration: '3 days', instructions: 'For pain/fever if needed' },
    ],
    investigations: 'Urine routine & microscopy, Urine culture & sensitivity',
    advice: 'Drink plenty of water (3L/day). Void after intercourse. Wipe front to back. Complete antibiotic course.',
    dietaryAdvice: 'Cranberry juice. Plenty of fluids. Avoid holding urine.',
  },

  {
    id: 'fibroid-followup',
    name: 'Fibroid Follow-up',
    category: 'Gynecology',
    icon: '🔴',
    chiefComplaint: 'Known fibroid uterus — follow-up',
    diagnosis: 'Uterine Fibroid (Leiomyoma) — (specify: submucosal / intramural / subserosal)',
    notes: 'Known fibroid. Follow-up for size monitoring and symptom assessment.',
    medications: [
      { drug: 'Tranexamic Acid 500mg', dose: '500mg', route: 'Oral', frequency: 'Thrice daily', duration: '5 days', instructions: 'During heavy bleeding days' },
      { drug: 'Iron + Folic Acid', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', duration: '3 months', instructions: '' },
    ],
    investigations: 'USG Pelvis (TVS) — fibroid mapping, CBC (Hb)',
    advice: 'Monitor symptoms. If fibroid growing rapidly or causing severe symptoms, discuss surgical options (myomectomy/hysterectomy).',
    dietaryAdvice: 'Avoid soy products (phytoestrogens). Green vegetables. Iron-rich foods.',
  },

  {
    id: 'endometriosis',
    name: 'Endometriosis',
    category: 'Gynecology',
    icon: '🎗️',
    chiefComplaint: 'Chronic pelvic pain / dysmenorrhea / dyspareunia',
    diagnosis: 'Endometriosis (Stage: I/II/III/IV)',
    notes: 'Suspected/confirmed endometriosis. Chronic pelvic pain with cyclical worsening.',
    medications: [
      { drug: 'Dienogest 2mg', dose: '2mg', route: 'Oral', frequency: 'Once daily', duration: '6 months', instructions: 'Continuous use. May cause irregular bleeding initially.' },
      { drug: 'Mefenamic Acid 500mg', dose: '500mg', route: 'Oral', frequency: 'Thrice daily', duration: '5 days', instructions: 'For pain during periods' },
    ],
    investigations: 'USG Pelvis (TVS), CA-125, MRI pelvis (if surgical planning), Diagnostic laparoscopy',
    advice: 'Long-term hormonal suppression. If fertility desired, discuss IVF/surgical options. Pain management.',
    dietaryAdvice: 'Anti-inflammatory diet. Omega-3 fatty acids. Avoid red meat, alcohol.',
  },

  {
    id: 'cervical-screening',
    name: 'Cervical Cancer Screening',
    category: 'Gynecology',
    icon: '🔬',
    chiefComplaint: 'Routine cervical cancer screening / abnormal PAP smear follow-up',
    diagnosis: 'Cervical screening — (Normal / ASCUS / LSIL / HSIL)',
    notes: 'Routine cervical cancer screening. PAP smear collected.',
    medications: [],
    investigations: 'PAP smear / Cervical cytology, HPV DNA test, Colposcopy (if abnormal PAP)',
    advice: 'Screening every 3 years (PAP) or 5 years (PAP + HPV co-testing) for women 25-65 years. HPV vaccination for eligible women.',
    dietaryAdvice: '',
  },

  // ═══ INFERTILITY TEMPLATES ═════════════════════════════════

  {
    id: 'infertility-initial',
    name: 'Infertility — Initial Workup',
    category: 'Infertility',
    icon: '🔍',
    chiefComplaint: 'Inability to conceive / infertility evaluation',
    diagnosis: 'Primary/Secondary Infertility — under evaluation',
    notes: 'Couple trying to conceive for > 1 year. Initial workup ordered for both partners.',
    medications: [
      { drug: 'Folic Acid 5mg', dose: '5mg', route: 'Oral', frequency: 'Once daily', duration: '3 months', instructions: 'Pre-conception supplementation' },
    ],
    investigations: 'Day 2 — FSH, LH, Estradiol, Prolactin, TSH, AMH; Day 21 — Progesterone; USG Pelvis (TVS) for AFC; HSG (Hysterosalpingography); Husband — Semen analysis',
    advice: 'Timed intercourse around ovulation (day 12-16). Avoid stress. Maintain healthy weight. Both partners to avoid smoking/alcohol.',
    dietaryAdvice: 'Balanced diet. Folic acid. Avoid excess caffeine. Maintain BMI 20-25.',
  },

  {
    id: 'ovulation-induction',
    name: 'Ovulation Induction Cycle',
    category: 'Infertility',
    icon: '💊',
    chiefComplaint: 'Ovulation induction — monitored cycle',
    diagnosis: 'Anovulatory infertility — ovulation induction',
    notes: 'Ovulation induction cycle started. Follicular monitoring planned.',
    medications: [
      { drug: 'Letrozole 2.5mg', dose: '2.5mg', route: 'Oral', frequency: 'Once daily', duration: '5 days (Day 2-6)', instructions: 'Start on Day 2 of period' },
      { drug: 'Folic Acid 5mg', dose: '5mg', route: 'Oral', frequency: 'Once daily', duration: 'Continuous', instructions: '' },
    ],
    investigations: 'USG Pelvis for follicular study — Day 2 (baseline), Day 9, Day 11, Day 13 (or till dominant follicle ≥ 18mm)',
    advice: 'Come for follicular monitoring as scheduled. Timed intercourse when advised. HCG trigger if needed.',
    dietaryAdvice: 'Healthy diet. Adequate protein. Stay hydrated.',
  },

  {
    id: 'iui-cycle',
    name: 'IUI Cycle',
    category: 'Infertility',
    icon: '🧪',
    chiefComplaint: 'Intrauterine insemination (IUI) cycle',
    diagnosis: 'Infertility — IUI planned',
    notes: 'IUI cycle. Ovulation induction + follicular monitoring + IUI procedure planned.',
    medications: [
      { drug: 'Letrozole 5mg', dose: '5mg', route: 'Oral', frequency: 'Once daily', duration: '5 days (Day 2-6)', instructions: '' },
      { drug: 'HCG 5000 IU', dose: '5000 IU', route: 'IM', frequency: 'Once', duration: 'Single dose', instructions: 'Trigger injection when dominant follicle ≥ 18mm' },
      { drug: 'Progesterone 200mg', dose: '200mg', route: 'Oral', frequency: 'Twice daily', duration: '14 days', instructions: 'Start after IUI for luteal support. Vaginal route preferred.' },
    ],
    investigations: 'Follicular monitoring USG (serial), Semen preparation on IUI day, Beta-hCG after 14 days',
    advice: 'IUI procedure 36h after HCG trigger. Rest for 15 min after procedure. Normal activities thereafter. Beta-hCG test after 14 days.',
    dietaryAdvice: 'Healthy diet. Avoid heavy exercise. Stay positive.',
  },

  // ═══ EMERGENCY TEMPLATES ═══════════════════════════════════

  {
    id: 'ectopic-suspected',
    name: 'Suspected Ectopic Pregnancy',
    category: 'Emergency',
    icon: '🚨',
    chiefComplaint: 'Amenorrhea with abdominal pain / suspected ectopic pregnancy',
    diagnosis: 'Suspected Ectopic Pregnancy — under evaluation',
    notes: 'EMERGENCY: Amenorrhea + abdominal pain + UPT positive. Rule out ectopic pregnancy. Hemodynamically stable/unstable.',
    medications: [],
    investigations: 'URGENT: Beta-hCG (quantitative), USG Pelvis (TVS), CBC, Blood group & crossmatch, Coagulation profile',
    advice: 'ADMIT for observation. NPO (nil by mouth). IV access. Serial beta-hCG (48h). Surgical team on standby.',
    dietaryAdvice: 'NPO if surgery planned.',
  },

  {
    id: 'threatened-abortion',
    name: 'Threatened Abortion',
    category: 'Emergency',
    icon: '⚠️',
    chiefComplaint: 'Bleeding in early pregnancy / threatened abortion',
    diagnosis: 'Threatened Abortion',
    notes: 'Bleeding PV in first trimester. Os closed. Fetal cardiac activity present on USG.',
    medications: [
      { drug: 'Progesterone 200mg', dose: '200mg', route: 'Oral', frequency: 'Twice daily', duration: '14 days', instructions: 'Vaginal route preferred. Continue till bleeding stops + 2 weeks.' },
      { drug: 'Dydrogesterone 10mg', dose: '10mg', route: 'Oral', frequency: 'Twice daily', duration: '14 days', instructions: 'Alternative to micronized progesterone' },
    ],
    investigations: 'USG Pelvis (TVS) — confirm viability, Beta-hCG (serial if needed), Blood group & Rh',
    advice: 'Complete bed rest. Avoid intercourse. Avoid heavy lifting. Report if bleeding increases or pain worsens.',
    dietaryAdvice: 'Light, easily digestible food. Adequate fluids.',
  },

  {
    id: 'pph',
    name: 'Postpartum Haemorrhage (PPH)',
    category: 'Emergency',
    icon: '🩸',
    chiefComplaint: 'Excessive bleeding after delivery / PPH',
    diagnosis: 'Postpartum Haemorrhage — (Atonic / Traumatic / Retained products)',
    notes: 'EMERGENCY: PPH. Estimated blood loss > 500ml. Uterus atonic/well-contracted. Genital tract examined.',
    medications: [
      { drug: 'Oxytocin 10 IU', dose: '10 IU', route: 'IV', frequency: 'Stat', duration: 'Single dose', instructions: 'In 500ml NS, run fast' },
      { drug: 'Methylergometrine 0.2mg', dose: '0.2mg', route: 'IM', frequency: 'Stat', duration: 'Single dose', instructions: 'AVOID if hypertensive' },
      { drug: 'Misoprostol 800mcg', dose: '800mcg', route: 'Rectal', frequency: 'Stat', duration: 'Single dose', instructions: 'If oxytocin + methylergometrine fail' },
      { drug: 'Tranexamic Acid 1g', dose: '1g', route: 'IV', frequency: 'Stat', duration: 'Single dose', instructions: 'Give within 3h of delivery. Can repeat once after 30 min.' },
    ],
    investigations: 'URGENT: CBC, Coagulation profile (PT, aPTT, fibrinogen), Blood group & crossmatch, Renal function',
    advice: 'EMERGENCY PROTOCOL: Bimanual compression. IV fluids. Blood transfusion if needed. Surgical intervention if medical management fails.',
    dietaryAdvice: '',
  },

  // ═══ POSTPARTUM TEMPLATES ══════════════════════════════════

  {
    id: 'postnatal-checkup',
    name: 'Postnatal Check-up (6 weeks)',
    category: 'Postpartum',
    icon: '👶',
    chiefComplaint: 'Postnatal check-up — 6 weeks after delivery',
    diagnosis: 'Postnatal visit — normal recovery',
    notes: 'Postnatal check-up at 6 weeks. Wound healing assessed. Breastfeeding established. Contraception counselled.',
    medications: [
      { drug: 'Iron + Folic Acid', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', duration: '3 months', instructions: 'Continue for 3 months postpartum' },
      { drug: 'Calcium 500mg', dose: '500mg', route: 'Oral', frequency: 'Twice daily', duration: '3 months', instructions: 'Important during breastfeeding' },
    ],
    investigations: 'CBC (Hb), Blood sugar fasting (if GDM), Thyroid (TSH)',
    advice: 'Exclusive breastfeeding for 6 months. Contraception options discussed. Pelvic floor exercises. Resume normal activities gradually.',
    dietaryAdvice: 'High protein, high calcium diet. Adequate fluids for breastfeeding. Traditional postpartum foods (gond ladoo, ajwain water).',
  },

  {
    id: 'lactation-issues',
    name: 'Lactation Problems',
    category: 'Postpartum',
    icon: '🍼',
    chiefComplaint: 'Breast engorgement / insufficient milk / mastitis',
    diagnosis: 'Lactation problem — (Engorgement / Insufficient lactation / Mastitis)',
    notes: 'Breastfeeding difficulty. Assessed latch, positioning, and breast examination.',
    medications: [
      { drug: 'Domperidone 10mg', dose: '10mg', route: 'Oral', frequency: 'Thrice daily', duration: '7 days', instructions: 'Galactagogue — increases prolactin. Take before meals.' },
      { drug: 'Paracetamol 500mg', dose: '500mg', route: 'Oral', frequency: 'Thrice daily', duration: '3 days', instructions: 'For breast pain/engorgement' },
    ],
    investigations: 'Breast USG (if abscess suspected)',
    advice: 'Frequent feeding (every 2-3h). Correct latch technique demonstrated. Warm compress before feeding. Cold compress after. Express milk if engorged.',
    dietaryAdvice: 'Fenugreek (methi) seeds. Garlic. Oats. Adequate fluids (3L/day). Shatavari powder in milk.',
  },

  // ═══ ADOLESCENT TEMPLATES ══════════════════════════════════

  {
    id: 'adolescent-irregular-periods',
    name: 'Adolescent Irregular Periods',
    category: 'Adolescent',
    icon: '👧',
    chiefComplaint: 'Irregular periods in adolescent girl',
    diagnosis: 'Adolescent menstrual irregularity — likely anovulatory cycles (physiological)',
    notes: 'Adolescent girl with irregular periods. Menarche at age ___. Cycles irregular since. No hirsutism. BMI normal.',
    medications: [
      { drug: 'Norethisterone 5mg', dose: '5mg', route: 'Oral', frequency: 'Twice daily', duration: '10 days', instructions: 'To induce withdrawal bleed. Period will come 3-5 days after stopping.' },
      { drug: 'Iron + Folic Acid', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', duration: '3 months', instructions: 'If Hb low' },
    ],
    investigations: 'CBC, Thyroid (TSH), USG Pelvis (transabdominal — NOT transvaginal in virgins)',
    advice: 'Irregular periods are common in first 2 years after menarche. Usually self-correcting. Maintain menstrual diary. Follow-up in 3 months.',
    dietaryAdvice: 'Balanced diet. Iron-rich foods. Regular exercise. Maintain healthy weight.',
  },
]

// ─── Helper Functions ─────────────────────────────────────────

/**
 * Get all templates.
 */
export function getAllTemplates(): ConsultationTemplate[] {
  return GYNECOLOGY_TEMPLATES
}

/**
 * Get templates by category.
 */
export function getTemplatesByCategory(category: ConsultationTemplate['category']): ConsultationTemplate[] {
  return GYNECOLOGY_TEMPLATES.filter(t => t.category === category)
}

/**
 * Get all unique categories.
 */
export function getTemplateCategories(): ConsultationTemplate['category'][] {
  return Array.from(new Set(GYNECOLOGY_TEMPLATES.map(t => t.category))) as ConsultationTemplate['category'][]
}

/**
 * Find a template by ID.
 */
export function getTemplateById(id: string): ConsultationTemplate | undefined {
  return GYNECOLOGY_TEMPLATES.find(t => t.id === id)
}

/**
 * Search templates by name or chief complaint.
 */
export function searchTemplates(query: string): ConsultationTemplate[] {
  const q = query.toLowerCase()
  return GYNECOLOGY_TEMPLATES.filter(t =>
    t.name.toLowerCase().includes(q) ||
    t.chiefComplaint.toLowerCase().includes(q) ||
    t.diagnosis.toLowerCase().includes(q)
  )
}
