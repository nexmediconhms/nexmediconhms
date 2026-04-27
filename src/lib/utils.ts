import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Calculate EDD from LMP (Naegele's rule: LMP + 280 days)
export function calculateEDD(lmpDate: string): string {
  if (!lmpDate) return ''
  const lmp = new Date(lmpDate)
  const edd = new Date(lmp.getTime() + 280 * 24 * 60 * 60 * 1000)
  return edd.toISOString().split('T')[0]
}

// Calculate gestational age from LMP
export function calculateGA(lmpDate: string): string {
  if (!lmpDate) return ''
  const lmp = new Date(lmpDate)
  const today = new Date()
  const diffDays = Math.floor((today.getTime() - lmp.getTime()) / (1000 * 60 * 60 * 24))
  const weeks = Math.floor(diffDays / 7)
  const days = diffDays % 7
  return `${weeks} weeks ${days} days`
}

// Calculate BMI
export function calculateBMI(weight: number, height: number): string {
  if (!weight || !height) return ''
  const heightM = height / 100
  const bmi = weight / (heightM * heightM)
  return bmi.toFixed(1)
}

// Format date nicely
export function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Format date+time
export function formatDateTime(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

// Calculate current age from date_of_birth string
// Used in display components so age is always accurate today, not the stored value
export function ageFromDOB(dob: string | undefined | null): number | null {
  if (!dob) return null
  const d = new Date(dob)
  if (isNaN(d.getTime())) return null
  const age = Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
  return age >= 0 && age < 150 ? age : null
}

// ── Live hospital settings ────────────────────────────────────
// Reads from Supabase-backed in-memory cache (populated by initSettings() in AppShell).
// Falls back to localStorage → DEFAULTS if cache not yet initialized.
// Call this inside components that need print-header values.
import { getSettingsCache } from './settings'

export function getHospitalSettings() {
  return getSettingsCache()
}

// ── Sunday / Holiday helpers ─────────────────────────────────
// Returns true if the given YYYY-MM-DD date is a Sunday
export function isSunday(dateStr: string): boolean {
  if (!dateStr) return false
  return new Date(dateStr).getDay() === 0
}

// Returns the next non-Sunday date string
export function skipSunday(dateStr: string): string {
  const d = new Date(dateStr)
  if (d.getDay() === 0) {
    d.setDate(d.getDate() + 1)  // Sunday → Monday
  }
  return d.toISOString().split('T')[0]
}

// For follow-up date pickers: returns min date (tomorrow, skipping Sunday)
export function minFollowUpDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  if (d.getDay() === 0) d.setDate(d.getDate() + 1)  // skip Sunday
  return d.toISOString().split('T')[0]
}

// ── Gujarati / Indic script helpers ──────────────────────────
// Gujarati digits ૦-૯ mapped to ASCII 0-9
const GUJARATI_DIGIT_MAP: Record<string, string> = {
  '૦': '0', '૧': '1', '૨': '2', '૩': '3', '૪': '4',
  '૫': '5', '૬': '6', '૭': '7', '૮': '8', '૯': '9',
}

// Hindi/Devanagari digits ०-९ mapped to ASCII 0-9
const HINDI_DIGIT_MAP: Record<string, string> = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
}

/**
 * Convert Gujarati/Hindi digits to ASCII digits.
 * "૯૮૭૬૫૪૩૨૧૦" → "9876543210"
 * Also handles mixed: "98૭૬5૪3210" → "9876543210"
 */
export function indicDigitsToAscii(str: string): string {
  return str.replace(/[૦-૯०-९]/g, ch =>
    GUJARATI_DIGIT_MAP[ch] || HINDI_DIGIT_MAP[ch] || ch
  )
}

/**
 * Normalize a phone/mobile input that may contain Gujarati or Hindi digits.
 * Converts Indic digits → ASCII, then strips non-digit characters.
 */
export function normalizePhone(raw: string): string {
  return indicDigitsToAscii(raw).replace(/\D/g, '').slice(-10)
}

