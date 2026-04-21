import { NextRequest, NextResponse } from 'next/server'
import { createWorker } from 'tesseract.js'

// Vercel serverless function config — Tesseract needs more time and memory
export const maxDuration = 60  // seconds (default is 10s on Hobby plan)
export const dynamic = 'force-dynamic'

/**
 * Free OCR endpoint using Tesseract.js
 *
 * No API key required. Runs entirely server-side.
 * Works best with:
 *   - Printed/typed text
 *   - BLOCK CAPITAL letters (as instructed on the forms)
 *   - Clear, well-lit photos
 *   - Black ink on white paper
 *
 * Limitations vs AI OCR:
 *   - Cannot read cursive handwriting
 *   - Gujarati script support requires gu.traineddata (auto-downloaded on first use)
 *   - Does not interpret or structure data — returns raw text only
 *   - The caller must parse the raw text into fields
 *
 * POST body: multipart/form-data
 *   image: File (JPG, PNG, WebP)
 *   lang:  string (optional) — 'eng' | 'guj' | 'eng+guj' (default: 'eng')
 *   form_type: string (optional)
 */

export async function POST(req: NextRequest) {
  try {
    const fd       = await req.formData()
    const file     = fd.get('image') as File | null
    const lang     = (fd.get('lang') as string | null) ?? 'eng'
    const formType = (fd.get('form_type') as string | null) ?? ''

    if (!file) {
      return NextResponse.json({ error: 'No image provided.' })
    }

    const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    if (!ALLOWED.includes(file.type)) {
      return NextResponse.json({ error: 'Use JPG, PNG, or WebP.' })
    }

    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image too large. Max 8 MB.' })
    }

    const bytes  = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Create Tesseract worker
    // Note: language data is auto-downloaded on first use (~4 MB for 'eng')
    // On Vercel serverless, use /tmp for cache (only writable directory)
    const worker = await createWorker(lang, 1, {
      logger: () => {},  // suppress progress logs
      cachePath: '/tmp',
    })

    try {
      const { data } = await worker.recognize(buffer)
      await worker.terminate()

      const rawText = data.text?.trim() ?? ''
      const confidence = data.confidence ?? 0

      // Parse the raw text into structured fields
      const parsed = parseFormText(rawText, formType)

      return NextResponse.json({
        ok:               true,
        raw_text:         rawText,
        confidence_pct:   Math.round(confidence),
        confidence:       confidence > 70 ? 'high' : confidence > 45 ? 'medium' : 'low',
        language_detected: lang.includes('guj') ? 'Gujarati' : 'English',
        form_type:        (formType || 'patient_registration') as any,
        ...parsed,
        _provider:        'tesseract.js (free, local)',
      })
    } catch (recognizeErr: any) {
      await worker.terminate()
      throw recognizeErr
    }

  } catch (err: any) {
    console.error('[OCR-Free]', err?.message)
    return NextResponse.json({
      error: `Free OCR failed: ${err?.message || 'Unknown error'}. Try the AI OCR (requires API key) for better accuracy.`,
    })
  }
}

