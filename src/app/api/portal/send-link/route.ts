/**
 * src/app/api/portal/send-link/route.ts  — UPDATED
 *
 * CHANGE: Replaced the manual inline Bearer token check and supabase.auth.getUser()
 * with requireAuth() so auth logic is consistent. Everything else — expire-old-tokens
 * query, new token insert, WhatsApp message format, 24-hour expiry — is preserved.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/api-auth'

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY!
const siteUrl      = process.env.NEXT_PUBLIC_SITE_URL || 'https://your-domain.vercel.app'
const hospitalName = process.env.NEXT_PUBLIC_HOSPITAL_NAME || 'NexMedicon Hospital'

export async function POST(req: NextRequest) {
  // ── Auth gate ────────────────────────────────────────────────
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth
  // ────────────────────────────────────────────────────────────

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

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
      created_by:  auth.user.id,
    })

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  // Build the magic link
  const portalUrl = `${siteUrl}/portal?mrn=${encodeURIComponent(mrn)}&token=${encodeURIComponent(portalToken)}`

  // Build WhatsApp message
  const firstName = (patient_name || 'Patient').split(' ')[0]
  const waMessage = `Namaste ${firstName} ji,\n\nYou can now view your health records, prescriptions, upcoming appointments, and bills securely:\n\n▶ ${portalUrl}\n\nThis link is valid for 24 hours. Do not share it with others.\n\n— ${hospitalName}`
  const waNumber  = mobile ? mobile.replace(/\D/g, '').slice(-10) : ''
  const waLink    = waNumber
    ? `https://wa.me/91${waNumber}?text=${encodeURIComponent(waMessage)}`
    : null

  return NextResponse.json({
    success:       true,
    portal_url:    portalUrl,
    expires_at:    expiresAt,
    whatsapp_link: waLink,
    message:       waMessage,
  })
}