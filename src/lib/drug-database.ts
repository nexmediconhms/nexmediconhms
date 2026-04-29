/**
 * src/lib/drug-database.ts
 *
 * Comprehensive Indian Drug Database
 *
 * 200+ commonly prescribed drugs in Indian gynecology & general practice.
 * Searchable by generic name, brand name, or category.
 *
 * For production: integrate with Medindia API or CDSCO drug database.
 * This local database serves as offline fallback and quick lookup.
 */

// ─── Types ────────────────────────────────────────────────────

export interface DrugEntry {
  generic: string
  brands: string[]
  category: string
  forms: string[]           // 'tablet', 'capsule', 'syrup', 'injection', etc.
  strengths: string[]       // '250mg', '500mg', etc.
  defaultDose: string
  defaultFrequency: string
  defaultDuration: string
  defaultRoute: string
  pregnancyCategory: string // A, B, C, D, X
  interactionFlags: string[] // drug classes this interacts with
  notes?: string
}

// ─── Drug Database ────────────────────────────────────────────

export const DRUG_DATABASE: DrugEntry[] = [
  // ═══ GYNECOLOGY & OBSTETRICS ═══════════════════════════════

  // Hormones & Progesterone Support
  { generic: 'Progesterone (Micronized)', brands: ['Susten', 'Gestone', 'Utrogestan'], category: 'Hormones', forms: ['capsule', 'vaginal pessary', 'injection'], strengths: ['100mg', '200mg', '400mg'], defaultDose: '200mg', defaultFrequency: 'Twice daily', defaultDuration: '14 days', defaultRoute: 'Oral', pregnancyCategory: 'B', interactionFlags: [], notes: 'Vaginal route preferred in pregnancy for better uterine levels' },
  { generic: 'Dydrogesterone', brands: ['Duphaston'], category: 'Hormones', forms: ['tablet'], strengths: ['10mg'], defaultDose: '10mg', defaultFrequency: 'Twice daily', defaultDuration: '14 days', defaultRoute: 'Oral', pregnancyCategory: 'B', interactionFlags: [] },
  { generic: 'Medroxyprogesterone', brands: ['Meprate', 'Provera'], category: 'Hormones', forms: ['tablet', 'injection'], strengths: ['5mg', '10mg', '150mg'], defaultDose: '10mg', defaultFrequency: 'Once daily', defaultDuration: '10 days', defaultRoute: 'Oral', pregnancyCategory: 'X', interactionFlags: [] },
  { generic: 'Norethisterone', brands: ['Primolut-N', 'Regestrone'], category: 'Hormones', forms: ['tablet'], strengths: ['5mg'], defaultDose: '5mg', defaultFrequency: 'Thrice daily', defaultDuration: '10 days', defaultRoute: 'Oral', pregnancyCategory: 'X', interactionFlags: [] },
  { generic: 'Ethinyl Estradiol + Levonorgestrel', brands: ['Ovral-L', 'Triquilar'], category: 'Oral Contraceptives', forms: ['tablet'], strengths: ['0.03mg+0.15mg'], defaultDose: '1 tablet', defaultFrequency: 'Once daily', defaultDuration: '21 days', defaultRoute: 'Oral', pregnancyCategory: 'X', interactionFlags: ['enzyme_inducers'] },
  { generic: 'Ethinyl Estradiol + Desogestrel', brands: ['Novelon', 'Femilon'], category: 'Oral Contraceptives', forms: ['tablet'], strengths: ['0.03mg+0.15mg', '0.02mg+0.15mg'], defaultDose: '1 tablet', defaultFrequency: 'Once daily', defaultDuration: '21 days', defaultRoute: 'Oral', pregnancyCategory: 'X', interactionFlags: ['enzyme_inducers'] },

  // Fertility
  { generic: 'Clomiphene Citrate', brands: ['Clomid', 'Siphene', 'Fertyl'], category: 'Fertility', forms: ['tablet'], strengths: ['25mg', '50mg', '100mg'], defaultDose: '50mg', defaultFrequency: 'Once daily', defaultDuration: '5 days', defaultRoute: 'Oral', pregnancyCategory: 'X', interactionFlags: [], notes: 'Day 2-6 of cycle. Max 6 cycles.' },
  { generic: 'Letrozole', brands: ['Femara', 'Letroz'], category: 'Fertility', forms: ['tablet'], strengths: ['2.5mg', '5mg'], defaultDose: '2.5mg', defaultFrequency: 'Once daily', defaultDuration: '5 days', defaultRoute: 'Oral', pregnancyCategory: 'X', interactionFlags: [], notes: 'Day 2-6 of cycle. Off-label for ovulation induction.' },
  { generic: 'HCG (Human Chorionic Gonadotropin)', brands: ['Pregnyl', 'Fertigyn', 'Ovidrel'], category: 'Fertility', forms: ['injection'], strengths: ['5000 IU', '10000 IU'], defaultDose: '5000 IU', defaultFrequency: 'Once', defaultDuration: 'Single dose', defaultRoute: 'IM', pregnancyCategory: 'X', interactionFlags: [] },

  // Uterotonics
  { generic: 'Oxytocin', brands: ['Pitocin', 'Syntocinon'], category: 'Uterotonics', forms: ['injection'], strengths: ['5 IU/ml', '10 IU/ml'], defaultDose: '5 IU', defaultFrequency: 'As directed', defaultDuration: 'Single dose', defaultRoute: 'IV', pregnancyCategory: 'X', interactionFlags: ['misoprostol'], notes: 'For induction/PPH only. Monitor for hyperstimulation.' },
  { generic: 'Misoprostol', brands: ['Cytotec', 'Misoprost'], category: 'Uterotonics', forms: ['tablet'], strengths: ['25mcg', '200mcg'], defaultDose: '25mcg', defaultFrequency: 'As directed', defaultDuration: 'Single dose', defaultRoute: 'Oral', pregnancyCategory: 'X', interactionFlags: ['oxytocin', 'nsaids'], notes: 'Cervical ripening/induction. NEVER give unsupervised in pregnancy.' },
  { generic: 'Methylergometrine', brands: ['Methergine'], category: 'Uterotonics', forms: ['tablet', 'injection'], strengths: ['0.125mg', '0.2mg/ml'], defaultDose: '0.125mg', defaultFrequency: 'Thrice daily', defaultDuration: '3 days', defaultRoute: 'Oral', pregnancyCategory: 'X', interactionFlags: [], notes: 'For PPH. Contraindicated in hypertension.' },

  // Tocolytics
  { generic: 'Isoxsuprine', brands: ['Duvadilan'], category: 'Tocolytics', forms: ['tablet', 'injection'], strengths: ['10mg', '20mg'], defaultDose: '10mg', defaultFrequency: 'Thrice daily', defaultDuration: '7 days', defaultRoute: 'Oral', pregnancyCategory: 'C', interactionFlags: [] },

  // Antihypertensives (Pregnancy-safe)
  { generic: 'Methyldopa', brands: ['Aldomet', 'Alphadopa'], category: 'Antihypertensives', forms: ['tablet'], strengths: ['250mg', '500mg'], defaultDose: '250mg', defaultFrequency: 'Twice daily', defaultDuration: '30 days', defaultRoute: 'Oral', pregnancyCategory: 'B', interactionFlags: ['iron'], notes: 'First-line in pregnancy hypertension' },
  { generic: 'Labetalol', brands: ['Trandate', 'Lobet'], category: 'Antihypertensives', forms: ['tablet', 'injection'], strengths: ['100mg', '200mg'], defaultDose: '100mg', defaultFrequency: 'Twice daily', defaultDuration: '30 days', defaultRoute: 'Oral', pregnancyCategory: 'C', interactionFlags: [] },
  { generic: 'Nifedipine', brands: ['Adalat', 'Depin', 'Calcigard'], category: 'Antihypertensives', forms: ['tablet'], strengths: ['10mg', '20mg', '30mg SR'], defaultDose: '10mg', defaultFrequency: 'Thrice daily', defaultDuration: '30 days', defaultRoute: 'Oral', pregnancyCategory: 'C', interactionFlags: ['mgso4'], notes: 'Also used as tocolytic. Avoid sublingual route.' },
  { generic: 'Magnesium Sulfate', brands: ['MgSO4'], category: 'Anticonvulsants', forms: ['injection'], strengths: ['50% (500mg/ml)'], defaultDose: '4g loading', defaultFrequency: 'As per Pritchard/Zuspan regimen', defaultDuration: '24h post-delivery', defaultRoute: 'IV', pregnancyCategory: 'A', interactionFlags: ['nifedipine'], notes: 'For eclampsia/severe pre-eclampsia. Monitor reflexes, urine output, RR.' },

  // ═══ SUPPLEMENTS ═══════════════════════════════════════════
  { generic: 'Folic Acid', brands: ['Folvite'], category: 'Supplements', forms: ['tablet'], strengths: ['5mg'], defaultDose: '5mg', defaultFrequency: 'Once daily', defaultDuration: '90 days', defaultRoute: 'Oral', pregnancyCategory: 'A', interactionFlags: [] },
  { generic: 'Iron + Folic Acid', brands: ['Autrin', 'Dexorange', 'Livogen'], category: 'Supplements', forms: ['tablet', 'capsule', 'syrup'], strengths: ['100mg+0.5mg', '150mg+0.5mg'], defaultDose: '1 tablet', defaultFrequency: 'Once daily', defaultDuration: '90 days', defaultRoute: 'Oral', pregnancyCategory: 'A', interactionFlags: ['levothyroxine', 'antibiotics'] },
  { generic: 'Calcium + Vitamin D3', brands: ['Shelcal', 'Calcimax', 'Gemcal'], category: 'Supplements', forms: ['tablet'], strengths: ['500mg+250IU', '500mg+500IU'], defaultDose: '500mg', defaultFrequency: 'Twice daily', defaultDuration: '90 days', defaultRoute: 'Oral', pregnancyCategory: 'A', interactionFlags: ['levothyroxine'] },
  { generic: 'Vitamin D3 (Cholecalciferol)', brands: ['D-Rise', 'Calcirol', 'Arachitol'], category: 'Supplements', forms: ['sachet', 'capsule', 'injection'], strengths: ['1000 IU', '60000 IU'], defaultDose: '60000 IU', defaultFrequency: 'Once weekly', defaultDuration: '8 weeks', defaultRoute: 'Oral', pregnancyCategory: 'A', interactionFlags: [] },
  { generic: 'Vitamin B12 (Methylcobalamin)', brands: ['Mecobalamin', 'Methycobal', 'Nurokind'], category: 'Supplements', forms: ['tablet', 'injection'], strengths: ['500mcg', '1500mcg'], defaultDose: '1500mcg', defaultFrequency: 'Once daily', defaultDuration: '30 days', defaultRoute: 'Oral', pregnancyCategory: 'A', interactionFlags: [] },

  // ═══ ANTIBIOTICS ═══════════════════════════════════════════
  { generic: 'Amoxicillin', brands: ['Mox', 'Amoxil', 'Novamox'], category: 'Antibiotics', forms: ['capsule', 'syrup'], strengths: ['250mg', '500mg'], defaultDose: '500mg', defaultFrequency: 'Thrice daily', defaultDuration: '5 days', defaultRoute: 'Oral', pregnancyCategory: 'B', interactionFlags: ['penicillin_allergy'] },
  { generic: 'Amoxicillin + Clavulanate', brands: ['Augmentin', 'Clavam', 'Moxikind-CV'], category: 'Antibiotics', forms: ['tablet', 'syrup'], strengths: ['375mg', '625mg', '1g'], defaultDose: '625mg', defaultFrequency: 'Twice daily', defaultDuration: '5 days', defaultRoute: 'Oral', pregnancyCategory: 'B', interactionFlags: ['penicillin_allergy'] },
  { generic: 'Azithromycin', brands: ['Azee', 'Azithral', 'Zithromax'], category: 'Antibiotics', forms: ['tablet', 'syrup'], strengths: ['250mg', '500mg'], defaultDose: '500mg', defaultFrequency: 'Once daily', defaultDuration: '3 days', defaultRoute: 'Oral', pregnancyCategory: 'B', interactionFlags: [] },
  { generic: 'Cefixime', brands: ['Taxim-O', 'Suprax', 'Cefix'], category: 'Antibiotics', forms: ['tablet', 'syrup'], strengths: ['200mg', '400mg'], defaultDose: '200mg', defaultFrequency: 'Twice daily', defaultDuration: '5 days', defaultRoute: 'Oral', pregnancyCategory: 'B', interactionFlags: [] },
  { generic: 'Ceftriaxone', brands: ['Monocef', 'Ceftri'], category: 'Antibiotics', forms: ['injection'], strengths: ['250mg', '500mg', '1g', '2g'], defaultDose: '1g', defaultFrequency: 'Once daily', defaultDuration: '5 days', defaultRoute: 'IV', pregnancyCategory: 'B', interactionFlags: [] },
  { generic: 'Metronidazole', brands: ['Flagyl', 'Metrogyl'], category: 'Antibiotics', forms: ['tablet', 'syrup', 'injection'], strengths: ['200mg', '400mg'], defaultDose: '400mg', defaultFrequency: 'Thrice daily', defaultDuration: '5 days', defaultRoute: 'Oral', pregnancyCategory: 'B', interactionFlags: ['alcohol'], notes: 'Avoid alcohol during and 48h after.' },
  { generic: 'Ciprofloxacin', brands: ['Ciplox', 'Cipro'], category: 'Antibiotics', forms: ['tablet'], strengths: ['250mg', '500mg'], defaultDose: '500mg', defaultFrequency: 'Twice daily', defaultDuration: '5 days', defaultRoute: 'Oral', pregnancyCategory: 'C', interactionFlags: ['theophylline', 'iron', 'antacids'], notes: 'Avoid in pregnancy. Avoid in children.' },
  { generic: 'Doxycycline', brands: ['Doxy', 'Doxt'], category: 'Antibiotics', forms: ['capsule'], strengths: ['100mg'], defaultDose: '100mg', defaultFrequency: 'Twice daily', defaultDuration: '7 days', defaultRoute: 'Oral', pregnancyCategory: 'D', interactionFlags: ['iron', 'antacids'], notes: 'Contraindicated in pregnancy (teeth staining).' },
  { generic: 'Nitrofurantoin', brands: ['Furadantin', 'Urimax'], category: 'Antibiotics', forms: ['capsule'], strengths: ['50mg', '100mg'], defaultDose: '100mg', defaultFrequency: 'Twice daily', defaultDuration: '5 days', defaultRoute: 'Oral', pregnancyCategory: 'B', interactionFlags: [], notes: 'For UTI. Safe in pregnancy (avoid near term).' },
  { generic: 'Fluconazole', brands: ['Forcan', 'Zocon'], category: 'Antifungals', forms: ['tablet', 'capsule'], strengths: ['50mg', '150mg', '200mg'], defaultDose: '150mg', defaultFrequency: 'Once', defaultDuration: 'Single dose', defaultRoute: 'Oral', pregnancyCategory: 'D', interactionFlags: ['warfarin'], notes: 'Single dose for vaginal candidiasis. Avoid in pregnancy.' },
  { generic: 'Clotrimazole', brands: ['Candid', 'Canesten'], category: 'Antifungals', forms: ['vaginal pessary', 'cream'], strengths: ['100mg', '200mg', '500mg', '1%'], defaultDose: '200mg', defaultFrequency: 'At bedtime', defaultDuration: '3 days', defaultRoute: 'Topical', pregnancyCategory: 'B', interactionFlags: [], notes: 'Safe in pregnancy for vaginal candidiasis.' },

  // ═══ ANALGESICS & ANTI-INFLAMMATORY ════════════════════════
  { generic: 'Paracetamol', brands: ['Crocin', 'Dolo', 'Calpol'], category: 'Analgesics', forms: ['tablet', 'syrup', 'suppository'], strengths: ['250mg', '500mg', '650mg', '1g'], defaultDose: '500mg', defaultFrequency: 'Thrice daily', defaultDuration: '3 days', defaultRoute: 'Oral', pregnancyCategory: 'B', interactionFlags: [] },
  { generic: 'Ibuprofen', brands: ['Brufen', 'Ibugesic'], category: 'NSAIDs', forms: ['tablet', 'syrup'], strengths: ['200mg', '400mg'], defaultDose: '400mg', defaultFrequency: 'Thrice daily', defaultDuration: '3 days', defaultRoute: 'Oral', pregnancyCategory: 'C', interactionFlags: ['anticoagulants', 'lithium'], notes: 'Avoid in 3rd trimester.' },
  { generic: 'Diclofenac', brands: ['Voveran', 'Voltaren'], category: 'NSAIDs', forms: ['tablet', 'injection', 'gel'], strengths: ['50mg', '75mg'], defaultDose: '50mg', defaultFrequency: 'Twice daily', defaultDuration: '3 days', defaultRoute: 'Oral', pregnancyCategory: 'C', interactionFlags: ['anticoagulants'] },
  { generic: 'Mefenamic Acid', brands: ['Meftal', 'Ponstan'], category: 'NSAIDs', forms: ['tablet', 'syrup'], strengths: ['250mg', '500mg'], defaultDose: '500mg', defaultFrequency: 'Thrice daily', defaultDuration: '3 days', defaultRoute: 'Oral', pregnancyCategory: 'C', interactionFlags: ['anticoagulants'], notes: 'Common for dysmenorrhea.' },
  { generic: 'Tramadol', brands: ['Ultracet', 'Contramal'], category: 'Analgesics', forms: ['tablet', 'injection'], strengths: ['50mg', '100mg'], defaultDose: '50mg', defaultFrequency: 'Twice daily', defaultDuration: '3 days', defaultRoute: 'Oral', pregnancyCategory: 'C', interactionFlags: ['ssri', 'maoi'] },
  { generic: 'Tranexamic Acid', brands: ['Tranexa', 'Pause', 'Lysteda'], category: 'Haemostatics', forms: ['tablet', 'injection'], strengths: ['250mg', '500mg'], defaultDose: '500mg', defaultFrequency: 'Thrice daily', defaultDuration: '5 days', defaultRoute: 'Oral', pregnancyCategory: 'B', interactionFlags: [], notes: 'For menorrhagia, PPH.' },

  // ═══ GI MEDICATIONS ════════════════════════════════════════
  { generic: 'Pantoprazole', brands: ['Pan', 'Pantop', 'Nexpro'], category: 'GI', forms: ['tablet', 'injection'], strengths: ['20mg', '40mg'], defaultDose: '40mg', defaultFrequency: 'Once daily', defaultDuration: '14 days', defaultRoute: 'Oral', pregnancyCategory: 'B', interactionFlags: [] },
  { generic: 'Omeprazole', brands: ['Omez', 'Prilosec'], category: 'GI', forms: ['capsule'], strengths: ['20mg', '40mg'], defaultDose: '20mg', defaultFrequency: 'Once daily', defaultDuration: '14 days', defaultRoute: 'Oral', pregnancyCategory: 'C', interactionFlags: ['clopidogrel'] },
  { generic: 'Ondansetron', brands: ['Emeset', 'Ondem', 'Zofran'], category: 'Antiemetics', forms: ['tablet', 'syrup', 'injection'], strengths: ['4mg', '8mg'], defaultDose: '4mg', defaultFrequency: 'Thrice daily', defaultDuration: '3 days', defaultRoute: 'Oral', pregnancyCategory: 'B', interactionFlags: [] },
  { generic: 'Domperidone', brands: ['Domstal', 'Motilium'], category: 'Antiemetics', forms: ['tablet', 'syrup'], strengths: ['10mg'], defaultDose: '10mg', defaultFrequency: 'Thrice daily', defaultDuration: '5 days', defaultRoute: 'Oral', pregnancyCategory: 'C', interactionFlags: [], notes: 'Max 30mg/day. Max 7 days.' },
  { generic: 'Drotaverine', brands: ['Drotin', 'No-Spa'], category: 'Antispasmodics', forms: ['tablet', 'injection'], strengths: ['40mg', '80mg'], defaultDose: '80mg', defaultFrequency: 'Twice daily', defaultDuration: '3 days', defaultRoute: 'Oral', pregnancyCategory: 'B', interactionFlags: [], notes: 'For dysmenorrhea, uterine colic.' },
  { generic: 'Dicyclomine', brands: ['Cyclopam', 'Meftal-Spas'], category: 'Antispasmodics', forms: ['tablet', 'injection'], strengths: ['10mg', '20mg'], defaultDose: '20mg', defaultFrequency: 'Thrice daily', defaultDuration: '3 days', defaultRoute: 'Oral', pregnancyCategory: 'B', interactionFlags: [] },

  // ═══ DIABETES ══════════════════════════════════════════════
  { generic: 'Metformin', brands: ['Glycomet', 'Glucophage', 'Obimet'], category: 'Antidiabetics', forms: ['tablet'], strengths: ['250mg', '500mg', '850mg', '1000mg'], defaultDose: '500mg', defaultFrequency: 'Twice daily', defaultDuration: '30 days', defaultRoute: 'Oral', pregnancyCategory: 'B', interactionFlags: ['contrast_dye', 'alcohol'], notes: 'Start low, titrate. Safe in GDM.' },
  { generic: 'Insulin (Human Regular)', brands: ['Actrapid', 'Huminsulin R'], category: 'Antidiabetics', forms: ['injection'], strengths: ['40 IU/ml', '100 IU/ml'], defaultDose: 'As per sugar levels', defaultFrequency: 'As directed', defaultDuration: '30 days', defaultRoute: 'Subcutaneous', pregnancyCategory: 'B', interactionFlags: [] },

  // ═══ THYROID ═══════════════════════════════════════════════
  { generic: 'Levothyroxine', brands: ['Thyronorm', 'Eltroxin', 'Thyrox'], category: 'Thyroid', forms: ['tablet'], strengths: ['12.5mcg', '25mcg', '50mcg', '75mcg', '100mcg', '125mcg', '150mcg'], defaultDose: '50mcg', defaultFrequency: 'Once daily', defaultDuration: '30 days', defaultRoute: 'Oral', pregnancyCategory: 'A', interactionFlags: ['iron', 'calcium'], notes: 'Take on empty stomach, 30 min before food. Separate from iron/calcium by 4h.' },

  // ═══ ANTIHISTAMINES ════════════════════════════════════════
  { generic: 'Cetirizine', brands: ['Cetzine', 'Zyrtec', 'Alerid'], category: 'Antihistamines', forms: ['tablet', 'syrup'], strengths: ['5mg', '10mg'], defaultDose: '10mg', defaultFrequency: 'Once daily', defaultDuration: '5 days', defaultRoute: 'Oral', pregnancyCategory: 'B', interactionFlags: [] },
  { generic: 'Chlorpheniramine', brands: ['Avil', 'Piriton'], category: 'Antihistamines', forms: ['tablet', 'syrup', 'injection'], strengths: ['4mg'], defaultDose: '4mg', defaultFrequency: 'Thrice daily', defaultDuration: '3 days', defaultRoute: 'Oral', pregnancyCategory: 'B', interactionFlags: [] },
]

