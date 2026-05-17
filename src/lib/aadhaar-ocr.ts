/**
 * src/lib/aadhaar-ocr.ts
 *
 * Aadhaar Card OCR extraction.
 * When user captures/uploads an Aadhaar card photo:
 *  1. Tesseract.js extracts raw text
 *  2. This module parses the text to extract structured data
 *  3. Returns patient registration fields pre-filled
 *
 * Extracted fields:
 *  - Full name (from Aadhaar)
 *  - Date of birth → age calculation
 *  - Gender
 *  - Aadhaar number (masked for display)
 *  - Address
 */

export interface AadhaarData {
  full_name?: string
  date_of_birth?: string  // YYYY-MM-DD
  age?: number
  gender?: string         // Male | Female
  aadhaar_no?: string     // Last 4 visible
  address?: string
  pincode?: string
  confidence: 'high' | 'medium' | 'low'
}

// Common Aadhaar card patterns
const AADHAAR_PATTERNS = {
  // Aadhaar number: 4 groups of 4 digits separated by space
  number: /\b(\d{4}\s?\d{4}\s?\d{4})\b/,
  // DOB patterns
  dob: /(?:DOB|Date of Birth|D\.O\.B|जन्म\s*तिथि)[:\s]*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i,
  dobAlt: /\b(\d{2}[\/-]\d{2}[\/-]\d{4})\b/,
  // Year of Birth
  yob: /(?:Year of Birth|YOB|जन्म\s*वर्ष)[:\s]*(\d{4})/i,
  // Gender
  gender: /\b(MALE|FEMALE|पुरुष|महिला|male|female|Male|Female)\b/,
  // Pincode (6 digits)
  pincode: /\b(\d{6})\b/,
  // VID
  vid: /VID[:\s]*(\d{4}\s?\d{4}\s?\d{4}\s?\d{4})/i,
}

/**
 * Parse Aadhaar card OCR text and extract structured patient data
 */
export function parseAadhaarText(rawText: string): AadhaarData {
  const result: AadhaarData = { confidence: 'low' }
  const text = rawText.replace(/\n+/g, '\n').trim()
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  let fieldsFound = 0

  // 1. Extract Aadhaar number
  const aadhaarMatch = text.match(AADHAAR_PATTERNS.number)
  if (aadhaarMatch) {
    const num = aadhaarMatch[1].replace(/\s/g, '')
    if (num.length === 12) {
      result.aadhaar_no = `XXXX XXXX ${num.slice(8)}`  // Mask first 8 digits
      fieldsFound++
    }
  }

  // 2. Extract Gender
  const genderMatch = text.match(AADHAAR_PATTERNS.gender)
  if (genderMatch) {
    const g = genderMatch[1].toLowerCase()
    if (g === 'male' || g === 'पुरुष') result.gender = 'Male'
    else if (g === 'female' || g === 'महिला') result.gender = 'Female'
    fieldsFound++
  }

  // 3. Extract DOB
  const dobMatch = text.match(AADHAAR_PATTERNS.dob) || text.match(AADHAAR_PATTERNS.dobAlt)
  if (dobMatch) {
    const dobStr = dobMatch[1]
    const parsed = parseDateString(dobStr)
    if (parsed) {
      result.date_of_birth = parsed
      result.age = calculateAge(parsed)
      fieldsFound++
    }
  } else {
    // Try Year of Birth
    const yobMatch = text.match(AADHAAR_PATTERNS.yob)
    if (yobMatch) {
      const year = parseInt(yobMatch[1])
      if (year > 1920 && year < new Date().getFullYear()) {
        result.age = new Date().getFullYear() - year
        fieldsFound++
      }
    }
  }

  // 4. Extract Name
  // Aadhaar cards typically have name after "Government of India" line
  // and before the DOB/gender line
  const name = extractName(lines, result.gender)
  if (name) {
    result.full_name = name
    fieldsFound++
  }

  // 5. Extract Address
  // Address is usually on the back of Aadhaar
  const address = extractAddress(lines)
  if (address) {
    result.address = address
    fieldsFound++
  }

  // 6. Extract Pincode
  const pincodeMatch = text.match(AADHAAR_PATTERNS.pincode)
  if (pincodeMatch) {
    const pin = pincodeMatch[1]
    // Validate it's a real pincode (starts with 1-9)
    if (pin[0] !== '0' && parseInt(pin) > 100000) {
      result.pincode = pin
      if (!result.address) result.address = ''
      if (result.address && !result.address.includes(pin)) {
        result.address += ` - ${pin}`
      }
    }
  }

  // Set confidence
  if (fieldsFound >= 4) result.confidence = 'high'
  else if (fieldsFound >= 2) result.confidence = 'medium'
  else result.confidence = 'low'

  return result
}

function parseDateString(dateStr: string): string | undefined {
  // Try DD/MM/YYYY or DD-MM-YYYY
  const parts = dateStr.split(/[\/\-]/)
  if (parts.length !== 3) return undefined

  let day = parseInt(parts[0])
  let month = parseInt(parts[1])
  let year = parseInt(parts[2])

  // Handle 2-digit year
  if (year < 100) year += year > 30 ? 1900 : 2000

  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1920) return undefined

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function calculateAge(dob: string): number {
  const birth = new Date(dob)
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  if (today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) {
    age--
  }
  return age
}

function extractName(lines: string[], gender?: string): string | undefined {
  // Skip common header lines
  const skipPatterns = [
    /government\s*of\s*india/i,
    /भारत\s*सरकार/,
    /UNIQUE\s*IDENTIFICATION/i,
    /आधार/,
    /aadhaar/i,
    /\d{4}\s?\d{4}\s?\d{4}/,  // Aadhaar number
    /DOB|Date of Birth/i,
    /MALE|FEMALE/i,
    /Address|पता/i,
    /VID/i,
    /\d{2}[\/-]\d{2}[\/-]\d{4}/,  // Date
  ]

  for (const line of lines) {
    // Skip header/label lines
    if (skipPatterns.some(p => p.test(line))) continue
    // Skip very short lines (likely noise)
    if (line.length < 3) continue
    // Skip lines that are mostly numbers
    if (/^\d+$/.test(line.replace(/\s/g, ''))) continue
    // Skip lines with gender keywords
    if (/^(MALE|FEMALE|पुरुष|महिला)$/i.test(line.trim())) continue

    // The first reasonable text line is likely the name
    // Names on Aadhaar are typically in ALL CAPS or Title Case
    const cleaned = line.replace(/[^a-zA-Z\s\u0900-\u097F]/g, '').trim()
    if (cleaned.length >= 3 && /[a-zA-Z\u0900-\u097F]/.test(cleaned)) {
      // Title case the name
      return cleaned.split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ')
    }
  }
  return undefined
}

function extractAddress(lines: string[]): string | undefined {
  // Look for lines after "Address" label or lines with common address patterns
  let capturing = false
  const addressParts: string[] = []

  for (const line of lines) {
    if (/^(Address|पता|S\/O|D\/O|W\/O|C\/O)/i.test(line)) {
      capturing = true
      const after = line.replace(/^(Address|पता)[:\s]*/i, '').trim()
      if (after) addressParts.push(after)
      continue
    }
    if (capturing) {
      // Stop at next section or Aadhaar number
      if (/\d{4}\s?\d{4}\s?\d{4}/.test(line)) break
      if (/^(VID|Download Date)/i.test(line)) break
      if (line.length < 3) break
      addressParts.push(line)
      if (addressParts.length >= 4) break // Max 4 lines of address
    }
  }

  if (addressParts.length > 0) {
    return addressParts.join(', ')
  }
  return undefined
}
