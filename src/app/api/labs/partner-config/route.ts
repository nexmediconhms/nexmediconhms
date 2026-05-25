/**
 * src/app/api/labs/partner-config/route.ts
 *
 * Lab Partner Commission Configuration API
 *
 * Manages per-test commission/discount percentages for lab partners.
 * Each lab partner can have:
 *   - Default hospital/lab percentage split
 *   - Per-test overrides (e.g., CBC: 40/60, MRI: 20/80)
 *   - Base prices per test (used to calculate financial line items)
 *
 * ENDPOINTS:
 *   GET    /api/labs/partner-config?partnerId=xxx — Get partner config with test list
 *   POST   /api/labs/partner-config — Create or update partner commission config
 *   PATCH  /api/labs/partner-config — Update individual test commission
 *   DELETE /api/labs/partner-config?partnerId=xxx&testName=xxx — Remove test from config
 *
 * SCHEMA (test_commissions JSONB on lab_partners table):
 *   [
 *     {
 *       "test_name": "CBC",
 *       "hospital_pct": 40,
 *       "lab_pct": 60,
 *       "base_price": 300,
 *       "category": "Blood - Routine"
 *     },
 *     ...
 *   ]
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['admin', 'doctor', 'staff'] as const

interface TestCommission {
  test_name: string
  hospital_pct: number
  lab_pct: number
  base_price: number
  category?: string
}

// ── GET: Fetch partner config with test commissions ──────────────
export async function GET(req: NextRequest) {
  const auth = await requireRole(req, ALLOWED_ROLES as unknown as string[])
  if (auth instanceof Response) return auth

  const partnerId = req.nextUrl.searchParams.get('partnerId')

  let sb: ReturnType<typeof getSupabaseAdmin>
  try {
    sb = getSupabaseAdmin()
  } catch {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  try {
    if (partnerId) {
      // Fetch single partner with full config
      const { data: partner, error } = await sb
        .from('lab_partners')
        .select('*')
        .eq('id', partnerId)
        .single()

      if (error || !partner) {
        return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
      }

      return NextResponse.json({
        partner: {
          id: partner.id,
          name: partner.name,
          contact_person: partner.contact_person || null,
          phone: partner.phone || null,
          email: partner.email || null,
          address: partner.address || null,
          default_hospital_pct: Number(partner.default_hospital_pct || partner.hospital_share || 30),
          default_lab_pct: Number(partner.default_lab_pct || partner.lab_share || 70),
          test_commissions: parseTestCommissions(partner.test_commissions),
          portal_enabled: partner.portal_enabled || false,
          is_active: partner.is_active,
        },
      })
    } else {
      // Fetch all partners
      const { data: partners, error } = await sb
        .from('lab_partners')
        .select('*')
        .order('name')

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({
        partners: (partners || []).map(p => ({
          id: p.id,
          name: p.name,
          contact_person: p.contact_person || null,
          phone: p.phone || null,
          email: p.email || null,
          default_hospital_pct: Number(p.default_hospital_pct || p.hospital_share || 30),
          default_lab_pct: Number(p.default_lab_pct || p.lab_share || 70),
          test_count: Array.isArray(p.test_commissions) ? p.test_commissions.length :
            (typeof p.test_commissions === 'string' ? safeParseJSON(p.test_commissions).length : 0),
          portal_enabled: p.portal_enabled || false,
          is_active: p.is_active,
        })),
      })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── POST: Create or update partner commission configuration ──────
export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['admin'])
  if (auth instanceof Response) return auth

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    partner_id,
    default_hospital_pct,
    default_lab_pct,
    test_commissions,
  } = body

  if (!partner_id) {
    return NextResponse.json({ error: 'partner_id is required' }, { status: 400 })
  }

  // Validate percentages
  if (default_hospital_pct !== undefined || default_lab_pct !== undefined) {
    const hPct = Number(default_hospital_pct) || 0
    const lPct = Number(default_lab_pct) || 0
    if (hPct < 0 || hPct > 100 || lPct < 0 || lPct > 100) {
      return NextResponse.json({ error: 'Percentages must be between 0 and 100' }, { status: 400 })
    }
    if (Math.abs(hPct + lPct - 100) > 0.01) {
      return NextResponse.json({ error: 'Hospital % + Lab % must equal 100' }, { status: 400 })
    }
  }

  // Validate test commissions if provided
  if (test_commissions && Array.isArray(test_commissions)) {
    for (const tc of test_commissions) {
      if (!tc.test_name || typeof tc.test_name !== 'string') {
        return NextResponse.json({ error: 'Each test must have a test_name' }, { status: 400 })
      }
      const hPct = Number(tc.hospital_pct) || 0
      const lPct = Number(tc.lab_pct) || 0
      if (hPct < 0 || hPct > 100 || lPct < 0 || lPct > 100) {
        return NextResponse.json({ error: `Invalid percentages for test "${tc.test_name}"` }, { status: 400 })
      }
      if (tc.base_price !== undefined && (Number(tc.base_price) < 0 || Number(tc.base_price) > 1000000)) {
        return NextResponse.json({ error: `Invalid base_price for test "${tc.test_name}"` }, { status: 400 })
      }
    }
  }

  let sb: ReturnType<typeof getSupabaseAdmin>
  try {
    sb = getSupabaseAdmin()
  } catch {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  try {
    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    }

    if (default_hospital_pct !== undefined) {
      updatePayload.default_hospital_pct = Number(default_hospital_pct)
      updatePayload.hospital_share = Number(default_hospital_pct) // legacy field
    }
    if (default_lab_pct !== undefined) {
      updatePayload.default_lab_pct = Number(default_lab_pct)
      updatePayload.lab_share = Number(default_lab_pct) // legacy field
    }
    if (test_commissions !== undefined) {
      // Normalize the test commissions
      const normalized: TestCommission[] = test_commissions.map((tc: any) => ({
        test_name: tc.test_name.trim(),
        hospital_pct: Number(tc.hospital_pct) || 30,
        lab_pct: Number(tc.lab_pct) || 70,
        base_price: Number(tc.base_price) || 0,
        category: tc.category || null,
      }))
      updatePayload.test_commissions = JSON.stringify(normalized)
    }

    const { error: updateErr } = await sb
      .from('lab_partners')
      .update(updatePayload)
      .eq('id', partner_id)

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: 'Partner commission configuration updated',
      partner_id,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── PATCH: Add or update a single test commission ────────────────
export async function PATCH(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'doctor'])
  if (auth instanceof Response) return auth

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { partner_id, test_name, hospital_pct, lab_pct, base_price, category } = body

  if (!partner_id || !test_name) {
    return NextResponse.json({ error: 'partner_id and test_name are required' }, { status: 400 })
  }

  let sb: ReturnType<typeof getSupabaseAdmin>
  try {
    sb = getSupabaseAdmin()
  } catch {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  try {
    // Fetch current config
    const { data: partner, error: fetchErr } = await sb
      .from('lab_partners')
      .select('test_commissions')
      .eq('id', partner_id)
      .single()

    if (fetchErr || !partner) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
    }

    const commissions: TestCommission[] = parseTestCommissions(partner.test_commissions)

    // Find or create the test entry
    const existingIdx = commissions.findIndex(
      c => c.test_name.toLowerCase() === test_name.trim().toLowerCase()
    )

    const updatedEntry: TestCommission = {
      test_name: test_name.trim(),
      hospital_pct: Number(hospital_pct) ?? (existingIdx >= 0 ? commissions[existingIdx].hospital_pct : 30),
      lab_pct: Number(lab_pct) ?? (existingIdx >= 0 ? commissions[existingIdx].lab_pct : 70),
      base_price: Number(base_price) ?? (existingIdx >= 0 ? commissions[existingIdx].base_price : 0),
      category: category || (existingIdx >= 0 ? commissions[existingIdx].category : null),
    }

    if (existingIdx >= 0) {
      commissions[existingIdx] = updatedEntry
    } else {
      commissions.push(updatedEntry)
    }

    // Save
    const { error: saveErr } = await sb
      .from('lab_partners')
      .update({
        test_commissions: JSON.stringify(commissions),
        updated_at: new Date().toISOString(),
      })
      .eq('id', partner_id)

    if (saveErr) {
      return NextResponse.json({ error: saveErr.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: existingIdx >= 0 ? `Updated "${test_name}" commission` : `Added "${test_name}" to partner`,
      test: updatedEntry,
      total_tests: commissions.length,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── DELETE: Remove a test from partner configuration ─────────────
export async function DELETE(req: NextRequest) {
  const auth = await requireRole(req, ['admin'])
  if (auth instanceof Response) return auth

  const partnerId = req.nextUrl.searchParams.get('partnerId')
  const testName = req.nextUrl.searchParams.get('testName')

  if (!partnerId || !testName) {
    return NextResponse.json({ error: 'partnerId and testName are required' }, { status: 400 })
  }

  let sb: ReturnType<typeof getSupabaseAdmin>
  try {
    sb = getSupabaseAdmin()
  } catch {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  try {
    const { data: partner } = await sb
      .from('lab_partners')
      .select('test_commissions')
      .eq('id', partnerId)
      .single()

    if (!partner) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
    }

    const commissions: TestCommission[] = parseTestCommissions(partner.test_commissions)
    const filtered = commissions.filter(
      c => c.test_name.toLowerCase() !== testName.trim().toLowerCase()
    )

    if (filtered.length === commissions.length) {
      return NextResponse.json({ error: 'Test not found in partner config' }, { status: 404 })
    }

    await sb
      .from('lab_partners')
      .update({
        test_commissions: JSON.stringify(filtered),
        updated_at: new Date().toISOString(),
      })
      .eq('id', partnerId)

    return NextResponse.json({
      success: true,
      message: `Removed "${testName}" from partner configuration`,
      remaining_tests: filtered.length,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function parseTestCommissions(raw: any): TestCommission[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return [] }
  }
  return []
}

function safeParseJSON(str: string): any[] {
  try { return JSON.parse(str) } catch { return [] }
}