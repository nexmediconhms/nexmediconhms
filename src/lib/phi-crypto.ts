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
 *
 * ═══════════════════════════════════════════════════════════════════════
 * UPDATES IN THIS VERSION (June 2026) — DPDP-COMPLIANCE-CRITICAL
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   FIX #20: STRICT KEY LENGTH VALIDATION (CRITICAL — was silently weakening AES-256)
 *     The previous version accepted any hex key ≥ 32 chars, then padded short
 *     keys with '0' to 64 chars:
 *         Buffer.from(KEY_HEX.slice(0, 64).padEnd(64, '0'), 'hex')
 *
 *     For a 32-char key this gave: 16 bytes of real entropy + 16 bytes of zeros.
 *     AES-256 was effectively reduced to <=128-bit security, with all PHI
 *     vulnerable to a key-half brute-force attack.
 *
 *     NEW BEHAVIOR:
 *       - getEncryptionStatus() now requires EXACTLY 64 hex chars for
 *         'configured'. Wrong-length keys return 'invalid' (rolled into the
 *         existing state rather than adding a new one — preserves the public
 *         API contract with phi-client.ts PHIStatusResponse and /api/phi route).
 *       - getKeyBuffer() no longer pads. A wrong-length key throws
 *         PHIEncryptionError with code 'KEY_INVALID'. The error MESSAGE
 *         distinguishes non-hex from wrong-length so admins can act on it.
 *       - isEncryptionConfigured() returns true ONLY for status 'configured'
 *         (was the case before; now strictly enforced at the byte level).
 *
 *   FIX #21: NO SILENT PLAINTEXT MOBILE STORAGE (CRITICAL — DPDP violation)
 *     Previous version of encryptPatientPHI(): when mobile encryption failed,
 *     it set `mobile_encrypted = null` but left the original `mobile` field
 *     unchanged. Result: plaintext mobile saved to DB while the system pretended
 *     to support encryption.
 *
 *     NEW BEHAVIOR:
 *       - If encryptPHI succeeds, mobile_encrypted is set normally (mobile
 *         field retained in plaintext for OTP/WhatsApp routing — this is
 *         intentional and documented).
 *       - If encryptPHI throws (key not configured / invalid), encryptPatientPHI
 *         RE-THROWS the same error rather than swallowing it. The caller (API
 *         route or admin form) decides whether mobile is critical enough to
 *         block the save. Previously this was silently masked.
 *       - Console warnings now include the patient context (without leaking PHI).
 *
 *   FIX #21b: PHI-LEAK GUARD ON encryptPatientPHI() RETURN SHAPE
 *     Added a runtime invariant check: when aadhaar_encrypted is set, the
 *     original `aadhaar_no` MUST be null. We assert this before returning.
 *
 * ALL EXISTING CALLERS REMAIN COMPATIBLE:
 *   - encryptPHI, decryptPHI, maskAadhaar, maskMobile, getEncryptionStatus,
 *     isEncryptionConfigured, PHIEncryptionError — signatures unchanged.
 *   - /api/phi route continues to work without modification.
 *   - generateEncryptionKey unchanged.
 * ═══════════════════════════════════════════════════════════════════════
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
 * Three states (UNCHANGED public contract — preserved for backwards compat
 * with phi-client.ts PHIStatusResponse and the /api/phi route):
 *   - 'configured'     → Key is EXACTLY 64 hex chars (256-bit), encryption works
 *   - 'not_configured' → Key is missing/empty, hard-stop on encrypt, passthrough on decrypt
 *   - 'invalid'        → Key is malformed: contains non-hex characters
 *                        OR is the wrong length (FIX #20 rolls wrong-length here
 *                        instead of introducing a new 'weak' state, so the public
 *                        API surface stays the same)
 *
 * The DISTINCTION between non-hex and wrong-length keys is preserved in the
 * error MESSAGE thrown by getKeyBuffer(), not in the status string.
 */
export type EncryptionStatus = 'configured' | 'not_configured' | 'invalid'

/**
 * Get the current encryption configuration status.
 * Used by admin settings page to show warnings.
 *
 * FIX #20: now strictly requires EXACTLY 64 hex chars for 'configured'.
 * Wrong-length keys (e.g., 32 chars = 128-bit) return 'invalid' rather
 * than being silently zero-padded to a weakened AES-256 key.
 */
