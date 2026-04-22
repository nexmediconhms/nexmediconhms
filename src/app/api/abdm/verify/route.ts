/**
 * ABDM ABHA Verification API Route
 * 
 * POST /api/abdm/verify
 * Body: { abhaNumber: "14-digit number" }
 * 
 * Verifies an ABHA number and returns the linked profile.
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
  const data = await res.json()
  return data.accessToken
}

export async function POST(req: NextRequest) {
  try {
    const { abhaNumber } = await req.json()
    
    if (!abhaNumber) {
      return NextResponse.json({ error: 'ABHA number is required' }, { status: 400 })
    }

    const digits = abhaNumber.replace(/[-\s]/g, '')
    if (!/^\d{14}$/.test(digits)) {
      return NextResponse.json({ error: 'Invalid ABHA number format. Must be 14 digits.' }, { status: 400 })
    }

    const environment = process.env.ABDM_ENVIRONMENT || 'sandbox'
    
    if (!process.env.ABDM_CLIENT_ID || !process.env.ABDM_CLIENT_SECRET) {
      // Return a simulated response for demo/development
      return NextResponse.json({
        success: true,
        profile: {
          healthIdNumber: `${digits.slice(0,2)}-${digits.slice(2,6)}-${digits.slice(6,10)}-${digits.slice(10,14)}`,
          healthId:       '',
          name:           'ABDM Verification Pending',
          gender:         'O',
          yearOfBirth:    '2000',
          mobile:         '',
          status:         'ACTIVE',
        },
        message: 'ABDM credentials not configured. This is a simulated response. Configure ABDM_CLIENT_ID and ABDM_CLIENT_SECRET for live verification.',
        simulated: true,
      })
    }

    const token   = await getToken(environment)
    const baseUrl = environment === 'production' ? ABDM_PROD_URL : ABDM_SANDBOX_URL

    // Step 1: Search by health ID number
    const searchRes = await fetch(`${baseUrl}/abha/api/v1/search/searchByHealthId`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ healthId: digits }),
    })

    if (!searchRes.ok) {
      const errText = await searchRes.text()
      return NextResponse.json(
        { success: false, error: `ABDM verification failed (${searchRes.status}): ${errText}` },
        { status: searchRes.status }
      )
    }

    const profile = await searchRes.json()

    return NextResponse.json({
      success: true,
      profile: {
        healthIdNumber: profile.healthIdNumber || `${digits.slice(0,2)}-${digits.slice(2,6)}-${digits.slice(6,10)}-${digits.slice(10,14)}`,
        healthId:       profile.healthId || '',
        name:           profile.name || `${profile.firstName || ''} ${profile.middleName || ''} ${profile.lastName || ''}`.trim(),
        firstName:      profile.firstName,
        middleName:     profile.middleName,
        lastName:       profile.lastName,
        gender:         profile.gender,
        yearOfBirth:    profile.yearOfBirth,
        monthOfBirth:   profile.monthOfBirth,
        dayOfBirth:     profile.dayOfBirth,
        mobile:         profile.mobile,
        email:          profile.email,
        address:        profile.address,
        districtName:   profile.districtName,
        stateName:      profile.stateName,
        pincode:        profile.pincode,
        kycVerified:    profile.kycVerified,
        profilePhoto:   profile.profilePhoto,
        status:         profile.status || 'ACTIVE',
      },
    })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
