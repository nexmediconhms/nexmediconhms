/**
 * ABDM ABHA Search by Health ID Address
 * POST /api/abdm/search  body: { healthId: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ABDM_SANDBOX_URL = 'https://dev.abdm.gov.in'
const ABDM_PROD_URL    = 'https://live.abdm.gov.in'

function logUpstream(scope: string, info: string) {
  console.warn(`[abdm.search] ${scope}: ${info.slice(0, 600)}`)
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
  if (!data.accessToken || typeof data.accessToken !== 'string') throw new Error('ABDM_GATEWAY_AUTH')
  return data.accessToken
}

/** NDHI-like address: something@sbx — allow short registry suffixes without a dot-TLD */
function isValidHealthIdAddress(s: string): boolean {
  if (s.length < 5 || s.length > 320) return false
  const at = s.indexOf('@')
  if (at < 1 || at !== s.lastIndexOf('@')) return false
  const local = s.slice(0, at).trim()
  const dom   = s.slice(at + 1).trim()
  if (!local || !dom) return false
  return /^[\w.\-]+$/.test(local) && /^[\w.\-]+$/.test(dom) && dom.length >= 2
}

export async function POST(req: NextRequest) {
  const gate = await requireRole(req, ['admin', 'doctor', 'receptionist', 'staff'])
  if (gate instanceof Response) return gate

  try {
    const body      = await req.json().catch(() => ({} as Record<string, unknown>))
    const healthIdRaw = body.healthId
    const healthId    = typeof healthIdRaw === 'string' ? healthIdRaw.trim() : ''

    if (!healthId) {
      return NextResponse.json({ success: false, error: 'Health ID address is required' }, { status: 400 })
    }
    if (!isValidHealthIdAddress(healthId)) {
      return NextResponse.json({ success: false, error: 'Health ID format is invalid.' }, { status: 400 })
    }

    const environment = process.env.ABDM_ENVIRONMENT || 'sandbox'
    const envIsProd   = environment === 'production'

    if (!process.env.ABDM_CLIENT_ID?.trim() || !process.env.ABDM_CLIENT_SECRET?.trim()) {
      return NextResponse.json({
        success: false,
        error: 'ABDM credentials not configured on the server.',
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
      body: JSON.stringify({ healthId }),
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
              ? 'Health ID lookup was rejected upstream.'
              : 'ABDM search service unavailable. Retry later.',
        },
        { status: searchRes.status >= 502 ? 502 : 400 },
      )
    }

    const payloadUnknown: unknown = await searchRes.json()
    const profile = (
      payloadUnknown && typeof payloadUnknown === 'object'
        ? (payloadUnknown as Record<string, unknown>)
        : {}) as Record<string, unknown>

    const first = typeof profile.firstName === 'string' ? profile.firstName : ''
    const mid   = typeof profile.middleName === 'string' ? profile.middleName : ''
    const last  = typeof profile.lastName === 'string' ? profile.lastName : ''
    const nameFromParts = `${first} ${mid} ${last}`.trim()

    return NextResponse.json({
      success: true,
      profile: {
        healthIdNumber: profile.healthIdNumber,
        healthId:       profile.healthId,
        name:           (profile.name as string | undefined)?.trim()
          ? (profile.name as string)
          : nameFromParts,
        gender:       profile.gender,
        yearOfBirth:  profile.yearOfBirth,
        monthOfBirth: profile.monthOfBirth,
        dayOfBirth:   profile.dayOfBirth,
        mobile:       profile.mobile,
        status:       (profile.status as string | undefined) || 'ACTIVE',
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[abdm.search] handler:', msg)
    return NextResponse.json(
      { success: false, error: 'Internal error during ABHA search.' },
      { status: 500 },
    )
  }
}