// ── Parse raw Tesseract text into structured fields ───────────
function parseFormText(text: string, formType: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const patient: Record<string, string>  = {}
  const vitals:  Record<string, string>  = {}

  // Helper: find value after a label keyword
  function after(keywords: string[], inLines: string[] = lines): string {
    for (const line of inLines) {
      for (const kw of keywords) {
        const rx = new RegExp(kw + '[:\\s]+(.+)', 'i')
        const m  = line.match(rx)
        if (m) return m[1].trim()
      }
    }
    return ''
  }

  // Helper: extract number from text
  function num(str: string): string {
    const m = str.match(/\d+\.?\d*/)
    return m ? m[0] : ''
  }

  // ── Patient fields ────────────────────────────────────────
  patient.full_name = after(['full name', 'name', 'patient name', 'નામ'])
  patient.mobile    = after(['mobile', 'phone', 'contact', 'mob', 'cell'])
    .replace(/\D/g, '').slice(-10)
  patient.address   = after(['address', 'addr', 'residence', 'સરનામ'])
  patient.abha_id    = after(['abha', 'health id'])
  patient.aadhaar_no = after(['aadhaar', 'aadhar', 'adhar', 'adhaar', 'uid', 'આધાર'])
    .replace(/\D/g, '').slice(0, 12)

  // Date of birth
  const dobRaw = after(['date of birth', 'dob', 'd.o.b', 'birth date', 'જન્મ'])
  if (dobRaw) {
    // Convert DD/MM/YYYY → YYYY-MM-DD
    const m = dobRaw.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/)
    if (m) {
      const [, d, mo, y] = m
      const year = y.length === 2 ? '20' + y : y
      patient.date_of_birth = `${year}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`
    }
  }

  // Age
  const ageRaw = after(['age', 'ઉંમર'])
  patient.age  = num(ageRaw)

  // Gender — look for checkboxes or keywords
  const genderText = lines.join(' ').toLowerCase()
  if (/\bfemale\b|\bf\b|✓.*female|female.*✓/.test(genderText))     patient.gender = 'Female'
  else if (/\bmale\b|\bm\b|✓.*male|male.*✓/.test(genderText))       patient.gender = 'Male'

  // Blood group
  const bgMatch = lines.join(' ').match(/\b(A|B|AB|O)[+\-]\b/)
  if (bgMatch) patient.blood_group = bgMatch[0].toUpperCase()

  // Emergency contact
  patient.emergency_contact_name  = after(['emergency contact', 'emergency name', 'contact name'])
  patient.emergency_contact_phone = after(['emergency.*mobile', 'emergency.*phone', 'emergency.*number'])
    .replace(/\D/g, '').slice(-10)

  // Mediclaim / Insurance — look for checkbox marks near keywords
  const fullText = lines.join(' ')
  const mediclaimSection = fullText.match(/mediclaim[^]*?cashless/i)?.[0] ?? fullText
  if (/mediclaim[^]*?(?:✓|✗|x|\[x\]|☑)[^]*?yes/i.test(mediclaimSection) ||
      /yes[^]*?(?:✓|✗|x|\[x\]|☑)[^]*?mediclaim/i.test(mediclaimSection) ||
      /mediclaim[:\s]*yes/i.test(fullText)) {
    patient.mediclaim = 'Yes'
  } else {
    patient.mediclaim = 'No'
  }

  // Cashless
  const cashlessSection = fullText.match(/cashless[^]*?(?:policy|tpa|how did)/i)?.[0] ?? fullText
  if (/cashless[^]*?(?:✓|✗|x|\[x\]|☑)[^]*?yes/i.test(cashlessSection) ||
      /yes[^]*?(?:✓|✗|x|\[x\]|☑)[^]*?cashless/i.test(cashlessSection) ||
      /cashless[:\s]*yes/i.test(fullText)) {
    patient.cashless = 'Yes'
  } else {
    patient.cashless = 'No'
  }

  // Policy / TPA name
  patient.policy_tpa_name = after(['policy', 'tpa', 'insurance company', 'insurer'])

  // Reference source — look for checked options
  const refOptions = ['Doctor Referral', 'Patient Referral', 'Advertisement', 'Google / Internet', 'Social Media', 'Walk-in', 'Camp / Outreach']
  for (const opt of refOptions) {
    const pattern = new RegExp(`(?:✓|✗|x|\\[x\\]|☑)[^\\n]*?${opt.replace(/[\/]/g, '\\/')}|${opt.replace(/[\/]/g, '\\/')}[^\\n]*?(?:✓|✗|x|\\[x\\]|☑)`, 'i')
    if (pattern.test(fullText)) {
      patient.reference_source = opt
      break
    }
  }

  // ── Vitals fields (for consultation form) ──────────────────
  if (formType === 'opd_consultation' || formType === 'vitals_complaints') {
    const pulseRaw = after(['pulse', 'hr', 'heart rate', 'pr', 'નાડી'])
    vitals.pulse = num(pulseRaw)

    const bpRaw = after(['bp', 'blood pressure', 'b.p', 'બ્લડ પ્રેશર'])
    const bpM   = bpRaw.match(/(\d{2,3})\s*[\/]\s*(\d{2,3})/)
    if (bpM) { vitals.bp_systolic = bpM[1]; vitals.bp_diastolic = bpM[2] }

    const tempRaw = after(['temp', 'temperature', 'fever', 'તાવ'])
    vitals.temperature = num(tempRaw)

    const spo2Raw = after(['spo2', 'spo₂', 'oxygen', 'o2 sat'])
    vitals.spo2 = num(spo2Raw)

    const wtRaw = after(['weight', 'wt', 'wgt', 'વજન'])
    vitals.weight = num(wtRaw)

    const htRaw = after(['height', 'ht', 'hgt', 'ઊંચ'])
    vitals.height = num(htRaw)

    vitals.chief_complaint = after(['chief complaint', 'complaints', 'presenting complaint', 'cc', 'ફરિયાદ'])
  }

  // Build result
  const result: any = { form_type: formType || 'patient_registration' }

  if (Object.values(patient).some(v => v)) result.patient = patient
  if (Object.values(vitals).some(v => v))  result.vitals  = vitals

  return result
}
