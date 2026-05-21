/**
 * src/lib/manual-extraction.ts
 *
 * Client-side regex-based extraction for lab reports and medical data.
 * Works WITHOUT any AI keys — provides a fallback when OCR/AI is not configured.
 *
 * Used by:
 *   - Lab report value extraction (when AI unavailable)
 *   - Patient registration form parsing (plain text)
 *   - Vitals extraction from typed notes
 */

// ── Lab Value Patterns ────────────────────────────────────────

export interface ExtractedLabValue {
  parameter: string
  value: string
  unit: string
  refRange: string
  flag: 'H' | 'L' | 'N' | ''
}

const LAB_PATTERNS: { name: string; patterns: RegExp[]; unit: string; low: number; high: number }[] = [
  { name: 'Haemoglobin (Hb)', patterns: [/h[ae]moglobin[:\s]+(\d+\.?\d*)/i, /\bHb[:\s]+(\d+\.?\d*)/i, /\bHB[:\s]+(\d+\.?\d*)/i], unit: 'g/dL', low: 11.5, high: 16.5 },
  { name: 'WBC (Total Count)', patterns: [/WBC[:\s]+(\d+[\.,]?\d*)/i, /Total\s*Count[:\s]+(\d+[\.,]?\d*)/i, /TLC[:\s]+(\d+[\.,]?\d*)/i], unit: 'cells/uL', low: 4000, high: 11000 },
  { name: 'Platelet Count', patterns: [/Platelet[s]?[:\s]+(\d+[\.,]?\d*)/i, /PLT[:\s]+(\d+[\.,]?\d*)/i], unit: 'cells/uL', low: 150000, high: 400000 },
  { name: 'Blood Sugar Fasting', patterns: [/Fasting[:\s]*(?:Blood\s*)?(?:Sugar|Glucose)[:\s]+(\d+\.?\d*)/i, /FBS[:\s]+(\d+\.?\d*)/i], unit: 'mg/dL', low: 70, high: 100 },
  { name: 'Blood Sugar PP', patterns: [/PP[:\s]*(?:Blood\s*)?(?:Sugar|Glucose)[:\s]+(\d+\.?\d*)/i, /PPBS[:\s]+(\d+\.?\d*)/i], unit: 'mg/dL', low: 0, high: 140 },
  { name: 'HbA1c', patterns: [/HbA1c[:\s]+(\d+\.?\d*)/i, /Glycosylated[:\s]+(\d+\.?\d*)/i], unit: '%', low: 0, high: 5.7 },
  { name: 'TSH', patterns: [/TSH[:\s]+(\d+\.?\d*)/i], unit: 'mIU/L', low: 0.4, high: 4.0 },
  { name: 'Creatinine', patterns: [/Creatinine[:\s]+(\d+\.?\d*)/i], unit: 'mg/dL', low: 0.6, high: 1.2 },
  { name: 'ESR', patterns: [/ESR[:\s]+(\d+\.?\d*)/i], unit: 'mm/hr', low: 0, high: 20 },
  { name: 'SGPT/ALT', patterns: [/SGPT[:\s]+(\d+\.?\d*)/i, /ALT[:\s]+(\d+\.?\d*)/i], unit: 'U/L', low: 7, high: 56 },
  { name: 'SGOT/AST', patterns: [/SGOT[:\s]+(\d+\.?\d*)/i, /AST[:\s]+(\d+\.?\d*)/i], unit: 'U/L', low: 10, high: 40 },
  { name: 'Cholesterol', patterns: [/(?:Total\s*)?Cholesterol[:\s]+(\d+\.?\d*)/i], unit: 'mg/dL', low: 0, high: 200 },
  { name: 'Triglycerides', patterns: [/Triglyceride[s]?[:\s]+(\d+\.?\d*)/i], unit: 'mg/dL', low: 0, high: 150 },
  { name: 'Uric Acid', patterns: [/Uric\s*Acid[:\s]+(\d+\.?\d*)/i], unit: 'mg/dL', low: 2.4, high: 7.0 },
  { name: 'PCV/Haematocrit', patterns: [/PCV[:\s]+(\d+\.?\d*)/i, /H[ae]matocrit[:\s]+(\d+\.?\d*)/i, /HCT[:\s]+(\d+\.?\d*)/i], unit: '%', low: 36, high: 48 },
]

/**
 * Extract lab values from plain text using regex patterns.
 * No AI required — works entirely client-side.
 */
