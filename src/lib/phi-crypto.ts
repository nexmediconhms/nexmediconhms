/**
 * src/lib/phi-crypto.ts
 *
 * PHI (Protected Health Information) Encryption
 * Requirement #9 — DPDP Act 2023 compliance
 *
 * Encrypts Aadhaar numbers and mobile numbers using AES-256-GCM
 * via the Web Crypto API (browser & Edge runtime compatible).
 *
 * Key derivation:
 *   - Master key comes from env var HOSPITAL_ENCRYPTION_KEY (32 hex chars = 128-bit, or 64 = 256-bit)
 *   - Each value gets a unique random IV (stored alongside ciphertext)
 *   - Stored format: base64( iv[12 bytes] || ciphertext )
 *
 * Server-side: pgcrypto's pgp_sym_encrypt/decrypt is used in SQL for
 * values stored in the encrypted columns (aadhaar_encrypted, mobile_encrypted).
 *
 * Client-side: this module wraps the same logic using Web Crypto API
 * for in-browser operations (e.g. displaying masked values).
 *
 * IMPORTANT: The encryption key MUST be the same on all deployments.
 * Store it as HOSPITAL_ENCRYPTION_KEY in Vercel environment variables.
 * If the key is lost, all encrypted PHI is unrecoverable.
 */

const KEY_HEX = process.env.HOSPITAL_ENCRYPTION_KEY || ''

// ── Key import ────────────────────────────────────────────────

let _keyCache: CryptoKey | null = null

async function getCryptoKey(): Promise<CryptoKey | null> {
  if (_keyCache) return _keyCache
  if (!KEY_HEX || KEY_HEX.length < 32) {
    console.warn('[phi-crypto] HOSPITAL_ENCRYPTION_KEY not set or too short. PHI encryption disabled.')
    return null
  }

  try {
    const keyBytes = hexToBytes(KEY_HEX.slice(0, 64)) // max 256-bit
    _keyCache = await crypto.subtle.importKey(
      'raw',
      keyBytes.buffer as ArrayBuffer,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    )
    return _keyCache
  } catch (e) {
    console.error('[phi-crypto] Failed to import key:', e)
    return null
  }
}

// ── Encrypt ───────────────────────────────────────────────────

/**
 * Encrypt a plaintext string.
 * Returns a base64-encoded string containing IV + ciphertext.
 * Returns the original plaintext if encryption is unavailable (key not set).
 */
export async function encryptPHI(plaintext: string): Promise<string> {
  if (!plaintext?.trim()) return plaintext

  const key = await getCryptoKey()
  if (!key) return plaintext  // graceful degradation

  const iv         = crypto.getRandomValues(new Uint8Array(12))
  const encoded    = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)

  // Combine: iv(12) + ciphertext
  const combined = new Uint8Array(12 + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), 12)

  return btoa(String.fromCharCode(...Array.from(combined)))
}

// ── Decrypt ───────────────────────────────────────────────────

/**
 * Decrypt a base64-encoded encrypted PHI string.
 * Returns the plaintext, or the input unchanged if decryption fails.
 */
export async function decryptPHI(encrypted: string): Promise<string> {
  if (!encrypted?.trim()) return encrypted

  const key = await getCryptoKey()
  if (!key) return encrypted

  try {
    const combined   = new Uint8Array(atob(encrypted).split('').map(c => c.charCodeAt(0)))
    const iv         = combined.slice(0, 12)
    const ciphertext = combined.slice(12)
    const plainBuf   = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
    return new TextDecoder().decode(plainBuf)
  } catch {
    // Decryption failed — probably plaintext (legacy record before encryption was added)
    return encrypted
  }
}

// ── Mask for display ──────────────────────────────────────────

/**
 * Mask Aadhaar number: show only last 4 digits.
 * Input: decrypted 12-digit string  →  Output: "XXXX XXXX 1234"
 */
export function maskAadhaar(aadhaar: string): string {
  const digits = aadhaar.replace(/\D/g, '')
  if (digits.length < 4) return '—'
  return `XXXX XXXX ${digits.slice(-4)}`
}

/**
 * Mask mobile number: show only last 4 digits.
 * Input: "9876543210"  →  Output: "XXXXXX3210"
 */
export function maskMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, '').slice(-10)
  if (digits.length < 4) return '—'
  return `XXXXXX${digits.slice(-4)}`
}

// ── Encrypt patient record fields ─────────────────────────────

/**
 * Encrypt all PHI fields in a patient record before inserting/updating.
 * Returns the record with encrypted fields added.
 *
 * Usage:
 *   const safe = await encryptPatientPHI(form)
 *   await supabase.from('patients').insert(safe)
 */
export async function encryptPatientPHI<T extends {
  aadhaar_no?: string
  mobile?:     string
}>(record: T): Promise<T & {
  aadhaar_encrypted?: string
  mobile_encrypted?:  string
  aadhaar_last4?:     string
}> {
  const result: any = { ...record }

  if (record.aadhaar_no?.trim()) {
    result.aadhaar_encrypted = await encryptPHI(record.aadhaar_no.replace(/\D/g, ''))
    result.aadhaar_last4     = record.aadhaar_no.replace(/\D/g, '').slice(-4)
    // Null out plaintext after encrypting
    // NOTE: during transition period, keep aadhaar_no for backward compat
    // Once all records are migrated, remove the plaintext field.
  }

  if (record.mobile?.trim()) {
    result.mobile_encrypted = await encryptPHI(record.mobile.replace(/\D/g, '').slice(-10))
    // Keep mobile in plaintext for search index (mobile is used for OTP, WhatsApp)
    // Mobile is less sensitive than Aadhaar — mask in display only
  }

  return result
}

/**
 * Decrypt PHI fields in a patient record fetched from the database.
 */
export async function decryptPatientPHI<T extends {
  aadhaar_encrypted?: string
  mobile_encrypted?:  string
}>(record: T): Promise<T & { aadhaar_no_decrypted?: string; mobile_decrypted?: string }> {
  const result: any = { ...record }

  if (record.aadhaar_encrypted) {
    result.aadhaar_no_decrypted = await decryptPHI(record.aadhaar_encrypted as string)
  }
  if (record.mobile_encrypted) {
    result.mobile_decrypted = await decryptPHI(record.mobile_encrypted as string)
  }

  return result
}

// ── Utility ───────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

/**
 * Check if encryption is configured.
 * Show a warning in Settings if not.
 */
export function isEncryptionConfigured(): boolean {
  return KEY_HEX.length >= 32
}