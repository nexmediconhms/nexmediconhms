/**
 * src/app/api/check-config/route.ts
 *
 * Lightweight health/config probe consumed by:
 *   - src/components/layout/AppShell.tsx (post-login banner)
 *   - src/app/status/page.tsx           (operator status page)
 *
 * It must remain unauthenticated because AppShell may render briefly
 * before the auth session hydrates, and /status is intentionally
 * accessible to operators verifying setup.
 *
 * SAFETY NOTES:
 *   - Returns ONLY booleans. Never expose key prefixes, lengths, or
 *     partial values — they help an attacker guess key formats.
 *   - Cache-Control: no-store so a CDN can't pin a stale "not configured"
 *     state right after env vars are corrected.
 *   - runtime='nodejs' to ensure process.env is read from the server
 *     runtime (not edge), keeping behaviour consistent with the other
 *     routes that read these same env vars.
 */

import { NextResponse } from 'next/server'

export const runtime  = 'nodejs'
export const dynamic  = 'force-dynamic'

export async function GET() {
  const anthropicKey = process.env.ANTHROPIC_API_KEY            ?? ''
  const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL     ?? ''
  const razorpayKey  = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID  ?? ''

  const anthropicOk =
    anthropicKey.length > 20 &&
    !anthropicKey.includes('YOUR') &&
    anthropicKey.startsWith('sk-ant-')

  const supabaseOk =
    supabaseUrl.startsWith('https://') &&
    !supabaseUrl.includes('YOUR_PROJECT_ID')

  const razorpayOk =
    razorpayKey.length > 10 &&
    !razorpayKey.includes('YOUR_KEY_HERE')

  return NextResponse.json(
    { anthropicOk, supabaseOk, razorpayOk },
    {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
      },
    }
  )
}
