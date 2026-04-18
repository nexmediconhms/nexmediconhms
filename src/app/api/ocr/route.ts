import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { OCRResult } from '@/lib/ocr'

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT — Gujarati + English medical form OCR specialist
// ─────────────────────────────────────────────────────────────────────────────
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
છેલ્લા માસિક=LMP, બ્લડ પ્રેશર=Blood Pressure, FHS=FHS (same in Gujarati)
પ્રસૂતિ=Delivery/Obstetric, ઓળખ=Identity, ABHA=ABHA
ગ્રૅવિડ=Gravida, પ્રસૂત=Para, ગર્ભપાત=Abortion, જીવિત=Living
ગર્ભાશય=Uterus, અંડાશય=Ovary, ઉંડ=Engagement, ગ્રીવા=Cervix
પ્રવાહ=Discharge, રક્તસ્ત્રાવ=Bleeding, બ્લડ સુગર=Blood Sugar
હિમોગ્લોબિન=Haemoglobin, યુરિન=Urine, ઈ.ડી.ડી=EDD

ABSOLUTE RULES:
1. Return ONLY a single valid JSON object — zero markdown, zero explanation, zero extra text
2. Dates must be converted to ISO YYYY-MM-DD (e.g. 15/3/1990 → 1990-03-15)
3. BP written as "120/80" → bp_systolic:"120", bp_diastolic:"80"
4. Gender must be exactly "Female", "Male", or "Other"
5. Blood group must be exactly one of: "A+","A-","B+","B-","O+","O-","AB+","AB-"
6. Mobile numbers: extract 10 digits only, strip leading 0 or country code +91
7. Omit any field that is blank, illegible, or absent — never invent values
8. All numeric values are stored as strings (e.g. "72" not 72)
9. confidence: "high" = >80% readable, "medium" = 50-80%, "low" = <50%
10. Omit entire section objects if they have no data

EXACT JSON SCHEMA (include only keys that have actual data from the form):
{
  "form_type": "patient_registration|opd_consultation|anc_card|lab_report|prescription",
  "confidence": "high|medium|low",
  "language_detected": "Gujarati|English|Mixed Gujarati-English|Hindi|Mixed",
  "raw_text": "<full verbatim text you read from the image>",
  "patient": {
    "full_name": "",
    "age": "",
    "date_of_birth": "YYYY-MM-DD",
    "gender": "Female|Male|Other",
    "mobile": "10digits",
    "blood_group": "A+|A-|B+|B-|O+|O-|AB+|AB-",
    "address": "",
    "abha_id": "",
    "emergency_contact_name": "",
    "emergency_contact_phone": ""
  },
  "vitals": {
    "pulse": "", "bp_systolic": "", "bp_diastolic": "",
    "temperature": "", "spo2": "", "weight": "", "height": "",
    "chief_complaint": "", "diagnosis": "", "notes": ""
  },
  "ob_data": {
    "lmp": "YYYY-MM-DD", "gravida": "", "para": "", "abortion": "", "living": "",
    "fhs": "", "liquor": "", "fundal_height": "", "presentation": "", "engagement": "",
    "uterus_size": "", "scar_tenderness": "", "fetal_movement": ""
  },
  "lab": {
    "test_name": "", "result_value": "", "unit": "", "reference_range": "",
    "all_results": "<full text of all lab values on the report>"
  },
  "prescription": {
    "medications": [{"drug": "", "dose": "", "route": "", "frequency": "", "duration": "", "instructions": ""}],
    "advice": "", "dietary_advice": "", "reports_needed": "", "follow_up_date": "YYYY-MM-DD"
  },
  "unrecognised_fields": "<any text on the form that did not map to the above fields>"
}

