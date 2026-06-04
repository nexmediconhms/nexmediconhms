/**
 * src/app/api/portal/send-link/route.ts
 *
 * Patient Portal — Send Magic Link (Staff-initiated)
 *
 * Called by clinic staff to send a patient their portal access link.
 * Now generates BOTH:
 *  1. Legacy magic link (portal_tokens) for backward compat
 *  2. New OTP + magic link (portal_otp) for the new login flow
 *
 * The WhatsApp message includes both the direct link and OTP.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/api-auth'
import { randomInt } from 'crypto'

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY!
const hospitalName = process.env.NEXT_PUBLIC_HOSPITAL_NAME || 'NexMedicon Hospital'

/**
 * Get the live site origin from the incoming request.
 *
 * FIX (2026-06-04): Uses request host header as primary source so the
 * generated URL ALWAYS points to the current live deployment, not a
 * stale NEXT_PUBLIC_SITE_URL env var that points to a dead Vercel
 * preview deployment.
 *
 * Returns origin like "https://example.com" — never has trailing slash.
 */
function getLiveSiteOrigin(req: NextRequest): string {
  const forwardedHost = req.headers.get('x-forwarded-host')
  const host = req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  const liveHost = forwardedHost || host

  if (liveHost) {
    try {
      return new URL(`${proto}://${liveHost}`).origin
    } catch {
      // Fall through to env var
    }
  }

  // Fallback: env var (may be stale, but better than nothing)
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL
  if (fromEnv && fromEnv.trim()) {
    try {
      return new URL(fromEnv.trim()).origin
    } catch {
      // Fall through
    }
  }

  return 'https://your-domain.vercel.app'
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

  // Expire any existing tokens for this MRN
  await supabase
    .from('portal_tokens')
    .update({ is_used: true })
    .eq('mrn', mrn)
    .eq('is_used', false)

  // Insert new token
  await supabase
    .from('portal_tokens')
    .insert({
      mrn,
      patient_id:  patient_id || null,
      token:       portalToken,
      expires_at:  expiresAt,
      is_used:     false,
      created_by: auth.userId,
    })

  // ── 2. Generate new OTP + magic link ─────────────────────────
  let otpCode = ''
  let magicLinkToken = ''

  if (normalizedMobile && patient_id) {
    otpCode = String(randomInt(100000, 999999))
    magicLinkToken = crypto.randomUUID()
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    // Expire old OTPs
    await supabase
      .from('portal_otp')
      .update({ verified: true })
      .eq('mobile', normalizedMobile)
      .eq('verified', false)

    // Insert new OTP
    await supabase
      .from('portal_otp')
      .insert({
        mobile:     normalizedMobile,
        otp_code:   otpCode,
        token:      magicLinkToken,
        patient_id: patient_id,
        mrn:        mrn,
        expires_at: otpExpiry,
      })
  }

  // ── Build URLs ───────────────────────────────────────────────
  // FIX: Use the live request host (current deployment) instead of
  // a possibly-stale NEXT_PUBLIC_SITE_URL env var.
  // The URL() constructor automatically prevents double slashes.
  const liveOrigin = getLiveSiteOrigin(req)

  const legacyUrlObj = new URL('/portal', liveOrigin)
  legacyUrlObj.searchParams.set('mrn', mrn)
  legacyUrlObj.searchParams.set('token', portalToken)
  const legacyUrl = legacyUrlObj.toString()

  let newPortalUrl: string
  if (magicLinkToken) {
    const u = new URL('/portal/verify', liveOrigin)
    u.searchParams.set('token', magicLinkToken)
    newPortalUrl = u.toString()
  } else {
    newPortalUrl = new URL('/portal/login', liveOrigin).toString()
  }

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
    otp_code:      process.env.NODE_ENV === 'development' ? otpCode : undefined,
  })
}