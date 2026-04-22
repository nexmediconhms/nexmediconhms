/**
 * ABDM Authentication API Route
 * 
 * POST /api/abdm/auth
 * 
 * Gets a session token from ABDM gateway using client credentials.
 * Client ID and Secret are stored in env vars or passed from settings.
 */
import { NextRequest, NextResponse } from 'next/server'

const ABDM_SANDBOX_URL = 'https://dev.abdm.gov.in'
const ABDM_PROD_URL    = 'https://live.abdm.gov.in'

// Token cache (in-memory, per serverless instance)
let cachedToken: { token: string; expiresAt: number } | null = null

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    
    const clientId     = body.clientId     || process.env.ABDM_CLIENT_ID     || ''
    const clientSecret = body.clientSecret || process.env.ABDM_CLIENT_SECRET || ''
    const environment  = body.environment  || process.env.ABDM_ENVIRONMENT   || 'sandbox'

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'ABDM credentials not configured. Set ABDM_CLIENT_ID and ABDM_CLIENT_SECRET in environment variables or configure in Settings → ABDM.' },
        { status: 400 }
      )
    }

    // Return cached token if still valid
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
      return NextResponse.json({ accessToken: cachedToken.token })
    }

    const baseUrl = environment === 'production' ? ABDM_PROD_URL : ABDM_SANDBOX_URL

    const res = await fetch(`${baseUrl}/gateway/v0.5/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret }),
    })

    if (!res.ok) {
      const errText = await res.text()
      return NextResponse.json(
        { error: `ABDM auth failed (${res.status}): ${errText}` },
        { status: res.status }
      )
    }

    const data = await res.json()
    const token = data.accessToken

    // Cache the token
    cachedToken = {
      token,
      expiresAt: Date.now() + (data.expiresIn || 1800) * 1000,
    }

    return NextResponse.json({ accessToken: token })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
