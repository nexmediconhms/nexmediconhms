/**
 * src/lib/phi-crypto.ts — SERVER-ONLY
 *
 * PHI (Protected Health Information) Encryption
 * Requirement #9 — DPDP Act 2023 compliance
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  SECURITY FIX: This module is SERVER-ONLY.                       ║
 * ║  It must NEVER be imported in client-side code (pages, components). ║
 * ║  For client-side PHI operations, use src/lib/phi-client.ts       ║
 * ║  which calls the /api/phi endpoint.                              ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Encrypts Aadhaar numbers and mobile numbers using AES-256-GCM
 * via the Node.js crypto module (server/API route only).
 *
 * Key derivation:
 *   - Master key comes from env var HOSPITAL_ENCRYPTION_KEY (64 hex chars = 256-bit)
 *   - Each value gets a unique random IV (stored alongside ciphertext)
 *   - Stored format: base64( iv[12 bytes] || ciphertext || authTag[16 bytes] )
 *
 * IMPORTANT:
 *   - The encryption key MUST be set in production. If missing, PHI operations
 *     will THROW an error (hard stop) — never silently store plaintext.
 *   - Store it as HOSPITAL_ENCRYPTION_KEY in Vercel environment variables.
 *   - If the key is lost, all encrypted PHI is unrecoverable.
 *   - The key must be exactly 64 hex characters (256-bit AES key).
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'

// ── Server-only guard ─────────────────────────────────────────
// This ensures the module cannot be accidentally bundled for the browser.
if (typeof window !== 'undefined') {
  throw new Error(
    '[phi-crypto] SECURITY ERROR: This module is server-only and must not be ' +
    'imported in client-side code. Use @/lib/phi-client for browser operations.'
  )
}

// ── Key Management ────────────────────────────────────────────

const KEY_HEX = process.env.HOSPITAL_ENCRYPTION_KEY || ''

/**
 * PHI Encryption Status
 *
 * Three states:
 *   - 'configured'   → Key is valid, encryption works normally
 *   - 'not_configured' → Key is missing/invalid, hard-stop on encrypt, passthrough on decrypt
 *   - 'invalid'      → Key format is wrong (not hex, wrong length)
 */
export type EncryptionStatus = 'configured' | 'not_configured' | 'invalid'

/**
 * Get the current encryption configuration status.
 * Used by admin settings page to show warnings.
 */
export function getEncryptionStatus(): EncryptionStatus {
  if (!KEY_HEX || KEY_HEX.length === 0) return 'not_configured'
  if (KEY_HEX.length < 32) return 'invalid'
  if (!/^[0-9a-fA-F]+$/.test(KEY_HEX)) return 'invalid'
  return 'configured'
}

/**
 * Check if encryption is configured and valid.
 * Used for pre-flight checks before patient creation.
 */
export function isEncryptionConfigured(): boolean {
  return getEncryptionStatus() === 'configured'
}

/**
 * Get the raw key buffer. Throws if not configured.
 */
function getKeyBuffer(): Buffer {
  const status = getEncryptionStatus()

  if (status === 'not_configured') {
    throw new PHIEncryptionError(
      'HOSPITAL_ENCRYPTION_KEY is not configured. ' +
      'Patient data with Aadhaar/sensitive fields CANNOT be saved until encryption is set up. ' +
      'Add HOSPITAL_ENCRYPTION_KEY (64 hex characters) to your environment variables.',
      'KEY_NOT_CONFIGURED'
    )
  }

  if (status === 'invalid') {
    throw new PHIEncryptionError(
      'HOSPITAL_ENCRYPTION_KEY is invalid. It must be a hex string of at least 32 characters (64 recommended for AES-256). ' +
      'Current key appears malformed. Please regenerate.',
      'KEY_INVALID'
    )
  }

  // Take up to 64 hex chars = 32 bytes = 256-bit key
  return Buffer.from(KEY_HEX.slice(0, 64).padEnd(64, '0'), 'hex')
}

// ── Custom Error Class ────────────────────────────────────────

export class PHIEncryptionError extends Error {
  code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'PHIEncryptionError'
    this.code = code
  }
}

// ── Encrypt ───────────────────────────────────────────────────

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * Returns a base64-encoded string containing: IV (12 bytes) + ciphertext + authTag (16 bytes).
 *
 * THROWS PHIEncryptionError if:
 *   - Encryption key is not configured
 *   - Encryption key is invalid
 *   - Input is empty/whitespace-only (returns empty string without error)
 *
 * This function will NEVER silently return plaintext. It either encrypts
 * successfully or throws an error. This prevents accidental plaintext storage.
 */
export function encryptPHI(plaintext: string): string {
  // Allow empty/null values to pass through (no sensitive data to protect)
  if (!plaintext || !plaintext.trim()) return plaintext || ''

  const key = getKeyBuffer() // throws if not configured
  const iv = randomBytes(12)

  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  // Format: iv(12) + ciphertext(variable) + authTag(16)
  const combined = Buffer.concat([iv, encrypted, authTag])
  return combined.toString('base64')
}

// ── Decrypt ───────────────────────────────────────────────────

