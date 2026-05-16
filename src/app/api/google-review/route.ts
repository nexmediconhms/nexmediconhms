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
 *     body: JSON.stringify({
 *       patientId:   patient.id,
 *       patientName: patient.fullname,
 *       mobile:      patient.mobile,
 *       encounterId: encounter.id,
 *     })
 *   })
 * Then open the returned whatsappUrl to send the message.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
      || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  )
}

// GET: list pending review requests
export async function GET() {
  const sb = getSupabase()
  const { data } = await sb
    .from('google_review_requests')
    .select('*')
    .eq('status', 'pending')
    .order('createdat', { ascending: false })
    .limit(50)

  return NextResponse.json({ requests: data || [] })
}

// POST: create review request + return WhatsApp link
export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { patientId, patientName, mobile, encounterId } = body

  if (!patientId || !mobile) {
    return NextResponse.json({ error: 'patientId and mobile are required' }, { status: 400 })
  }

  const sb = getSupabase()

  // Avoid duplicate requests in the last 7 days
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)

  const { data: recent } = await sb
    .from('google_review_requests')
    .select('id')
    .eq('patientid', patientId)
    .gte('createdat', weekAgo.toISOString())
    .limit(1)
    .single()

  if (recent) {
    return NextResponse.json({
      skipped: true,
      reason:  'Review request already sent in the last 7 days',
    })
  }

  // Get Google review URL from clinicsettings
  const { data: reviewSetting } = await sb
    .from('clinicsettings')
    .select('value')
    .eq('key', 'google_review_url')
    .single()

  const { data: nameSetting } = await sb
    .from('clinicsettings')
    .select('value')
    .eq('key', 'hospital_name')
    .single()

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
  const whatsappUrl = `https://wa.me/91${cleanMobile}?text=${encodeURIComponent(message)}`

  // Save the review request
  const { data: request } = await sb
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

  return NextResponse.json({
    success:      true,
    whatsappUrl,  // open this link — WhatsApp opens with message pre-filled
    message,      // the actual message text
    requestId:    request?.id,
    howToUse:     'Open whatsappUrl on any device — WhatsApp will open with the message pre-filled. Staff just needs to press Send.',
  })
}

// PATCH: mark a request as sent
export async function PATCH(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { requestId } = body
  if (!requestId) return NextResponse.json({ error: 'requestId required' }, { status: 400 })

  const sb = getSupabase()
  await sb
    .from('google_review_requests')
    .update({ status: 'sent', sentat: new Date().toISOString() })
    .eq('id', requestId)

  return NextResponse.json({ success: true })
}