export function extractLabValuesFromText(text: string): {
  values: ExtractedLabValue[]
  abnormals: string[]
  extractedCount: number
} {
  const values: ExtractedLabValue[] = []
  const abnormals: string[] = []

  for (const test of LAB_PATTERNS) {
    for (const pattern of test.patterns) {
      const match = text.match(pattern)
      if (match && match[1]) {
        const numStr = match[1].replace(/,/g, '')
        const numVal = parseFloat(numStr)

        if (!isNaN(numVal)) {
          let flag: 'H' | 'L' | 'N' | '' = ''
          if (test.low > 0 || test.high > 0) {
            if (numVal < test.low) flag = 'L'
            else if (numVal > test.high) flag = 'H'
            else flag = 'N'
          }

          values.push({
            parameter: test.name,
            value: String(numVal),
            unit: test.unit,
            refRange: `${test.low}-${test.high}`,
            flag,
          })

          if (flag === 'H' || flag === 'L') {
            abnormals.push(`${test.name}: ${numVal} ${test.unit} [${flag === 'H' ? 'HIGH' : 'LOW'}] (Normal: ${test.low}-${test.high})`)
          }
          break
        }
      }
    }
  }

  return { values, abnormals, extractedCount: values.length }
}

// ── Vitals Extraction ─────────────────────────────────────────

export interface ExtractedVitals {
  bp_systolic?: string
  bp_diastolic?: string
  pulse?: string
  temperature?: string
  spo2?: string
  weight?: string
  height?: string
}

/**
 * Extract vital signs from free text (e.g., typed/dictated notes).
 */
export function extractVitalsFromText(text: string): ExtractedVitals {
  const vitals: ExtractedVitals = {}

  // BP: "120/80", "BP 130/90", "B.P. 140/95"
  const bpMatch = text.match(/(?:BP|B\.?P\.?)[:\s]*(\d{2,3})\s*[/\\]\s*(\d{2,3})/i)
  if (bpMatch) {
    vitals.bp_systolic = bpMatch[1]
    vitals.bp_diastolic = bpMatch[2]
  }

  // Pulse: "Pulse 80", "PR: 72", "Heart Rate 90"
  const pulseMatch = text.match(/(?:Pulse|PR|Heart\s*Rate)[:\s]+(\d{2,3})/i)
  if (pulseMatch) vitals.pulse = pulseMatch[1]

  // Temperature: "Temp 98.6", "Temperature: 101.2"
  const tempMatch = text.match(/(?:Temp|Temperature)[:\s]+(\d{2,3}\.?\d*)/i)
  if (tempMatch) vitals.temperature = tempMatch[1]

  // SpO2: "SpO2 98%", "O2 Sat: 95"
  const spo2Match = text.match(/(?:SpO2|O2\s*Sat|Oxygen)[:\s]+(\d{2,3})/i)
  if (spo2Match) vitals.spo2 = spo2Match[1]

  // Weight: "Wt 65kg", "Weight: 72"
  const weightMatch = text.match(/(?:Wt|Weight)[:\s]+(\d{2,3}\.?\d*)/i)
  if (weightMatch) vitals.weight = weightMatch[1]

  // Height: "Ht 165cm", "Height: 5'4"
  const heightMatch = text.match(/(?:Ht|Height)[:\s]+(\d{2,3}\.?\d*)/i)
  if (heightMatch) vitals.height = heightMatch[1]

  return vitals
}

// ── Patient Info Extraction ───────────────────────────────────

export interface ExtractedPatientInfo {
  full_name?: string
  age?: string
  gender?: string
  mobile?: string
  blood_group?: string
}

/**
 * Extract patient information from free text.
 */
export function extractPatientFromText(text: string): ExtractedPatientInfo {
  const info: ExtractedPatientInfo = {}

  // Age: "Age: 35", "age 28y"
  const ageMatch = text.match(/(?:Age|Umar)[:\s]+(\d{1,3})/i)
  if (ageMatch) info.age = ageMatch[1]

  // Gender
  if (/\b(female|woman|lady|mahila|stri)\b/i.test(text)) info.gender = 'Female'
  else if (/\b(male|man|purush)\b/i.test(text)) info.gender = 'Male'

  // Mobile: 10-digit Indian number
  const mobileMatch = text.match(/(?:Mobile|Phone|Contact|Mob)[:\s]+(\d{10})/i)
  if (mobileMatch) info.mobile = mobileMatch[1]

  // Blood group
  const bgMatch = text.match(/(?:Blood\s*Group|BG)[:\s]*((?:A|B|AB|O)[+-])/i)
  if (bgMatch) info.blood_group = bgMatch[1].toUpperCase()

  return info
}

/**
 * Check if AI/OCR is available by calling the OCR endpoint with a test.
 * Returns true if AI keys are configured.
 */
export async function checkAIAvailability(): Promise<boolean> {
  try {
    const res = await fetch('/api/ocr', { method: 'POST', body: new FormData() })
    const data = await res.json()
    // If it returns _setup_required, AI is not available
    return !data._setup_required
  } catch {
    return false
  }
}