/**
 * src/app/api/patients/search/route.ts
 *
 * Server-side patient search API.
 * Replaces client-side supabase.from('patients').select() calls.
 *
 * SECURITY FIX: All patient searches now go through this authenticated
 * API route instead of directly from the browser. This prevents:
 *   - Database schema exposure in DevTools
 *   - Unauthorized queries bypassing RLS
 *   - Aadhaar search patterns being visible to attackers
 *
 * Usage from frontend:
 *   const res = await fetch('/api/patients/search?q=rahul&type=name', {
 *     headers: { Authorization: `Bearer ${session.access_token}` }
 *   })
 *   const { patients } = await res.json()
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // ── Authentication ────────────────────────────────────────
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  // ── Parse query parameters ────────────────────────────────
  const { searchParams } = req.nextUrl
  const query = (searchParams.get('q') || '').trim()
  const searchType = searchParams.get('type') || 'name'
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
  const offset = parseInt(searchParams.get('offset') || '0')

  if (!query) {
    return NextResponse.json({ patients: [], total: 0 })
  }

  // Minimum search length to prevent overly broad queries
  if (query.length < 2) {
    return NextResponse.json(
      { error: 'Search query must be at least 2 characters' },
      { status: 400 }
    )
  }

  const supabase = getSupabaseAdmin()

  // ── Build query based on search type ──────────────────────
  let dbQuery = supabase
    .from('patients')
    .select('id, mrn, fullname, mobile, dob, age, gender, city, bloodgroup, createdat', { count: 'exact' })
    .eq('isactive', true)

  switch (searchType) {
    case 'name':
      dbQuery = dbQuery.ilike('fullname', `%${query}%`)
      break
    case 'mobile':
      // Strip non-digits for mobile search
      const digits = query.replace(/\D/g, '')
      if (digits.length < 4) {
        return NextResponse.json(
          { error: 'Mobile search requires at least 4 digits' },
          { status: 400 }
        )
      }
      dbQuery = dbQuery.ilike('mobile', `%${digits}%`)
      break
    case 'mrn':
      dbQuery = dbQuery.ilike('mrn', `%${query}%`)
      break
    case 'aadhaar':
      // Only admin and doctor can search by Aadhaar
      if (!['admin', 'doctor'].includes(auth.role)) {
        return NextResponse.json(
          { error: 'Aadhaar search restricted to admin and doctor roles.' },
          { status: 403 }
        )
      }
      const aadhaarDigits = query.replace(/\D/g, '')
      if (aadhaarDigits.length < 4) {
        return NextResponse.json(
          { error: 'Aadhaar search requires at least 4 digits' },
          { status: 400 }
        )
      }
      dbQuery = dbQuery.ilike('aadhaar', `%${aadhaarDigits}%`)
      break
    default:
      // General search - searches name and mobile
      dbQuery = dbQuery.or(`fullname.ilike.%${query}%,mobile.ilike.%${query}%,mrn.ilike.%${query}%`)
  }

  // ── Execute with pagination ───────────────────────────────
  const { data, error, count } = await dbQuery
    .order('createdat', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    console.error('[patients/search] Query error:', error.message)
    return NextResponse.json(
      { error: 'Failed to search patients. Please try again.' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    patients: data || [],
    total: count || 0,
    limit,
    offset,
  })
}