/**
 * src/app/api/abdm/auth/route.ts
 *
 * ABDM (Ayushman Bharat Digital Mission) gateway authentication.
 *
 * POST /api/abdm/auth
 *   → Exchanges configured client credentials for an ABDM access token.
 *   → Returns { accessToken } on success.
 *
 * SECURITY CHANGES (this revision):
 *   1. Now requires an authenticated clinic user. Reading the auth-token
 *      itself is harmless to the patient, but the ABDM session token is
 *      a privileged credential — anyone who calls this route gets a
 *      working bearer token against the ABDM gateway. We restrict to:
 *        - admin (always)
 *        - any authenticated clinic role IF env-configured (production
 *          flow where doctors call ABHA verify endpoints)
 *      Practically: requireRole(['admin','doctor','receptionist','staff']).
 *   2. In production, client credentials may ONLY come from the server
 *      env (ABDM_CLIENT_ID / ABDM_CLIENT_SECRET). Body-supplied creds
 *      are ignored to prevent a logged-in user from probing other
 *      vendors' creds through our server.
 *   3. In sandbox / non-production, body-supplied creds are accepted ONLY
 *      from admins (the abdm-setup wizard) so admins can test creds
 *      before persisting them.
 *   4. ABDM gateway error bodies are logged server-side but NEVER echoed
 *      to the client — they can include rate-limit details, debug IDs,
 *      and partial credential echoes that we don't want in the browser.
 *   5. Generic 502 returned when the upstream fails. 503 returned when
 *      ABDM is not configured at all (was previously a 400 with a
 *      verbose hint that revealed whether admin had partial creds set).
 *   6. runtime='nodejs' (fetch + Basic auth) and dynamic='force-dynamic'.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole }                from '@/lib/api-auth'

export const runtime  = 'nodejs'
export const dynamic  = 'force-dynamic'

const ABDM_SANDBOX_URL = 'https://dev.abdm.gov.in'
const ABDM_PROD_URL    = 'https://live.abdm.gov.in'

// In-memory token cache (per serverless instance).
let cachedToken: { token: string; expiresAt: number; envKey: string } | null = null

function logErr(scope: string, err: unknown) {
  const klass = (err as any)?.constructor?.name || 'Error'
  const msg   = (err as any)?.message            || String(err)
  console.error(`[abdm.auth] ${scope}: ${klass} ${msg}`)
}

// Sanitise/cap a string credential field (defence in depth).
function clipCred(v: unknown, max = 200): string {
  if (typeof v !== 'string') return ''
  return v.trim().slice(0, max)
}

export async function POST(req: NextRequest) {
  // Any authenticated clinic user can request an ABDM session — they
  // need it to call /api/abdm/verify etc. from the patient registration
  // flow. We block unauthenticated callers entirely.
  const auth = await requireRole(req, ['admin', 'doctor', 'receptionist', 'staff'])
  if (auth instanceof Response) return auth

  // Body is optional for the normal "use server-side env" flow.
  const body = await req.json().catch(() => ({} as Record<string, unknown>))

  // Server-side env values are the source of truth.
  const envClientId     = process.env.ABDM_CLIENT_ID     ?? ''
  const envClientSecret = process.env.ABDM_CLIENT_SECRET ?? ''
  const envEnvironment  = process.env.ABDM_ENVIRONMENT   ?? 'sandbox'

  const isProd = envEnvironment === 'production'

  // ── Decide which credentials to use ─────────────────────────
  let clientId     = envClientId
  let clientSecret = envClientSecret
  let environment  = envEnvironment

  // Body credentials are ONLY accepted in non-production AND only from
  // admins (this is the abdm-setup wizard's "Test Connection" path).
  const wantBodyCreds =
    !isProd &&
    auth.role === 'admin' &&
    (body.clientId || body.clientSecret)

  if (wantBodyCreds) {
    clientId     = clipCred(body.clientId,     200) || envClientId
    clientSecret = clipCred(body.clientSecret, 500) || envClientSecret
    const bodyEnv = clipCred(body.environment, 32)
    environment  = (bodyEnv === 'production' || bodyEnv === 'sandbox') ? bodyEnv : envEnvironment
  }

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        error: isProd
          ? 'ABDM is not configured on the server.'
          : 'ABDM credentials are not configured. An administrator must set ABDM_CLIENT_ID and ABDM_CLIENT_SECRET, or test from Settings → ABDM.',
      },
      { status: 503 }
    )
  }

  // ── Cache hit (≥60s of life remaining) ──────────────────────
  // We key the cache by env+clientId so swapping creds doesn't return
  // a stale token.
  const envKey = `${environment}:${clientId}`
  if (
    cachedToken &&
    cachedToken.envKey === envKey &&
    cachedToken.expiresAt > Date.now() + 60_000
  ) {
    return NextResponse.json({ accessToken: cachedToken.token })
  }

  // ── Call ABDM gateway ───────────────────────────────────────
  const baseUrl = environment === 'production' ? ABDM_PROD_URL : ABDM_SANDBOX_URL

  let res: Response
  try {
    res = await fetch(`${baseUrl}/gateway/v0.5/sessions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ clientId, clientSecret }),
      // Avoid Next.js fetch caching this token call.
      cache:   'no-store',
    })
  } catch (err) {
    logErr('gateway.fetch', err)
    return NextResponse.json(
      { error: 'Could not reach ABDM gateway. Please retry.' },
      { status: 502 }
    )
  }

  if (!res.ok) {
    // Log server-side, return a generic upstream-error response.
    let upstream = ''
    try { upstream = (await res.text()).slice(0, 500) } catch { /* ignore */ }
    console.warn(`[abdm.auth] gateway ${res.status} ${upstream}`)
    return NextResponse.json(
      {
        error:
          res.status === 401 || res.status === 403
            ? 'ABDM rejected the configured credentials.'
            : 'ABDM gateway error. Please retry.',
      },
      { status: res.status === 401 || res.status === 403 ? 502 : 502 }
    )
  }

  let data: { accessToken?: string; expiresIn?: number }
  try {
    data = await res.json()
  } catch (err) {
    logErr('gateway.parse', err)
    return NextResponse.json(
      { error: 'ABDM gateway returned an unexpected response.' },
      { status: 502 }
    )
  }

  const token = data.accessToken
  if (!token || typeof token !== 'string') {
    logErr('gateway.missing_token', new Error(JSON.stringify(data).slice(0, 200)))
    return NextResponse.json(
      { error: 'ABDM gateway did not return a session token.' },
      { status: 502 }
    )
  }

  cachedToken = {
    token,
    expiresAt: Date.now() + (data.expiresIn || 1800) * 1000,
    envKey,
  }

  return NextResponse.json({ accessToken: token })
}
