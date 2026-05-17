/**
 * src/app/api/labs/extract-values/route.ts
 *
 * AI PDF Lab Value Extraction
 * Extracts lab values like Hb, WBC, Sugar from uploaded PDFs/images.
 * Uses Tesseract.js for OCR + regex parsing for structured extraction.
 * Falls back to AI (Claude/GPT) if configured.
 *
 * Input: multipart/form-data with file field
 * Output: { values: { testName: value, ... }, abnormals: string[] }
 */

import { NextRequest, NextResponse } from 'next/server'

// Common lab test patterns for extraction
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

/**
 * Extract lab values from raw OCR text
 */
function extractLabValues(text: string): { values: Record<string, string>; abnormals: string[] } {
  const values: Record<string, string> = {}
  const abnormals: string[] = []

  for (const test of LAB_PATTERNS) {
    for (const pattern of test.patterns) {
      const match = text.match(pattern)
      if (match && match[1]) {
        const numStr = match[1].replace(',', '')
        const numVal = parseFloat(numStr)
        if (!isNaN(numVal)) {
          values[test.name] = `${numVal} ${test.unit}`

          // Check if abnormal
          if (numVal < test.low || numVal > test.high) {
            const status = numVal < test.low ? 'LOW' : 'HIGH'
            abnormals.push(`${test.name}: ${numVal} ${test.unit} [${status}] (Normal: ${test.low}–${test.high})`)
          }
          break // Found a match, skip other patterns for this test
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
    const rawText = formData.get('text') as string | null

    let ocrText = rawText || ''

    // If file is provided and no text, we need to OCR it
    // For server-side, we'll try to use the AI client
    if (file && !ocrText) {
      // Try AI-based extraction first
      const hasAI = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY
      if (hasAI) {
        try {
          const { analyzePDF } = await import('@/lib/ai-client')
          const buffer = Buffer.from(await file.arrayBuffer())
          const result = await analyzePDF(buffer, 'Extract all lab test values from this report. List each test name and its numeric value.')
          if (result) ocrText = result
        } catch (e) {
          console.error('[labs/extract] AI extraction failed:', e)
        }
      }

      // If still no text, return partial result
      if (!ocrText) {
        return NextResponse.json({
          values: {},
          abnormals: [],
          message: 'Could not extract text from file. Please use client-side OCR or configure AI API key.',
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
