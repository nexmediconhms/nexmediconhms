/**
 * Hospital Settings — Supabase-backed with in-memory cache
 *
 * Data flow:
 *   1. On app boot, initSettings() fetches from Supabase → populates _cache + localStorage
 *   2. Synchronous callers (getSettingsCache / loadSettings / getHospitalSettings)
 *      return _cache instantly (falls back to localStorage → DEFAULTS)
 *   3. saveSettings() writes to Supabase first, then updates _cache + localStorage
 *   4. localStorage acts as offline fallback only
 */

import { supabase } from './supabase'

// ── Key used in both clinic_settings table and localStorage ───
const SUPABASE_KEY = 'hospital_settings'
const STORAGE_KEY = 'nexmedicon_settings'

// ── Types ─────────────────────────────────────────────────────
export interface HospitalSettings {
  hospitalName: string
  address: string
  phone: string
  regNo: string
  gstin: string
  doctorName: string
  doctorQual: string
  doctorReg: string
  footerNote: string
  upiId: string
  feeOPD: string
  feeANC: string
  feeFollowUp: string
  feeIPD: string
  feeEmergency: string
  caName: string
  caWhatsApp: string
  caEmail: string
}

export const DEFAULTS: HospitalSettings = {
  hospitalName: 'NexMedicon Hospital',
  address: 'Your Hospital Address, City, PIN',
  phone: '+91 98765 43210',
  regNo: 'Your Reg. No.',
  gstin: '',
  doctorName: 'Dr. Your Name',
  doctorQual: 'MBBS, MD (OBG)',
  doctorReg: 'Your Medical Council Reg. No.',
  footerNote: 'Thank you for visiting. Please follow the advice given above. Report any emergency immediately.',
  upiId: '',
  feeOPD: '500',
  feeANC: '400',
  feeFollowUp: '300',
  feeIPD: '1500',
  feeEmergency: '800',
  caName: '',
  caWhatsApp: '',
  caEmail: '',
}

// Keep the old export for any remaining direct references
export const SETTINGS_STORAGE_KEY = STORAGE_KEY

// ── In-memory cache ───────────────────────────────────────────
let _cache: HospitalSettings = { ...DEFAULTS }
let _initialized = false

/**
 * Write-through to localStorage (offline fallback).
 * Safe to call on server (no-ops).
 */
function persistToLocalStorage(settings: HospitalSettings) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch { /* quota / private-mode — ignore */ }
}

/**
 * Read from localStorage (used as fallback when Supabase hasn't loaded yet).
 */
function readFromLocalStorage(): HospitalSettings | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch { /* corrupt data — ignore */ }
  return null
}

// ── Async Supabase operations ─────────────────────────────────

/**
 * Fetch settings from Supabase clinic_settings table.
 * Returns null if not found or on error.
 */
async function fetchFromSupabase(): Promise<HospitalSettings | null> {
  try {
    const { data, error } = await supabase
      .from('clinic_settings')
      .select('value')
      .eq('key', SUPABASE_KEY)
      .maybeSingle()

    if (error) {
      console.warn('[settings] Supabase fetch error:', error.message)
      return null
    }
    if (data?.value) {
      return { ...DEFAULTS, ...JSON.parse(data.value) }
    }
  } catch (err) {
    console.warn('[settings] Supabase fetch exception:', err)
  }
  return null
}

/**
 * Upsert settings into Supabase clinic_settings table.
 * Uses the unique `key` column for conflict resolution.
 */
async function writeToSupabase(settings: HospitalSettings): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('clinic_settings')
      .upsert(
        {
          key: SUPABASE_KEY,
          value: JSON.stringify(settings),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      )

    if (error) {
      console.error('[settings] Supabase write error:', error.message)
      return false
    }
    return true
  } catch (err) {
    console.error('[settings] Supabase write exception:', err)
    return false
  }
}

// ── Public API ────────────────────────────────────────────────

/**
 * Initialize settings cache from Supabase.
 * Call once on app mount (e.g. in layout or AppShell).
 * Falls back to localStorage → DEFAULTS if Supabase is unreachable.
 */
export async function initSettings(): Promise<HospitalSettings> {
  // Try Supabase first
  const remote = await fetchFromSupabase()
  if (remote) {
    _cache = remote
    _initialized = true
    persistToLocalStorage(remote)
    return _cache
  }

  // Fallback: localStorage
  const local = readFromLocalStorage()
  if (local) {
    _cache = local
    _initialized = true
    return _cache
  }

  // Ultimate fallback: defaults
  _cache = { ...DEFAULTS }
  _initialized = true
  return _cache
}

/**
 * Save settings to Supabase + update cache + localStorage.
 * Returns true if Supabase write succeeded.
 */
export async function saveSettings(settings: HospitalSettings): Promise<boolean> {
  _cache = { ...settings }
  persistToLocalStorage(settings)

  const ok = await writeToSupabase(settings)
  if (!ok) {
    console.warn('[settings] Saved to localStorage only — Supabase write failed')
  }
  return ok
}

/**
 * Synchronous read from in-memory cache.
 * Always returns a complete HospitalSettings object.
 * If initSettings() hasn't been called yet, falls back to localStorage → DEFAULTS.
 */
export function loadSettings(): HospitalSettings {
  if (_initialized) return _cache

  // Not yet initialized — try localStorage as bridge
  const local = readFromLocalStorage()
  if (local) {
    _cache = local
    return _cache
  }
  return DEFAULTS
}

/**
 * Alias for loadSettings() — used by getHospitalSettings() in utils.ts
 */
export function getSettingsCache(): HospitalSettings {
  return loadSettings()
}

/**
 * Force-refresh cache from Supabase (e.g. after another user saves settings).
 */
export async function refreshSettings(): Promise<HospitalSettings> {
  return initSettings()
}

/**
 * Migrate existing localStorage settings to Supabase.
 * Called once during initSettings if Supabase has no data but localStorage does.
 * This ensures a smooth transition for existing users.
 */
export async function migrateLocalStorageToSupabase(): Promise<void> {
  const local = readFromLocalStorage()
  if (!local) return

  // Check if Supabase already has settings
  const remote = await fetchFromSupabase()
  if (remote) return // Already migrated

  // Migrate
  console.info('[settings] Migrating localStorage settings to Supabase...')
  const ok = await writeToSupabase(local)
  if (ok) {
    console.info('[settings] Migration complete.')
  }
}
