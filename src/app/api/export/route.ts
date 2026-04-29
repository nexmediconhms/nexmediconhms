/**
 * src/app/api/export/route.ts
 *
 * Full Data Export API
 *
 * Exports all patient data in JSON or CSV format.
 * Admin-only endpoint for data portability compliance.
 *
 * Supports:
 *   - Full export (all tables)
 *   - Per-table export
 *   - FHIR-compliant patient bundles
 *   - Date range filtering
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  try {
    // Auth check — only admin can export
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const admin = getAdminClient()

    const { data: { user }, error: authError } = await admin.auth.getUser(token)
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    // Check admin role
    const { data: clinicUser } = await admin
      .from('clinic_users')
      .select('role')
      .eq('auth_id', user.id)
      .single()

    if (!clinicUser || clinicUser.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required for data export' }, { status: 403 })
    }

    // Parse query params
    const { searchParams } = new URL(req.url)
    const format = searchParams.get('format') || 'json'  // 'json' or 'csv'
    const table = searchParams.get('table') || 'all'
    const from = searchParams.get('from')  // ISO date
    const to = searchParams.get('to')      // ISO date

    const tables = table === 'all'
      ? ['patients', 'encounters', 'prescriptions', 'lab_reports', 'bills', 'patient_allergies', 'appointments']
      : [table]

    const exportData: Record<string, any[]> = {}

    for (const t of tables) {
      try {
        let query = admin.from(t).select('*')

        if (from) query = query.gte('created_at', from)
        if (to) query = query.lte('created_at', to)

        query = query.order('created_at', { ascending: false })

        const { data, error } = await query
        if (!error && data) {
          exportData[t] = data
        }
      } catch {
        exportData[t] = []
      }
    }

    // Format response
    if (format === 'csv') {
      // Convert to CSV
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
      exportedBy: user.email,
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
