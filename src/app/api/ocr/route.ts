/**
 * src/app/api/ocr/route.ts  — UPDATED
 *
 * CHANGE: Added requireAuth() guard. The full original system prompt (Gujarati
 * medical terms, all JSON schema, all 15 ABSOLUTE RULES), file validation logic,
 * image path, PDF path, markdown stripping, graceful low-confidence fallback,
 * and all error handlers are preserved exactly as in the original.
 */

import { NextRequest, NextResponse } from 'next/server'
import { analyzeImage, analyzePDF, hasAnyAIKey } from '@/lib/ai-client'
import { requireAuth } from '@/lib/api-auth'
import type { OCRResult } from '@/lib/ocr'

const SYSTEM_PROMPT = `You are a medical form OCR specialist for Indian hospitals in Gujarat.
You read photographed, scanned, or digitally filled forms and extract structured data into JSON.

LANGUAGE SUPPORT: Gujarati, English, Hindi, and mixed forms.

GUJARATI MEDICAL TERMS:
નામ=Name, ઉંમર=Age, જન્મ તારીખ=DOB, લિંગ=Gender
સ્ત્રી=Female, પુરૂષ=Male, સરનામું=Address, ફોન/મોબાઈલ=Phone
લોહી જૂથ=Blood Group, નિદાન=Diagnosis, ફરિયાદ=Complaint
છેલ્લા માસિક=LMP, ગ્રૅવિડ=Gravida, પ્રસૂત=Para, ઈ.ડી.ડી=EDD
માસિક=Menstrual, નિયમિત=Regular, અનિયમિત=Irregular
ભૂતકાળ=Past History, ડાયાબિટીસ=Diabetes, બ્લડ પ્રેશર=BP
ઓપરેશન=Surgery, આવક=Income, ખર્ચ=Expenditure

ABSOLUTE RULES:
1. Return ONLY valid JSON — no markdown, no explanation
2. Dates → ISO YYYY-MM-DD
3. BP "120/80" → bp_systolic:"120", bp_diastolic:"80"
4. Gender: "Female" | "Male" | "Other"
5. Blood group: "A+" | "A-" | "B+" | "B-" | "O+" | "O-" | "AB+" | "AB-"
6. Mobile: 10 digits only
7. Omit blank/illegible fields — never invent values
8. Numeric values stored as strings
9. CHECKBOX DETECTION: Look for filled/ticked/marked checkboxes (✓, ✗, X, filled square, or any mark inside the checkbox box). A checkbox with any mark = selected. Empty checkbox = not selected.
10. Mediclaim: "Yes" if the Yes checkbox next to "Mediclaim / Health Insurance" is marked, "No" if the No checkbox is marked or neither is marked
11. Cashless: "Yes" if the Yes checkbox next to "Cashless Facility" is marked, "No" if the No checkbox is marked or neither is marked
12. Reference source: Match to one of: "Doctor Referral"|"Patient Referral"|"Advertisement"|"Google / Internet"|"Social Media"|"Walk-in"|"Camp / Outreach"|"Other"
13. For obstetric_history: create one entry per pregnancy row found (1st, 2nd, 3rd, 4th). Only include rows that have data.
14. For abortion_entries: create one entry per distinct abortion event found. Only include if abortion count > 0.
15. past_diabetes / past_hypertension / past_thyroid / past_surgery: set true only if clearly marked/written as positive. Default omit (not false).
16. income / expenditure: extract numeric value only (no ₹ symbol), store as string.

JSON SCHEMA:
{
  "form_type": "patient_registration|opd_consultation|anc_card|lab_report|prescription",
  "confidence": "high|medium|low",
  "language_detected": "Gujarati|English|Mixed|Hindi",
  "raw_text": "<full text from form>",
  "patient": {
    "full_name":"","age":"","date_of_birth":"YYYY-MM-DD","gender":"",
    "mobile":"","blood_group":"","address":"","abha_id":"","aadhaar_no":"",
    "emergency_contact_name":"","emergency_contact_phone":"",
    "mediclaim":"Yes|No","cashless":"Yes|No","policy_tpa_name":"",
    "reference_source":"Doctor Referral|Patient Referral|Advertisement|Google / Internet|Social Media|Walk-in|Camp / Outreach|Other",
    "reference_detail":""
  },
  "vitals": {
    "pulse":"","bp_systolic":"","bp_diastolic":"","temperature":"",
    "spo2":"","weight":"","height":"","chief_complaint":"","diagnosis":"","notes":""
  },
  "ob_data": {
    "lmp":"YYYY-MM-DD","gravida":"","para":"","abortion":"","living":"",
    "fhs":"","liquor":"","fundal_height":"","presentation":"",
    "per_abdomen":"","per_speculum":"","per_vaginum":"",
    "menstrual_regularity":"Regular|Irregular",
    "menstrual_flow":"Scanty|Normal|Heavy",
    "post_menstrual_days":"",
    "post_menstrual_pain":"Mild|Moderate|Severe",
    "urine_pregnancy_result":"",
    "obstetric_history":[
      {
        "pregnancy_no":"1",
        "type":"Full Term|Preterm",
        "delivery_mode":"Normal|CS",
        "outcome":"Live|Expired",
        "baby_gender":"M|F",
        "age_of_child":""
      }
    ],
    "abortion_entries":[
      {
        "type":"Spontaneous|Induced",
        "weeks":"",
        "method":"Medicines|Surgery",
        "years_ago":""
      }
    ],
    "past_diabetes":false,
    "past_hypertension":false,
    "past_thyroid":false,
    "past_surgery":false,
    "past_surgery_detail":"",
    "income":"",
    "expenditure":""
  },
  "prescription": {
    "medications":[{"drug":"","dose":"","route":"","frequency":"","duration":""}],
    "advice":"","follow_up_date":"YYYY-MM-DD"
  },
  "unrecognised_fields": ""
}
Return ONLY valid JSON.`

