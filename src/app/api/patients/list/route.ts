/**
 * src/app/api/patients/list/route.ts
 *
 * Server-side patient list API with pagination.
 * Replaces client-side supabase.from('patients').select() in patient list pages.
 *
 * SECURITY FIX: Database queries now go through authenticated API route.
 *
 * Usage from frontend:
 *   const res = await fetch('/api/patients/list?page=1&per_page=25', {
 *     headers: { Authorization: `Bearer ${session.access_token}` }
 *   })
 *   const { patients, total, page, per_page } = await res.json()
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
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const perPage = Math.min(parseInt(searchParams.get('per_page') || '25'), 100)
  const sortBy = searchParams.get('sort') || 'createdat'
  const sortOrder = searchParams.get('order') === 'asc' ? true : false
  const activeOnly = searchParams.get('active') !== 'false'

  const offset = (page - 1) * perPage

  const supabase = getSupabaseAdmin()

  // ── Build query ───────────────────────────────────────────
  let dbQuery = supabase
    .from('patients')
    .select('id, mrn, fullname, mobile, dob, age, gender, city, bloodgroup, isactive, createdat, updatedat', { count: 'exact' })

  if (activeOnly) {
    dbQuery = dbQuery.eq('isactive', true)
  }

  // Validate sort column (prevent SQL injection via sort param)
  const allowedSortColumns = ['createdat', 'fullname', 'mrn', 'updatedat', 'dob']
  const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'createdat'

  const { data, error, count } = await dbQuery
    .order(safeSortBy, { ascending: sortOrder })
    .range(offset, offset + perPage - 1)

  if (error) {
    console.error('[patients/list] Query error:', error.message)
    return NextResponse.json(
      { error: 'Failed to load patients. Please try again.' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    patients: data || [],
    total: count || 0,
    page,
    per_page: perPage,
    total_pages: Math.ceil((count || 0) / perPage),
  })
}
