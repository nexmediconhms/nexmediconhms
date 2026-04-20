import { NextRequest, NextResponse } from 'next/server'
import { analyzeImage, analyzePDF, hasAnyAIKey } from '@/lib/ai-client'
import type { OCRResult } from '@/lib/ocr'

const SYSTEM_PROMPT = `You are a medical form OCR specialist for Indian hospitals in Gujarat.
You read photographed, scanned, or digitally filled forms and extract structured data into JSON.

LANGUAGE SUPPORT: Gujarati, English, Hindi, and mixed forms.

GUJARATI MEDICAL TERMS:
નામ=Name, ઉંમર=Age, જન્મ તારીખ=DOB, લિંગ=Gender
સ્ત્રી=Female, પુરૂષ=Male, સરનામું=Address, ફોન/મોબાઈલ=Phone
લોહી જૂથ=Blood Group, નિદાન=Diagnosis, ફરિયાદ=Complaint
છેલ્લા માસિક=LMP, ગ્રૅવિડ=Gravida, પ્રસૂત=Para, ઈ.ડી.ડી=EDD

ABSOLUTE RULES:
1. Return ONLY valid JSON — no markdown, no explanation
2. Dates → ISO YYYY-MM-DD
3. BP "120/80" → bp_systolic:"120", bp_diastolic:"80"
4. Gender: "Female" | "Male" | "Other"
5. Blood group: "A+" | "A-" | "B+" | "B-" | "O+" | "O-" | "AB+" | "AB-"
6. Mobile: 10 digits only
7. Omit blank/illegible fields — never invent values
8. Numeric values stored as strings

JSON SCHEMA:
{
  "form_type": "patient_registration|opd_consultation|anc_card|lab_report|prescription",
  "confidence": "high|medium|low",
  "language_detected": "Gujarati|English|Mixed|Hindi",
  "raw_text": "<full text from form>",
  "patient": {
    "full_name":"","age":"","date_of_birth":"YYYY-MM-DD","gender":"",
    "mobile":"","blood_group":"","address":"","abha_id":"",
    "emergency_contact_name":"","emergency_contact_phone":""
  },
  "vitals": {
    "pulse":"","bp_systolic":"","bp_diastolic":"","temperature":"",
    "spo2":"","weight":"","height":"","chief_complaint":"","diagnosis":"","notes":""
  },
  "ob_data": {
    "lmp":"YYYY-MM-DD","gravida":"","para":"","abortion":"","living":"",
    "fhs":"","liquor":"","fundal_height":"","presentation":"",
    "per_abdomen":"","per_speculum":"","per_vaginum":""
  },
  "prescription": {
    "medications":[{"drug":"","dose":"","route":"","frequency":"","duration":""}],
    "advice":"","follow_up_date":"YYYY-MM-DD"
  },
  "unrecognised_fields": ""
}
Return ONLY valid JSON.`

export async function POST(req: NextRequest) {
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
    if (err?.message?.includes('no extractable text')) {
      return NextResponse.json({
        error: 'This PDF appears to be a scanned image. Please photograph it and upload as JPG instead, or use an AI key (Anthropic) which can read scanned PDFs natively.',
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