/**
 * Normalize a numeric-only input (Aadhaar, PIN code, age, etc.)
 * Converts Indic digits → ASCII, then strips non-digit characters.
 */
export function normalizeDigits(raw: string): string {
  return indicDigitsToAscii(raw).replace(/\D/g, '')
}

/**
 * Detect if a string contains Gujarati Unicode characters (U+0A80–U+0AFF).
 */
export function containsGujarati(str: string): boolean {
  return /[\u0A80-\u0AFF]/.test(str)
}

/**
 * Detect if a string contains Devanagari/Hindi Unicode characters (U+0900–U+097F).
 */
export function containsHindi(str: string): boolean {
  return /[\u0900-\u097F]/.test(str)
}

/**
 * Detect the likely language of a text string.
 * Returns 'Gujarati', 'Hindi', 'Mixed', or 'English'.
 */
export function detectLanguage(text: string): string {
  const hasGuj  = containsGujarati(text)
  const hasHin  = containsHindi(text)
  const hasLatin = /[a-zA-Z]/.test(text)

  if (hasGuj && hasLatin) return 'Mixed Gujarati-English'
  if (hasGuj)             return 'Gujarati'
  if (hasHin && hasLatin) return 'Mixed Hindi-English'
  if (hasHin)             return 'Hindi'
  return 'English'
}

// Common Gujarati → English field label mappings for OCR parsing
export const GUJARATI_FIELD_LABELS: Record<string, string[]> = {
  full_name:               ['નામ', 'દર્દીનું નામ', 'પૂરું નામ', 'પેશન્ટનું નામ'],
  age:                     ['ઉંમર', 'વય'],
  date_of_birth:           ['જન્મ તારીખ', 'જન્મ', 'જન્મતારીખ'],
  gender:                  ['લિંગ', 'જાતિ'],
  mobile:                  ['મોબાઈલ', 'ફોન', 'મોબાઈલ નંબર', 'ફોન નંબર', 'સંપર્ક'],
  blood_group:             ['લોહી જૂથ', 'બ્લડ ગ્રુપ', 'રક્ત જૂથ'],
  address:                 ['સરનામું', 'સરનામુ', 'ઠેકાણું', 'રહેઠાણ', 'ગામ', 'શહેર'],
  aadhaar_no:              ['આધાર', 'આધાર નંબર', 'આધાર કાર્ડ'],
  abha_id:                 ['આભા', 'હેલ્થ આઈડી'],
  emergency_contact_name:  ['ઈમરજન્સી સંપર્ક', 'કટોકટી સંપર્ક', 'સંબંધી નામ'],
  emergency_contact_phone: ['ઈમરજન્સી ફોન', 'કટોકટી ફોન', 'સંબંધી ફોન'],
  chief_complaint:         ['ફરિયાદ', 'મુખ્ય ફરિયાદ', 'તકલીફ', 'સમસ્યા'],
  diagnosis:               ['નિદાન'],
  pulse:                   ['નાડી', 'પલ્સ'],
  temperature:             ['તાવ', 'તાપમાન'],
  weight:                  ['વજન'],
  height:                  ['ઊંચાઈ', 'ઊંચ'],
  bp:                      ['બ્લડ પ્રેશર', 'બી.પી.', 'રક્તદબાણ'],
}

// Gujarati gender mappings
export const GUJARATI_GENDER_MAP: Record<string, string> = {
  'સ્ત્રી': 'Female',
  'પુરૂષ': 'Male',
  'પુરુષ': 'Male',
  'મહિલા': 'Female',
  'અન્ય': 'Other',
  'female': 'Female',
  'male': 'Male',
  'other': 'Other',
}

// Gujarati Yes/No mappings
export const GUJARATI_YESNO_MAP: Record<string, string> = {
  'હા': 'Yes',
  'ના': 'No',
  'નહીં': 'No',
  'yes': 'Yes',
  'no': 'No',
}
