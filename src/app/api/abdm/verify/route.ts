/**
 * ABDM ABHA Verification API Route
 *
 * POST /api/abdm/verify  body: { abhaNumber: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ABDM_SANDBOX_URL = 'https://dev.abdm.gov.in'
const ABDM_PROD_URL    = 'https://live.abdm.gov.in'

function logUpstream(scope: string, info: string) {
  console.warn(`[abdm.verify] ${scope}: ${info.slice(0, 600)}`)
}

async function gatewayToken(envIsProd: boolean): Promise<string> {
  const clientId     = process.env.ABDM_CLIENT_ID     || ''
  const clientSecret = process.env.ABDM_CLIENT_SECRET || ''
  const baseUrl      = envIsProd ? ABDM_PROD_URL : ABDM_SANDBOX_URL

  const res = await fetch(`${baseUrl}/gateway/v0.5/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
    cache: 'no-store',
  })
  if (!res.ok) {
    let t = ''
    try { t = await res.text() } catch { /* noop */ }
    logUpstream('sessions', `${res.status} ${t}`)
    throw new Error('ABDM_GATEWAY_AUTH')
  }
  const data = await res.json()
  if (!data.accessToken || typeof data.accessToken !== 'string') {
    logUpstream('sessions', 'missing accessToken')
    throw new Error('ABDM_GATEWAY_AUTH')
  }
  return data.accessToken
}

function mapProfile(profile: Record<string, unknown>, digits: string) {
  const hyphenated =
    `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}-${digits.slice(10, 14)}`
  const first = typeof profile.firstName === 'string' ? profile.firstName : ''
  const mid   = typeof profile.middleName === 'string' ? profile.middleName : ''
  const last  = typeof profile.lastName === 'string' ? profile.lastName : ''
  const nameFromParts = `${first} ${mid} ${last}`.trim()
  const nameFlat = typeof profile.name === 'string' ? profile.name : nameFromParts

  return {
    healthIdNumber: (profile.healthIdNumber as string | undefined) || hyphenated,
    healthId:       (profile.healthId as string | undefined) || '',
    name:           nameFlat,
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
    status:         (profile.status as string | undefined) || 'ACTIVE',
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireRole(req, ['admin', 'doctor', 'receptionist', 'staff'])
  if (gate instanceof Response) return gate

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const abhaRaw = body.abhaNumber

    if (abhaRaw == null || typeof abhaRaw !== 'string') {
      return NextResponse.json({ error: 'ABHA number is required' }, { status: 400 })
    }

    const digits = abhaRaw.replace(/[-\s]/g, '').trim()
    if (!/^\d{14}$/.test(digits)) {
      return NextResponse.json(
        { success: false, error: 'Invalid ABHA number format. Must be 14 digits.' },
        { status: 400 },
      )
    }

    const environment = process.env.ABDM_ENVIRONMENT || 'sandbox'
    const envIsProd   = environment === 'production'

    if (!process.env.ABDM_CLIENT_ID?.trim() || !process.env.ABDM_CLIENT_SECRET?.trim()) {
      return NextResponse.json({
        success: true,
        profile: {
          healthIdNumber: `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}-${digits.slice(10, 14)}`,
          healthId:       '',
          name:           'ABDM Verification Pending',
          gender:         'O',
          yearOfBirth:    '2000',
          mobile:         '',
          status:         'ACTIVE',
        },
        message: 'Server-side ABDM creds absent — simulated response only.',
        simulated: true,
      })
    }

    let token: string
    try {
      token = await gatewayToken(envIsProd)
    } catch {
      return NextResponse.json(
        { success: false, error: 'Could not authenticate against ABDM gateway. Retry later.' },
        { status: 502 },
      )
    }

    const baseUrl   = envIsProd ? ABDM_PROD_URL : ABDM_SANDBOX_URL
    const searchRes = await fetch(`${baseUrl}/abha/api/v1/search/searchByHealthId`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ healthId: digits }),
      cache: 'no-store',
    })

    if (!searchRes.ok) {
      let errText = ''
      try { errText = await searchRes.text() } catch { /* noop */ }
      logUpstream('searchByHealthId', `${searchRes.status} ${errText}`)
      return NextResponse.json(
        {
          success: false,
          error:
            searchRes.status >= 400 && searchRes.status < 500
              ? 'ABHA verification request was rejected upstream.'
              : 'ABHA verification service unavailable. Retry later.',
        },
        { status: searchRes.status >= 502 ? 502 : 400 },
      )
    }

    const payloadUnknown: unknown = await searchRes.json()
    const profileObj =
      payloadUnknown && typeof payloadUnknown === 'object'
        ? (payloadUnknown as Record<string, unknown>)
        : {}

    return NextResponse.json({
      success: true,
      profile: mapProfile(profileObj, digits),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[abdm.verify] handler:', msg)
    return NextResponse.json(
      { success: false, error: 'Internal error during ABHA verification.' },
      { status: 500 },
    )
  }
}