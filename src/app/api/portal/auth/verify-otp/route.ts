/**
 * src/app/api/portal/auth/verify-otp/route.ts
 *
 * Patient Portal — Verify OTP / Magic Link Token
 *
 * POST { mobile: "9876543210", otp: "123456" }
 *   OR
 * POST { token: "uuid-magic-link-token" }
 *
 * On success, creates a portal_session and returns a session_token
 * that the client stores in localStorage/cookie for subsequent requests.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { mobile, otp, token } = body

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    let otpRecord: any = null

    if (token) {
      // Magic link verification
      const { data, error } = await supabase
        .from('portal_otp')
        .select('*')
        .eq('token', token)
        .eq('verified', false)
        .single()

      if (error || !data) {
        return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 })
      }
      otpRecord = data
    } else if (mobile && otp) {
      // OTP verification
      const normalizedMobile = mobile.replace(/\D/g, '').slice(-10)

      const { data, error } = await supabase
        .from('portal_otp')
        .select('*')
        .eq('mobile', normalizedMobile)
        .eq('verified', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (error || !data) {
        return NextResponse.json({ error: 'No pending OTP found. Please request a new one.' }, { status: 401 })
      }
      otpRecord = data

      // Check attempts
      if (otpRecord.attempts >= 5) {
        // Mark as used
        await supabase
          .from('portal_otp')
          .update({ verified: true })
          .eq('id', otpRecord.id)
        return NextResponse.json({ error: 'Too many attempts. Please request a new OTP.' }, { status: 429 })
      }

      // FIX: Increment attempts BEFORE verifying OTP (prevents race condition)
      const { error: incrementErr } = await supabase
        .from('portal_otp')
        .update({ attempts: (otpRecord.attempts || 0) + 1 })
        .eq('id', otpRecord.id)

      if (incrementErr) {
        console.error('[verify-otp] Failed to increment attempts:', incrementErr)
        return NextResponse.json({ error: 'Verification failed. Please try again.' }, { status: 500 })
      }

      // Verify OTP code
      if (otpRecord.otp_code !== otp.trim()) {
        return NextResponse.json({ error: 'Incorrect OTP. Please try again.' }, { status: 401 })
      }
    } else {
      return NextResponse.json({ error: 'Provide either {mobile, otp} or {token}' }, { status: 400 })
    }

    // Check expiry
    if (new Date(otpRecord.expires_at) < new Date()) {
      // Mark expired OTP as verified to prevent reuse
      await supabase
        .from('portal_otp')
        .update({ verified: true })
        .eq('id', otpRecord.id)
      return NextResponse.json({ error: 'OTP has expired. Please request a new one.' }, { status: 401 })
    }

    // Mark OTP as verified
    await supabase
      .from('portal_otp')
      .update({ verified: true })
      .eq('id', otpRecord.id)

    // Create a portal session (valid for 7 days)
    const sessionToken = crypto.randomUUID() + '-' + crypto.randomUUID()
    const sessionExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { error: sessErr } = await supabase
      .from('portal_sessions')
      .insert({
        patient_id:    otpRecord.patient_id,
        mrn:           otpRecord.mrn,
        mobile:        otpRecord.mobile,
        session_token: sessionToken,
        expires_at:    sessionExpiry,
      })

    if (sessErr) {
      console.error('Session creation error:', sessErr)
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
    }

    // Get patient info for response
    const { data: patient } = await supabase
      .from('patients')
      .select('id, full_name, mrn, age, gender, mobile, blood_group')
      .eq('id', otpRecord.patient_id)
      .single()

    return NextResponse.json({
      success:       true,
      session_token: sessionToken,
      expires_at:    sessionExpiry,
      patient:       patient || { id: otpRecord.patient_id, mrn: otpRecord.mrn },
    })

  } catch (err: any) {
    console.error('Portal verify-otp error:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
