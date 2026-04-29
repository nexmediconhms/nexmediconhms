/**
 * src/lib/drug-interactions.ts
 *
 * Drug Interaction Checking Engine
 *
 * Checks prescribed medications against each other and against patient's
 * existing medications for known dangerous interactions.
 *
 * Severity Levels:
 *   - critical:  Contraindicated — should NEVER be combined (hard stop)
 *   - major:     Serious risk — requires doctor override with documented reason
 *   - moderate:  Monitor closely — warning shown, can proceed
 *   - minor:     Low risk — informational only
 *
 * Data sources: WHO Essential Medicines List, BNF, CDSCO guidelines
 */

// ─── Types ────────────────────────────────────────────────────

export type InteractionSeverity = 'critical' | 'major' | 'moderate' | 'minor'

export interface DrugInteraction {
  drugA: string
  drugB: string
  severity: InteractionSeverity
  description: string
  mechanism: string
  clinicalEffect: string
  management: string
}

export interface InteractionCheckResult {
  hasInteractions: boolean
  critical: DrugInteraction[]
  major: DrugInteraction[]
  moderate: DrugInteraction[]
  minor: DrugInteraction[]
  all: DrugInteraction[]
}

// ─── Interaction Database ─────────────────────────────────────
// Each entry: [drugA_keywords, drugB_keywords, severity, description, mechanism, effect, management]

type InteractionEntry = [string[], string[], InteractionSeverity, string, string, string, string]

