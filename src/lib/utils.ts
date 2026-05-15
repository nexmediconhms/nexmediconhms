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

/**
 * Sanitise user-supplied text to prevent XSS if ever rendered as HTML.
 * Strips <script>, <iframe>, on* attributes, and javascript: URLs.
 * Safe for use in React JSX (which already escapes), but this adds
 * defense-in-depth for any future dangerouslySetInnerHTML usage.
 */
export function sanitiseText(input: string | undefined | null): string {
  if (!input) return ''
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript\s*:/gi, '')
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  BUG #19 FIX — IST Timezone "Today" Helper                        ║
// ║  BUG #9  FIX — SQL Injection Escape for ilike                     ║
// ║                                                                    ║
// ║  INSTRUCTIONS:                                                     ║
// ║  Open your file: src/lib/utils.ts                                  ║
// ║  Copy ALL the code below and PASTE it at the BOTTOM of utils.ts    ║
// ║  (after the last export function)                                  ║
// ║  DO NOT delete anything that's already in utils.ts                 ║
// ╚══════════════════════════════════════════════════════════════════════╝

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BUG #19 FIX — India Standard Time "Today" Date
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// WHY THIS IS NEEDED:
// Your code currently does: new Date().toISOString().split('T')[0]
// This gives you the date in UTC (London time).
// India is 5 hours 30 minutes AHEAD of UTC.
// So between 12:00 AM and 5:30 AM India time, this returns YESTERDAY's date!
//
// REAL EXAMPLE:
// It's 1:00 AM on January 15th in India.
// But in UTC (London), it's still 7:30 PM on January 14th.
// So your code would say "today = 2025-01-14" when it's actually January 15th.
// The dashboard shows yesterday's OPD count, appointments look wrong, etc.
//
// IMPACT AFTER FIX:
// ✅ Dashboard "Today's OPD" count will always be correct, even at midnight
// ✅ Appointment "Today" tab shows the right day
// ✅ Reminders fire on the correct day
// ✅ Revenue reports match the actual clinic day
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Returns today's date in YYYY-MM-DD format using India Standard Time (IST).
 *
 * IST is always UTC+5:30. Unlike some countries, India does NOT have
 * daylight saving time, so this offset never changes.
 *
 * Use this EVERYWHERE instead of: new Date().toISOString().split('T')[0]
 */
export function getIndiaToday(): string {
  // Step 1: Get the current time
  const now = new Date()

  // Step 2: Convert to IST
  // IST = UTC + 5 hours + 30 minutes = UTC + 330 minutes
  const IST_OFFSET_MINUTES = 5 * 60 + 30 // = 330

  // getTimezoneOffset() returns the difference in minutes between UTC and LOCAL time.
  // We first convert "now" to UTC milliseconds, then add IST offset.
  const utcMilliseconds = now.getTime() + (now.getTimezoneOffset() * 60 * 1000)
  const istDate = new Date(utcMilliseconds + (IST_OFFSET_MINUTES * 60 * 1000))

  // Step 3: Format as YYYY-MM-DD
  const year  = istDate.getFullYear()
  const month = String(istDate.getMonth() + 1).padStart(2, '0')  // months are 0-based
  const day   = String(istDate.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

/**
 * Returns the current IST datetime as an ISO string.
 * Use this when you need the full timestamp, not just the date.
 */
export function getIndiaNow(): Date {
  const now = new Date()
  const IST_OFFSET_MINUTES = 5 * 60 + 30
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60 * 1000)
  return new Date(utcMs + (IST_OFFSET_MINUTES * 60 * 1000))
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BUG #9 FIX — SQL Injection Protection for Search Queries
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// WHY THIS IS NEEDED:
// When a user types in the patient search box, their text goes directly
// into a database query like:  .ilike.%${userInput}%
//
// If someone types:  %' OR 1=1 --
// The query becomes: .ilike.%%' OR 1=1 --%
// This could return ALL patients (data leak) or cause errors.
//
// Even innocent characters are a problem:
// - Typing "%" makes the search match everything
// - Typing "_" matches any single character (wildcard in SQL)
//
// IMPACT AFTER FIX:
// ✅ Search works correctly even if user types special characters
// ✅ No more risk of data leaks through search
// ✅ "_" and "%" in names (rare but possible) are searched literally
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Escapes special characters that have meaning in PostgreSQL LIKE/ILIKE patterns.
 *
 * In SQL:
 *   %  means "match any number of characters"
 *   _  means "match exactly one character"
 *   \  is the escape character
 *
 * We need to put a backslash (\) before these so they are treated as
 * regular characters, not wildcards.
 *
 * USAGE:
 *   const safe = escapeLike(userInput)
 *   supabase.from('patients').select('*').or(`full_name.ilike.%${safe}%`)
 */
export function escapeLike(value: string): string {
  return value
    .replace(/\\/g, '\\\\')   // escape backslash FIRST (otherwise it escapes our escapes!)
    .replace(/%/g,  '\\%')    // escape percent sign
    .replace(/_/g,  '\\_')    // escape underscore
    .trim()                    // remove extra whitespace
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BUG #20 FIX — Single Source of Truth for Appointment Status Logic
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// WHY THIS IS NEEDED:
// Different pages in your app treat appointment statuses differently.
// Dashboard says "completed" AND "no-show" = visited.
// Billing says only "completed" = visited.
// Follow-up overdue logic counts "cancelled" as missed.
// This makes numbers not match across pages.
//
// IMPACT AFTER FIX:
// ✅ Dashboard, Billing, Appointments, Reminders all agree on counts
// ✅ "Today's OPD" on dashboard matches Appointments page exactly
// ✅ Overdue follow-ups won't count cancelled appointments
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Statuses that mean "the patient actually came and was seen" */
export const VISIT_HAPPENED = ['completed'] as const

/** Statuses that mean "patient was expected but didn't show" */
export const NO_SHOW = ['no-show'] as const

/** Statuses that mean "appointment is still active, patient is coming" */
export const ACTIVE_APPOINTMENT = ['scheduled', 'confirmed'] as const

/** Statuses that mean "appointment was cancelled, no follow-up expected" */
export const CANCELLED = ['cancelled'] as const

/**
 * Check if an appointment status means the patient was actually seen.
 * Use this in Dashboard, Billing, and Reports when counting visits.
 *
 * USAGE:
 *   const todayVisits = appointments.filter(a => visitHappened(a.status))
 */
export function visitHappened(status: string): boolean {
  return (VISIT_HAPPENED as readonly string[]).includes(status)
}

/**
 * Check if an appointment is overdue (past the date and still not resolved).
 * Only scheduled/confirmed appointments can be overdue.
 * Cancelled and no-show are RESOLVED — they are not overdue.
 *
 * USAGE:
 *   const overdueAppts = appointments.filter(a => isAppointmentOverdue(a, today))
 */
export function isAppointmentOverdue(
  appointment: { date: string; status: string },
  today: string
): boolean {
  return (
    appointment.date < today &&
    (ACTIVE_APPOINTMENT as readonly string[]).includes(appointment.status)
  )
}
