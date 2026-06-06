/**
 * src/app/api/ensure-schema/route.ts
 *
 * Self-healing schema endpoint.
 * Called automatically by components that need specific tables/columns.
 * Uses service_role to execute DDL via multiple fallback methods:
 *   1. exec_sql RPC (if the function exists)
 *   2. Direct SQL via Supabase REST /pg endpoint
 *
 * This prevents "Could not find column X of table Y in the schema cache" errors
 * that occur when the database was set up with an older/incomplete migration.
 *
 * SAFE: All operations use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
 * IDEMPOTENT: Can be called multiple times without side effects.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// ── Table schemas: defines what columns each table MUST have ──────────────────
// Format: { column_name: 'SQL_TYPE DEFAULT ...' }

const REQUIRED_SCHEMAS: Record<string, Record<string, string>> = {
  consultation_attachments: {
    patient_id:   'UUID',
    encounter_id: 'UUID',
    file_name:    'TEXT',
    file_type:    'TEXT',
    file_size:    'INTEGER',
    bucket:       "TEXT DEFAULT 'consultation-files'",
    storage_key:  'TEXT',
    storage_path: 'TEXT',
    notes:        'TEXT',
    uploaded_by:  'TEXT',
    created_at:   'TIMESTAMPTZ DEFAULT NOW()',
  },
  consultation_files_db: {
    patient_id:   'UUID',
    encounter_id: 'UUID',
    file_name:    'TEXT',
    file_type:    'TEXT',
    file_size:    'INTEGER',
    file_data:    'TEXT',
    notes:        'TEXT',
    uploaded_by:  'TEXT',
    created_at:   'TIMESTAMPTZ DEFAULT NOW()',
  },
  ot_schedules: {
    patient_id:      'UUID',
    patient_name:    'TEXT',
    mrn:             'TEXT',
    surgery_name:    'TEXT',
    surgery_date:    'DATE',
    start_time:      'TEXT',
    end_time:        'TEXT',
    surgeon:         'TEXT',
    assistant:       'TEXT',
    anesthesia_type: 'TEXT',
    anesthetist:     'TEXT',
    ot_room:         "TEXT DEFAULT 'OT-1'",
    priority:        "TEXT DEFAULT 'elective'",
    status:          "TEXT DEFAULT 'scheduled'",
    pre_op_notes:    'TEXT',
    post_op_notes:   'TEXT',
    complications:   'TEXT',
    instruments:     'JSONB',
    created_at:      'TIMESTAMPTZ DEFAULT NOW()',
    updated_at:      'TIMESTAMPTZ DEFAULT NOW()',
  },
  hospital_fund: {
    type:          'TEXT',
    category:      'TEXT',
    amount:        'NUMERIC(10,2)',
    description:   'TEXT',
    date:          'DATE DEFAULT CURRENT_DATE',
    submitted_by:  'TEXT',
    approved_by:   'TEXT',
    status:        "TEXT DEFAULT 'pending'",
    receipt_url:   'TEXT',
    receipt_note:  'TEXT',
    created_at:    'TIMESTAMPTZ DEFAULT NOW()',
    updated_at:    'TIMESTAMPTZ DEFAULT NOW()',
  },
  ipd_files: {
    patient_id:       'UUID',
    bed_id:           'TEXT',
    file_name:        'TEXT',
    file_type:        'TEXT',
    file_size:        'INTEGER',
    file_url:         'TEXT',
    storage_path:     'TEXT',
    uploaded_by:      'TEXT',
    uploaded_by_role: 'TEXT',
    category:         'TEXT',
    notes:            'TEXT',
    ocr_extracted:    'BOOLEAN DEFAULT false',
    created_at:       'TIMESTAMPTZ DEFAULT NOW()',
  },
}

/**
 * Execute SQL using multiple fallback methods.
 * Tries exec_sql RPC first, then falls back to direct pg REST endpoint.
 */
async function executeSql(sql: string): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseAdmin()

  // Method 1: Try exec_sql RPC (most common in this project)
  try {
    const { error } = await supabase.rpc('exec_sql', { sql })
    if (!error) return { success: true }
    // If exec_sql doesn't exist, try alternative parameter name
    if (error.message?.includes('function') || error.message?.includes('does not exist')) {
      // Try with 'query' parameter name (some setups use this)
      const { error: err2 } = await supabase.rpc('exec_sql', { query: sql } as any)
      if (!err2) return { success: true }
    }
  } catch { /* fall through to next method */ }

  // Method 2: Try direct SQL via Supabase REST pg endpoint
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (url && key) {
      const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ sql }),
      })
      if (res.ok) return { success: true }
    }
  } catch { /* fall through */ }

  // Method 3: Try via pg_net or direct connection (last resort)
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (url && key) {
      // Use the Supabase SQL endpoint (available in newer versions)
      const res = await fetch(`${url}/pg/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': key,
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({ query: sql }),
      })
      if (res.ok) return { success: true }
    }
  } catch { /* fall through */ }

  return { success: false, error: 'All SQL execution methods failed' }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const tables: string[] = body.tables || Object.keys(REQUIRED_SCHEMAS)

    const results: Record<string, { status: string; columns_added: string[] }> = {}

    for (const table of tables) {
      const schema = REQUIRED_SCHEMAS[table]
      if (!schema) {
        results[table] = { status: 'skipped (unknown table)', columns_added: [] }
        continue
      }

      // Build CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN IF NOT EXISTS
      const allColDefs = [
        'id UUID DEFAULT gen_random_uuid() PRIMARY KEY',
        ...Object.entries(schema).map(([col, def]) => `${col} ${def}`),
      ].join(', ')

      const statements = [
        `CREATE TABLE IF NOT EXISTS public.${table} (${allColDefs});`,
        ...Object.entries(schema).map(([col, def]) =>
          `ALTER TABLE public.${table} ADD COLUMN IF NOT EXISTS ${col} ${def};`
        ),
      ]

      // Execute all statements as one block
      const fullSQL = statements.join('\n')
      const { success, error } = await executeSql(fullSQL)

      if (success) {
        results[table] = { status: 'ensured', columns_added: Object.keys(schema) }
      } else {
        // Try individual statements
        const columnsAdded: string[] = []
        for (const stmt of statements) {
          const r = await executeSql(stmt)
          if (r.success) {
            // Extract column name from ALTER statement
            const match = stmt.match(/ADD COLUMN IF NOT EXISTS (\w+)/)
            if (match) columnsAdded.push(match[1])
          }
        }
        results[table] = {
          status: columnsAdded.length > 0 ? 'partially_fixed' : `failed: ${error}`,
          columns_added: columnsAdded,
        }
      }
    }

    // Reload PostgREST schema cache so new columns are immediately available
    await executeSql("NOTIFY pgrst, 'reload schema';")

    return NextResponse.json({ success: true, results })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// GET: Quick health check
export async function GET() {
  return NextResponse.json({
    info: 'POST with { "tables": ["consultation_attachments"] } to auto-fix schema',
    known_tables: Object.keys(REQUIRED_SCHEMAS),
  })
}
