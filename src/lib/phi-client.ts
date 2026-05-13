/**
 * src/lib/phi-client.ts — CLIENT-SAFE
 *
 * PHI utilities for browser/client-side code.
 *
 * This module provides:
 *   1. Masking functions (for displaying sensitive data in UI)
 *   2. API calls to /api/phi for server-side encrypt/decrypt
 *   3. Encryption status check
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  This file is SAFE to import in client components.              ║
 * ║  It contains NO encryption keys or secrets.                     ║
 * ║  All actual crypto operations happen server-side via /api/phi.  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

// ── Masking Functions (pure client-side, no secrets needed) ────

/**
 * Mask Aadhaar number: show only last 4 digits.
 * Input: "123456789012" → "XXXX XXXX 9012"
 */
export function maskAadhaar(aadhaar: string): string {
  if (!aadhaar) return '—'
  const digits = aadhaar.replace(/\D/g, '')
  if (digits.length < 4) return '—'
  return `XXXX XXXX ${digits.slice(-4)}`
}

/**
 * Mask mobile number: show only last 4 digits.
 * Input: "9876543210" → "XXXXXX3210"
 */
export function maskMobile(mobile: string): string {
  if (!mobile) return '—'
  const digits = mobile.replace(/\D/g, '').slice(-10)
  if (digits.length < 4) return '—'
  return `XXXXXX${digits.slice(-4)}`
}

/**
 * Mask any sensitive value: show only last N characters.
 * Default: last 4 characters visible.
 */
export function maskValue(value: string, visibleChars: number = 4): string {
  if (!value || value.length <= visibleChars) return value || '—'
  const masked = 'X'.repeat(value.length - visibleChars)
  return masked + value.slice(-visibleChars)
}

// ── API-based Encrypt/Decrypt (calls server) ──────────────────

export interface PHIEncryptResponse {
  success: boolean
  encrypted?: string
  error?: string
  code?: string
}

export interface PHIDecryptResponse {
  success: boolean
  decrypted?: string
  masked?: string
  error?: string
}

export interface PHIStatusResponse {
  configured: boolean
  status: 'configured' | 'not_configured' | 'invalid'
  message: string
}

/**
 * Encrypt a PHI value via the server-side API.
 * Use this when you need to encrypt before saving (e.g., in forms).
 *
 * Returns the encrypted string or throws if encryption is not configured.
 */
export async function encryptPHIViaAPI(plaintext: string): Promise<string> {
  if (!plaintext || !plaintext.trim()) return ''

  const res = await fetch('/api/phi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'encrypt', value: plaintext }),
  })

  const data: PHIEncryptResponse = await res.json()

  if (!res.ok || !data.success) {
    throw new Error(data.error || 'PHI encryption failed. Ensure HOSPITAL_ENCRYPTION_KEY is configured.')
  }

  return data.encrypted!
}

/**
 * Decrypt a PHI value via the server-side API.
 * Use this when you need to display a decrypted value in the UI.
 *
 * Returns { decrypted, masked } — use masked for display, decrypted only when necessary.
 */
export async function decryptPHIViaAPI(
  encrypted: string,
  options: { returnMasked?: boolean; maskType?: 'aadhaar' | 'mobile' } = {}
): Promise<{ decrypted: string; masked: string }> {
  if (!encrypted || !encrypted.trim()) return { decrypted: '', masked: '—' }

  const res = await fetch('/api/phi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'decrypt',
      value: encrypted,
      maskType: options.maskType,
    }),
  })

  const data: PHIDecryptResponse = await res.json()

  if (!res.ok || !data.success) {
    // Graceful degradation on decrypt — return the raw value masked
    return { decrypted: encrypted, masked: '—' }
  }

  return {
    decrypted: data.decrypted!,
    masked: data.masked || maskValue(data.decrypted!),
  }
}

/**
 * Check if PHI encryption is properly configured on the server.
 * Use this in admin settings to show a warning banner.
 */
export async function checkEncryptionStatus(): Promise<PHIStatusResponse> {
  try {
    const res = await fetch('/api/phi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' }),
    })

    if (!res.ok) {
      return {
        configured: false,
        status: 'not_configured',
        message: 'Failed to check encryption status',
      }
    }

    return await res.json()
  } catch {
    return {
      configured: false,
      status: 'not_configured',
      message: 'Could not connect to server to verify encryption status',
    }
  }
}

/**
 * Pre-flight check: Can we safely save patient PHI?
 * Call this before allowing patient creation with Aadhaar.
 *
 * Returns true if encryption is configured and ready.
 * Returns false (with error message) if saving would expose PHI.
 */
export async function canSavePHI(): Promise<{ allowed: boolean; error?: string }> {
  try {
    const status = await checkEncryptionStatus()

    if (status.configured) {
      return { allowed: true }
    }

    return {
      allowed: false,
      error: 'PHI encryption is not configured. Aadhaar numbers cannot be saved. ' +
        'Please contact your administrator to set up HOSPITAL_ENCRYPTION_KEY.',
    }
  } catch {
    return {
      allowed: false,
      error: 'Could not verify encryption status. Please try again.',
    }
  }
}