const INTERACTION_DB: InteractionEntry[] = [
  // ── CRITICAL (Contraindicated) ──────────────────────────────
  [
    ['metformin'],
    ['contrast', 'iodinated', 'gadolinium'],
    'critical',
    'Metformin + Iodinated Contrast Dye',
    'Contrast media can cause acute kidney injury, impairing metformin clearance',
    'Lactic acidosis — potentially fatal',
    'STOP metformin 48h before contrast. Resume only after renal function confirmed normal (eGFR > 30).',
  ],
  [
    ['methotrexate'],
    ['trimethoprim', 'cotrimoxazole', 'septran', 'bactrim'],
    'critical',
    'Methotrexate + Trimethoprim/Sulfamethoxazole',
    'Both are folate antagonists; trimethoprim reduces methotrexate clearance',
    'Severe pancytopenia, potentially fatal bone marrow suppression',
    'AVOID combination. Use alternative antibiotic.',
  ],
  [
    ['warfarin', 'acenocoumarol'],
    ['aspirin', 'ibuprofen', 'diclofenac', 'naproxen', 'piroxicam', 'ketorolac'],
    'critical',
    'Anticoagulant + NSAID',
    'NSAIDs inhibit platelet function and can cause GI erosion',
    'Major bleeding risk — GI haemorrhage, intracranial bleeding',
    'AVOID NSAIDs with anticoagulants. Use paracetamol for pain. If NSAID essential, add PPI and monitor INR closely.',
  ],
  [
    ['cisapride'],
    ['erythromycin', 'clarithromycin', 'ketoconazole', 'fluconazole', 'itraconazole'],
    'critical',
    'Cisapride + CYP3A4 Inhibitor',
    'CYP3A4 inhibition increases cisapride levels',
    'QT prolongation → Torsades de Pointes → cardiac arrest',
    'CONTRAINDICATED. Use alternative prokinetic (domperidone).',
  ],
  [
    ['ergotamine', 'dihydroergotamine'],
    ['erythromycin', 'clarithromycin', 'ritonavir', 'ketoconazole'],
    'critical',
    'Ergot Alkaloid + CYP3A4 Inhibitor',
    'Increased ergotamine levels due to CYP3A4 inhibition',
    'Ergotism — vasospasm, gangrene of extremities',
    'CONTRAINDICATED. Use triptans for migraine instead.',
  ],
  [
    ['maoi', 'phenelzine', 'tranylcypromine', 'isocarboxazid', 'selegiline'],
    ['ssri', 'fluoxetine', 'sertraline', 'paroxetine', 'citalopram', 'escitalopram', 'venlafaxine', 'duloxetine'],
    'critical',
    'MAOI + Serotonergic Drug',
    'Excessive serotonin accumulation in CNS',
    'Serotonin syndrome — hyperthermia, rigidity, seizures, death',
    'CONTRAINDICATED. Wait 14 days after stopping MAOI before starting SSRI (5 weeks for fluoxetine).',
  ],

  // ── MAJOR ───────────────────────────────────────────────────
  [
    ['metformin'],
    ['alcohol', 'ethanol'],
    'major',
    'Metformin + Alcohol',
    'Alcohol potentiates metformin\'s effect on lactate metabolism',
    'Increased risk of lactic acidosis and hypoglycemia',
    'Advise patient to limit alcohol. Monitor blood sugar closely.',
  ],
  [
    ['digoxin'],
    ['amiodarone'],
    'major',
    'Digoxin + Amiodarone',
    'Amiodarone inhibits P-glycoprotein, reducing digoxin clearance',
    'Digoxin toxicity — nausea, arrhythmias, visual disturbances',
    'Reduce digoxin dose by 50% when starting amiodarone. Monitor digoxin levels.',
  ],
  [
    ['lithium'],
    ['ibuprofen', 'diclofenac', 'naproxen', 'indomethacin'],
    'major',
    'Lithium + NSAID',
    'NSAIDs reduce renal lithium clearance',
    'Lithium toxicity — tremor, confusion, seizures',
    'Avoid NSAIDs or monitor lithium levels closely. Use paracetamol instead.',
  ],
  [
    ['ace inhibitor', 'enalapril', 'ramipril', 'lisinopril', 'perindopril'],
    ['potassium', 'spironolactone', 'amiloride', 'triamterene'],
    'major',
    'ACE Inhibitor + Potassium-sparing Diuretic/Supplement',
    'Both increase serum potassium',
    'Hyperkalemia — cardiac arrhythmias, potentially fatal',
    'Monitor serum potassium regularly. Avoid potassium supplements unless hypokalemic.',
  ],
  [
    ['ciprofloxacin', 'levofloxacin', 'moxifloxacin', 'norfloxacin'],
    ['theophylline', 'aminophylline'],
    'major',
    'Fluoroquinolone + Theophylline',
    'Fluoroquinolones inhibit CYP1A2, reducing theophylline metabolism',
    'Theophylline toxicity — seizures, arrhythmias',
    'Monitor theophylline levels. Consider dose reduction or alternative antibiotic.',
  ],
  [
    ['clopidogrel'],
    ['omeprazole', 'esomeprazole'],
    'major',
    'Clopidogrel + Omeprazole/Esomeprazole',
    'Omeprazole inhibits CYP2C19, reducing clopidogrel activation',
    'Reduced antiplatelet effect — increased cardiovascular risk',
    'Use pantoprazole or rabeprazole instead (less CYP2C19 inhibition).',
  ],
  [
    ['simvastatin', 'lovastatin', 'atorvastatin'],
    ['erythromycin', 'clarithromycin', 'itraconazole', 'ketoconazole', 'ritonavir'],
    'major',
    'Statin + CYP3A4 Inhibitor',
    'CYP3A4 inhibition increases statin levels',
    'Rhabdomyolysis — muscle breakdown, kidney failure',
    'Temporarily stop statin during antibiotic course, or use rosuvastatin (not CYP3A4 metabolized).',
  ],
  [
    ['insulin', 'glimepiride', 'glipizide', 'glyburide', 'glibenclamide'],
    ['ciprofloxacin', 'levofloxacin'],
    'major',
    'Sulfonylurea/Insulin + Fluoroquinolone',
    'Fluoroquinolones can cause both hypo- and hyperglycemia',
    'Unpredictable blood sugar changes — severe hypoglycemia risk',
    'Monitor blood sugar closely. Warn patient about hypoglycemia symptoms.',
  ],

  // ── MODERATE ────────────────────────────────────────────────
  [
    ['metformin'],
    ['furosemide', 'hydrochlorothiazide', 'chlorthalidone'],
    'moderate',
    'Metformin + Diuretic',
    'Diuretics can impair renal function and cause dehydration',
    'Increased risk of lactic acidosis in dehydrated patients',
    'Ensure adequate hydration. Monitor renal function.',
  ],
  [
    ['amlodipine', 'nifedipine'],
    ['simvastatin'],
    'moderate',
    'Calcium Channel Blocker + Simvastatin',
    'Amlodipine inhibits CYP3A4, increasing simvastatin levels',
    'Increased risk of myopathy',
    'Limit simvastatin to 20mg/day with amlodipine. Consider atorvastatin.',
  ],
  [
    ['iron', 'ferrous'],
    ['levothyroxine', 'thyroxine'],
    'moderate',
    'Iron + Levothyroxine',
    'Iron chelates levothyroxine in the gut, reducing absorption',
    'Reduced thyroid hormone levels — hypothyroidism symptoms',
    'Separate doses by at least 4 hours. Take levothyroxine on empty stomach.',
  ],
  [
    ['calcium'],
    ['levothyroxine', 'thyroxine'],
    'moderate',
    'Calcium + Levothyroxine',
    'Calcium reduces levothyroxine absorption',
    'Reduced thyroid hormone levels',
    'Separate doses by at least 4 hours.',
  ],
  [
    ['iron', 'ferrous'],
    ['ciprofloxacin', 'levofloxacin', 'norfloxacin', 'tetracycline', 'doxycycline'],
    'moderate',
    'Iron + Antibiotic (Quinolone/Tetracycline)',
    'Iron chelates the antibiotic, reducing its absorption',
    'Reduced antibiotic efficacy — treatment failure',
    'Separate doses by at least 2 hours (iron after antibiotic).',
  ],
  [
    ['antacid', 'aluminium', 'magnesium'],
    ['ciprofloxacin', 'levofloxacin', 'norfloxacin'],
    'moderate',
    'Antacid + Fluoroquinolone',
    'Antacids chelate fluoroquinolones, reducing absorption',
    'Reduced antibiotic efficacy',
    'Take fluoroquinolone 2h before or 6h after antacid.',
  ],
  [
    ['metronidazole'],
    ['alcohol', 'ethanol'],
    'moderate',
    'Metronidazole + Alcohol',
    'Disulfiram-like reaction',
    'Severe nausea, vomiting, flushing, headache, tachycardia',
    'AVOID alcohol during and 48h after metronidazole course.',
  ],
  [
    ['paracetamol', 'acetaminophen'],
    ['warfarin', 'acenocoumarol'],
    'moderate',
    'Paracetamol + Warfarin',
    'Regular paracetamol use (>2g/day) can increase INR',
    'Increased bleeding risk with prolonged use',
    'Monitor INR if paracetamol used regularly. Occasional use is safe.',
  ],
  [
    ['aspirin'],
    ['metformin'],
    'moderate',
    'Aspirin + Metformin',
    'High-dose aspirin can enhance metformin\'s hypoglycemic effect',
    'Increased risk of hypoglycemia',
    'Low-dose aspirin (75-150mg) is generally safe. Monitor blood sugar.',
  ],

  // ── Gynecology-specific interactions ────────────────────────
  [
    ['progesterone', 'dydrogesterone', 'medroxyprogesterone'],
    ['rifampicin', 'rifampin', 'carbamazepine', 'phenytoin', 'phenobarbital'],
    'major',
    'Progesterone + Enzyme Inducer',
    'CYP3A4 induction increases progesterone metabolism',
    'Reduced progesterone levels — breakthrough bleeding, contraceptive failure, threatened abortion',
    'Use higher progesterone dose or alternative. Critical in pregnancy support.',
  ],
  [
    ['oral contraceptive', 'ethinyl estradiol', 'levonorgestrel', 'desogestrel'],
    ['rifampicin', 'rifampin', 'carbamazepine', 'phenytoin', 'phenobarbital', 'st john'],
    'major',
    'Oral Contraceptive + Enzyme Inducer',
    'CYP3A4 induction reduces contraceptive hormone levels',
    'Contraceptive failure — unintended pregnancy',
    'Use additional barrier method. Consider higher-dose OCP or alternative contraception.',
  ],
  [
    ['misoprostol'],
    ['nsaid', 'ibuprofen', 'diclofenac', 'aspirin'],
    'moderate',
    'Misoprostol + NSAID',
    'Misoprostol is a prostaglandin; NSAIDs inhibit prostaglandin synthesis',
    'Reduced misoprostol efficacy for cervical ripening/induction',
    'If using misoprostol for induction, avoid concurrent NSAIDs.',
  ],
  [
    ['methyldopa'],
    ['iron', 'ferrous'],
    'moderate',
    'Methyldopa + Iron',
    'Iron reduces methyldopa absorption',
    'Reduced antihypertensive effect',
    'Separate doses by 2 hours. Important in pregnancy hypertension management.',
  ],
  [
    ['magnesium sulfate', 'mgso4'],
    ['nifedipine'],
    'major',
    'MgSO₄ + Nifedipine',
    'Both cause vasodilation and neuromuscular blockade',
    'Severe hypotension, neuromuscular blockade, respiratory depression',
    'Use with extreme caution. Monitor BP and reflexes closely. Have calcium gluconate ready.',
  ],
  [
    ['oxytocin', 'pitocin'],
    ['misoprostol'],
    'major',
    'Oxytocin + Misoprostol (concurrent)',
    'Both are uterotonic agents',
    'Uterine hyperstimulation, rupture risk (especially with previous CS)',
    'Do NOT use simultaneously. Wait adequate interval between agents.',
  ],

  // ── MINOR ───────────────────────────────────────────────────
  [
    ['paracetamol', 'acetaminophen'],
    ['caffeine'],
    'minor',
    'Paracetamol + Caffeine',
    'Caffeine may slightly enhance paracetamol absorption',
    'Slightly faster onset of action',
    'No action needed. Common combination in OTC products.',
  ],
  [
    ['folic acid'],
    ['methotrexate'],
    'minor',
    'Folic Acid + Methotrexate (low-dose)',
    'Folic acid reduces methotrexate side effects without reducing efficacy (at low doses)',
    'Reduced GI side effects and mouth ulcers',
    'Beneficial combination for low-dose methotrexate (e.g., RA). Take folic acid on non-MTX days.',
  ],
]

