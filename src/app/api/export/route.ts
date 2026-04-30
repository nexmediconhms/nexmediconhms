/**
 * src/app/api/export/route.ts  — UPDATED
 *
 * CHANGE: Replaced manual inline auth check with requireRole('admin').
 * Everything else is the original code — table list, date filtering, CSV
 * multi-table format, JSON bundle with metadata — all preserved exactly.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

export async function GET(req: NextRequest) {
  // ── Auth gate: admin only ────────────────────────────────────
  const auth = await requireRole(req, 'admin')
  if (auth instanceof Response) return auth
  // ────────────────────────────────────────────────────────────

  try {
    const admin = getAdminClient()

    // Parse query params
    const { searchParams } = new URL(req.url)
    const format = searchParams.get('format') || 'json'  // 'json' or 'csv'
    const table  = searchParams.get('table')  || 'all'
    const from   = searchParams.get('from')             // ISO date
    const to     = searchParams.get('to')               // ISO date

    const tables = table === 'all'
      ? ['patients', 'encounters', 'prescriptions', 'lab_reports', 'bills', 'patient_allergies', 'appointments']
      : [table]

    const exportData: Record<string, any[]> = {}

    for (const t of tables) {
      try {
        let query = admin.from(t).select('*')

        if (from) query = query.gte('created_at', from)
        if (to)   query = query.lte('created_at', to)

        query = query.order('created_at', { ascending: false })

        const { data, error } = await query
        if (!error && data) exportData[t] = data
      } catch {
        exportData[t] = []
      }
    }

    // Audit the export
    const totalRecords = Object.values(exportData).reduce((s, r) => s + r.length, 0)
    await audit('export', 'patient', undefined, `${table} (${totalRecords} records)`)

    // CSV format
    if (format === 'csv') {
      const csvParts: string[] = []
      for (const [tableName, rows] of Object.entries(exportData)) {
        if (rows.length === 0) continue
        const headers = Object.keys(rows[0])
        csvParts.push(`\n--- ${tableName.toUpperCase()} ---`)
        csvParts.push(headers.join(','))
        for (const row of rows) {
          csvParts.push(headers.map(h => {
            const val = row[h]
            if (val === null || val === undefined) return ''
            const str = typeof val === 'object' ? JSON.stringify(val) : String(val)
            return str.includes(',') || str.includes('"') || str.includes('\n')
              ? `"${str.replace(/"/g, '""')}"`
              : str
          }).join(','))
        }
      }

      return new NextResponse(csvParts.join('\n'), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="nexmedicon-export-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      })
    }

    // JSON format
    const exportBundle = {
      exportedAt: new Date().toISOString(),
      exportedBy: auth.user.email,
      system: 'NexMedicon HMS',
      version: '2.0',
      tables: Object.keys(exportData),
      recordCounts: Object.fromEntries(
        Object.entries(exportData).map(([k, v]) => [k, v.length])
      ),
      data: exportData,
    }

    return new NextResponse(JSON.stringify(exportBundle, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="nexmedicon-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Export failed' }, { status: 500 })
  }
}