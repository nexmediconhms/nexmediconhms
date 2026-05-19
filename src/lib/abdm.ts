/**
 * ABDM (Ayushman Bharat Digital Mission) API Client
 * 
 * Supports:
 * - ABHA Number verification
 * - ABHA Address (Health ID) creation & linking
 * - Authentication token management
 * - Health Information consent flow (basic)
 * 
 * Uses ABDM Sandbox APIs by default; switch to production via settings.
 * Docs: https://sandbox.abdm.gov.in/docs/
 */

// ── ABDM Environment URLs ────────────────────────────────────
const ABDM_SANDBOX_URL = 'https://dev.abdm.gov.in'
const ABDM_PROD_URL    = 'https://live.abdm.gov.in'

// ── Types ────────────────────────────────────────────────────
export interface ABDMConfig {
  clientId:     string
  clientSecret: string
  environment:  'sandbox' | 'production'
  enabled:      boolean
}

export interface ABDMAuthToken {
  accessToken:  string
  expiresIn:    number
  tokenType:    string
  issuedAt:     number  // timestamp
}

export interface ABHAProfile {
  healthIdNumber:  string   // 14-digit ABHA number (XX-XXXX-XXXX-XXXX)
  healthId:        string   // ABHA address (user@abdm)
  name:            string
  firstName?:      string
  middleName?:     string
  lastName?:       string
  gender:          string   // M, F, O
  yearOfBirth:     string
  monthOfBirth?:   string
  dayOfBirth?:     string
  mobile:          string
  email?:          string
  address?:        string
  districtName?:   string
  stateName?:      string
  pincode?:        string
  kycVerified?:    boolean
  profilePhoto?:   string   // base64
  status:          'ACTIVE' | 'INACTIVE' | 'DEACTIVATED'
}

export interface ABHAVerifyResult {
  success:  boolean
  profile?: ABHAProfile
  error?:   string
  txnId?:   string
}

export interface ABHACreateResult {
  success:        boolean
  healthIdNumber?: string
  healthId?:       string
  token?:          string
  error?:          string
}

// ── Settings Storage ─────────────────────────────────────────
// Supabase-backed with localStorage as offline fallback (mirrors hospital settings pattern)
import { supabase } from './supabase'

const ABDM_SETTINGS_KEY = 'nexmedicon_abdm_settings'
const ABDM_SUPABASE_KEY = 'abdm_settings'

const ABDM_DEFAULTS: ABDMConfig = {
  clientId:     '',
  clientSecret: '',
  environment:  'sandbox',
  enabled:      false,
}

// In-memory cache for synchronous access
let _abdmCache: ABDMConfig = { ...ABDM_DEFAULTS }
let _abdmInitialized = false

function readABDMFromLocalStorage(): ABDMConfig | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(ABDM_SETTINGS_KEY)
    if (raw) return { ...ABDM_DEFAULTS, ...JSON.parse(raw) }
  } catch {}
  return null
}

function persistABDMToLocalStorage(config: ABDMConfig): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(ABDM_SETTINGS_KEY, JSON.stringify(config))
  } catch {}
}

/**
 * Initialize ABDM config from Supabase → localStorage → defaults.
 * Call once on app boot (called from initABDMConfig or lazily).
 */
export async function initABDMConfig(): Promise<ABDMConfig> {
  try {
    const { data, error } = await supabase
      .from('clinic_settings')
      .select('value')
      .eq('key', ABDM_SUPABASE_KEY)
      .maybeSingle()

    if (!error && data?.value) {
      const remote = { ...ABDM_DEFAULTS, ...JSON.parse(data.value) }
      _abdmCache = remote
      _abdmInitialized = true
      persistABDMToLocalStorage(remote)
      return _abdmCache
    }
  } catch {}

  // Fallback: localStorage (auto-migrate to Supabase if found)
  const local = readABDMFromLocalStorage()
  if (local) {
    _abdmCache = local
    _abdmInitialized = true
    // Auto-migrate to Supabase (fire-and-forget)
    ;(async () => {
      try {
        await supabase
          .from('clinic_settings')
          .upsert({ key: ABDM_SUPABASE_KEY, value: JSON.stringify(local), updated_at: new Date().toISOString() }, { onConflict: 'key' })
      } catch { /* non-fatal */ }
    })()
    return _abdmCache
  }

  _abdmCache = { ...ABDM_DEFAULTS }
  _abdmInitialized = true
  return _abdmCache
}

/**
 * Synchronous read — returns cached config (falls back to localStorage → defaults).
 */
export function loadABDMConfig(): ABDMConfig {
  if (_abdmInitialized) return _abdmCache
  const local = readABDMFromLocalStorage()
  if (local) {
    _abdmCache = local
    return _abdmCache
  }
  return ABDM_DEFAULTS
}

/**
 * Save ABDM config to Supabase + cache + localStorage.
 */
