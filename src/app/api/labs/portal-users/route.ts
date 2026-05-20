/**
 * src/app/api/labs/portal-users/route.ts
 *
 * Lab Portal User Management API — Admin creates persistent portal accounts.
 *
 * Instead of generating a new token every time, this creates a PERMANENT
 * portal user account for the lab partner. The token never expires unless
 * explicitly revoked by admin. Lab partners save it in localStorage once
 * and never need to ask for it again.
 *
 * GET    /api/labs/portal-users           — List all portal users
 * POST   /api/labs/portal-users           — Create new portal user (generates permanent token)
 * PATCH  /api/labs/portal-users           — Toggle active/inactive, regenerate token
 * DELETE /api/labs/portal-users?id=XXX    — Deactivate portal user
 *
 * EFFICIENCY:
 *  - Token is stored in lab partner's browser (localStorage) permanently
 *  - Token only needs to be shared ONCE via WhatsApp/SMS link
 *  - If lab partner loses token, admin can regenerate + re-share
 *  - Token can be revoked without deleting the account (set is_active = false)
 *  - Shareable URL format: /lab-partner-portal?token=XXXXX (bookmarkable)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

/** Generate a URL-safe token — short enough to share via WhatsApp */
function generateToken(): string {
  return crypto.randomBytes(24).toString('base64url')
}

// ── GET: List portal users ────────────────────────────────────
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('lab_portal_users')
      .select('id, name, email, phone, lab_partner_id, auth_token, is_active, last_used_at, token_expires_at, created_at, lab_partners(name)')
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const users = (data || []).map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      lab_partner_id: u.lab_partner_id,
      lab_name: (u.lab_partners as any)?.name || 'Unknown',
      auth_token: u.auth_token,
      is_active: u.is_active,
      last_used_at: u.last_used_at,
      token_expires_at: u.token_expires_at,
      created_at: u.created_at,
    }))

    return NextResponse.json({ users })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── POST: Create new portal user ──────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, email, phone, lab_partner_id, never_expires = true } = body

    if (!name || !lab_partner_id) {
      return NextResponse.json({ error: 'name and lab_partner_id are required' }, { status: 400 })
    }

    const token = generateToken()
    const expiresAt = never_expires ? null : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await supabase
      .from('lab_portal_users')
      .insert({
        name,
        email: email || null,
        phone: phone || null,
        lab_partner_id,
        auth_token: token,
        is_active: true,
        token_expires_at: expiresAt,
      })
      .select('id, name, auth_token')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Generate shareable URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000'
    const shareableUrl = `${baseUrl}/lab-partner-portal?token=${token}`

    return NextResponse.json({
      ok: true,
      user: data,
      token,
      shareable_url: shareableUrl,
      message: `Portal access created for ${name}. Share the link — it never expires unless revoked.`,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── PATCH: Update portal user (toggle active, regenerate token) ──
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, action } = body

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    if (action === 'regenerate_token') {
      const newToken = generateToken()
      const { error } = await supabase
        .from('lab_portal_users')
        .update({ auth_token: newToken, updatedat: new Date().toISOString() })
        .eq('id', id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000'

      return NextResponse.json({
        ok: true,
        new_token: newToken,
        shareable_url: `${baseUrl}/lab-partner-portal?token=${newToken}`,
        message: 'Token regenerated. Old token is now invalid. Share the new link with the lab partner.',
      })
    }

    if (action === 'toggle_active') {
      // Get current state
      const { data: current } = await supabase
        .from('lab_portal_users')
        .select('is_active')
        .eq('id', id)
        .single()

      const newState = !current?.is_active
      const { error } = await supabase
        .from('lab_portal_users')
        .update({ is_active: newState, updatedat: new Date().toISOString() })
        .eq('id', id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({
        ok: true,
        is_active: newState,
        message: newState ? 'Portal access reactivated.' : 'Portal access revoked. Lab partner can no longer upload.',
      })
    }

    return NextResponse.json({ error: 'Unknown action. Use "regenerate_token" or "toggle_active"' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── DELETE: Remove portal user ────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'id query param is required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('lab_portal_users')
      .delete()
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, message: 'Portal user deleted permanently.' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}