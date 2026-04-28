/**
 * src/app/api/portal/send-link/route.ts
 *
 * POST /api/portal/send-link
 *
 * Generates a magic-link portal token for a patient and (optionally)
 * returns a WhatsApp deep-link to send it.
 *
 * Body: { patient_id, mrn, mobile, patient_name }
 * Auth: requires valid clinic user JWT (admin or staff)
 *
 * The token:
 *  - Is stored in `portal_tokens` table
 *  - Expires in 24 hours
 *  - Is single-use (is_used flag)
 *
 * Requirement #5 — patient-direct portal access without staff interference
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey      = process.env.SUPABASE_SERVICE_ROLE_KEY!
const siteUrl         = process.env.NEXT_PUBLIC_SITE_URL || 'https://your-domain.vercel.app'
const hospitalName    = process.env.NEXT_PUBLIC_HOSPITAL_NAME || 'NexMedicon Hospital'

export async function POST(req: NextRequest) {
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Auth check
  const authHeader = req.headers.get('authorization')
  const token      = authHeader?.split(' ')[1]
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  // Parse body
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { patient_id, mrn, mobile, patient_name } = body
  if (!mrn) {
    return NextResponse.json({ error: 'mrn is required' }, { status: 400 })
  }

  // Generate token (UUID)
  const portalToken = crypto.randomUUID()
  const expiresAt   = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  // Expire any existing tokens for this MRN
  await supabase
    .from('portal_tokens')
    .update({ is_used: true })
    .eq('mrn', mrn)
    .eq('is_used', false)

  // Insert new token
  const { error: insertErr } = await supabase
    .from('portal_tokens')
    .insert({
      mrn,
      patient_id:  patient_id || null,
      token:       portalToken,
      expires_at:  expiresAt,
      is_used:     false,
      created_by:  user.id,
    })

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  // Build the magic link
  const portalUrl = `${siteUrl}/portal?mrn=${encodeURIComponent(mrn)}&token=${encodeURIComponent(portalToken)}`

  // Build WhatsApp message
  const firstName   = (patient_name || 'Patient').split(' ')[0]
  const waMessage   = `Namaste ${firstName} ji,\n\nYou can now view your health records, prescriptions, upcoming appointments, and bills securely:\n\n▶ ${portalUrl}\n\nThis link is valid for 24 hours. Do not share it with others.\n\n— ${hospitalName}`
  const waNumber    = mobile ? mobile.replace(/\D/g, '').slice(-10) : ''
  const waLink      = waNumber
    ? `https://wa.me/91${waNumber}?text=${encodeURIComponent(waMessage)}`
    : null

  return NextResponse.json({
    success:    true,
    portal_url: portalUrl,
    expires_at: expiresAt,
    whatsapp_link: waLink,
    message:    waMessage,
  })
}