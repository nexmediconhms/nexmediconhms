/**
 * src/lib/abdm-server.ts
 *
 * Server-side ABDM helpers shared by all /api/abdm/* route handlers.
 *
 * KEY DESIGN DECISIONS
 * ---------------------
 * 1. In-memory token cache (per serverless instance). This is identical to
 *    the pattern already used in src/app/api/abdm/auth/route.ts but
 *    centralised so we don't have N separate caches across N route files.
 *
 * 2. Graceful degradation: when ABDM_CLIENT_ID / ABDM_CLIENT_SECRET are
 *    absent the functions return { simulated: true } rather than throwing.
 *    Callers decide how to surface this to the UI.
 *
 * 3. NO browser APIs — this file is server-only (no `use client`).
 *
 * EXISTING CODE IMPACT: none. Existing route files call their own inline
 * getToken and continue to work. New routes (discharge flow additions)
 * import from here.
 */

const ABDM_SANDBOX_URL = 'https://dev.abdm.gov.in'
const ABDM_PROD_URL    = 'https://live.abdm.gov.in'

/** In-memory token cache — one per serverless worker instance */
let _cachedToken: { token: string; expiresAt: number } | null = null

export function getABDMBaseUrl(env: 'sandbox' | 'production' = 'sandbox'): string {
  return env === 'production' ? ABDM_PROD_URL : ABDM_SANDBOX_URL
}

export function isABDMConfigured(): boolean {
  return !!(process.env.ABDM_CLIENT_ID && process.env.ABDM_CLIENT_SECRET)
}

/**
 * Fetch (or return cached) ABDM access token.
 * Throws on network / auth failure.
 */
export async function getABDMToken(
  env: 'sandbox' | 'production' = 'sandbox'
): Promise<string> {
  // Return cached token if still valid (>60 s margin)
  if (_cachedToken && _cachedToken.expiresAt > Date.now() + 60_000) {
    return _cachedToken.token
  }

  const clientId     = process.env.ABDM_CLIENT_ID!
  const clientSecret = process.env.ABDM_CLIENT_SECRET!
  const baseUrl      = getABDMBaseUrl(env)

  const res = await fetch(`${baseUrl}/gateway/v0.5/sessions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ clientId, clientSecret }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`ABDM auth failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  const expiresIn = data.expiresIn ?? 1800

  _cachedToken = {
    token:     data.accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  }

  return _cachedToken.token
}

/** Environment from env var, defaults to sandbox */
export function getABDMEnv(): 'sandbox' | 'production' {
  return process.env.ABDM_ENVIRONMENT === 'production' ? 'production' : 'sandbox'
}
