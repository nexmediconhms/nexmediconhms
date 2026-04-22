/**
 * ABDM ABHA Creation — Verify Aadhaar OTP
 * 
 * POST /api/abdm/create/verify-otp
 * Body: { txnId: "...", otp: "6-digit OTP" }
 * 
 * Verifies the OTP and creates the ABHA number.
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
    const { txnId, otp } = await req.json()

    if (!txnId || !otp) {
      return NextResponse.json({ error: 'txnId and otp are required' }, { status: 400 })
    }

    if (!/^\d{6}$/.test(otp)) {
      return NextResponse.json({ error: 'OTP must be 6 digits' }, { status: 400 })
    }

    if (!process.env.ABDM_CLIENT_ID || !process.env.ABDM_CLIENT_SECRET) {
      return NextResponse.json({
        success: false,
        error: 'ABDM credentials not configured.',
      }, { status: 400 })
    }

    const environment = process.env.ABDM_ENVIRONMENT || 'sandbox'
    const token       = await getToken(environment)
    const baseUrl     = environment === 'production' ? ABDM_PROD_URL : ABDM_SANDBOX_URL

    // Step 1: Verify OTP
    const verifyRes = await fetch(`${baseUrl}/abha/api/v1/registration/aadhaar/verifyOtp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ txnId, otp }),
    })

    if (!verifyRes.ok) {
      const errText = await verifyRes.text()
      return NextResponse.json(
        { success: false, error: `OTP verification failed (${verifyRes.status}): ${errText}` },
        { status: verifyRes.status }
      )
    }

    const verifyData = await verifyRes.json()

    // Step 2: Create Health ID
    const createRes = await fetch(`${baseUrl}/abha/api/v1/registration/aadhaar/createHealthIdWithPreVerified`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ txnId: verifyData.txnId || txnId }),
    })

    if (!createRes.ok) {
      const errText = await createRes.text()
      return NextResponse.json(
        { success: false, error: `ABHA creation failed (${createRes.status}): ${errText}` },
        { status: createRes.status }
      )
    }

    const createData = await createRes.json()

    return NextResponse.json({
      success:        true,
      healthIdNumber: createData.healthIdNumber,
      healthId:       createData.healthId,
      token:          createData.token,
    })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
