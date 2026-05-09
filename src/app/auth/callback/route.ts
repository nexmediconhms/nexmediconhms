/**
 * src/app/auth/callback/route.ts
 *
 * Handles Supabase auth callbacks including:
 * - Password reset (recovery) links
 * - Email confirmation links
 * - Magic link sign-ins
 *
 * Supabase sends users here with a `code` query parameter.
 * We exchange the code for a session, then redirect based on the type.
 */

import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const type = requestUrl.searchParams.get('type')
  const origin = requestUrl.origin

  if (code) {
    // Create a Supabase client to exchange the code
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // If this is a password recovery, redirect to the reset password page
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/reset-password`)
      }
      // For other types (email confirmation, magic link), go to dashboard
      return NextResponse.redirect(`${origin}/dashboard`)
    }
  }

  // If there's no code or an error occurred, redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