export async function POST(req: NextRequest) {
  // ── Auth gate ────────────────────────────────────────────────
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth
  // ────────────────────────────────────────────────────────────

  if (!hasAnyAIKey()) {
    return NextResponse.json({
      error: 'No AI key configured. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to .env.local and restart.',
      _setup_required: true,
    })
  }

  try {
    const fd       = await req.formData()
    const file     = fd.get('image') as File | null
    const hintType = (fd.get('form_type') as string | null) ?? ''

    if (!file) {
      return NextResponse.json({ error: 'No file provided.' })
    }

    // Validate file type — now includes PDF
    const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
    if (!ALLOWED.includes(file.type)) {
      return NextResponse.json({
        error: `Unsupported format "${file.type}". Use JPG, PNG, WebP images or PDF documents.`,
      })
    }

    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 20 MB).' })
    }

    const bytes  = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')

    const userPrompt = hintType
      ? `Extract all fields from this ${hintType.replace(/_/g, ' ')} form. Return JSON only.`
      : 'Extract all fields from this medical form. Detect the form type. Return JSON only.'

    let rawResponse: string
    let provider:    string

    if (file.type === 'application/pdf') {
      // PDF path — uses Anthropic native PDF or text-extraction fallback
      const result = await analyzePDF({
        base64,
        prompt:    userPrompt,
        system:    SYSTEM_PROMPT,
        maxTokens: 2048,
      })
      rawResponse = result.text
      provider    = result.provider
    } else {
      // Image path — uses vision models
      const mediaType = (file.type === 'image/jpg' ? 'image/jpeg' : file.type) as 'image/jpeg' | 'image/png' | 'image/webp'
      const result = await analyzeImage({
        base64,
        mediaType,
        prompt:    userPrompt,
        system:    SYSTEM_PROMPT,
        maxTokens: 2048,
      })
      rawResponse = result.text
      provider    = result.provider
    }

    // Strip markdown fences
    const jsonString = rawResponse
      .replace(/^```json\s*/im, '')
      .replace(/^```\s*/im, '')
      .replace(/\s*```$/im, '')
      .trim()

    let parsed: OCRResult
    try {
      parsed = JSON.parse(jsonString) as OCRResult
    } catch {
      return NextResponse.json({
        form_type:           (hintType || 'patient_registration') as OCRResult['form_type'],
        confidence:          'low' as const,
        language_detected:   'Unknown',
        raw_text:            rawResponse,
        unrecognised_fields: 'Could not parse AI response. For PDFs, ensure the file has readable text.',
        _provider:           provider,
      })
    }

    parsed.form_type         ??= (hintType as OCRResult['form_type']) || 'patient_registration'
    parsed.confidence        ??= 'medium'
    parsed.language_detected ??= 'Unknown'
    parsed.raw_text          ??= ''

    return NextResponse.json({ ...parsed, _provider: provider })

  } catch (err: any) {
    console.error('[OCR API]', err?.message)

    if (err?.message?.includes('NO_AI_KEY')) {
      return NextResponse.json({
        error: 'No AI key configured. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to .env.local.',
      })
    }
    if (err?.message?.includes('PDF_NO_TEXT') || err?.message?.includes('no readable text') || err?.message?.includes('no text layer')) {
      return NextResponse.json({
        error: 'SCANNED_PDF: This PDF is a scanned image with no text layer. The app tried to render it as an image but failed. Please photograph the paper form with your camera instead, then upload the photo (JPG/PNG).',
      })
    }
    if (err?.message?.includes('401') || err?.message?.includes('authentication')) {
      return NextResponse.json({ error: 'Invalid API key. Check .env.local.' })
    }
    if (err?.message?.includes('429') || err?.message?.includes('rate')) {
      return NextResponse.json({ error: 'Rate limited. Wait 30 seconds and try again.' })
    }
    return NextResponse.json({
      error: `OCR failed: ${err?.message || 'Unknown error. Check server console.'}`,
    })
  }
}