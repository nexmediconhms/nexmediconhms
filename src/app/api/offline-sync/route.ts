/**
 * src/app/api/offline-sync/route.ts
 *
 * Server-side endpoint for syncing offline-queued operations.
 * Called by the offline-queue module when internet reconnects.
 *
 * Accepts queued INSERT/UPDATE/UPSERT operations and executes them
 * against the database with proper authentication.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// Tables that are allowed to be synced offline
const ALLOWED_TABLES = [
  'patients',
  'encounters',
  'prescriptions',
  'appointments',
  'bills',
  'opdqueue',
  'reminders',
]

export async function POST(req: NextRequest) {
  // ── Authentication ────────────────────────────────────────
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  // ── Parse body ────────────────────────────────────────────
  let body: {
    table: string
    method: 'INSERT' | 'UPDATE' | 'UPSERT'
    data: Record<string, unknown>
    matchColumn?: string
    matchValue?: string
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { table, method, data, matchColumn, matchValue } = body

  // ── Validate table ────────────────────────────────────────
  if (!table || !ALLOWED_TABLES.includes(table)) {
    return NextResponse.json(
      { error: `Table '${table}' is not allowed for offline sync` },
      { status: 403 }
    )
  }

  if (!method || !['INSERT', 'UPDATE', 'UPSERT'].includes(method)) {
    return NextResponse.json({ error: 'Invalid method' }, { status: 400 })
  }

  if (!data || typeof data !== 'object') {
    return NextResponse.json({ error: 'data is required and must be an object' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // ── Execute operation ─────────────────────────────────────
  try {
    let result: any

    switch (method) {
      case 'INSERT':
        result = await supabase.from(table).insert(data)
        break

      case 'UPDATE':
        if (!matchColumn || !matchValue) {
          return NextResponse.json(
            { error: 'UPDATE requires matchColumn and matchValue' },
            { status: 400 }
          )
        }
        result = await supabase.from(table).update(data).eq(matchColumn, matchValue)
        break

      case 'UPSERT':
        result = await supabase.from(table).upsert(data)
        break
    }

    if (result?.error) {
      console.error(`[offline-sync] ${method} on ${table} failed:`, result.error.message)
      return NextResponse.json(
        { error: result.error.message || 'Database operation failed' },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, method, table })
  } catch (err: any) {
    console.error('[offline-sync] Exception:', err)
    return NextResponse.json(
      { error: err.message || 'Sync operation failed' },
      { status: 500 }
    )
  }
}