// ─── Interaction Checker ──────────────────────────────────────

/**
 * Normalize a drug name for matching.
 * Strips dose, form, and converts to lowercase.
 */
function normalizeDrug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\d+\s*(mg|mcg|g|ml|iu|units?)\b/gi, '')
    .replace(/\b(tablet|capsule|syrup|injection|cream|ointment|drops|sr|er|cr|xl|od)\b/gi, '')
    .replace(/[^a-z\s]/g, '')
    .trim()
}

/**
 * Check if a drug name matches any keyword in a keyword list.
 */
function matchesDrug(drugName: string, keywords: string[]): boolean {
  const normalized = normalizeDrug(drugName)
  return keywords.some(kw => normalized.includes(kw.toLowerCase()))
}

/**
 * Check a list of medications for interactions between them.
 *
 * @param medications - Array of drug names being prescribed
 * @param existingMedications - Array of drugs the patient is already taking
 * @returns InteractionCheckResult with all found interactions
 */
export function checkDrugInteractions(
  medications: string[],
  existingMedications: string[] = []
): InteractionCheckResult {
  const allDrugs = [...medications, ...existingMedications]
  const found: DrugInteraction[] = []
  const seen = new Set<string>()

  // Check every pair of drugs
  for (let i = 0; i < allDrugs.length; i++) {
    for (let j = i + 1; j < allDrugs.length; j++) {
      const drugA = allDrugs[i]
      const drugB = allDrugs[j]

      for (const [kwA, kwB, severity, description, mechanism, effect, management] of INTERACTION_DB) {
        const matchAB = matchesDrug(drugA, kwA) && matchesDrug(drugB, kwB)
        const matchBA = matchesDrug(drugA, kwB) && matchesDrug(drugB, kwA)

        if (matchAB || matchBA) {
          const key = [drugA, drugB].sort().join('|')
          if (!seen.has(key + description)) {
            seen.add(key + description)
            found.push({
              drugA,
              drugB,
              severity,
              description,
              mechanism,
              clinicalEffect: effect,
              management,
            })
          }
        }
      }
    }
  }

  return {
    hasInteractions: found.length > 0,
    critical: found.filter(i => i.severity === 'critical'),
    major: found.filter(i => i.severity === 'major'),
    moderate: found.filter(i => i.severity === 'moderate'),
    minor: found.filter(i => i.severity === 'minor'),
    all: found,
  }
}

/**
 * Get severity badge styling for UI display.
 */
export function interactionSeverityStyle(severity: InteractionSeverity): {
  bg: string; text: string; border: string; icon: string; label: string
} {
  switch (severity) {
    case 'critical':
      return { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300', icon: '🚫', label: 'CONTRAINDICATED' }
    case 'major':
      return { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: '⚠️', label: 'MAJOR' }
    case 'moderate':
      return { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200', icon: '⚡', label: 'MODERATE' }
    case 'minor':
      return { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: 'ℹ️', label: 'MINOR' }
  }
}
