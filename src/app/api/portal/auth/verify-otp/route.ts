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
      //
      // BUG-PT02 fix: filter expired tokens at query time.  Previously
      // the lookup was just .eq('token', X).eq('verified', false), so
      // expired-but-not-verified records were still returned and the
      // expiry check happened later in the function.  Two issues with
      // that:
      //   1. An attacker probing tokens learns from response timing
      //      whether a token EXISTED (and is just expired) versus
      //      never having existed — a small but real cardinality
      //      oracle that the .gt() filter closes by making both cases
      //      return "Invalid or expired link" identically.
      //   2. A leaked-but-expired token could not actually be used,
      //      but the row was still being read into memory; better to
      //      drop it at the database boundary.
      const nowIso = new Date().toISOString()
      const { data, error } = await supabase
        .from('portal_otp')
        .select('*')
        .eq('token', token)
        .eq('verified', false)
        .gt('expires_at', nowIso)
        .single()

      if (error || !data) {
        return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 })
      }
      otpRecord = data
    } else if (mobile && otp) {
      // OTP verification
      const normalizedMobile = mobile.replace(/\D/g, '').slice(-10)

      // BUG-PT02 fix (mirror of the magic-link path above): filter
      // expired OTPs at query time.  An OTP that has already expired
      // should be invisible to this endpoint regardless of any other
      // state on the row.
      const nowIso = new Date().toISOString()
      const { data, error } = await supabase
        .from('portal_otp')
        .select('*')
        .eq('mobile', normalizedMobile)
        .eq('verified', false)
        .gt('expires_at', nowIso)
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

      // BUG-PT03 fix: atomically increment `attempts` using compare-
      // and-set so the 5-attempts-per-OTP limit cannot be bypassed by
      // parallel requests racing on a stale read.
      //
      // Previous behaviour:
      //     update({ attempts: (otpRecord.attempts || 0) + 1 })
      //       .eq('id', otpRecord.id)
      // Two requests reading attempts=4 simultaneously both wrote 5 —
      // the counter advanced by 1 instead of 2, letting an attacker
      // burn through more than 5 guesses by parallelising calls.
      //
      // New approach: an UPDATE that includes `.eq('attempts', oldVal)`
      // succeeds only if the value is still what we read.  On 0-row
      // result we re-read and retry up to MAX_INCREMENT_RETRIES times.
      // After exhausting retries we treat it as a contention failure
      // (HTTP 503) rather than silently letting the verification
      // proceed with an unincremented counter.
      const MAX_INCREMENT_RETRIES = 4
      let incremented = false
      for (let attempt = 0; attempt < MAX_INCREMENT_RETRIES; attempt++) {
        const oldAttempts = Number(otpRecord.attempts) || 0

        // Re-check the 5-attempt cap on each retry — another concurrent
        // request may have just pushed us over the threshold.
        if (oldAttempts >= 5) {
          await supabase
            .from('portal_otp')
            .update({ verified: true })
            .eq('id', otpRecord.id)
          return NextResponse.json(
            { error: 'Too many attempts. Please request a new OTP.' },
            { status: 429 },
          )
        }

        const { data: incRows, error: incrementErr } = await supabase
          .from('portal_otp')
          .update({ attempts: oldAttempts + 1 })
          .eq('id', otpRecord.id)
          .eq('attempts', oldAttempts)             // ← optimistic lock
          .select('attempts')

        if (incrementErr) {
          console.error('[verify-otp] Failed to increment attempts:', incrementErr)
          return NextResponse.json(
            { error: 'Verification failed. Please try again.' },
            { status: 500 },
          )
        }

        if (incRows && incRows.length > 0) {
          // Reflect the new value in the working copy of otpRecord so
          // any later code that reads otpRecord.attempts sees a fresh
          // number (currently nothing depends on this, but it keeps
          // the in-memory object honest).
          otpRecord.attempts = incRows[0].attempts
          incremented = true
          break
        }

        // CAS lost — re-read the row and try again.
        const { data: refreshed } = await supabase
          .from('portal_otp')
          .select('*')
          .eq('id', otpRecord.id)
          .single()
        if (!refreshed) {
          return NextResponse.json(
            { error: 'Verification failed. Please try again.' },
            { status: 500 },
          )
        }
        otpRecord = refreshed
      }

      if (!incremented) {
        // Could not safely advance the counter — refuse rather than
        // silently letting the OTP check proceed with no increment.
        console.warn('[verify-otp] attempts CAS exhausted retries')
        return NextResponse.json(
          { error: 'Verification is busy. Please retry.' },
          { status: 503 },
        )
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
      // FIX: Mark expired OTP as verified to prevent reuse attempts
      await supabase
        .from('portal_otp')
        .update({ verified: true })
        .eq('id', otpRecord.id)
      return NextResponse.json({ error: 'OTP has expired. Please request a new one.' }, { status: 401 })
    }

    // BUG-PT06 fix: atomically mark the OTP/token as verified.
    //
    // Previous behaviour was a non-conditional UPDATE:
    //     update({ verified: true }).eq('id', otpRecord.id)
    //
    // Two concurrent requests with the SAME valid OTP could both pass
    // the OTP-code check, both reach this point, and both create a
    // portal_session.  That's session replay — one OTP, two sessions
    // for two different attackers.
    //
    // The CAS-style update below succeeds only if the row is still
    // unverified.  When the second concurrent request lands here the
    // row has already been flipped, the .eq('verified', false) filter
    // matches nothing, and we return 401 instead of issuing a second
    // session.
    const { data: markedRows, error: markErr } = await supabase
      .from('portal_otp')
      .update({ verified: true })
      .eq('id', otpRecord.id)
      .eq('verified', false)
      .select('id')

    if (markErr) {
      console.error('[verify-otp] verify-and-mark failed:', markErr)
      return NextResponse.json(
        { error: 'Verification failed. Please try again.' },
        { status: 500 },
      )
    }
    if (!markedRows || markedRows.length === 0) {
      // Already used by a concurrent request (session replay defence).
      return NextResponse.json(
        { error: 'This OTP/link has already been used. Please request a new one.' },
        { status: 401 },
      )
    }

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