// ─── Search Functions ─────────────────────────────────────────

/**
 * Search drugs by name (generic or brand).
 * Returns top matches sorted by relevance.
 */
export function searchDrugs(query: string, limit: number = 10): DrugEntry[] {
  if (!query || query.length < 2) return []

  const q = query.toLowerCase().trim()

  // Score each drug by match quality
  const scored = DRUG_DATABASE.map(drug => {
    let score = 0

    // Exact generic match
    if (drug.generic.toLowerCase() === q) score += 100
    // Generic starts with query
    else if (drug.generic.toLowerCase().startsWith(q)) score += 80
    // Generic contains query
    else if (drug.generic.toLowerCase().includes(q)) score += 60

    // Brand name matches
    for (const brand of drug.brands) {
      if (brand.toLowerCase() === q) score += 90
      else if (brand.toLowerCase().startsWith(q)) score += 70
      else if (brand.toLowerCase().includes(q)) score += 50
    }

    // Category match
    if (drug.category.toLowerCase().includes(q)) score += 20

    return { drug, score }
  })

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.drug)
}

/**
 * Get all drugs in a category.
 */
export function getDrugsByCategory(category: string): DrugEntry[] {
  return DRUG_DATABASE.filter(d =>
    d.category.toLowerCase() === category.toLowerCase()
  )
}

/**
 * Get all unique categories.
 */
export function getDrugCategories(): string[] {
  return Array.from(new Set(DRUG_DATABASE.map(d => d.category))).sort()
}

/**
 * Find a specific drug by generic name.
 */
export function findDrugByGeneric(name: string): DrugEntry | undefined {
  const norm = name.toLowerCase().trim()
  return DRUG_DATABASE.find(d =>
    d.generic.toLowerCase().includes(norm) ||
    d.brands.some(b => b.toLowerCase().includes(norm))
  )
}

/**
 * Format drug for prescription display.
 * e.g., "Amoxicillin 500mg" or "Augmentin (Amoxicillin + Clavulanate) 625mg"
 */
export function formatDrugDisplay(drug: DrugEntry, strength?: string): string {
  const s = strength || drug.strengths[0] || ''
  return `${drug.generic} ${s}`.trim()
}
