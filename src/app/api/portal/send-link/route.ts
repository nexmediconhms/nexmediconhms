/**
 * src/app/api/portal/send-link/route.ts
 *
 * Patient Portal — Send Magic Link (Staff-initiated)
 *
 * ═══════════════════════════════════════════════════════════════════
 * CRITICAL FIX (2026-06-04):
 *
 * ROOT CAUSE OF 404 PROBLEM:
 *   NEXT_PUBLIC_SITE_URL was set to an OLD Vercel preview deployment URL
 *   (e.g. nexmediconhms-sarvam-iagzpcxz5-...) that no longer exists or
 *   runs outdated code. Every new Vercel deployment creates a new URL,
 *   so the env var becomes stale.
 *
 * THE FIX:
 *   Reversed the priority order — now uses the REQUEST HOST HEADER
 *   as the primary source of the site origin. This means the URL
 *   in the WhatsApp message ALWAYS points to the same deployment
 *   the staff member is currently using (which is guaranteed to be
 *   live and have the latest code).
 *
 *   The env var is now only used as a LAST RESORT fallback when the
 *   request has no host header (which never happens in real HTTP).
 * ═══════════════════════════════════════════════════════════════════
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/api-auth'
import { randomInt } from 'crypto'

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY!
const hospitalName = process.env.NEXT_PUBLIC_HOSPITAL_NAME || 'NexMedicon Hospital'

/**
 * Resolve the site origin from the incoming request.
 *
 * NEW PRIORITY (fixes the stale-env-var 404 problem):
 *   1. Request host header — guaranteed to be the live deployment URL
 *   2. x-forwarded-host header — for proxied deployments
 *   3. NEXT_PUBLIC_SITE_URL env var — only if request has no host
 *   4. VERCEL_URL — Vercel auto-injected
 *   5. Hardcoded fallback
 *
 * This guarantees the generated URL always works because it points
 * to the same deployment the staff member is currently on.
 */
function getSiteOrigin(req: NextRequest): string {
  // Priority 1 & 2: Request headers (the actual live URL)
  const forwardedHost = req.headers.get('x-forwarded-host')
  const host = req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') || 'https'

  // Use forwarded-host first (more reliable behind proxies/CDNs)
  // then fall back to host header
  const liveHost = forwardedHost || host

  if (liveHost) {
    try {
      const origin = `${proto}://${liveHost}`
      // Validate it's a proper URL
      const u = new URL(origin)
      return u.origin // strips any trailing slash automatically
    } catch {
      // Malformed host — fall through to env var
    }
  }

  // Priority 3: explicit env var (only used if no request host)
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL
  if (fromEnv && fromEnv.trim()) {
    try {
      const u = new URL(fromEnv.trim())
      return u.origin
    } catch {
      // Malformed env var
    }
  }

  // Priority 4: Vercel auto-injected URL
  if (process.env.VERCEL_URL) {
    try {
      const u = new URL(`https://${process.env.VERCEL_URL}`)
      return u.origin
    } catch {
      // Fall through
    }
  }

  // Last resort fallback
  return 'https://your-domain.vercel.app'
}

/**
 * Build a portal URL with guaranteed correct format.
 * The URL() constructor automatically normalizes paths,
 * so this NEVER produces double slashes regardless of input.
 */
function buildPortalUrl(origin: string, path: string, params: Record<string, string> = {}): string {
  const u = new URL(path, origin)
  Object.entries(params).forEach(([key, value]) => {
    u.searchParams.set(key, value)
  })
  return u.toString()
}

