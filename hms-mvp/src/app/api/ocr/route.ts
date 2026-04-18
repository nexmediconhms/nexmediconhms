import { NextRequest, NextResponse } from 'next/server'
import { analyzeImage, hasAnyAIKey } from '@/lib/ai-client'
import type { OCRResult } from '@/lib/ocr'

const SYSTEM_PROMPT = `You are a medical form OCR specialist for Indian hospitals in Gujarat.
You read photographed or scanned paper forms and extract structured data into JSON.

LANGUAGE SUPPORT:
You can read Gujarati script, English, Hindi (Devanagari), and mixed forms.
Many Gujarati hospital forms use Gujarati labels with handwritten English/Gujarati values.

GUJARATI MEDICAL TERMS — REFERENCE:
નામ=Name, ઉંમર=Age, જન્મ તારીખ=Date of Birth, લિંગ=Gender
સ્ત્રી=Female, પુરૂષ=Male, સરનામું=Address, ફોન/મોબાઈલ=Phone
લોહી જૂથ=Blood Group, નિદાન=Diagnosis, ફરિયાદ/ફરિયાદો=Complaint(s)
દવા=Medicine, નાડી=Pulse, તાવ=Temperature, વજન=Weight, ઊંચાઇ=Height
છેલ્લા માસિક=LMP, બ્લડ પ્રેશર=Blood Pressure, FHS=FHS
ગ્રૅવિડ=Gravida, પ્રસૂત=Para, ગર્ભપાત=Abortion, જીવિત=Living
ઈ.ડી.ડી=EDD, હિમોગ્લોબિન=Haemoglobin, યુરિન=Urine

ABSOLUTE RULES:
1. Return ONLY a single valid JSON object — zero markdown, zero explanation, zero extra text
2. Dates → ISO YYYY-MM-DD (e.g. 15/3/1990 → 1990-03-15)
3. BP "120/80" → bp_systolic:"120", bp_diastolic:"80"
4. Gender must be exactly "Female", "Male", or "Other"
5. Blood group: "A+","A-","B+","B-","O+","O-","AB+","AB-"
6. Mobile: 10 digits only, strip leading 0 or +91
7. Omit any field that is blank, illegible, or absent — never invent values
8. All numeric values stored as strings
9. confidence: "high" = >80% readable, "medium" = 50-80%, "low" = <50%

JSON SCHEMA:
{
  "form_type": "patient_registration|opd_consultation|anc_card|lab_report|prescription",
  "confidence": "high|medium|low",
  "language_detected": "Gujarati|English|Mixed Gujarati-English|Hindi|Mixed",
  "raw_text": "<full verbatim text>",
  "patient": { "full_name":"","age":"","date_of_birth":"YYYY-MM-DD","gender":"","mobile":"","blood_group":"","address":"","abha_id":"","emergency_contact_name":"","emergency_contact_phone":"" },
  "vitals": { "pulse":"","bp_systolic":"","bp_diastolic":"","temperature":"","spo2":"","weight":"","height":"","chief_complaint":"","diagnosis":"","notes":"" },
  "ob_data": { "lmp":"YYYY-MM-DD","gravida":"","para":"","abortion":"","living":"","fhs":"","liquor":"","fundal_height":"","presentation":"","engagement":"","per_abdomen":"","per_speculum":"","per_vaginum":"" },
  "lab": { "test_name":"","result_value":"","unit":"","reference_range":"","all_results":"" },
  "prescription": { "medications":[{"drug":"","dose":"","route":"","frequency":"","duration":"","instructions":""}],"advice":"","follow_up_date":"YYYY-MM-DD" },
  "unrecognised_fields": ""
}
Return ONLY valid JSON. No markdown fences.`

export async function POST(req: NextRequest) {
  // Pre-flight: at least one AI key must be configured
  if (!hasAnyAIKey()) {
    return NextResponse.json({
      error: 'AI key not configured. Open .env.local → set ANTHROPIC_API_KEY=sk-ant-... (from console.anthropic.com) or OPENAI_API_KEY=sk-... (from platform.openai.com) → restart server. Then go to /ai-setup to verify.',
      _setup_required: true,
    })
  }

  try {
    const fd       = await req.formData()
    const file     = fd.get('image') as File | null
    const hintType = (fd.get('form_type') as string | null) ?? ''

    if (!file) {
      return NextResponse.json({ error: 'No image provided.' })
    }

    const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    if (!ALLOWED.includes(file.type)) {
      return NextResponse.json({ error: `Unsupported format. Use JPG, PNG, or WebP.` })
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Photo too large (max 10 MB).' })
    }

    const bytes     = await file.arrayBuffer()
    const base64    = Buffer.from(bytes).toString('base64')
    const mediaType = (file.type === 'image/jpg' ? 'image/jpeg' : file.type) as 'image/jpeg' | 'image/png' | 'image/webp'

    const userPrompt = hintType
      ? `Extract all fields from this ${hintType.replace(/_/g, ' ')} form. Return JSON only.`
      : 'Extract all fields from this medical form. Detect the form type. Return JSON only.'

    const { text: rawResponse, provider } = await analyzeImage({
      base64,
      mediaType,
      prompt:    userPrompt,
      system:    SYSTEM_PROMPT,
      maxTokens: 2048,
    })

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
        form_type:           (hintType || 'opd_consultation') as OCRResult['form_type'],
        confidence:          'low' as const,
        language_detected:   'Unknown',
        raw_text:            rawResponse,
        unrecognised_fields: 'Could not parse AI response. Try with better lighting and a steadier hand.',
        _provider:           provider,
      })
    }

    parsed.form_type         ??= (hintType as OCRResult['form_type']) || 'opd_consultation'
    parsed.confidence        ??= 'medium'
    parsed.language_detected ??= 'Unknown'
    parsed.raw_text          ??= ''

    return NextResponse.json({ ...parsed, _provider: provider })

  } catch (err: any) {
    console.error('[OCR API]', err?.message)

    if (err?.message?.includes('NO_AI_KEY')) {
      return NextResponse.json({ error: 'No AI key configured. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to .env.local and restart.' })
    }
    if (err?.message?.includes('401') || err?.message?.includes('authentication')) {
      return NextResponse.json({ error: 'Invalid API key. Check ANTHROPIC_API_KEY or OPENAI_API_KEY in .env.local.' })
    }
    if (err?.message?.includes('429') || err?.message?.includes('rate')) {
      return NextResponse.json({ error: 'Rate limited. Wait 30 seconds and try again.' })
    }
    return NextResponse.json({ error: `OCR failed: ${err?.message || 'Unknown error. Check server console.'}` })
  }
}
