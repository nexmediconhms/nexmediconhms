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
// Reads from localStorage (set in /settings page).
// Falls back to HOSPITAL constants if nothing saved yet.
// Call this inside components that need print-header values.
export function getHospitalSettings() {
  const FALLBACK = {
    hospitalName: 'NexMedicon Demo Hospital',
    address:      '123 Hospital Road, City',
    phone:        '+91 98765 43210',
    regNo:        'MH/12345',
    gstin:        '27ABCDE1234F1Z5',
    doctorName:   'Dr. Demo',
    doctorQual:   'MBBS, MD (OBG)',
    doctorReg:    'MH/12345',
    footerNote:   'Thank you for visiting. Please follow the advice given above.',
  }
  if (typeof window === 'undefined') return FALLBACK
  try {
    const raw = localStorage.getItem('nexmedicon_settings')
    if (raw) return { ...FALLBACK, ...JSON.parse(raw) }
  } catch {}
  return FALLBACK
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
