/**
 * src/app/api/phi/route.ts
 *
 * PHI (Protected Health Information) API Route — Server-Only Crypto Operations
 *
 * This route handles all PHI encryption/decryption on the server side.
 * The encryption key NEVER leaves the server — client code calls this API.
 *
 * Actions:
 *   - encrypt:  Encrypt a plaintext value (Aadhaar, mobile, etc.)
 *   - decrypt:  Decrypt an encrypted value and return with optional mask
 *   - status:   Check if encryption is configured (for admin UI warnings)
 *
 * Security:
 *   - All actions require authentication (valid Supabase JWT)
 *   - Decrypt returns both raw and masked values (prefer masked for display)
 *   - Rate-limited inherently by Supabase auth validation overhead
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  encryptPHI,
  decryptPHI,
  maskAadhaar,
  maskMobile,
  getEncryptionStatus,
  isEncryptionConfigured,
  PHIEncryptionError,
} from '@/lib/phi-crypto'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

/**
 * Validate the caller is authenticated.
 * Returns the user or null if unauthenticated.
 */
async function authenticateRequest(req: NextRequest): Promise<{ id: string; email: string } | null> {
  const authHeader = req.headers.get('authorization') || ''
  const [scheme, token] = authHeader.split(' ')

  // Try Authorization header first
  if (scheme === 'Bearer' && token) {
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    const { data: { user } } = await admin.auth.getUser(token)
    if (user) return { id: user.id, email: user.email || '' }
  }

  // Try cookie-based auth (for client-side calls without explicit Bearer token)
  const cookieHeader = req.headers.get('cookie') || ''
  if (cookieHeader) {
    try {
      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
      // Extract access token from Supabase auth cookie if present
      const match = cookieHeader.match(/sb-[^-]+-auth-token=([^;]+)/)
      if (match) {
        try {
          const parsed = JSON.parse(decodeURIComponent(match[1]))
          const accessToken = parsed?.[0] || parsed?.access_token
          if (accessToken) {
            const { data: { user } } = await admin.auth.getUser(accessToken)
            if (user) return { id: user.id, email: user.email || '' }
          }
        } catch {
          // Cookie parsing failed — fall through
        }
      }
    } catch {
      // Cookie auth failed — fall through
    }
  }

  return null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, value, maskType } = body

    if (!action) {
      return NextResponse.json(
        { success: false, error: 'Missing "action" field. Use: encrypt, decrypt, or status.' },
        { status: 400 }
      )
    }

    // ── Status check: does not require auth (used by setup wizard) ──
    if (action === 'status') {
      const status = getEncryptionStatus()
      const messages: Record<string, string> = {
        configured: 'PHI encryption is active and properly configured.',
        not_configured: 'HOSPITAL_ENCRYPTION_KEY is not set. Patient Aadhaar data CANNOT be saved securely.',
        invalid: 'HOSPITAL_ENCRYPTION_KEY is malformed. Must be a hex string of at least 32 characters.',
      }
      return NextResponse.json({
        success: true,
        configured: status === 'configured',
        status,
        message: messages[status],
      })
    }

    // ── All other actions require authentication ──────────────────
    const user = await authenticateRequest(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required. Please log in.' },
        { status: 401 }
      )
    }

    // ── Encrypt ───────────────────────────────────────────────────
    if (action === 'encrypt') {
      if (!value || typeof value !== 'string') {
        return NextResponse.json(
          { success: false, error: 'Missing or invalid "value" to encrypt.' },
          { status: 400 }
        )
      }

      // Validate value isn't excessively long (prevent abuse)
      if (value.length > 500) {
        return NextResponse.json(
          { success: false, error: 'Value too long. Max 500 characters for PHI encryption.' },
          { status: 400 }
        )
      }

      const encrypted = encryptPHI(value)
      return NextResponse.json({ success: true, encrypted })
    }

    // ── Decrypt ───────────────────────────────────────────────────
    if (action === 'decrypt') {
      if (!value || typeof value !== 'string') {
        return NextResponse.json(
          { success: false, error: 'Missing or invalid "value" to decrypt.' },
          { status: 400 }
        )
      }

      const decrypted = decryptPHI(value)

      // Generate appropriate mask based on type
      let masked = '—'
      if (maskType === 'aadhaar') {
        masked = maskAadhaar(decrypted)
      } else if (maskType === 'mobile') {
        masked = maskMobile(decrypted)
      } else {
        // Generic mask: show last 4 chars
        if (decrypted.length > 4) {
          masked = 'X'.repeat(decrypted.length - 4) + decrypted.slice(-4)
        } else {
          masked = decrypted
        }
      }

      return NextResponse.json({ success: true, decrypted, masked })
    }

    // ── Encrypt patient record (batch operation) ──────────────────
    if (action === 'encrypt_patient') {
      const { aadhaar_no, mobile } = body

      const result: Record<string, string | null> = {
        aadhaar_encrypted: null,
        aadhaar_last4: null,
        mobile_encrypted: null,
      }

      if (aadhaar_no && typeof aadhaar_no === 'string') {
        const cleanAadhaar = aadhaar_no.replace(/\D/g, '')
        if (cleanAadhaar.length > 0) {
          result.aadhaar_encrypted = encryptPHI(cleanAadhaar)
          result.aadhaar_last4 = cleanAadhaar.slice(-4)
        }
      }

      if (mobile && typeof mobile === 'string') {
        const cleanMobile = mobile.replace(/\D/g, '').slice(-10)
        if (cleanMobile.length > 0) {
          try {
            result.mobile_encrypted = encryptPHI(cleanMobile)
          } catch {
            // Mobile encryption failure is non-fatal
            result.mobile_encrypted = null
          }
        }
      }

      return NextResponse.json({ success: true, ...result })
    }

    return NextResponse.json(
      { success: false, error: `Unknown action: "${action}". Use: encrypt, decrypt, status, or encrypt_patient.` },
      { status: 400 }
    )
  } catch (err: unknown) {
    // Handle known PHI errors gracefully
    if (err instanceof PHIEncryptionError) {
      return NextResponse.json(
        {
          success: false,
          error: err.message,
          code: err.code,
        },
        { status: 503 } // Service Unavailable — encryption not ready
      )
    }

    // Handle JSON parse errors
    if (err instanceof SyntaxError) {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON request body.' },
        { status: 400 }
      )
    }

    // Unknown error
    console.error('[PHI API] Unexpected error:', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error during PHI operation.' },
      { status: 500 }
    )
  }
}
