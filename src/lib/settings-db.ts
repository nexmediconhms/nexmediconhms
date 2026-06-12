/**
 * src/lib/settings-db.ts
 *
 * Database-backed clinic settings layer (Issue 2 Fix). v2.
 *
 * Bug fixes from v1:
 *  - Removed 'use client' directive: this module is isomorphic (server + client).
 *    Server code calls the DB directly via /api/settings (or skip via service role).
 *  - JSON.parse coercion bug fixed: strings like "true", "123" were being
 *    converted to boolean/number on read. Now we store with a type marker
 *    that preserves the original type. Backward compatible with old localStorage
 *    values via best-effort detection.
 *  - getSettingDB() now safe to call before loadAllSettingsDB(): falls back
 *    to localStorage or DB cleanly.
 *  - SSR-safe: getSettingDBSync returns default when window is undefined.
 *
 * USAGE:
 *   import { getSettingDB, setSettingDB, loadAllSettingsDB } from '@/lib/settings-db'
 *
 *   // App boot (client-side, in a 'use client' provider):
 *   useEffect(() => { loadAllSettingsDB() }, [])
 *
 *   // Async read (preferred, can call from anywhere):
 *   const fee = await getSettingDB('consultation_fee', 500)
 *
 *   // Sync read (after loadAllSettingsDB completed):
 *   const fee = getSettingDBSync('consultation_fee', 500)
 *
 *   // Admin-only write:
 *   await setSettingDB('clinic_name', 'NexMedicon Clinic')
 */

export type SettingValue = string | number | boolean | object | null

// Type-preserving serialization. We wrap the value with a tiny envelope so
// we can faithfully round-trip strings vs numbers vs booleans vs objects.
// Envelope: '__nm__:<json>' where json is { t: 's'|'n'|'b'|'o', v: ... }.
// Backward compat: if no envelope prefix, we use best-effort detection.
const ENVELOPE_PREFIX = '__nm__:'

function serialize(value: SettingValue): string {
  const t = value === null ? 'null'
    : typeof value === 'string' ? 's'
    : typeof value === 'number' ? 'n'
    : typeof value === 'boolean' ? 'b'
    : 'o'
  return ENVELOPE_PREFIX + JSON.stringify({ t, v: value })
}

function deserialize(raw: string): SettingValue {
  if (raw == null) return null
  if (raw.startsWith(ENVELOPE_PREFIX)) {
    try {
      const env = JSON.parse(raw.slice(ENVELOPE_PREFIX.length))
      return env && 'v' in env ? env.v : null
    } catch { return null }
  }
  // Legacy / unenveloped value — best effort. Prefer returning as string
  // (the conservative choice) unless it's clearly JSON object/array.
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try { return JSON.parse(raw) } catch { return raw }
  }
  // Do NOT auto-convert "true"/"false"/"123" — those should remain strings
  // because we don't know what the caller stored.
  return raw
}

// ─── State (module-level, but each request on server gets fresh state) ──
const memCache = new Map<string, SettingValue>()
let bulkLoaded = false
let loadPromise: Promise<void> | null = null

const LS_PREFIX = 'nm_setting_'
const lsKey = (k: string) => LS_PREFIX + k

const inBrowser = (): boolean => typeof window !== 'undefined' && !!window.localStorage

function getFromLS(key: string): SettingValue | undefined {
  if (!inBrowser()) return undefined
  try {
    const raw = window.localStorage.getItem(lsKey(key))
    return raw === null ? undefined : deserialize(raw)
  } catch { return undefined }
}

function setToLS(key: string, value: SettingValue): void {
  if (!inBrowser()) return
  try { window.localStorage.setItem(lsKey(key), serialize(value)) }
  catch { /* quota exceeded — non-fatal */ }
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Bulk-load all settings from DB → cache + localStorage.
 * Idempotent: subsequent calls return the same in-flight promise.
 * Safe to call from server components: it just no-ops (no fetch, no LS).
 */
export async function loadAllSettingsDB(force = false): Promise<void> {
  if (!inBrowser()) return  // server: nothing to do
  if (bulkLoaded && !force) return
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    try {
      const res = await fetch('/api/settings', { cache: 'no-store' })
      if (!res.ok) { bulkLoaded = true; return }
      const data = await res.json()
      const settings = data?.settings || {}
      for (const [k, v] of Object.entries(settings)) {
        memCache.set(k, v as SettingValue)
        setToLS(k, v as SettingValue)
      }
      bulkLoaded = true
    } catch { bulkLoaded = true }
    finally { loadPromise = null }
  })()

  return loadPromise
}

/**
 * Async read. Priority: memory cache → localStorage → DB → default.
 * Falls back gracefully on any error.
 */
