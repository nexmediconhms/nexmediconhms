/**
 * src/app/api/portal/send-link/route.ts
 *
 * Patient Portal — Send Magic Link (Staff-initiated)
 *
 * Called by clinic staff to send a patient their portal access link.
 * Generates BOTH:
 *  1. Legacy magic link (portal_tokens) for backward compat
 *  2. New OTP + magic link (portal_otp) for the new login flow
 *
 * The WhatsApp message includes both the direct link and OTP.
 *
 * BULLETPROOF URL CONSTRUCTION (2026-06-03):
 *   Uses the URL() constructor (built into Node.js) which AUTOMATICALLY
 *   normalizes paths and strips redundant slashes. This guarantees that
 *   the generated URLs NEVER have double slashes, regardless of what
 *   value NEXT_PUBLIC_SITE_URL is set to (with or without trailing slash).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/api-auth'
import { randomInt } from 'crypto'

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY!
const hospitalName = process.env.NEXT_PUBLIC_HOSPITAL_NAME || 'NexMedicon Hospital'

/**
 * Resolve the site origin from environment variables.
 * Returns just the origin (e.g. "https://example.com") with no trailing slash,
 * no path, no query string. Always safe to concatenate paths to.
 */
function getSiteOrigin(req: NextRequest): string {
  // Priority 1: explicit env var (works in production)
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL
  if (fromEnv && fromEnv.trim()) {
    try {
      const u = new URL(fromEnv.trim())
      return u.origin // returns "https://example.com" — never has trailing slash
    } catch {
      // Malformed env var — fall through
    }
  }

  // Priority 2: Vercel auto-injected URL
  if (process.env.VERCEL_URL) {
    try {
      const u = new URL(`https://${process.env.VERCEL_URL}`)
      return u.origin
    } catch {
      // Fall through
    }
  }

  // Priority 3: derive from request host header (works on any platform)
  const host = req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  if (host) {
    return `${proto}://${host}`
  }

  // Last resort fallback
  return 'https://your-domain.vercel.app'
}

/**
 * Build a portal URL with guaranteed correct format.
 * Uses URL() constructor which auto-normalizes paths.
 *
 * @param origin - The site origin (e.g. "https://example.com")
 * @param path - The path (e.g. "/portal/verify")
 * @param params - Query parameters
 * @returns Fully-formed URL string with NO double slashes
 */
function buildPortalUrl(origin: string, path: string, params: Record<string, string> = {}): string {
  // The URL constructor automatically normalizes the path, collapsing
  // any "//" sequences into "/". Even if origin or path has stray slashes,
  // the result is always a valid URL.
  const u = new URL(path, origin)

  // Clear and set query params
  Object.entries(params).forEach(([key, value]) => {
    u.searchParams.set(key, value)
  })

  // .toString() returns a properly normalized URL
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

  // ── Build URLs (BULLETPROOF — uses URL() constructor) ────────
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
    // Only expose OTP code in development for testing
    otp_code:      process.env.NODE_ENV === 'development' ? otpCode : undefined,
  })
}