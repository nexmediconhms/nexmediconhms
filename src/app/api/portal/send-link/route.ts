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
const siteUrl      = process.env.NEXT_PUBLIC_SITE_URL || 'https://your-domain.vercel.app'
const hospitalName = process.env.NEXT_PUBLIC_HOSPITAL_NAME || 'NexMedicon Hospital'

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
  const { error: expireError } = await supabase
    .from('portal_tokens')
    .update({ is_used: true })
    .eq('mrn', mrn)
    .eq('is_used', false)
  
  if (expireError) {
    console.error('[send-link] Failed to expire old tokens:', expireError)
    // Non-fatal - continue with new token generation
  }

  // Insert new token
  const { error: insertError } = await supabase
    .from('portal_tokens')
    .insert({
      mrn,
      patient_id:  patient_id || null,
      token:       portalToken,
      expires_at:  expiresAt,
      is_used:     false,
      created_by: auth.userId,
    })
  
  if (insertError) {
    console.error('[send-link] Failed to create portal token:', insertError)
    return NextResponse.json({ error: 'Failed to generate portal link' }, { status: 500 })
  }

  // ── 2. Generate new OTP + magic link ─────────────────────────
  let otpCode = ''
  let magicLinkToken = ''

  if (normalizedMobile && patient_id) {
    otpCode = String(randomInt(100000, 999999))
    magicLinkToken = crypto.randomUUID()
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    // Expire old OTPs
    const { error: expireOtpError } = await supabase
      .from('portal_otp')
      .update({ verified: true })
      .eq('mobile', normalizedMobile)
      .eq('verified', false)
    
    if (expireOtpError) {
      console.error('[send-link] Failed to expire old OTPs:', expireOtpError)
      // Non-fatal - continue with new OTP generation
    }

    // Insert new OTP
    const { error: insertOtpError } = await supabase
      .from('portal_otp')
      .insert({
        mobile:     normalizedMobile,
        otp_code:   otpCode,
        token:      magicLinkToken,
        patient_id: patient_id,
        mrn:        mrn,
        expires_at: otpExpiry,
      })
    
    if (insertOtpError) {
      console.error('[send-link] Failed to create OTP:', insertOtpError)
      // Fall back to legacy link only
      otpCode = ''
      magicLinkToken = ''
    }
  }

  // ── Build URLs ───────────────────────────────────────────────
  const legacyUrl = `${siteUrl}/portal?mrn=${encodeURIComponent(mrn)}&token=${encodeURIComponent(portalToken)}`
  const newPortalUrl = magicLinkToken
    ? `${siteUrl}/portal/verify?token=${encodeURIComponent(magicLinkToken)}`
    : `${siteUrl}/portal/login`

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