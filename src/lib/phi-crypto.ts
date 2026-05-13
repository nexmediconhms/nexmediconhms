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
if (typeof window !== 'undefined') {
  throw new Error(
    '[phi-crypto] SECURITY ERROR: This module is server-only and must not be ' +
    'imported in client-side code. Use @/lib/phi-client for browser operations.'
  )
}

// ── Key Management ────────────────────────────────────────────

const KEY_HEX = process.env.HOSPITAL_ENCRYPTION_KEY || ''

export type EncryptionStatus = 'configured' | 'not_configured' | 'invalid'

export function getEncryptionStatus(): EncryptionStatus {
  if (!KEY_HEX || KEY_HEX.length === 0) return 'not_configured'
  if (KEY_HEX.length < 32) return 'invalid'
  if (!/^[0-9a-fA-F]+$/.test(KEY_HEX)) return 'invalid'
  return 'configured'
}

export function isEncryptionConfigured(): boolean {
  return getEncryptionStatus() === 'configured'
}

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

export function encryptPHI(plaintext: string): string {
  if (!plaintext || !plaintext.trim()) return plaintext || ''

  const key = getKeyBuffer()
  const iv = randomBytes(12)

  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  const combined = Buffer.concat([iv, encrypted, authTag])
  return combined.toString('base64')
}

// ── Decrypt ───────────────────────────────────────────────────

export function decryptPHI(encrypted: string): string {
  if (!encrypted || !encrypted.trim()) return encrypted || ''

  const status = getEncryptionStatus()
  if (status !== 'configured') {
    return encrypted
  }

  try {
    const key = getKeyBuffer()
    const combined = Buffer.from(encrypted, 'base64')

    if (combined.length < 29) {
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
      result.aadhaar_encrypted = encryptPHI(cleanAadhaar)
      result.aadhaar_last4 = cleanAadhaar.slice(-4)
      result.aadhaar_no = null
    }
  }

  if (record.mobile && record.mobile.trim()) {
    const cleanMobile = record.mobile.replace(/\D/g, '').slice(-10)

    if (cleanMobile.length > 0) {
      try {
        result.mobile_encrypted = encryptPHI(cleanMobile)
      } catch {
        result.mobile_encrypted = null
      }
    }
  }

  return result
}

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

export function generateEncryptionKey(): string {
  return randomBytes(32).toString('hex')
}