export async function saveABDMConfig(config: ABDMConfig): Promise<void> {
  _abdmCache = { ...config }
  _abdmInitialized = true
  persistABDMToLocalStorage(config)

  try {
    await supabase
      .from('clinic_settings')
      .upsert(
        { key: ABDM_SUPABASE_KEY, value: JSON.stringify(config), updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      )
  } catch {
    console.warn('[abdm] Saved to localStorage only — Supabase write failed')
  }
}

// ── Helper: Get base URL ─────────────────────────────────────
export function getABDMBaseUrl(env: 'sandbox' | 'production'): string {
  return env === 'production' ? ABDM_PROD_URL : ABDM_SANDBOX_URL
}

// ── Helper: Format ABHA number ───────────────────────────────
export function formatABHANumber(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 14) return raw
  return `${digits.slice(0,2)}-${digits.slice(2,6)}-${digits.slice(6,10)}-${digits.slice(10,14)}`
}

// ── Helper: Validate ABHA number format ──────────────────────
export function isValidABHANumber(abha: string): boolean {
  const digits = abha.replace(/[-\s]/g, '')
  return /^\d{14}$/.test(digits)
}

// ── Helper: Validate ABHA address format ─────────────────────
export function isValidABHAAddress(address: string): boolean {
  // ABHA address format: username@abdm
  return /^[a-zA-Z0-9._]+@abdm$/.test(address)
}

// ── Map ABDM gender to our system ────────────────────────────
export function mapABDMGender(abdmGender: string): string {
  switch (abdmGender?.toUpperCase()) {
    case 'M': return 'Male'
    case 'F': return 'Female'
    case 'O': return 'Other'
    default:  return 'Other'
  }
}

// ── Map our gender to ABDM ───────────────────────────────────
export function mapToABDMGender(gender: string): string {
  switch (gender) {
    case 'Male':   return 'M'
    case 'Female': return 'F'
    case 'Other':  return 'O'
    default:       return 'O'
  }
}

// ── Build date of birth from ABDM profile ────────────────────
export function buildDOBFromProfile(profile: ABHAProfile): string {
  const y = profile.yearOfBirth
  const m = profile.monthOfBirth?.padStart(2, '0') || '01'
  const d = profile.dayOfBirth?.padStart(2, '0') || '01'
  return `${y}-${m}-${d}`
}

// ── Calculate age from ABDM profile ──────────────────────────
export function calculateAgeFromProfile(profile: ABHAProfile): number {
  const dob = buildDOBFromProfile(profile)
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
}

/**
 * All actual ABDM API calls go through our Next.js API routes
 * to keep client secrets server-side. These functions call our
 * internal API endpoints which proxy to ABDM.
 */

// ── Get ABDM session token (via our API) ─────────────────────
//
// /api/abdm/auth now requires a Bearer token from a clinic user. We
// lazy-import the supabase browser client to keep this file usable in
// any environment where supabase auth is set up.
export async function getABDMSessionToken(): Promise<{ token?: string; error?: string }> {
  try {
    // Lazy import so that any non-browser caller doesn't drag in the
    // browser supabase client unnecessarily.
    const { supabase } = await import('@/lib/supabase')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      return { error: 'Not signed in. Please log in again.' }
    }
    const res = await fetch('/api/abdm/auth', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = await res.json().catch(() => ({} as { accessToken?: string; error?: string }))
    if (!res.ok) return { error: data.error || 'Auth failed' }
    return { token: data.accessToken }
  } catch (err: any) {
    return { error: err?.message || 'Network error' }
  }
}

// ── Verify ABHA number ───────────────────────────────────────
export async function verifyABHANumber(abhaNumber: string): Promise<ABHAVerifyResult> {
  try {
    const { supabase } = await import('@/lib/supabase')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      return { success: false, error: 'Not signed in. Please log in again.' }
    }
    const res = await fetch('/api/abdm/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ abhaNumber: abhaNumber.replace(/[-\s]/g, '') }),
    })
    const data = await res.json()
    if (!res.ok) return { success: false, error: data.error || 'Verification failed' }
    return data
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ── Search by ABHA address ───────────────────────────────────
export async function searchByABHAAddress(healthId: string): Promise<ABHAVerifyResult> {
  try {
    const { supabase } = await import('@/lib/supabase')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      return { success: false, error: 'Not signed in. Please log in again.' }
    }
    const res = await fetch('/api/abdm/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ healthId }),
    })
    const data = await res.json()
    if (!res.ok) return { success: false, error: data.error || 'Search failed' }
    return data
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ── Initiate ABHA creation via Aadhaar OTP ───────────────────
export async function initiateABHACreation(aadhaarNumber: string): Promise<{ txnId?: string; error?: string }> {
  try {
    const res = await fetch('/api/abdm/create/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aadhaar: aadhaarNumber.replace(/\s/g, '') }),
    })
    const data = await res.json()
    if (!res.ok) return { error: data.error || 'Failed to initiate' }
    return { txnId: data.txnId }
  } catch (err: any) {
    return { error: err.message }
  }
}

// ── Verify Aadhaar OTP for ABHA creation ─────────────────────
export async function verifyAadhaarOTP(txnId: string, otp: string): Promise<ABHACreateResult> {
  try {
    const res = await fetch('/api/abdm/create/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txnId, otp }),
    })
    const data = await res.json()
    if (!res.ok) return { success: false, error: data.error || 'OTP verification failed' }
    return data
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
