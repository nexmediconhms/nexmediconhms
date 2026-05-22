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
// SECURITY FIX: ABDM credentials (clientId, clientSecret) are now
// stored ONLY server-side via environment variables (ABDM_CLIENT_ID,
// ABDM_CLIENT_SECRET). The client-side config only stores non-secret
// preferences (environment, enabled).
import { supabase } from './supabase'

const ABDM_SUPABASE_KEY = 'abdm_settings'

const ABDM_DEFAULTS: ABDMConfig = {
  clientId:     '',       // NOT stored — read from env on server
  clientSecret: '',       // NOT stored — read from env on server
  environment:  'sandbox',
  enabled:      false,
}

// In-memory cache for synchronous access (non-secret fields only)
let _abdmCache: ABDMConfig = { ...ABDM_DEFAULTS }
let _abdmInitialized = false

/**
 * Initialize ABDM config from Supabase (non-secret fields only).
 * Credentials come from server env vars, NEVER from the client.
 */
export async function initABDMConfig(): Promise<ABDMConfig> {
  try {
    const { data, error } = await supabase
      .from('clinic_settings')
      .select('value')
      .eq('key', ABDM_SUPABASE_KEY)
      .maybeSingle()

    if (!error && data?.value) {
      const parsed = JSON.parse(data.value)
      // SECURITY: Strip any credentials that may have been stored previously
      const remote: ABDMConfig = {
        clientId: '',
        clientSecret: '',
        environment: parsed.environment || 'sandbox',
        enabled: parsed.enabled ?? false,
      }
      _abdmCache = remote
      _abdmInitialized = true
      return _abdmCache
    }
  } catch {}

  // Clean up legacy localStorage data (remove credentials)
  if (typeof window !== 'undefined') {
    try {
      const legacyKey = 'nexmedicon_abdm_settings'
      const raw = localStorage.getItem(legacyKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        // If credentials were stored in localStorage, remove them
        if (parsed.clientId || parsed.clientSecret) {
          localStorage.removeItem(legacyKey)
          console.warn('[abdm] Removed legacy credentials from localStorage (security fix)')
        }
      }
    } catch {}
  }

  _abdmCache = { ...ABDM_DEFAULTS }
  _abdmInitialized = true
  return _abdmCache
}

/**
 * Synchronous read — returns cached config (non-secret fields only).
 */
export function loadABDMConfig(): ABDMConfig {
  if (_abdmInitialized) return _abdmCache
  return ABDM_DEFAULTS
}

/**
 * Save ABDM config to Supabase (non-secret fields only).
 * Credentials are managed via environment variables on the server.
 */
export async function saveABDMConfig(config: ABDMConfig): Promise<void> {
  // SECURITY: Never persist credentials to Supabase or localStorage
  const safeConfig = {
    environment: config.environment,
    enabled: config.enabled,
  }
  _abdmCache = { ...ABDM_DEFAULTS, ...safeConfig }
  _abdmInitialized = true

  try {
    await supabase
      .from('clinic_settings')
      .upsert(
        { key: ABDM_SUPABASE_KEY, value: JSON.stringify(safeConfig), updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      )
  } catch {
    console.warn('[abdm] Supabase write failed for ABDM settings')
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