/**
 * Decrypt a base64-encoded encrypted PHI string.
 *
 * Behavior:
 *   - If key is not configured: returns the input AS-IS (graceful read degradation for legacy data)
 *   - If decryption fails: returns the input AS-IS (assumes it's legacy plaintext from before encryption)
 *   - If successful: returns the decrypted plaintext
 *
 * We allow graceful degradation on DECRYPT (not encrypt) because:
 *   - Old records may have been stored as plaintext before encryption was enabled
 *   - Reading should never crash the app
 *   - But WRITING plaintext is never acceptable (handled by encryptPHI throwing)
 */
export function decryptPHI(encrypted: string): string {
  if (!encrypted || !encrypted.trim()) return encrypted || ''

  // If key isn't configured, we can't decrypt — return as-is (may be legacy plaintext)
  const status = getEncryptionStatus()
  if (status !== 'configured') {
    return encrypted
  }

  try {
    const key = getKeyBuffer()
    const combined = Buffer.from(encrypted, 'base64')

    // Minimum length: 12 (iv) + 1 (ciphertext) + 16 (authTag) = 29 bytes
    if (combined.length < 29) {
      // Too short to be encrypted — probably legacy plaintext
      return encrypted
    }

    const iv = combined.subarray(0, 12)
    const authTag = combined.subarray(combined.length - 16)
    const ciphertext = combined.subarray(12, combined.length - 16)

    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ])

    return decrypted.toString('utf8')
  } catch {
    // Decryption failed — likely legacy plaintext stored before encryption was enabled
    // Return as-is to avoid breaking reads of old data
    return encrypted
  }
}

// ── Mask for display ──────────────────────────────────────────

export function maskAadhaar(aadhaar: string): string {
  if (!aadhaar) return '—'
  const digits = aadhaar.replace(/\D/g, '')
  if (digits.length < 4) return '—'
  return `XXXX XXXX ${digits.slice(-4)}`
}

export function maskMobile(mobile: string): string {
  if (!mobile) return '—'
  const digits = mobile.replace(/\D/g, '').slice(-10)
  if (digits.length < 4) return '—'
  return `XXXXXX${digits.slice(-4)}`
}

// ── Encrypt patient record fields ─────────────────────────────

/**
 * Encrypt all PHI fields in a patient record before inserting/updating.
 * Returns the record with encrypted fields added and plaintext removed.
 *
 * THROWS PHIEncryptionError if encryption key is not configured and
 * the record contains an Aadhaar number. Mobile is less sensitive
 * and is kept in plaintext for search/OTP functionality.
 *
 * Usage (server-side only — in API routes):
 *   const safe = encryptPatientPHI(formData)
 *   await supabase.from('patients').insert(safe)
 */
export function encryptPatientPHI<T extends {
  aadhaar_no?: string | null
  mobile?: string | null
}>(record: T): T & {
  aadhaar_encrypted?: string | null
  mobile_encrypted?: string | null
  aadhaar_last4?: string | null
  aadhaar_no?: string | null
} {
  const result: any = { ...record }

  if (record.aadhaar_no && record.aadhaar_no.trim()) {
    const cleanAadhaar = record.aadhaar_no.replace(/\D/g, '')

    if (cleanAadhaar.length > 0) {
      // This WILL throw if encryption is not configured — intentional hard stop
      result.aadhaar_encrypted = encryptPHI(cleanAadhaar)
      result.aadhaar_last4 = cleanAadhaar.slice(-4)
      // Remove plaintext Aadhaar — NEVER store it unencrypted
      result.aadhaar_no = null
    }
  }

  if (record.mobile && record.mobile.trim()) {
    const cleanMobile = record.mobile.replace(/\D/g, '').slice(-10)

    if (cleanMobile.length > 0) {
      // Encrypt mobile but also keep plaintext for search/OTP
      // Mobile is less sensitive than Aadhaar but still PHI under DPDP Act
      try {
        result.mobile_encrypted = encryptPHI(cleanMobile)
      } catch {
        // If encryption fails for mobile, we still allow the operation
        // because mobile is needed for OTP/WhatsApp and is less sensitive
        result.mobile_encrypted = null
      }
    }
  }

  return result
}

/**
 * Decrypt PHI fields in a patient record fetched from the database.
 * Never throws — returns original values if decryption fails.
 */
export function decryptPatientPHI<T extends {
  aadhaar_encrypted?: string | null
  mobile_encrypted?: string | null
}>(record: T): T & {
  aadhaar_no_decrypted?: string | null
  mobile_decrypted?: string | null
} {
  const result: any = { ...record }

  if (record.aadhaar_encrypted) {
    result.aadhaar_no_decrypted = decryptPHI(record.aadhaar_encrypted)
  }

  if (record.mobile_encrypted) {
    result.mobile_decrypted = decryptPHI(record.mobile_encrypted)
  }

  return result
}

// ── Key Generation Utility ────────────────────────────────────

/**
 * Generate a new random encryption key.
 * Call this once during initial setup to create HOSPITAL_ENCRYPTION_KEY.
 * Returns a 64-character hex string (256-bit key).
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('hex')
}
