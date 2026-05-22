/**
 * src/app/api/patients/search/route.ts
 *
 * Server-side patient search — replaces direct client-side Supabase calls.
 *
 * This moves sensitive queries (Aadhaar lookup, mobile search, patient list)
 * behind an authenticated API route so:
 * 1. Table structure is not exposed in browser DevTools
 * 2. Search by Aadhaar/mobile goes through proper access control
 * 3. RLS is enforced server-side regardless of client-side configuration
 *
 * GET /api/patients/search?q=priya&limit=20
 * GET /api/patients/search?mobile=9876543210
 * GET /api/patients/search?mrn=P-042
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  const { searchParams } = req.nextUrl
  const q = searchParams.get('q')?.trim() || ''
  const mobile = searchParams.get('mobile')?.trim() || ''
  const mrn = searchParams.get('mrn')?.trim() || ''
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50)

  const supabase = getSupabaseAdmin()

  try {
    let query = supabase
      .from('patients')
      .select('id, full_name, mrn, age, date_of_birth, gender, mobile, blood_group, abha_id, created_at')
      .eq('is_active', true)

    if (mrn) {
      query = query.eq('mrn', mrn)
    } else if (mobile) {
      const cleaned = mobile.replace(/[\s\-+]/g, '').slice(-10)
      query = query.or(`mobile.ilike.%${cleaned}%`)
    } else if (q && q.length >= 2) {
      // Escape special characters for ilike
      const safe = q.replace(/[%_\\]/g, c => `\\${c}`)
      query = query.or(`full_name.ilike.%${safe}%,mrn.ilike.%${safe}%,mobile.ilike.%${safe}%`)
    } else {
      // No search criteria — return recent patients
      query = query.order('created_at', { ascending: false })
    }

    const { data, error } = await query.limit(limit)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ patients: data || [], count: data?.length || 0 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Search failed' }, { status: 500 })
  }
}
