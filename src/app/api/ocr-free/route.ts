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
 *   - Gujarati script support requires guj.traineddata (auto-downloaded on first use)
 *   - Does not interpret or structure data — returns raw text only
 *   - The caller must parse the raw text into fields
 *
 * POST body: multipart/form-data
 *   image: File (JPG, PNG, WebP)
 *   lang:  string (optional) — 'eng' | 'guj' | 'eng+guj' (default: 'eng+guj')
 *   form_type: string (optional)
 */

// ── Gujarati / Indic digit conversion (server-side) ──────────
const GUJARATI_DIGIT_MAP: Record<string, string> = {
  '૦': '0', '૧': '1', '૨': '2', '૩': '3', '૪': '4',
  '૫': '5', '૬': '6', '૭': '7', '૮': '8', '૯': '9',
}
const HINDI_DIGIT_MAP: Record<string, string> = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
}
function indicDigitsToAscii(str: string): string {
  return str.replace(/[૦-૯०-९]/g, ch =>
    GUJARATI_DIGIT_MAP[ch] || HINDI_DIGIT_MAP[ch] || ch
  )
}
function containsGujarati(str: string): boolean {
  return /[\u0A80-\u0AFF]/.test(str)
}
function containsHindi(str: string): boolean {
  return /[\u0900-\u097F]/.test(str)
}
function detectLang(text: string): string {
  const hasGuj  = containsGujarati(text)
  const hasHin  = containsHindi(text)
  const hasLatin = /[a-zA-Z]/.test(text)
  if (hasGuj && hasLatin) return 'Mixed Gujarati-English'
  if (hasGuj)             return 'Gujarati'
  if (hasHin && hasLatin) return 'Mixed Hindi-English'
  if (hasHin)             return 'Hindi'
  return 'English'
}

// Gujarati gender mappings
const GUJARATI_GENDER_MAP: Record<string, string> = {
  'સ્ત્રી': 'Female', 'પુરૂષ': 'Male', 'પુરુષ': 'Male',
  'મહિલા': 'Female', 'અન્ય': 'Other',
}

