/**
 * ABDM ABHA Search by Health ID Address
 * 
 * POST /api/abdm/search
 * Body: { healthId: "user@abdm" }
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
    const { healthId } = await req.json()
    if (!healthId) {
      return NextResponse.json({ error: 'Health ID address is required' }, { status: 400 })
    }

    const environment = process.env.ABDM_ENVIRONMENT || 'sandbox'

    if (!process.env.ABDM_CLIENT_ID || !process.env.ABDM_CLIENT_SECRET) {
      return NextResponse.json({
        success: false,
        error: 'ABDM credentials not configured. Set ABDM_CLIENT_ID and ABDM_CLIENT_SECRET.',
        simulated: true,
      })
    }

    const token   = await getToken(environment)
    const baseUrl = environment === 'production' ? ABDM_PROD_URL : ABDM_SANDBOX_URL

    const searchRes = await fetch(`${baseUrl}/abha/api/v1/search/searchByHealthId`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ healthId }),
    })

    if (!searchRes.ok) {
      const errText = await searchRes.text()
      return NextResponse.json(
        { success: false, error: `Search failed (${searchRes.status}): ${errText}` },
        { status: searchRes.status }
      )
    }

    const profile = await searchRes.json()
    return NextResponse.json({
      success: true,
      profile: {
        healthIdNumber: profile.healthIdNumber,
        healthId:       profile.healthId,
        name:           profile.name || `${profile.firstName || ''} ${profile.middleName || ''} ${profile.lastName || ''}`.trim(),
        gender:         profile.gender,
        yearOfBirth:    profile.yearOfBirth,
        monthOfBirth:   profile.monthOfBirth,
        dayOfBirth:     profile.dayOfBirth,
        mobile:         profile.mobile,
        status:         profile.status || 'ACTIVE',
      },
    })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
