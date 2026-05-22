/**
 * src/lib/prescription-templates.ts
 *
 * Prescription Template Management — OB-GYN Specific
 *
 * Allows doctors to save and load reusable prescription templates.
 * Templates are stored in the clinic_settings table (key: 'rx_templates')
 * and shared across all doctors in the clinic.
 *
 * Usage:
 *   import { loadTemplates, saveTemplate, deleteTemplate, DEFAULT_TEMPLATES } from '@/lib/prescription-templates'
 *
 *   const templates = await loadTemplates()
 *   const selected = templates.find(t => t.id === 'anc-first-trimester')
 *   setRxMeds(selected.medications)
 *
 * Integration with OPD page:
 *   Import TemplateSelector component and place above the medications list.
 *   On select → pre-fill rxMeds state with template medications.
 */

import { supabase } from './supabase'

// ── Types ────────────────────────────────────────────────────

export interface PrescriptionMedication {
  drug: string
  dose: string
  route: string
  frequency: string
  duration: string
  instructions: string
}

export interface PrescriptionTemplate {
  id: string
  name: string
  category: string       // 'ANC', 'Gynae', 'General', 'Post-Op', 'Emergency', 'Custom'
  description?: string
  medications: PrescriptionMedication[]
  advice?: string
  dietaryAdvice?: string
  reportsNeeded?: string
  createdBy?: string
  createdAt?: string
  updatedAt?: string
}

// ── Storage Key ──────────────────────────────────────────────

const SUPABASE_KEY = 'rx_templates'
const LOCAL_STORAGE_KEY = 'nexmedicon_rx_templates'

// ── Default OB-GYN Templates ─────────────────────────────────

