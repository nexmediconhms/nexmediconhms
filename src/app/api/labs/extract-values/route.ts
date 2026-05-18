/**
 * src/app/api/labs/extract-values/route.ts
 */

import { NextRequest, NextResponse } from 'next/server'

// Common lab test patterns for extraction - All original patterns preserved
const LAB_PATTERNS: { name: string; patterns: RegExp[]; unit: string; low: number; high: number }[] = [
  { name: 'Haemoglobin (Hb)', patterns: [/h[ae]moglobin[:\s]+(\d+\.?\d*)/i, /\bHb[:\s]+(\d+\.?\d*)/i, /\bHB[:\s]+(\d+\.?\d*)/i], unit: 'g/dL', low: 11.5, high: 16.5 },
  { name: 'WBC (Total Count)', patterns: [/WBC[:\s]+(\d+[\.,]?\d*)/i, /Total\s*Count[:\s]+(\d+[\.,]?\d*)/i, /TLC[:\s]+(\d+[\.,]?\d*)/i], unit: 'cells/µL', low: 4000, high: 11000 },
  { name: 'Platelet Count', patterns: [/Platelet[s]?[:\s]+(\d+[\.,]?\d*)/i, /PLT[:\s]+(\d+[\.,]?\d*)/i], unit: 'cells/µL', low: 150000, high: 400000 },
  { name: 'Blood Sugar Fasting', patterns: [/Fasting[:\s]*(?:Blood\s*)?(?:Sugar|Glucose)[:\s]+(\d+\.?\d*)/i, /FBS[:\s]+(\d+\.?\d*)/i, /Glucose\s*\(F\)[:\s]+(\d+\.?\d*)/i], unit: 'mg/dL', low: 70, high: 100 },
  { name: 'Blood Sugar PP', patterns: [/PP[:\s]*(?:Blood\s*)?(?:Sugar|Glucose)[:\s]+(\d+\.?\d*)/i, /PPBS[:\s]+(\d+\.?\d*)/i, /Post\s*Prandial[:\s]+(\d+\.?\d*)/i], unit: 'mg/dL', low: 0, high: 140 },
  { name: 'HbA1c', patterns: [/HbA1c[:\s]+(\d+\.?\d*)/i, /Glycosylated[:\s]+(\d+\.?\d*)/i], unit: '%', low: 0, high: 5.7 },
  { name: 'TSH', patterns: [/TSH[:\s]+(\d+\.?\d*)/i, /Thyroid[:\s]+(\d+\.?\d*)/i], unit: 'mIU/L', low: 0.4, high: 4.0 },
  { name: 'Creatinine', patterns: [/Creatinine[:\s]+(\d+\.?\d*)/i], unit: 'mg/dL', low: 0.6, high: 1.2 },
  { name: 'ESR', patterns: [/ESR[:\s]+(\d+\.?\d*)/i], unit: 'mm/hr', low: 0, high: 20 },
  { name: 'SGPT/ALT', patterns: [/SGPT[:\s]+(\d+\.?\d*)/i, /ALT[:\s]+(\d+\.?\d*)/i], unit: 'U/L', low: 7, high: 56 },
  { name: 'SGOT/AST', patterns: [/SGOT[:\s]+(\d+\.?\d*)/i, /AST[:\s]+(\d+\.?\d*)/i], unit: 'U/L', low: 10, high: 40 },
  { name: 'Cholesterol', patterns: [/(?:Total\s*)?Cholesterol[:\s]+(\d+\.?\d*)/i], unit: 'mg/dL', low: 0, high: 200 },
  { name: 'Triglycerides', patterns: [/Triglyceride[s]?[:\s]+(\d+\.?\d*)/i], unit: 'mg/dL', low: 0, high: 150 },
  { name: 'Uric Acid', patterns: [/Uric\s*Acid[:\s]+(\d+\.?\d*)/i], unit: 'mg/dL', low: 2.4, high: 7.0 },
  { name: 'PCV/Haematocrit', patterns: [/PCV[:\s]+(\d+\.?\d*)/i, /H[ae]matocrit[:\s]+(\d+\.?\d*)/i, /HCT[:\s]+(\d+\.?\d*)/i], unit: '%', low: 36, high: 48 },
]

function extractLabValues(text: string): { values: Record<string, string>; abnormals: string[] } {
  const values: Record<string, string> = {}
  const abnormals: string[] = []

  for (const test of LAB_PATTERNS) {
    for (const pattern of test.patterns) {
      const match = text.match(pattern)
      if (match && match[1]) {
        // Handle commas in numbers like 1,50,000 correctly
        const numStr = match[1].replace(/,/g, '')
        const numVal = parseFloat(numStr)
        
        if (!isNaN(numVal)) {
          values[test.name] = `${numVal} ${test.unit}`
          if (numVal < test.low || numVal > test.high) {
            const status = numVal < test.low ? 'LOW' : 'HIGH'
            abnormals.push(`${test.name}: ${numVal} ${test.unit} [${status}] (Normal: ${test.low}–${test.high})`)
          }
          break 
        }
      }
    }
  }
  return { values, abnormals }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const incomingText = formData.get('text')

    let ocrText = ''

    // Logic for handling potential JSON object inside 'text' field
    if (incomingText && typeof incomingText === 'string') {
      try {
        const parsed = JSON.parse(incomingText)
        ocrText = (typeof parsed === 'object' && parsed !== null && 'text' in parsed) 
          ? String(parsed.text) 
          : incomingText
      } catch {
        ocrText = incomingText
      }
    }

    // AI Fallback logic
    if (file && !ocrText) {
      try {
        const { analyzePDF, hasAnyAIKey } = await import('@/lib/ai-client')
        
        if (hasAnyAIKey()) {
          // Convert file to base64 as expected by analyzePDF in ai-client.ts
          const buffer = await file.arrayBuffer()
          const base64 = Buffer.from(buffer).toString('base64')
          
          // Match the signature: analyzePDF(opts: { base64, prompt, ... })
          const result = await analyzePDF({
            base64,
            prompt: 'Extract all lab test values from this report. List each test name and its numeric value.'
          })

          if (result && result.text) {
            ocrText = result.text
          }
        }
      } catch (e) {
        console.error('[labs/extract] AI extraction failed:', e)
      }

      if (!ocrText) {
        return NextResponse.json({
          values: {},
          abnormals: [],
          message: 'Could not extract text from file. Please ensure keys are configured.',
        })
      }
    }

    if (!ocrText) {
      return NextResponse.json({ error: 'No text or file provided' }, { status: 400 })
    }

    // Extract structured lab values
    const { values, abnormals } = extractLabValues(ocrText)

    return NextResponse.json({
      values,
      abnormals,
      extractedCount: Object.keys(values).length,
      hasAbnormals: abnormals.length > 0,
    })
  } catch (err: any) {
    console.error('[labs/extract-values] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}