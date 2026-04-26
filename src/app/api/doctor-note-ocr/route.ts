/**
 * src/app/api/doctor-note-ocr/route.ts
 *
 * Doctor Note Photo Reader — handles cursive & non-block handwriting
 *
 * POST /api/doctor-note-ocr
 * Body: multipart/form-data
 *   - image: File (JPG / PNG / WebP)
 *   - context: optional string (patient name, date, hint about content)
 *
 * Returns:
 *   { transcription, structured, confidence, raw_text, provider }
 *
 * Why a separate route from /api/ocr?
 *   The standard /api/ocr route is tuned for structured printed/block-letter
 *   forms and returns rigid JSON schema. Doctor notes are free-form narrative,
 *   often in cursive, with abbreviations. This route uses a different system
 *   prompt optimised for clinical handwriting interpretation.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth }               from '@/lib/api-auth'
import { hasAnyAIKey, analyzeImage } from '@/lib/ai-client'

// ── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert medical transcriptionist specialising in reading
handwritten Indian doctor notes. You can read:
- Cursive handwriting (even difficult, fast doctor scrawl)
- Block letters
- Mixed cursive and print
- Medical shorthand and abbreviations common in India
- Gujarati words mixed into English clinical notes

MEDICAL ABBREVIATIONS you recognise (expand them in the output):
c/o = complains of, h/o = history of, k/c/o = known case of
P/A = per abdomen, P/V = per vaginum, P/S = per speculum
NAD = no abnormality detected, WNL = within normal limits
N/V = nausea/vomiting, SOB = shortness of breath
BP = blood pressure, PR = pulse rate, RR = respiratory rate
Hb = haemoglobin, CBC = complete blood count, USG = ultrasound
OCP = oral contraceptive pill, MTP = medical termination of pregnancy
LSCS = lower segment caesarean section, NVD = normal vaginal delivery
LMP = last menstrual period, EDD = expected date of delivery
G/P/A/L = gravida/para/abortion/living, ANC = antenatal care
Rx = prescription/treatment, Dx = diagnosis, Hx = history
FHS = foetal heart sounds, POG = period of gestation
TT = tetanus toxoid, IFA = iron folic acid
OD = once daily, BD = twice daily, TDS = three times a day, QID = four times a day
AC = before meals, PC = after meals, HS = at bedtime
Tab = tablet, Cap = capsule, Inj = injection, Syr = syrup

YOUR TASK:
1. Transcribe the handwritten text EXACTLY as it appears (preserve the structure)
2. In a separate structured section, extract key clinical data
3. If you cannot read a word, write [illegible] — do not guess
4. Expand common abbreviations inline in the structured output only, not in the transcription
5. Note the confidence level for difficult sections

Return JSON ONLY (no markdown fences):
{
  "transcription": "verbatim text from the note, preserving line breaks with \\n",
  "confidence": "high|medium|low",
  "illegible_sections": ["list any sections that were unclear"],
  "structured": {
    "chief_complaint": "",
    "history": "",
    "examination_findings": "",
    "diagnosis": "",
    "investigations_ordered": "",
    "treatment_plan": "",
    "medications": [
      { "drug": "", "dose": "", "frequency": "", "duration": "", "route": "" }
    ],
    "advice": "",
    "follow_up": "",
    "notes": ""
  },
  "raw_text": "same as transcription — full verbatim text"
}`

// ── Handler ──────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Require authentication
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  if (!hasAnyAIKey()) {
    return NextResponse.json({
      error: 'No AI key configured. Add ANTHROPIC_API_KEY or OPENAI_API_KEY.',
      _setup_required: true,
    }, { status: 503 })
  }

  try {
    const fd      = await req.formData()
    const file    = fd.get('image') as File | null
    const context = (fd.get('context') as string | null) ?? ''

    if (!file) {
      return NextResponse.json({ error: 'No image file provided.' }, { status: 400 })
    }

    const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    if (!ALLOWED.includes(file.type)) {
      return NextResponse.json({
        error: 'Unsupported format. Upload a JPG, PNG, or WebP photo of the note.',
      }, { status: 400 })
    }

    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image too large (max 20 MB).' }, { status: 400 })
    }

    const bytes     = await file.arrayBuffer()
    const base64    = Buffer.from(bytes).toString('base64')
    const mediaType = (file.type === 'image/jpg' ? 'image/jpeg' : file.type) as
                      'image/jpeg' | 'image/png' | 'image/webp'

    // Build user prompt with optional context hint
    let userPrompt = 'Please transcribe this handwritten doctor note. Include all text, even if partially illegible.'
    if (context.trim()) {
      userPrompt += `\n\nContext hint: ${context.trim()}`
    }
    userPrompt += '\n\nReturn JSON only — no markdown, no explanation.'

    const result = await analyzeImage({
      base64,
      mediaType,
      prompt:    userPrompt,
      system:    SYSTEM_PROMPT,
      maxTokens: 2048,
    })

    // Strip any accidental markdown fences
    const jsonString = result.text
      .replace(/^```json\s*/im, '')
      .replace(/^```\s*/im, '')
      .replace(/\s*```$/im, '')
      .trim()

    let parsed: any
    try {
      parsed = JSON.parse(jsonString)
    } catch {
      // AI failed to return valid JSON — return raw transcription anyway
      return NextResponse.json({
        transcription:       result.text,
        confidence:          'low',
        illegible_sections:  [],
        structured:          {},
        raw_text:            result.text,
        _provider:           result.provider,
        _parse_error:        true,
      })
    }

    return NextResponse.json({
      ...parsed,
      _provider: result.provider,
    })

  } catch (err: any) {
    console.error('[DoctorNoteOCR]', err?.message)

    if (err?.message?.includes('401') || err?.message?.includes('authentication')) {
      return NextResponse.json({ error: 'Invalid API key.' }, { status: 401 })
    }
    if (err?.message?.includes('429') || err?.message?.includes('rate')) {
      return NextResponse.json({ error: 'Rate limited — wait 30 seconds.' }, { status: 429 })
    }
    return NextResponse.json({
      error: `Processing failed: ${err?.message ?? 'Unknown error'}`,
    }, { status: 500 })
  }
}