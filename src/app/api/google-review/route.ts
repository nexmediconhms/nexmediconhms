/**
 * src/app/api/google-review/route.ts
 *
 * Google Review Automation
 *
 * After each patient visit, this generates a WhatsApp link the
 * staff can click to send a Google review request — NO WhatsApp
 * Business API key needed.
 *
 * SETUP:
 * 1. Go to Google Business Profile → "Ask for Reviews" → copy the link
 * 2. In Supabase SQL editor, run:
 *    INSERT INTO clinicsettings (key, value)
 *    VALUES ('google_review_url', 'https://g.page/r/YOUR_LINK/review')
 *    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
 *
 * HOW TO CALL THIS API:
 * After saving an encounter, call:
 *   await fetch('/api/google-review', {
 *     method: 'POST',
 *     headers: {
 *       'Content-Type': 'application/json',
 *       Authorization: `Bearer ${session.access_token}`,
 *     },
 *     body: JSON.stringify({
 *       patientId:   patient.id,
 *       patientName: patient.fullname,
 *       mobile:      patient.mobile,
 *       encounterId: encounter.id,
 *     })
 *   })
 * Then open the returned whatsappUrl to send the message.
 *
 * ─── HARDENING (May 2026) ────────────────────────────────────────────
 *  - All three verbs (GET / POST / PATCH) require an authenticated,
 *    active clinic user.  The endpoint stores patient names + mobile
 *    numbers, which is PII.
 *  - Service-role client comes from `getSupabaseAdmin()` — lazy and
 *    fails fast if env vars are missing.
 *  - Errors return generic messages; details are logged server-side
 *    without PHI.
 * ─────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole }               from '@/lib/api-auth'
import { getSupabaseAdmin }          from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED_ROLES = ['admin', 'doctor', 'receptionist', 'staff'] as const

function safeErrorLog(scope: string, err: unknown) {
  const code = (err as { code?: string })?.code ?? 'unknown'
  const msg  = (err as { message?: string })?.message ?? String(err)
  // eslint-disable-next-line no-console
  console.error(`[google-review][${scope}] code=${code} msg=${msg}`)
}

// ── GET: list pending review requests ─────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireRole(req, ALLOWED_ROLES as unknown as string[])
  if (auth instanceof Response) return auth

  let sb
  try { sb = getSupabaseAdmin() } catch (err) {
    safeErrorLog('getAdmin', err)
    return NextResponse.json({ error: 'Server is misconfigured.' }, { status: 500 })
  }

  const { data, error } = await sb
    .from('google_review_requests')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    safeErrorLog('GET.list', error)
    return NextResponse.json({ error: 'Failed to fetch review requests.' }, { status: 500 })
  }

  return NextResponse.json({ requests: data || [] })
}

// ── POST: create review request + return WhatsApp link ────────
export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ALLOWED_ROLES as unknown as string[])
  if (auth instanceof Response) return auth

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { patientId, patientName, mobile, encounterId } = body ?? {}

  if (!patientId || typeof patientId !== 'string') {
    return NextResponse.json({ error: 'patientId is required' }, { status: 400 })
  }
  if (!mobile || typeof mobile !== 'string') {
    return NextResponse.json({ error: 'mobile is required' }, { status: 400 })
  }

  let sb
  try { sb = getSupabaseAdmin() } catch (err) {
    safeErrorLog('getAdmin', err)
    return NextResponse.json({ error: 'Server is misconfigured.' }, { status: 500 })
  }

  // Avoid duplicate requests in the last 7 days
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)

  const { data: recent } = await sb
    .from('google_review_requests')
    .select('id')
    .eq('patient_id', patientId)
    .gte('created_at', weekAgo.toISOString())
    .limit(1)
    .maybeSingle()

  if (recent) {
    return NextResponse.json({
      skipped: true,
      reason:  'Review request already sent in the last 7 days',
    })
  }

  // Get Google review URL from clinic_settings
  const { data: reviewSetting } = await sb
    .from('clinic_settings')
    .select('value')
    .eq('key', 'google_review_url')
    .maybeSingle()

  const { data: nameSetting } = await sb
    .from('clinic_settings')
    .select('value')
    .eq('key', 'hospital_name')
    .maybeSingle()

  const reviewUrl  = reviewSetting?.value || ''
  const clinicName = nameSetting?.value   || 'our clinic'

  // Build the WhatsApp message
  const name    = patientName || 'Patient'
  const message =
    `Dear ${name},\n\n` +
    `Thank you for visiting ${clinicName}! 🙏\n\n` +
    `We hope you are feeling better. If you are satisfied with your care, ` +
    `it would mean a lot to us if you could leave a Google review:\n\n` +
    (reviewUrl ? `⭐ ${reviewUrl}\n\n` : '') +
    `Your feedback helps other patients find trusted care.\n\n` +
    `Stay healthy!\n— ${clinicName} Team`

  // Clean and format the mobile number
  const cleanMobile = mobile.replace(/\D/g, '').slice(-10)
  if (cleanMobile.length !== 10) {
    return NextResponse.json({ error: 'mobile must be a 10-digit Indian number' }, { status: 400 })
  }
  const whatsappUrl = `https://wa.me/91${cleanMobile}?text=${encodeURIComponent(message)}`

  // Save the review request
  const { data: request, error: insErr } = await sb
    .from('google_review_requests')
    .insert({
      patientid:   patientId,
      patientname: patientName,
      mobile:      cleanMobile,
      encounterid: encounterId || null,
      status:      'pending',
    })
    .select()
    .single()

  if (insErr) {
    safeErrorLog('POST.insert', insErr)
    // We can still return the WhatsApp link even if the audit row failed;
    // staff workflow shouldn't be blocked by a logging failure.
  }

  return NextResponse.json({
    success:      true,
    whatsappUrl,
    message,
    requestId:    request?.id,
    howToUse:     'Open whatsappUrl on any device — WhatsApp will open with the message pre-filled. Staff just needs to press Send.',
  })
}

// ── PATCH: mark a request as sent ─────────────────────────────
export async function PATCH(req: NextRequest) {
  const auth = await requireRole(req, ALLOWED_ROLES as unknown as string[])
  if (auth instanceof Response) return auth

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { requestId } = body ?? {}
  if (!requestId || typeof requestId !== 'string') {
    return NextResponse.json({ error: 'requestId required' }, { status: 400 })
  }

  let sb
  try { sb = getSupabaseAdmin() } catch (err) {
    safeErrorLog('getAdmin', err)
    return NextResponse.json({ error: 'Server is misconfigured.' }, { status: 500 })
  }

  const { error } = await sb
    .from('google_review_requests')
    .update({ status: 'sent', sentat: new Date().toISOString() })
    .eq('id', requestId)

  if (error) {
    safeErrorLog('PATCH.update', error)
    return NextResponse.json({ error: 'Failed to mark request as sent.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}