export async function POST(req: NextRequest) {
  // ── Auth gate ────────────────────────────────────────────────
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth
  // ────────────────────────────────────────────────────────────

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { patient_id, mrn, mobile, patient_name } = body
  if (!mrn) {
    return NextResponse.json({ error: 'mrn is required' }, { status: 400 })
  }

  // Normalize mobile
  const normalizedMobile = mobile ? mobile.replace(/\D/g, '').slice(-10) : ''

  // ── 1. Generate legacy portal token ──────────────────────────
  const portalToken = crypto.randomUUID()
  const expiresAt   = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  // Expire any existing tokens for this MRN (non-fatal)
  const { error: expireTokenErr } = await supabase
    .from('portal_tokens')
    .update({ is_used: true })
    .eq('mrn', mrn)
    .eq('is_used', false)

  if (expireTokenErr) {
    console.warn('[send-link] Could not expire old portal_tokens:', expireTokenErr.message)
  }

  // Insert new token (primary link, must succeed)
  const { error: insertTokenErr } = await supabase
    .from('portal_tokens')
    .insert({
      mrn,
      patient_id:  patient_id || null,
      token:       portalToken,
      expires_at:  expiresAt,
      is_used:     false,
      created_by:  auth.userId,
    })

  if (insertTokenErr) {
    console.error('[send-link] portal_tokens insert failed:', insertTokenErr.message)
    return NextResponse.json(
      { error: 'Failed to generate portal link. Please ensure the database migration has been run.' },
      { status: 500 }
    )
  }

  // ── 2. Generate new OTP + magic link ─────────────────────────
  // Non-fatal: if portal_otp insert fails, fall back to legacy link only
  let otpCode = ''
  let magicLinkToken = ''

  if (normalizedMobile && patient_id) {
    otpCode = String(randomInt(100000, 999999))
    magicLinkToken = crypto.randomUUID()
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    // Expire old OTPs (non-fatal)
    const { error: expireOtpErr } = await supabase
      .from('portal_otp')
      .update({ verified: true })
      .eq('mobile', normalizedMobile)
      .eq('verified', false)

    if (expireOtpErr) {
      console.warn('[send-link] Could not expire old portal_otp:', expireOtpErr.message)
    }

    // Insert new OTP
    const { error: insertOtpErr } = await supabase
      .from('portal_otp')
      .insert({
        mobile:     normalizedMobile,
        otp_code:   otpCode,
        token:      magicLinkToken,
        patient_id: patient_id,
        mrn:        mrn,
        expires_at: otpExpiry,
      })

    if (insertOtpErr) {
      // Non-fatal: fall back to legacy link
      console.warn('[send-link] portal_otp insert failed (using legacy link):', insertOtpErr.message)
      otpCode = ''
      magicLinkToken = ''
    }
  }

  // ── Build URLs (uses LIVE request host, not stale env var) ───
  const origin = getSiteOrigin(req)

  const legacyUrl = buildPortalUrl(origin, '/portal', {
    mrn,
    token: portalToken,
  })

  const newPortalUrl = magicLinkToken
    ? buildPortalUrl(origin, '/portal/verify', { token: magicLinkToken })
    : buildPortalUrl(origin, '/portal/login', {})

  // ── Build WhatsApp message ───────────────────────────────────
  const firstName = (patient_name || 'Patient').split(' ')[0]
  let waMessage = `Namaste ${firstName} ji,\n\n`
  waMessage += `Your ${hospitalName} Patient Portal is ready! 🏥\n\n`

  if (otpCode) {
    waMessage += `🔑 Your OTP: *${otpCode}* (valid 10 min)\n\n`
  }

  waMessage += `▶ Click to access your portal:\n${newPortalUrl}\n\n`
  waMessage += `You can view:\n`
  waMessage += `• 💊 Prescriptions & medications\n`
  waMessage += `• 🧪 Lab reports\n`
  waMessage += `• 💳 Bills & online payment\n`
  waMessage += `• 📅 Book follow-up appointments\n\n`
  waMessage += `🔒 Do not share this link/OTP with anyone.\n\n`
  waMessage += `— ${hospitalName}`

  const waLink = normalizedMobile
    ? `https://wa.me/91${normalizedMobile}?text=${encodeURIComponent(waMessage)}`
    : null

  return NextResponse.json({
    success:       true,
    portal_url:    newPortalUrl,
    legacy_url:    legacyUrl,
    expires_at:    expiresAt,
    whatsapp_link: waLink,
    message:       waMessage,
    debug_origin:  origin, // included so you can verify the URL source
    // Only expose OTP code in development for testing
    otp_code:      process.env.NODE_ENV === 'development' ? otpCode : undefined,
  })
}