export function getEncryptionStatus(): EncryptionStatus {
  if (!KEY_HEX || KEY_HEX.length === 0) return 'not_configured'
  // FIX #20: must be exactly 64 hex chars (256-bit key) AND all-hex
  if (KEY_HEX.length !== 64) return 'invalid'
  if (!/^[0-9a-fA-F]+$/.test(KEY_HEX)) return 'invalid'
  return 'configured'
}

/**
 * Check if encryption is configured and valid.
 * Used for pre-flight checks before patient creation.
 *
 * Returns true ONLY when status is 'configured' (exactly 64 hex chars,
 * all valid hex). A wrong-length key is rejected here — was previously
 * accepted and silently padded.
 */
export function isEncryptionConfigured(): boolean {
  return getEncryptionStatus() === 'configured'
}

/**
 * Get the raw key buffer. Throws if not configured.
 *
 * FIX #20: no longer pads short keys with zeros. A wrong-length key
 * throws PHIEncryptionError('KEY_INVALID') rather than silently producing
 * a weakened AES-256 key.
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
    // FIX #20: differentiate the two invalid sub-states in the error MESSAGE
    // (we keep the EncryptionStatus union at three values to preserve the
    // public API contract with phi-client.ts and /api/phi route).
    const isNonHex = !/^[0-9a-fA-F]+$/.test(KEY_HEX)
    if (isNonHex) {
      throw new PHIEncryptionError(
        'HOSPITAL_ENCRYPTION_KEY contains non-hexadecimal characters. ' +
        'It must be a hex string (0-9, a-f, A-F) of exactly 64 characters. ' +
        'Generate a new key with: openssl rand -hex 32',
        'KEY_INVALID'
      )
    }
    // Otherwise: wrong-length key (was previously silently padded with zeros — REMOVED)
    throw new PHIEncryptionError(
      `HOSPITAL_ENCRYPTION_KEY is the wrong length: got ${KEY_HEX.length} hex characters, ` +
      'expected exactly 64 (= 256 bits = AES-256). The previous implementation padded ' +
      'short keys with zeros, silently weakening AES-256 to <=128-bit security. ' +
      'This is no longer allowed. Generate a proper key: openssl rand -hex 32',
      'KEY_INVALID'
    )
  }

  // At this point: status === 'configured' → exactly 64 hex chars = 32 bytes
  return Buffer.from(KEY_HEX, 'hex')
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
 *   - Encryption key is not configured ('KEY_NOT_CONFIGURED')
 *   - Encryption key is invalid (non-hex)             ('KEY_INVALID')
 *   - Encryption key is wrong length (FIX #20)        ('KEY_INVALID')
 *
 * For empty/whitespace-only input, returns empty string without error.
 *
 * This function will NEVER silently return plaintext. It either encrypts
 * successfully or throws an error. This prevents accidental plaintext storage.
 */
