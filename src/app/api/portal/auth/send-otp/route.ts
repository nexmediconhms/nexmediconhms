/**
 * src/app/api/portal/auth/send-otp/route.ts
 *
 * Patient Portal — Send OTP / Magic Link
 *
 * POST { mobile: "9876543210" }
 *
 * Looks up the patient by mobile number, generates a 6-digit OTP
 * and a magic link token, stores in portal_otp table.
 * Returns the OTP (for dev) and WhatsApp link for sending.
 * In production, integrate with SMS gateway (MSG91, Twilio, etc.)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY!
// FIX (2026-06-03): Strip trailing slash to prevent double-slash 404
const siteUrl      = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '')
const hospitalName = process.env.NEXT_PUBLIC_HOSPITAL_NAME || 'NexMedicon Hospital'

export async function POST(req: NextRequest) {
  try {
    const { mobile } = await req.json()

    if (!mobile || mobile.length < 10) {
      return NextResponse.json({ error: 'Valid mobile number is required' }, { status: 400 })
    }

    // Normalize mobile: keep last 10 digits
    const normalizedMobile = mobile.replace(/\D/g, '').slice(-10)

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    // Find patient by mobile
    const { data: patient, error: patErr } = await supabase
      .from('patients')
      .select('id, full_name, mrn, mobile')
      .or(`mobile.eq.${normalizedMobile},mobile.eq.+91${normalizedMobile},mobile.ilike.%${normalizedMobile}`)
      .limit(1)
      .single()

    if (patErr || !patient) {
      return NextResponse.json(
        { error: 'No patient found with this mobile number. Please contact the hospital.' },
        { status: 404 }
      )
    }

    // Rate limiting: max 3 OTPs per mobile in last 10 minutes
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { count } = await supabase
      .from('portal_otp')
      .select('id', { count: 'exact', head: true })
      .eq('mobile', normalizedMobile)
      .gte('created_at', tenMinAgo)

    if ((count || 0) >= 3) {
      return NextResponse.json(
        { error: 'Too many OTP requests. Please wait 10 minutes and try again.' },
        { status: 429 }
      )
    }

    // Generate 6-digit OTP and magic link token
    const otpCode = String(Math.floor(100000 + Math.random() * 900000))
    const token   = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 min expiry

    // Expire any existing unused OTPs for this mobile
    await supabase
      .from('portal_otp')
      .update({ verified: true })
      .eq('mobile', normalizedMobile)
      .eq('verified', false)

    // Insert new OTP
    const { error: insertErr } = await supabase
      .from('portal_otp')
      .insert({
        mobile:     normalizedMobile,
        otp_code:   otpCode,
        token,
        patient_id: patient.id,
        mrn:        patient.mrn,
        expires_at: expiresAt,
      })

    if (insertErr) {
      return NextResponse.json({ error: 'Failed to generate OTP' }, { status: 500 })
    }

    // Build magic link
    const magicLink = `${siteUrl}/portal/verify?token=${encodeURIComponent(token)}`

    // Build WhatsApp message
    const firstName = patient.full_name.split(' ')[0]
    const waMessage = `Namaste ${firstName} ji,\n\nYour OTP for ${hospitalName} Patient Portal is: *${otpCode}*\n\nOr click this link to login directly:\n${magicLink}\n\nValid for 10 minutes. Do not share with anyone.\n\n— ${hospitalName}`
    const waLink    = `https://wa.me/91${normalizedMobile}?text=${encodeURIComponent(waMessage)}`

    return NextResponse.json({
      success:       true,
      patient_name:  patient.full_name,
      mrn:           patient.mrn,
      magic_link:    magicLink,
      whatsapp_link: waLink,
      expires_at:    expiresAt,
      // In production, remove otp_code from response and send via SMS gateway
      ...(process.env.NODE_ENV === 'development' ? { otp_code: otpCode } : {}),
    })

  } catch (err: any) {
    console.error('Portal send-otp error:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