Detect the form_type from visual clues: headings, layout, fields visible on the form.`

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ocr
// Always returns HTTP 200 — error info is in the JSON body { error: string }
// This prevents browser console "Failed to load resource" noise.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    // ── 1. Parse multipart form ───────────────────────────────
    let fd: FormData
    try {
      fd = await req.formData()
    } catch (e: any) {
      return NextResponse.json({ error: 'Could not parse upload. Please try again.' })
    }

    const file     = fd.get('image') as File | null
    const hintType = (fd.get('form_type') as string | null) ?? ''

    if (!file || file.size === 0) {
      return NextResponse.json({ error: 'No image received. Please try again.' })
    }

    // ── 2. Validate file type ─────────────────────────────────
    const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    const fileType = file.type || 'image/jpeg'
    if (!ALLOWED.includes(fileType)) {
      return NextResponse.json({
        error: `Unsupported format "${fileType}". Please use JPG, PNG, or WebP.`
      })
    }

    // ── 3. Validate size (max 10 MB) ──────────────────────────
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({
        error: 'Photo too large (max 10 MB). Try taking the photo from closer or use lower resolution.'
      })
    }

    // ── 4. Check API key ──────────────────────────────────────
    const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim()
    if (!apiKey) {
      return NextResponse.json({
        error: 'ANTHROPIC_API_KEY is missing from .env.local. Add it and restart the server.',
        setup_required: true
      })
    }
    if (apiKey.includes('YOUR') || apiKey.includes('YOUR_KEY') || apiKey.length < 20) {
      return NextResponse.json({
        error: 'ANTHROPIC_API_KEY is still the placeholder value. Open .env.local, replace it with your real key from console.anthropic.com, then restart with: npm run dev',
        setup_required: true
      })
    }

    // ── 5. Base64 encode ──────────────────────────────────────
    const bytes     = await file.arrayBuffer()
    const base64    = Buffer.from(bytes).toString('base64')
    // Normalize jpg → jpeg for API
    const mediaType = (fileType === 'image/jpg' ? 'image/jpeg' : fileType) as 'image/jpeg' | 'image/png' | 'image/webp'

    // ── 6. Call Claude Vision with model fallback chain ───────
    const VISION_MODELS = [
      'claude-sonnet-4-6',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-sonnet-20240620',
    ]

    const client = new Anthropic({ apiKey })
    const userMsg = hintType
      ? `Extract all fields from this ${hintType.replace(/_/g, ' ')} form. Return JSON only.`
      : `Extract all fields from this medical form. Detect the form type. Return JSON only.`

    let rawResponse = ''
    let lastErr: any = null

    for (const model of VISION_MODELS) {
      try {
        const response = await client.messages.create({
          model,
          max_tokens: 2048,
          system:     SYSTEM_PROMPT,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text', text: userMsg },
            ],
          }],
        })
        rawResponse = response.content
          .filter(b => b.type === 'text')
          .map(b => (b as { type: 'text'; text: string }).text)
          .join('')
        lastErr = null
        break
      } catch (err: any) {
        console.error(`[OCR] model ${model} failed: status=${err?.status} msg=${err?.message}`)
        lastErr = err
        if (err?.status === 401) break  // invalid key — no point trying other models
      }
    }

    // ── 7. Handle model errors ────────────────────────────────
    if (lastErr) {
      const s = lastErr?.status
      if (s === 401) {
        return NextResponse.json({
          error: 'Anthropic API key is invalid (401 Unauthorized). Go to console.anthropic.com → API Keys, create a new key, update ANTHROPIC_API_KEY in .env.local, and restart.',
          setup_required: true
        })
      }
      if (s === 429) {
        return NextResponse.json({
          error: 'Anthropic API rate limit reached. Wait 30 seconds and try again.'
        })
      }
      return NextResponse.json({
        error: `AI service error (${s ?? 'network'}): ${lastErr?.message ?? 'Unknown error. Check terminal for details.'}`
      })
    }

    // ── 8. Strip markdown fences ──────────────────────────────
    const jsonString = rawResponse
      .replace(/^```json\s*/im, '')
      .replace(/^```\s*/im,     '')
      .replace(/\s*```$/im,     '')
      .trim()

    // ── 9. Parse JSON ─────────────────────────────────────────
    let parsed: OCRResult
    try {
      parsed = JSON.parse(jsonString) as OCRResult
    } catch {
      // Return raw text in a low-confidence result rather than an error
      return NextResponse.json({
        form_type:           (hintType || 'opd_consultation') as OCRResult['form_type'],
        confidence:          'low' as const,
        language_detected:   'Unknown',
        raw_text:            rawResponse,
        unrecognised_fields: 'Could not parse structured data. The photo may be blurry — try with better lighting and hold steady.',
      })
    }

    // Ensure required keys exist
    parsed.form_type         ??= (hintType as OCRResult['form_type']) || 'opd_consultation'
    parsed.confidence        ??= 'medium'
    parsed.language_detected ??= 'Unknown'
    parsed.raw_text          ??= ''

    return NextResponse.json(parsed)

  } catch (err: unknown) {
    const e = err as { status?: number; message?: string }
    console.error('[OCR] outer catch:', e?.status, e?.message)
    return NextResponse.json({
      error: `OCR failed: ${e?.message || 'Unexpected error. Check the terminal/server console for details.'}`
    })
  }
}