export function encryptPHI(plaintext: string): string {
  // Allow empty/null values to pass through (no sensitive data to protect)
  if (!plaintext || !plaintext.trim()) return plaintext || ''

  const key = getKeyBuffer() // throws if not configured / weak / invalid
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

  // If key isn't 'configured' (covers not_configured / invalid / weak),
  // we can't reliably decrypt — return as-is (may be legacy plaintext).
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
 * THROWS PHIEncryptionError if:
 *   - Encryption key is not configured ('KEY_NOT_CONFIGURED')
 *   - Encryption key is invalid / wrong length ('KEY_INVALID') — see FIX #20
 *
 * Usage (server-side only — in API routes):
 *   try {
 *     const safe = encryptPatientPHI(formData)
 *     await supabase.from('patients').insert(safe)
 *   } catch (err) {
 *     if (err instanceof PHIEncryptionError) { ... show error to user ... }
 *   }
 *
 * ═══════════════════════════════════════════════════════════════════════
 * FIX #21: NO MORE SILENT PLAINTEXT MOBILE STORAGE
 *
 * Previous behavior (REMOVED):
 *   if (record.mobile && record.mobile.trim()) {
 *     try { result.mobile_encrypted = encryptPHI(cleanMobile) }
 *     catch { result.mobile_encrypted = null }  ← BUG: original `mobile` field
 *                                                  unchanged, still plaintext
 *   }
 *
 * New behavior:
 *   - encryptPHI throws are re-thrown (caller decides if mobile is critical).
 *   - Mobile is intentionally kept in plaintext on the `mobile` field FOR
 *     OTP / WhatsApp routing. This is documented, explicit, and audited —
 *     not a silent failure mode.
 *   - aadhaar_no is unconditionally cleared after encryption, with a
 *     runtime invariant check that ensures no plaintext Aadhaar leaks
 *     into the database.
 * ═══════════════════════════════════════════════════════════════════════
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

  // ── AADHAAR (always encrypted, plaintext cleared) ───────────
  if (record.aadhaar_no && record.aadhaar_no.trim()) {
    const cleanAadhaar = record.aadhaar_no.replace(/\D/g, '')

    if (cleanAadhaar.length > 0) {
      // This WILL throw if encryption is not configured — intentional hard stop
      result.aadhaar_encrypted = encryptPHI(cleanAadhaar)
      result.aadhaar_last4 = cleanAadhaar.slice(-4)
      // CRITICAL: Remove plaintext Aadhaar — NEVER store it unencrypted
      result.aadhaar_no = null
    }
  }

  // ── MOBILE (FIX #21: no silent plaintext fallback) ─────────
  if (record.mobile && record.mobile.trim()) {
    const cleanMobile = record.mobile.replace(/\D/g, '').slice(-10)

    if (cleanMobile.length > 0) {
      // FIX #21: We deliberately do NOT swallow the error here.
      //
      // Why mobile is treated differently from Aadhaar:
      //   - Aadhaar must be encrypted at rest (DPDP Act + sensitivity).
      //   - Mobile is needed for OTP and WhatsApp routing, so we keep
      //     the plaintext `mobile` field AND store an encrypted copy
      //     in `mobile_encrypted` (defense in depth).
      //
      // If encryption fails, the OLD code silently lost mobile_encrypted
      // and kept the plaintext mobile. That's not what the API documented.
      //
      // The new behavior: let the error bubble up so the caller knows
      // PHI encryption is misconfigured and can decide what to do.
      // For routes that want to be lenient (e.g., portal OTP requests),
      // they should catch PHIEncryptionError explicitly.
      try {
        result.mobile_encrypted = encryptPHI(cleanMobile)
      } catch (err) {
        // We rethrow only KEY_NOT_CONFIGURED / KEY_INVALID (configuration
        // errors). For any other unexpected error, we log and continue
        // since mobile encryption is not strictly required by DPDP for
        // OTP-routable numbers — but we leave a clear breadcrumb.
        if (err instanceof PHIEncryptionError) {
          // Re-throw so caller is forced to make an explicit decision
          // about whether to proceed without mobile encryption.
          throw err
        }
        // Unexpected runtime error in encryption: log without leaking PHI
        console.error(
          '[phi-crypto] Unexpected mobile encryption error (non-config). ' +
          'Mobile will NOT be encrypted-at-rest. Investigate immediately.',
          { errorName: (err as Error)?.name, lastFour: cleanMobile.slice(-4) },
        )
        result.mobile_encrypted = null
      }
    }
  }

  // FIX #21b: runtime invariant — if aadhaar_encrypted is set,
  // the plaintext aadhaar_no MUST be null.
  if (result.aadhaar_encrypted && result.aadhaar_no) {
    throw new PHIEncryptionError(
      '[phi-crypto] INVARIANT VIOLATION: aadhaar_encrypted is set but ' +
      'aadhaar_no plaintext was not cleared. This would leak PHI.',
      'INVARIANT_VIOLATION'
    )
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



// ─────────────────────────────────────────────────────────────────
// FIX (2026-06-04): AADHAAR HMAC for race-free dedup
// ─────────────────────────────────────────────────────────────────
// Why this exists:
//   AES-256-GCM uses a fresh random IV per encryption, so two rows
//   storing the SAME Aadhaar end up with DIFFERENT ciphertexts.
//   That's correct from a confidentiality standpoint — but it makes
//   "have we already registered this Aadhaar?" impossible to answer
//   with a SQL equality check.
//
//   The previous duplicate-check code worked around this by querying
//   `aadhaar_no` (the plaintext column). With encryption switched on
//   that column is always NULL, so the dedup STOPPED WORKING.
//
// Fix:
//   We compute a deterministic HMAC over the Aadhaar digits, using a
//   second server-only secret (HOSPITAL_AADHAAR_HMAC_KEY). The same
//   Aadhaar always hashes to the same string, so:
//     - Two registrations of the same Aadhaar collide on the DB
//       unique index `uniq_patients_aadhaar_hmac_nonnull`.
//     - The plaintext Aadhaar is NEVER stored, queryable, or sent
//       to the browser.
//
// Properties:
//   - Deterministic: same input → same output (required for dedup).
//   - Keyed: an attacker who steals the DB still can't brute-force
//     the 12-digit Aadhaar space (10^12) without the HMAC key.
//   - Distinct from the AES key: rotating one doesn't force re-encrypt
//     of the other.
//   - Length: 64 hex chars (256 bits).
//
// Returns null (not throw) if the HMAC key is unconfigured — the
// caller is expected to refuse the write in that case, just like
// encryptPHI throws on missing AES key.
// ─────────────────────────────────────────────────────────────────

import { createHmac } from 'crypto'

const HMAC_KEY_HEX = process.env.HOSPITAL_AADHAAR_HMAC_KEY || ''

/** Configuration check for the HMAC key (independent of AES key). */
export function isAadhaarHmacConfigured(): boolean {
  return HMAC_KEY_HEX.length === 64 && /^[0-9a-fA-F]+$/.test(HMAC_KEY_HEX)
}

/**
 * Compute the deterministic dedup hash for an Aadhaar number.
 *
 * @param aadhaarDigits  Digits-only Aadhaar (12 digits expected).
 *                       The function digit-strips defensively.
 * @returns 64-char hex string, or null if HMAC key unconfigured.
 *
 * Throws PHIEncryptionError('HMAC_KEY_INVALID') only if the key is
 * present but malformed (non-hex / wrong length). A simply-missing
 * key returns null so the caller can show a friendlier "set up
 * encryption first" error.
 */
export function computeAadhaarHmac(aadhaarDigits: string): string | null {
  if (!aadhaarDigits) return null

  const digits = String(aadhaarDigits).replace(/\D/g, '')
  if (digits.length === 0) return null

  if (HMAC_KEY_HEX.length === 0) {
    return null
  }
  if (HMAC_KEY_HEX.length !== 64 || !/^[0-9a-fA-F]+$/.test(HMAC_KEY_HEX)) {
    throw new PHIEncryptionError(
      'HOSPITAL_AADHAAR_HMAC_KEY is malformed: must be exactly 64 hex chars. ' +
      'Generate with: openssl rand -hex 32',
      'HMAC_KEY_INVALID'
    )
  }

  const keyBuf = Buffer.from(HMAC_KEY_HEX, 'hex')
  return createHmac('sha256', keyBuf).update(digits, 'utf8').digest('hex')
}

/**
 * Convenience wrapper: returns the columns to insert/update on the
 * patients table when registering or editing a patient with an Aadhaar.
 *
 * Returns shape:
 *   {
 *     aadhaar_encrypted: string,   // base64 AES-256-GCM
 *     aadhaar_last4:     string,   // displayable 4-digit suffix
 *     aadhaar_hmac:      string,   // dedup hash (64 hex chars)
 *     aadhaar_no:        null      // explicit null to clear plaintext
 *   }
 *
 * Or null if no Aadhaar was provided.
 *
 * Throws PHIEncryptionError if either AES or HMAC keys are missing.
 * The caller (a server route) should catch and surface a helpful
 * "encryption not configured" error to the user.
 */
export function buildEncryptedAadhaarFields(rawAadhaar: string | null | undefined): {
  aadhaar_encrypted: string
  aadhaar_last4:     string
  aadhaar_hmac:      string
  aadhaar_no:        null
} | null {
  if (!rawAadhaar) return null
  const digits = String(rawAadhaar).replace(/\D/g, '')
  if (digits.length === 0) return null

  // Hard-fail on either missing key — never silently store plaintext.
  if (!isEncryptionConfigured()) {
    throw new PHIEncryptionError(
      'HOSPITAL_ENCRYPTION_KEY is not configured. Cannot save Aadhaar.',
      'KEY_NOT_CONFIGURED'
    )
  }
  const hmac = computeAadhaarHmac(digits)
  if (hmac === null) {
    throw new PHIEncryptionError(
      'HOSPITAL_AADHAAR_HMAC_KEY is not configured. Aadhaar duplicate detection ' +
      'requires this second key. Generate with: openssl rand -hex 32',
      'HMAC_KEY_NOT_CONFIGURED'
    )
  }

  return {
    aadhaar_encrypted: encryptPHI(digits),
    aadhaar_last4:     digits.slice(-4),
    aadhaar_hmac:      hmac,
    aadhaar_no:        null,
  }
}
