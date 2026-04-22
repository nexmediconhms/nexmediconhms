/**
 * /api/users — List and manage clinic users
 *
 * GET  → List all clinic users (admin only)
 * POST → Update a user's role or active status (admin only)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  try {
    const supabase = createClientFromRequest(req)
    
    // Verify caller is admin
    const role = await getCallerRole(supabase)
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can manage users' }, { status: 403 })
    }

    const { data, error } = await supabase
      .from('clinic_users')
      .select('*')
      .order('created_at', { ascending: true })

    if (error) throw error
    return NextResponse.json({ users: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createClientFromRequest(req)
    
    // Verify caller is admin
    const role = await getCallerRole(supabase)
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can manage users' }, { status: 403 })
    }

    const body = await req.json()
    const { userId, updates } = body

    if (!userId || !updates) {
      return NextResponse.json({ error: 'userId and updates required' }, { status: 400 })
    }

    // Only allow updating role and is_active
    const allowed: Record<string, any> = {}
    if (updates.role && ['admin', 'doctor', 'staff'].includes(updates.role)) {
      allowed.role = updates.role
    }
    if (typeof updates.is_active === 'boolean') {
      allowed.is_active = updates.is_active
    }
    if (updates.full_name) {
      allowed.full_name = updates.full_name
    }
    allowed.updated_at = new Date().toISOString()

    const { data, error } = await supabase
      .from('clinic_users')
      .update(allowed)
      .eq('id', userId)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ user: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── Helpers ──────────────────────────────────────────────────
function createClientFromRequest(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace('Bearer ', '')
  
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    }
  )
}

async function getCallerRole(supabase: any): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('clinic_users')
    .select('role')
    .eq('auth_id', user.id)
    .eq('is_active', true)
    .single()

  return data?.role || null
}