export async function getSettingDB<T extends SettingValue>(
  key: string,
  defaultValue: T
): Promise<T> {
  if (memCache.has(key)) {
    const v = memCache.get(key)
    return (v === null || v === undefined) ? defaultValue : (v as T)
  }
  const lsV = getFromLS(key)
  if (lsV !== undefined) {
    memCache.set(key, lsV)
    // Async refresh in background (best-effort)
    if (inBrowser()) refreshOne(key)
    return lsV as T
  }
  try {
    const res = await fetch(`/api/settings?key=${encodeURIComponent(key)}`, { cache: 'no-store' })
    if (res.ok) {
      const data = await res.json()
      const value = data?.value
      if (value !== null && value !== undefined) {
        memCache.set(key, value)
        setToLS(key, value)
        return value as T
      }
    }
  } catch { /* network down — fall through */ }
  return defaultValue
}

/**
 * Synchronous read — for legacy code paths.
 * After loadAllSettingsDB() completes, the cache holds everything; this is
 * fast. Before that, it reads from localStorage. Returns defaultValue if neither.
 */
export function getSettingDBSync<T extends SettingValue>(
  key: string,
  defaultValue: T
): T {
  if (memCache.has(key)) {
    const v = memCache.get(key)
    return (v === null || v === undefined) ? defaultValue : (v as T)
  }
  const lsV = getFromLS(key)
  if (lsV !== undefined) {
    memCache.set(key, lsV)
    return lsV as T
  }
  return defaultValue
}

/**
 * Write a single setting to DB + cache + localStorage.
 * Requires admin role (server enforces).
 * Returns true on success, false on any error.
 */
export async function setSettingDB(key: string, value: SettingValue): Promise<boolean> {
  // Optimistic local update
  memCache.set(key, value)
  setToLS(key, value)
  if (!inBrowser()) return false  // server can't POST to itself meaningfully

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Bulk save.
 */
export async function setManySettingsDB(settings: Record<string, SettingValue>): Promise<boolean> {
  for (const [k, v] of Object.entries(settings)) {
    memCache.set(k, v)
    setToLS(k, v)
  }
  if (!inBrowser()) return false

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    })
    return res.ok
  } catch {
    return false
  }
}

async function refreshOne(key: string): Promise<void> {
  if (!inBrowser()) return
  try {
    const res = await fetch(`/api/settings?key=${encodeURIComponent(key)}`, { cache: 'no-store' })
    if (!res.ok) return
    const data = await res.json()
    const value = data?.value
    if (value !== null && value !== undefined) {
      memCache.set(key, value)
      setToLS(key, value)
    }
  } catch { /* non-fatal */ }
}

/**
 * One-time migration: push any localStorage values to DB.
 * Returns { migrated, failed }.
 */
export async function migrateLocalStorageToDB(): Promise<{ migrated: number; failed: number }> {
  if (!inBrowser()) return { migrated: 0, failed: 0 }

  const toMigrate: Record<string, SettingValue> = {}

  // 1. Collect prefixed keys
  for (let i = 0; i < window.localStorage.length; i++) {
    const fullKey = window.localStorage.key(i)
    if (!fullKey || !fullKey.startsWith(LS_PREFIX)) continue
    const raw = window.localStorage.getItem(fullKey)
    if (raw === null) continue
    toMigrate[fullKey.slice(LS_PREFIX.length)] = deserialize(raw)
  }

  // 2. Legacy unprefixed keys (from old settings.ts)
  const LEGACY_KEYS = [
    'clinic_name', 'clinic_address', 'clinic_phone', 'clinic_email', 'clinic_gst',
    'doctor_name', 'doctor_qualification', 'doctor_registration', 'doctor_phone',
    'consultation_fee', 'followup_fee', 'opd_upi_id', 'ipd_upi_id',
    'prescription_header', 'prescription_footer', 'invoice_prefix',
    'gst_percent_default', 'enable_gst', 'enable_razorpay',
  ]
  for (const key of LEGACY_KEYS) {
    if (key in toMigrate) continue
    const raw = window.localStorage.getItem(key)
    if (raw === null) continue
    // Best-effort for legacy unenveloped values: try JSON.parse, fallback to string
    let val: SettingValue
    if (raw.startsWith('{') || raw.startsWith('[')) {
      try { val = JSON.parse(raw) } catch { val = raw }
    } else {
      val = raw  // string, preserved literally
    }
    toMigrate[key] = val
  }

  if (Object.keys(toMigrate).length === 0) {
    return { migrated: 0, failed: 0 }
  }

  const ok = await setManySettingsDB(toMigrate)
  return ok
    ? { migrated: Object.keys(toMigrate).length, failed: 0 }
    : { migrated: 0, failed: Object.keys(toMigrate).length }
}

/**
 * Clear all cached settings. Use sparingly — forces reload from DB on next access.
 */
export function clearSettingsCache(): void {
  memCache.clear()
  bulkLoaded = false
}