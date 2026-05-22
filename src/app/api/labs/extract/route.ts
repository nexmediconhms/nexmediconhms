/**
 * src/app/api/labs/extract/route.ts
 *
 * Lab Report AI Extraction API
 *
 * When a lab partner uploads a PDF report, this endpoint extracts:
 *  - Test name
 *  - Test values (name, value, unit, reference range)
 *  - Patient name (if visible)
 *  - Date
 *  - Lab name
 *  - Conclusion/impression
 *
 * The extracted data is:
 *  1. Saved to lab_reports.ai_extracted_data
 *  2. Saved to lab_reports.results_data (structured test values)
 *  3. Checked for abnormal values → creates doctor_alert
 *  4. Auto-attached to patient profile
 *
 * POST /api/labs/extract
 *   Body: { report_id: UUID, base64_data: string, mime_type: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Reference ranges for common Indian lab tests
const REFERENCE_RANGES: Record<string, { low: number; high: number; unit: string }> = {
  'haemoglobin': { low: 11.5, high: 16.5, unit: 'g/dL' },
  'hb': { low: 11.5, high: 16.5, unit: 'g/dL' },
  'wbc': { low: 4000, high: 11000, unit: 'cells/µL' },
  'rbc': { low: 3.8, high: 5.8, unit: 'million/µL' },
  'platelet': { low: 150000, high: 400000, unit: '/µL' },
  'platelets': { low: 150000, high: 400000, unit: '/µL' },
  'esr': { low: 0, high: 20, unit: 'mm/hr' },
  'blood sugar fasting': { low: 70, high: 100, unit: 'mg/dL' },
  'fbs': { low: 70, high: 100, unit: 'mg/dL' },
  'blood sugar pp': { low: 70, high: 140, unit: 'mg/dL' },
  'ppbs': { low: 70, high: 140, unit: 'mg/dL' },
  'hba1c': { low: 4.0, high: 5.7, unit: '%' },
  'tsh': { low: 0.4, high: 4.0, unit: 'mIU/L' },
  't3': { low: 80, high: 200, unit: 'ng/dL' },
  't4': { low: 4.5, high: 12.5, unit: 'µg/dL' },
  'creatinine': { low: 0.6, high: 1.2, unit: 'mg/dL' },
  'urea': { low: 15, high: 40, unit: 'mg/dL' },
  'uric acid': { low: 2.4, high: 7.0, unit: 'mg/dL' },
  'sgpt': { low: 7, high: 56, unit: 'U/L' },
  'alt': { low: 7, high: 56, unit: 'U/L' },
  'sgot': { low: 10, high: 40, unit: 'U/L' },
  'ast': { low: 10, high: 40, unit: 'U/L' },
  'bilirubin total': { low: 0.1, high: 1.2, unit: 'mg/dL' },
  'bilirubin direct': { low: 0, high: 0.3, unit: 'mg/dL' },
  'cholesterol': { low: 0, high: 200, unit: 'mg/dL' },
  'triglycerides': { low: 0, high: 150, unit: 'mg/dL' },
  'hdl': { low: 40, high: 100, unit: 'mg/dL' },
  'ldl': { low: 0, high: 100, unit: 'mg/dL' },
  'vitamin d': { low: 30, high: 100, unit: 'ng/mL' },
  'vitamin b12': { low: 200, high: 900, unit: 'pg/mL' },
  'iron': { low: 60, high: 170, unit: 'µg/dL' },
  'ferritin': { low: 12, high: 300, unit: 'ng/mL' },
  'calcium': { low: 8.5, high: 10.5, unit: 'mg/dL' },
}

function detectAbnormalValues(results: Array<{ name: string; value: string | number; unit?: string }>): string[] {
  const abnormals: string[] = []
  for (const result of results) {
    const numVal = parseFloat(String(result.value))
    if (isNaN(numVal)) continue
    const nameKey = result.name.toLowerCase().trim()
    for (const [refKey, range] of Object.entries(REFERENCE_RANGES)) {
      if (nameKey.includes(refKey)) {
        if (numVal < range.low || numVal > range.high) {
          const status = numVal < range.low ? 'LOW' : 'HIGH'
          abnormals.push(`${result.name}: ${result.value} ${result.unit || range.unit} [${status}] (Normal: ${range.low}–${range.high})`)
        }
        break
      }
    }
  }
  return abnormals
}

export async function POST(req: NextRequest) {
  // ── SECURITY FIX: Require authentication ──────────────────
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  // Use admin client for database operations (runs server-side only)
  const supabase = getSupabaseAdmin()

  try {
    const body = await req.json()
    const { report_id, base64_data, mime_type } = body

    if (!report_id) {
      return NextResponse.json({ error: 'report_id required' }, { status: 400 })
    }

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return NextResponse.json({
        ok: false,
        error: 'AI extraction not available — OPENAI_API_KEY not configured',
        suggestion: 'Set OPENAI_API_KEY in your environment variables to enable AI lab report extraction',
      }, { status: 503 })
    }

    if (!base64_data) {
      return NextResponse.json({ error: 'base64_data required for extraction' }, { status: 400 })
    }

    // Call OpenAI Vision to extract lab data
    const systemPrompt = `You are a medical lab report data extraction AI for an Indian hospital.
Extract ALL test values from this lab report image/PDF.

Return a JSON object with:
{
  "patient_name": "if visible",
  "report_date": "YYYY-MM-DD if visible",
  "lab_name": "if visible",
  "test_name": "main test name (e.g. Complete Blood Count, Thyroid Profile)",
  "results": [
    { "name": "Test Parameter Name", "value": "numeric value", "unit": "unit", "reference_range": "normal range if shown" }
  ],
  "conclusion": "doctor's impression if any",
  "notes": "any additional observations"
}

Be thorough — extract ALL numeric values you can see. Use exact parameter names as shown in the report.`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extract all test values from this lab report:' },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mime_type || 'application/pdf'};base64,${base64_data}`,
                  detail: 'high',
                },
              },
            ],
          },
        ],
        max_tokens: 2000,
        temperature: 0.1,
      }),
    })

    if (!response.ok) {
      return NextResponse.json({ error: 'AI extraction failed', status: response.status }, { status: 500 })
    }

    const aiData = await response.json()
    const content = aiData.choices?.[0]?.message?.content || ''

    // Parse the JSON response
    let extracted: any = {}
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        extracted = JSON.parse(jsonMatch[0])
      } catch {
        extracted = { raw_extraction: content }
      }
    } else {
      extracted = { raw_extraction: content }
    }

    // Check for abnormal values
    const results = extracted.results || []
    const abnormals = detectAbnormalValues(results)

    // Update the lab_reports record with extracted data
    await supabase.from('lab_reports').update({
      ai_extracted_data: extracted,
      results_data: results,
      report_name: extracted.test_name || undefined,
      updated_at: new Date().toISOString(),
    }).eq('id', report_id)

    // If abnormal values found, create doctor alert
    if (abnormals.length > 0) {
      // Get patient info from the report
      const { data: report } = await supabase
        .from('lab_reports')
        .select('patient_id, report_name')
        .eq('id', report_id)
        .single()

      if (report?.patient_id) {
        const { data: patient } = await supabase
          .from('patients')
          .select('full_name, mrn')
          .eq('id', report.patient_id)
          .single()

        if (patient) {
          await supabase.from('doctor_alerts').insert({
            patient_id: report.patient_id,
            patient_name: patient.full_name,
            mrn: patient.mrn,
            alert_type: 'abnormal_lab',
            severity: abnormals.length >= 3 ? 'critical' : 'warning',
            alert_data: {
              report_name: report.report_name || extracted.test_name,
              abnormal_values: abnormals,
              report_id,
              extracted_at: new Date().toISOString(),
            },
            source: 'ai_extraction',
          })
        }
      }
    }

    return NextResponse.json({
      ok: true,
      extracted,
      results,
      abnormal_values: abnormals,
      has_abnormals: abnormals.length > 0,
    })
  } catch (err: any) {
    console.error('[Lab Extract] Error:', err)
    return NextResponse.json({ error: err.message || 'Extraction failed' }, { status: 500 })
  }
}