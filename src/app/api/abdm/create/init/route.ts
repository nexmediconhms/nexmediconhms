/**
 * ABDM ABHA Creation — Initiate via Aadhaar OTP
 * 
 * POST /api/abdm/create/init
 * Body: { aadhaar: "12-digit Aadhaar number" }
 * 
 * Sends OTP to Aadhaar-linked mobile number.
 * Returns txnId for OTP verification step.
 */
import { NextRequest, NextResponse } from 'next/server'

const ABDM_SANDBOX_URL = 'https://dev.abdm.gov.in'
const ABDM_PROD_URL    = 'https://live.abdm.gov.in'

async function getToken(env: string): Promise<string> {
  const clientId     = process.env.ABDM_CLIENT_ID     || ''
  const clientSecret = process.env.ABDM_CLIENT_SECRET || ''
  const baseUrl      = env === 'production' ? ABDM_PROD_URL : ABDM_SANDBOX_URL
  const res = await fetch(`${baseUrl}/gateway/v0.5/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  })
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`)
  return (await res.json()).accessToken
}

export async function POST(req: NextRequest) {
  try {
    const { aadhaar } = await req.json()
    
    if (!aadhaar || !/^\d{12}$/.test(aadhaar.replace(/\s/g, ''))) {
      return NextResponse.json({ error: 'Valid 12-digit Aadhaar number is required' }, { status: 400 })
    }

    if (!process.env.ABDM_CLIENT_ID || !process.env.ABDM_CLIENT_SECRET) {
      return NextResponse.json({
        error: 'ABDM credentials not configured. Set ABDM_CLIENT_ID and ABDM_CLIENT_SECRET in environment variables.',
        simulated: true,
      }, { status: 400 })
    }

    const environment = process.env.ABDM_ENVIRONMENT || 'sandbox'
    const token       = await getToken(environment)
    const baseUrl     = environment === 'production' ? ABDM_PROD_URL : ABDM_SANDBOX_URL

    const res = await fetch(`${baseUrl}/abha/api/v1/registration/aadhaar/generateOtp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ aadhaar: aadhaar.replace(/\s/g, '') }),
    })

    if (!res.ok) {
      const errText = await res.text()
      return NextResponse.json(
        { error: `OTP generation failed (${res.status}): ${errText}` },
        { status: res.status }
      )
    }

    const data = await res.json()
    return NextResponse.json({ txnId: data.txnId })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