export const DEFAULT_TEMPLATES: PrescriptionTemplate[] = [
  {
    id: 'anc-first-trimester',
    name: 'ANC — First Trimester (< 12 weeks)',
    category: 'ANC',
    description: 'Standard antenatal supplements for first trimester',
    medications: [
      { drug: 'Folic Acid 5mg', dose: '5mg', route: 'Oral', frequency: 'Once daily', duration: '90 days', instructions: 'Take in the morning' },
      { drug: 'Iron + Folic Acid (Autrin)', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', duration: '90 days', instructions: 'After lunch, with orange juice' },
      { drug: 'Calcium 500mg', dose: '500mg', route: 'Oral', frequency: 'Twice daily', duration: '90 days', instructions: 'After meals' },
      { drug: 'Ondansetron 4mg', dose: '4mg', route: 'Oral', frequency: 'SOS / As needed', duration: '15 days', instructions: 'For nausea/vomiting, max 3 per day' },
    ],
    advice: 'Avoid raw/undercooked food. Rest adequately. Stay hydrated.',
    dietaryAdvice: 'High protein diet. Green leafy vegetables. Avoid papaya and pineapple.',
    reportsNeeded: 'CBC, Blood group & Rh, Blood sugar fasting, TSH, Urine routine, USG Obstetric (dating)',
  },
  {
    id: 'anc-second-trimester',
    name: 'ANC — Second Trimester (13-28 weeks)',
    category: 'ANC',
    description: 'Standard antenatal care for second trimester',
    medications: [
      { drug: 'Iron + Folic Acid (Autrin)', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', duration: '90 days', instructions: 'After lunch' },
      { drug: 'Calcium 500mg + Vitamin D3', dose: '1 tablet', route: 'Oral', frequency: 'Twice daily', duration: '90 days', instructions: 'After meals' },
      { drug: 'Vitamin D3 60000 IU', dose: '60000 IU', route: 'Oral', frequency: 'Once weekly', duration: '8 weeks', instructions: 'Every Sunday after breakfast' },
      { drug: 'Protein powder (Protinex Mama)', dose: '2 scoops', route: 'Oral', frequency: 'Once daily', duration: '90 days', instructions: 'Mixed in milk' },
    ],
    advice: 'Regular walking 30 min/day. Sleep on left side. Count fetal movements after 28 weeks.',
    dietaryAdvice: 'High protein, calcium-rich foods. 3 liters water/day. Fruits and vegetables.',
    reportsNeeded: 'OGTT (24-28 weeks), CBC, Urine routine, USG Obstetric (anomaly scan)',
  },
  {
    id: 'anc-third-trimester',
    name: 'ANC — Third Trimester (28-40 weeks)',
    category: 'ANC',
    description: 'Standard antenatal care for third trimester',
    medications: [
      { drug: 'Iron + Folic Acid (Autrin)', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', duration: '60 days', instructions: 'After lunch' },
      { drug: 'Calcium 500mg + Vitamin D3', dose: '1 tablet', route: 'Oral', frequency: 'Twice daily', duration: '60 days', instructions: 'After meals' },
      { drug: 'Progesterone 200mg SR', dose: '200mg', route: 'Oral', frequency: 'At bedtime', duration: '14 days', instructions: 'Only if prescribed for preterm risk' },
    ],
    advice: 'Count baby kicks (min 10 in 2 hours). Report any leaking/bleeding immediately. Hospital bag ready by 36 weeks.',
    reportsNeeded: 'NST (Non-stress test), CBC, Coagulation profile, USG growth scan',
  },
  {
    id: 'pcod-management',
    name: 'PCOD / PCOS Management',
    category: 'Gynae',
    description: 'Polycystic ovarian disease — lifestyle + medical management',
    medications: [
      { drug: 'Metformin 500mg', dose: '500mg', route: 'Oral', frequency: 'Twice daily', duration: '90 days', instructions: 'After meals to avoid GI upset' },
      { drug: 'Myo-Inositol + D-Chiro Inositol', dose: '1 sachet', route: 'Oral', frequency: 'Twice daily', duration: '90 days', instructions: 'Dissolve in water, before meals' },
      { drug: 'Vitamin D3 60000 IU', dose: '60000 IU', route: 'Oral', frequency: 'Once weekly', duration: '8 weeks', instructions: 'After breakfast on Sunday' },
      { drug: 'Omega-3 Fatty Acid 1000mg', dose: '1 capsule', route: 'Oral', frequency: 'Once daily', duration: '90 days', instructions: 'After dinner' },
    ],
    advice: 'Weight loss target: 5-10% in 3 months. Regular exercise 45 min/day. Avoid processed food and sugar.',
    dietaryAdvice: 'Low GI diet. High protein, low carb. Avoid refined flour (maida), sugar, white rice.',
    reportsNeeded: 'LH/FSH, Prolactin, TSH, Blood sugar fasting, HbA1c, Lipid profile, USG Pelvis',
  },
  {
    id: 'uti-treatment',
    name: 'UTI — Empirical Treatment',
    category: 'Gynae',
    description: 'Uncomplicated urinary tract infection treatment',
    medications: [
      { drug: 'Nitrofurantoin 100mg', dose: '100mg', route: 'Oral', frequency: 'Twice daily', duration: '5 days', instructions: 'Take with food' },
      { drug: 'Cranberry extract', dose: '1 tablet', route: 'Oral', frequency: 'Twice daily', duration: '14 days', instructions: 'After meals' },
      { drug: 'Paracetamol 500mg', dose: '500mg', route: 'Oral', frequency: 'SOS / As needed', duration: '5 days', instructions: 'For fever/pain, max 4 per day' },
    ],
    advice: 'Drink 3+ liters water daily. Urinate every 2-3 hours. Complete full antibiotic course. Follow-up if symptoms persist after 3 days.',
    reportsNeeded: 'Urine routine & microscopy, Urine culture & sensitivity',
  },
  {
    id: 'menorrhagia',
    name: 'Heavy Menstrual Bleeding (Menorrhagia)',
    category: 'Gynae',
    description: 'Management of heavy periods',
    medications: [
      { drug: 'Tranexamic acid 500mg', dose: '500mg', route: 'Oral', frequency: 'Thrice daily', duration: '5 days', instructions: 'During heavy bleeding days only' },
      { drug: 'Mefenamic acid 500mg', dose: '500mg', route: 'Oral', frequency: 'Thrice daily', duration: '5 days', instructions: 'After food, during periods' },
      { drug: 'Iron + Folic Acid', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', duration: '30 days', instructions: 'After lunch' },
      { drug: 'Norethisterone 5mg', dose: '5mg', route: 'Oral', frequency: 'Thrice daily', duration: '21 days', instructions: 'Only if prescribed for cycle regulation' },
    ],
    advice: 'Maintain menstrual diary. Report if soaking >1 pad/hour. Follow-up after next cycle.',
    reportsNeeded: 'CBC, TSH, USG Pelvis (Transvaginal), Coagulation profile',
  },
  {
    id: 'fever-general',
    name: 'Fever — General (Adult)',
    category: 'General',
    description: 'Symptomatic treatment for fever',
    medications: [
      { drug: 'Paracetamol 500mg', dose: '500mg', route: 'Oral', frequency: 'SOS / As needed', duration: '5 days', instructions: 'For fever >100°F, max 4 times/day, gap of 6 hours' },
      { drug: 'Pantoprazole 40mg', dose: '40mg', route: 'Oral', frequency: 'Once daily', duration: '5 days', instructions: 'Empty stomach, 30 min before breakfast' },
    ],
    advice: 'Rest. Plenty of fluids. Sponging for high fever. Return if fever >3 days or any warning signs.',
    reportsNeeded: 'CBC, Blood sugar, Urine routine',
  },
  {
    id: 'post-lscs',
    name: 'Post LSCS (Caesarean) Discharge',
    category: 'Post-Op',
    description: 'Discharge medications after C-section',
    medications: [
      { drug: 'Amoxicillin + Clavulanate 625mg', dose: '625mg', route: 'Oral', frequency: 'Twice daily', duration: '5 days', instructions: 'After food' },
      { drug: 'Ibuprofen 400mg + Paracetamol 325mg', dose: '1 tablet', route: 'Oral', frequency: 'Thrice daily', duration: '5 days', instructions: 'After food, for pain' },
      { drug: 'Pantoprazole 40mg', dose: '40mg', route: 'Oral', frequency: 'Once daily', duration: '5 days', instructions: 'Before breakfast' },
      { drug: 'Iron + Folic Acid', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', duration: '90 days', instructions: 'After lunch' },
      { drug: 'Calcium 500mg + Vitamin D3', dose: '1 tablet', route: 'Oral', frequency: 'Twice daily', duration: '90 days', instructions: 'After meals' },
    ],
    advice: 'Stitch removal/check on day 7. No heavy lifting for 6 weeks. Exclusive breastfeeding. Report any fever, wound discharge, or foul-smelling lochia.',
  },
]

// ── Load Templates ───────────────────────────────────────────

let _templateCache: PrescriptionTemplate[] | null = null

/**
 * Load all prescription templates.
 * Fetches from Supabase → merges with defaults → caches in memory.
 */
export async function loadTemplates(): Promise<PrescriptionTemplate[]> {
  if (_templateCache) return _templateCache

  let customTemplates: PrescriptionTemplate[] = []

  try {
    const { data, error } = await supabase
      .from('clinic_settings')
      .select('value')
      .eq('key', SUPABASE_KEY)
      .maybeSingle()

    if (!error && data?.value) {
      customTemplates = JSON.parse(data.value) || []
    }
  } catch {
    // Try localStorage fallback
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
        if (raw) customTemplates = JSON.parse(raw) || []
      } catch { /* ignore */ }
    }
  }

  // Merge: custom templates + defaults (custom first so they appear on top)
  const allTemplates = [...customTemplates, ...DEFAULT_TEMPLATES]
  _templateCache = allTemplates
  return allTemplates
}

/**
 * Save a new custom template.
 */
export async function saveTemplate(template: Omit<PrescriptionTemplate, 'id' | 'createdAt'>): Promise<PrescriptionTemplate> {
  const newTemplate: PrescriptionTemplate = {
    ...template,
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  // Load existing custom templates
  let existing: PrescriptionTemplate[] = []
  try {
    const { data } = await supabase
      .from('clinic_settings')
      .select('value')
      .eq('key', SUPABASE_KEY)
      .maybeSingle()
    if (data?.value) existing = JSON.parse(data.value) || []
  } catch { /* start fresh */ }

  existing.push(newTemplate)

  // Save to Supabase
  try {
    await supabase
      .from('clinic_settings')
      .upsert(
        { key: SUPABASE_KEY, value: JSON.stringify(existing), updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      )
  } catch {
    // Fallback to localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(existing))
    }
  }

  // Invalidate cache
  _templateCache = null
  return newTemplate
}

/**
 * Delete a custom template by ID.
 * Cannot delete default templates.
 */
export async function deleteTemplate(templateId: string): Promise<boolean> {
  // Don't allow deleting built-in templates
  if (DEFAULT_TEMPLATES.some(t => t.id === templateId)) return false

  let existing: PrescriptionTemplate[] = []
  try {
    const { data } = await supabase
      .from('clinic_settings')
      .select('value')
      .eq('key', SUPABASE_KEY)
      .maybeSingle()
    if (data?.value) existing = JSON.parse(data.value) || []
  } catch { return false }

  const filtered = existing.filter(t => t.id !== templateId)

  try {
    await supabase
      .from('clinic_settings')
      .upsert(
        { key: SUPABASE_KEY, value: JSON.stringify(filtered), updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      )
  } catch { return false }

  _templateCache = null
  return true
}

/**
 * Get templates filtered by category.
 */
export async function getTemplatesByCategory(category: string): Promise<PrescriptionTemplate[]> {
  const all = await loadTemplates()
  if (category === 'all') return all
  return all.filter(t => t.category === category)
}

/**
 * Invalidate template cache (call after save/delete).
 */
export function invalidateTemplateCache(): void {
  _templateCache = null
}