export async function POST(req: NextRequest) {
  try {
    // ── Check if this is a JSON request (client-side OCR already done) ──
    const contentType = req.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const body = await req.json()
      const rawText  = body.raw_text ?? ''
      const formType = body.form_type ?? ''
      if (!rawText) {
        return NextResponse.json({ error: 'No text provided.' })
      }
      const parsed = parseFormText(rawText, formType)
      const detectedLanguage = detectLang(rawText)
      return NextResponse.json({
        ok:               true,
        raw_text:         rawText,
        confidence:       'medium',
        language_detected: detectedLanguage,
        form_type:        (formType || 'patient_registration') as any,
        ...parsed,
        _provider:        'tesseract.js (browser, free)',
      })
    }

    // ── FormData request (server-side OCR with Tesseract) ──
    const fd       = await req.formData()
    const file     = fd.get('image') as File | null
    // Default to eng+guj for bilingual support
    const lang     = (fd.get('lang') as string | null) ?? 'eng+guj'
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

    // Create Tesseract worker with eng+guj for bilingual support
    // Note: language data is auto-downloaded on first use (~4 MB for 'eng', ~6 MB for 'guj')
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

      // Detect language from the extracted text
      const detectedLanguage = detectLang(rawText)

      // Parse the raw text into structured fields
      const parsed = parseFormText(rawText, formType)

      return NextResponse.json({
        ok:               true,
        raw_text:         rawText,
        confidence_pct:   Math.round(confidence),
        confidence:       confidence > 70 ? 'high' : confidence > 45 ? 'medium' : 'low',
        language_detected: detectedLanguage,
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
// Supports both English and Gujarati field labels
function parseFormText(text: string, formType: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const patient: Record<string, string>  = {}
  const vitals:  Record<string, string>  = {}

  // Helper: find value after a label keyword (fuzzy — handles OCR typos)
  function after(keywords: string[], inLines: string[] = lines): string {
    for (const line of inLines) {
      for (const kw of keywords) {
        // Try exact match first
        const rx = new RegExp(kw + '[:\\s\\-_|]+(.+)', 'i')
        const m  = line.match(rx)
        if (m) return m[1].trim().replace(/^[:\-_|]+/, '').trim()
      }
    }
    // Fuzzy: try matching with common OCR substitutions
    for (const line of inLines) {
      const lower = line.toLowerCase()
      for (const kw of keywords) {
        // Check if the line contains most characters of the keyword
        const kwLower = kw.toLowerCase()
        if (kwLower.length >= 4 && lower.includes(kwLower.slice(0, Math.ceil(kwLower.length * 0.7)))) {
          const parts = line.split(/[:\s\-_|]+/)
          const kwIdx = parts.findIndex(p => p.toLowerCase().includes(kwLower.slice(0, 3)))
          if (kwIdx >= 0 && kwIdx < parts.length - 1) {
            return parts.slice(kwIdx + 1).join(' ').trim()
          }
        }
      }
    }
    return ''
  }

  // Helper: extract number from text (supports Gujarati digits)
  function num(str: string): string {
    const ascii = indicDigitsToAscii(str)
    const m = ascii.match(/\d+\.?\d*/)
    return m ? m[0] : ''
  }

  // Helper: find a 10-digit phone number anywhere in text (supports Gujarati digits)
  function findPhone(): string {
    const allText = indicDigitsToAscii(lines.join(' '))
    const m = allText.match(/(?:(?:\+?91[\s\-]?)?([6-9]\d{9}))/g)
    return m ? m[0].replace(/\D/g, '').slice(-10) : ''
  }

  // Helper: find a 12-digit Aadhaar number anywhere in text (supports Gujarati digits)
  function findAadhaar(): string {
    const allText = indicDigitsToAscii(lines.join(' '))
    const m = allText.match(/\b(\d{4}[\s\-]?\d{4}[\s\-]?\d{4})\b/)
    return m ? m[1].replace(/\D/g, '') : ''
  }

  // ── Patient fields (English + Gujarati keywords) ────────────
  patient.full_name = after([
    'full name', 'patient name', 'name of patient', 'name',
    'નામ', 'દર્દીનું નામ', 'પૂરું નામ', 'પેશન્ટનું નામ',
    'patient'
  ])
  const mobileRaw = after([
    'mobile', 'phone', 'contact no', 'contact number', 'mob', 'cell', 'tel',
    'મોબાઈલ', 'ફોન', 'મોબાઈલ નંબર', 'ફોન નંબર', 'સંપર્ક'
  ])
  patient.mobile = indicDigitsToAscii(mobileRaw).replace(/\D/g, '').slice(-10)
  // Fallback: find phone number anywhere in text if label-based search failed
  if (!patient.mobile || patient.mobile.length < 10) {
    patient.mobile = findPhone()
  }
  patient.address = after([
    'address', 'addr', 'residence', 'residential address',
    'સરનામું', 'સરનામુ', 'ઠેકાણું', 'રહેઠાણ', 'ગામ', 'શહેર',
    'village', 'city'
  ])
  patient.abha_id = after(['abha', 'health id', 'abha id', 'health card', 'આભા', 'હેલ્થ આઈડી'])
  const aadhaarRaw = after([
    'aadhaar', 'aadhar', 'adhar', 'adhaar', 'uid',
    'આધાર', 'આધાર નંબર', 'આધાર કાર્ડ',
    'aadhaar no', 'aadhaar card', 'aadhar no'
  ])
  patient.aadhaar_no = indicDigitsToAscii(aadhaarRaw).replace(/\D/g, '').slice(0, 12)
  // Fallback: find 12-digit Aadhaar number anywhere in text
  if (!patient.aadhaar_no || patient.aadhaar_no.length < 12) {
    const found = findAadhaar()
    if (found.length === 12) patient.aadhaar_no = found
  }

  // Date of birth
  const dobRaw = after([
    'date of birth', 'dob', 'd.o.b', 'birth date',
    'જન્મ તારીખ', 'જન્મ', 'જન્મતારીખ'
  ])
  if (dobRaw) {
    // Convert DD/MM/YYYY → YYYY-MM-DD (normalize Gujarati digits first)
    const normalized = indicDigitsToAscii(dobRaw)
    const m = normalized.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/)
    if (m) {
      const [, d, mo, y] = m
      const year = y.length === 2 ? '20' + y : y
      patient.date_of_birth = `${year}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`
    }
  }

  // Age (supports Gujarati digits)
  const ageRaw = after(['age', 'ઉંમર', 'વય'])
  patient.age  = num(ageRaw)

  // Gender — look for checkboxes or keywords (English + Gujarati)
  const genderText = lines.join(' ')
  const genderLower = genderText.toLowerCase()
  // Check Gujarati gender terms first
  if (/સ્ત્રી|મહિલા/.test(genderText))                                    patient.gender = 'Female'
  else if (/પુરૂષ|પુરુષ/.test(genderText))                                patient.gender = 'Male'
  else if (/અન્ય/.test(genderText))                                        patient.gender = 'Other'
  else if (/\bfemale\b|\bf\b|✓.*female|female.*✓/.test(genderLower))       patient.gender = 'Female'
  else if (/\bmale\b|\bm\b|✓.*male|male.*✓/.test(genderLower))             patient.gender = 'Male'
  else if (/\bother\b/.test(genderLower))                                   patient.gender = 'Other'

  // Also try label-based gender extraction
  if (!patient.gender) {
    const genderVal = after(['gender', 'sex', 'લિંગ', 'જાતિ'])
    if (genderVal) {
      const mapped = GUJARATI_GENDER_MAP[genderVal.trim()] || GUJARATI_GENDER_MAP[genderVal.trim().toLowerCase()]
      if (mapped) patient.gender = mapped
      else if (/female/i.test(genderVal)) patient.gender = 'Female'
      else if (/male/i.test(genderVal))   patient.gender = 'Male'
      else if (/other/i.test(genderVal))  patient.gender = 'Other'
    }
  }

  // Blood group
  const bgMatch = indicDigitsToAscii(lines.join(' ')).match(/\b(A|B|AB|O)[+\-]\b/)
  if (bgMatch) patient.blood_group = bgMatch[0].toUpperCase()

  // Emergency contact (English + Gujarati)
  patient.emergency_contact_name = after([
    'emergency contact', 'emergency name', 'contact name',
    'ઈમરજન્સી સંપર્ક', 'કટોકટી સંપર્ક', 'સંબંધી નામ'
  ])
  const emergPhoneRaw = after([
    'emergency.*mobile', 'emergency.*phone', 'emergency.*number',
    'ઈમરજન્સી ફોન', 'કટોકટી ફોન', 'સંબંધી ફોન'
  ])
  patient.emergency_contact_phone = indicDigitsToAscii(emergPhoneRaw).replace(/\D/g, '').slice(-10)

  // Mediclaim / Insurance — look for checkbox marks near keywords (English + Gujarati)
  const fullText = lines.join(' ')
  const mediclaimSection = fullText.match(/(?:mediclaim|મેડિક્લેમ|ઈન્સ્યોરન્સ)[^]*?(?:cashless|કેશલેસ)/i)?.[0] ?? fullText
  if (/(?:mediclaim|મેડિક્લેમ)[^]*?(?:✓|✗|x|\[x\]|☑)[^]*?(?:yes|હા)/i.test(mediclaimSection) ||
      /(?:yes|હા)[^]*?(?:✓|✗|x|\[x\]|☑)[^]*?(?:mediclaim|મેડિક્લેમ)/i.test(mediclaimSection) ||
      /(?:mediclaim|મેડિક્લેમ)[:\s]*(?:yes|હા)/i.test(fullText)) {
    patient.mediclaim = 'Yes'
  } else {
    patient.mediclaim = 'No'
  }

  // Cashless
  const cashlessSection = fullText.match(/(?:cashless|કેશલેસ)[^]*?(?:policy|tpa|how did|પોલિસી)/i)?.[0] ?? fullText
  if (/(?:cashless|કેશલેસ)[^]*?(?:✓|✗|x|\[x\]|☑)[^]*?(?:yes|હા)/i.test(cashlessSection) ||
      /(?:yes|હા)[^]*?(?:✓|✗|x|\[x\]|☑)[^]*?(?:cashless|કેશલેસ)/i.test(cashlessSection) ||
      /(?:cashless|કેશલેસ)[:\s]*(?:yes|હા)/i.test(fullText)) {
    patient.cashless = 'Yes'
  } else {
    patient.cashless = 'No'
  }

  // Policy / TPA name
  patient.policy_tpa_name = after(['policy', 'tpa', 'insurance company', 'insurer', 'પોલિસી', 'વીમા કંપની'])

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
    const pulseRaw = after(['pulse', 'hr', 'heart rate', 'pr', 'નાડી', 'પલ્સ'])
    vitals.pulse = num(pulseRaw)

    const bpRaw = indicDigitsToAscii(after(['bp', 'blood pressure', 'b.p', 'બ્લડ પ્રેશર', 'બી.પી.', 'રક્તદબાણ']))
    const bpM   = bpRaw.match(/(\d{2,3})\s*[\/]\s*(\d{2,3})/)
    if (bpM) { vitals.bp_systolic = bpM[1]; vitals.bp_diastolic = bpM[2] }

    const tempRaw = after(['temp', 'temperature', 'fever', 'તાવ', 'તાપમાન'])
    vitals.temperature = num(tempRaw)

    const spo2Raw = after(['spo2', 'spo₂', 'oxygen', 'o2 sat'])
    vitals.spo2 = num(spo2Raw)

    const wtRaw = after(['weight', 'wt', 'wgt', 'વજન'])
    vitals.weight = num(wtRaw)

    const htRaw = after(['height', 'ht', 'hgt', 'ઊંચાઈ', 'ઊંચ'])
    vitals.height = num(htRaw)

    vitals.chief_complaint = after([
      'chief complaint', 'complaints', 'presenting complaint', 'cc',
      'ફરિયાદ', 'મુખ્ય ફરિયાદ', 'તકલીફ', 'સમસ્યા'
    ])
  }

  // Build result
  const result: any = { form_type: formType || 'patient_registration' }

  if (Object.values(patient).some(v => v)) result.patient = patient
  if (Object.values(vitals).some(v => v))  result.vitals  = vitals

  return result
}
