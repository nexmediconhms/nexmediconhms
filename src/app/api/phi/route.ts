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
 * 2026-06-04 audit fix (§1.2):
 *   - Decrypt now requires admin or doctor role (was: any authenticated user).
 *     A previously-authenticated lab_partner / staff account could read
 *     `aadhaar_encrypted` from `patients` (RLS allows SELECT) and POST it
 *     here to get plaintext back. Now restricted to roles that need it.
 *   - Every successful decrypt is now audited via insert_audit_entry RPC,
 *     creating a tamper-evident trail of who decrypted what and when
 *     (DPDP-Act-required PHI access logging).
 *   - 'invalid' status message corrected from "at least 32 characters"
 *     (the old behaviour) to "exactly 64 hex characters" (current
 *     behaviour after FIX #20).
 *   - encrypt_patient action no longer silently swallows mobile
 *     encryption errors; aligned with phi-crypto.ts FIX #21.
 */

/**
 * Look up the caller's clinic_users row to determine role.
 * Returns null if the user isn't in clinic_users / not active.
 */
async function authenticateAndAuthorize(
  req: NextRequest,
  requiredRoles?: string[],
): Promise<{ id: string; email: string; clinicUserId: string; role: string } | { error: string; status: number }> {
  const authHeader = req.headers.get('authorization') || ''
  const [scheme, token] = authHeader.split(' ')
  let userId: string | null = null
  let userEmail: string = ''

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Try Authorization header first
  if (scheme === 'Bearer' && token) {
    const { data: { user } } = await admin.auth.getUser(token)
    if (user) { userId = user.id; userEmail = user.email || '' }
  }

  // Cookie fallback
  if (!userId) {
    const cookieHeader = req.headers.get('cookie') || ''
    const match = cookieHeader.match(/sb-[^-]+-auth-token=([^;]+)/)
    if (match) {
      try {
        const parsed = JSON.parse(decodeURIComponent(match[1]))
        const accessToken = parsed?.[0] || parsed?.access_token
        if (accessToken) {
          const { data: { user } } = await admin.auth.getUser(accessToken)
          if (user) { userId = user.id; userEmail = user.email || '' }
        }
      } catch { /* ignore */ }
    }
  }

  if (!userId) {
    return { error: 'Authentication required. Please log in.', status: 401 }
  }

  // Look up role + clinic_user id
  const { data: cu } = await admin
    .from('clinic_users')
    .select('id, email, role, is_active')
    .eq('auth_id', userId)
    .single()

  if (!cu || !cu.is_active) {
    return { error: 'Account not found in clinic_users or inactive.', status: 403 }
  }

  if (requiredRoles && !requiredRoles.includes(cu.role)) {
    return {
      error: `Forbidden. This action requires role(s): ${requiredRoles.join(', ')}. Your role: ${cu.role}.`,
      status: 403,
    }
  }

  return { id: userId, email: userEmail || cu.email, clinicUserId: cu.id, role: cu.role }
}

/**
 * Audit a successful PHI decrypt. Non-blocking — never crashes the request.
 */
async function auditDecrypt(
  user: { clinicUserId: string; email: string; role: string },
  maskType: string | undefined,
  cipherLen: number,
) {
  try {
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    await admin.rpc('insert_audit_entry', {
      p_user_id:      user.clinicUserId,
      p_user_email:   user.email,
      p_user_role:    user.role,
      p_action:       'view',                  // PHI access = view
      p_entity_type:  'patient',
      p_entity_id:    null,
      p_entity_label: `PHI decrypt (${maskType || 'generic'})`,
      p_changes:      JSON.stringify({ ciphertext_len: cipherLen }),
    })
  } catch (e: any) {
    console.warn('[PHI API] decrypt audit failed (non-fatal):', e?.message)
  }
}

/**
 * Legacy helper retained for backwards compatibility with code paths
 * that don't need a role (status, encrypt). Returns user-or-null.
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
  // The Supabase client on the frontend automatically includes cookies
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

    // ── Status check ─────────────────────────────────────────────
    //
    // FIX (May 2026): the previous version returned a detailed
    // breakdown of why encryption was not working (env-var missing
    // vs malformed key length) without authentication.  An attacker
    // can use that to fingerprint a target deployment.  We now
    // return ONLY a boolean to anonymous callers; full diagnostic
    // detail requires authentication.
    if (action === 'status') {
      const status = getEncryptionStatus()
      const configured = status === 'configured'

      // Anonymous callers get a yes/no.
      const user = await authenticateRequest(req)
      if (!user) {
        return NextResponse.json({ success: true, configured })
      }

      // Authenticated users get the diagnostic detail.
      const messages: Record<string, string> = {
        configured: 'PHI encryption is active and properly configured.',
        not_configured: 'HOSPITAL_ENCRYPTION_KEY is not set. Patient Aadhaar data CANNOT be saved securely.',
        // FIX (2026-06-04): message corrected to reflect actual phi-crypto.ts FIX #20 contract.
        invalid: 'HOSPITAL_ENCRYPTION_KEY is malformed. Must be EXACTLY 64 hexadecimal characters (256-bit AES). Generate with: openssl rand -hex 32',
      }
      return NextResponse.json({
        success: true,
        configured,
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

      // FIX (2026-06-04 §1.2): decrypt is admin/doctor-only.
      // Receptionist/staff/lab_partner cannot turn ciphertext back into plaintext.
      const authz = await authenticateAndAuthorize(req, ['admin', 'doctor'])
      if ('error' in authz) {
        return NextResponse.json({ success: false, error: authz.error }, { status: authz.status })
      }

      const decrypted = decryptPHI(value)

      // FIX (2026-06-04 §1.2): every decrypt is audited (DPDP-Act PHI access logging).
      // This runs after decryption succeeds and before responding, so a failed
      // audit doesn't reveal info to the caller (we just log it server-side).
      await auditDecrypt(authz, maskType, value.length)

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
    // FIX (2026-06-04 §1.3): no longer silently swallows mobile encryption
    // errors (was: `try { encryptPHI(...) } catch { result.mobile_encrypted = null }`).
    // Aligned with src/lib/phi-crypto.ts FIX #21 — configuration errors
    // bubble up so the caller knows encryption is misconfigured.
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
          // encryptPHI throws on missing/invalid key; let the outer catch handle
          // it (returns 503 with PHIEncryptionError details).
          result.aadhaar_encrypted = encryptPHI(cleanAadhaar)
          result.aadhaar_last4 = cleanAadhaar.slice(-4)
        }
      }

      if (mobile && typeof mobile === 'string') {
        const cleanMobile = mobile.replace(/\D/g, '').slice(-10)
        if (cleanMobile.length > 0) {
          // FIX (2026-06-04 §1.3): re-throw configuration errors. The previous
          // version did `catch { result.mobile_encrypted = null }` which masked
          // a misconfigured deployment. We now re-throw PHIEncryptionError so
          // the caller (the patient registration route) knows to refuse the
          // save. Truly unexpected runtime errors are still caught and logged
          // (they may not warrant blocking the save).
          try {
            result.mobile_encrypted = encryptPHI(cleanMobile)
          } catch (err) {
            if (err instanceof PHIEncryptionError) throw err
            console.error('[PHI API] Unexpected mobile encryption error (non-config)',
              { errorName: (err as Error)?.name, lastFour: cleanMobile.slice(-4) })
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

    // Unknown error — log a structured server-side line WITHOUT the
    // raw request body (which can contain PHI).  Only the error
    // class / message string is logged; never the value being
    // encrypted/decrypted.
    const eMsg = (err as { message?: string })?.message ?? String(err)
    console.error(`[PHI API] Unexpected error: ${eMsg}`)
    return NextResponse.json(
      { success: false, error: 'Internal server error during PHI operation.' },
      { status: 500 }
    )
  }
}
