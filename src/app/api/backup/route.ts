/**
 * src/app/api/backup/route.ts  — UPDATED
 *
 * CHANGE: Added requireRole('admin') guard at the top of both POST and GET.
 * Everything else is the original code — backup logic, table list, backup_log,
 * file size computation, response headers — all preserved exactly.
 *
 * Original: no auth check on POST (cron secret only) and manual Bearer check on GET.
 * Updated: both paths now also accept Bearer JWT via requireRole(), so the UI
 * "Trigger Backup" button works without needing a cron secret.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/api-auth'

const BACKUP_TABLES = [
  'patients',
  'encounters',
  'prescriptions',
  'lab_reports',
  'bills',
  'patient_allergies',
  'clinic_users',
  'clinic_settings',
  'appointments',
  'beds',
  'discharge_summaries',
  'audit_log',
  'critical_alerts',
  'consultation_templates',
  'data_retention_policies',
]

export async function POST(req: NextRequest) {
  try {
    const admin = getAdminClient()

    // ── Auth: accept cron secret OR admin JWT ─────────────────
    const cronSecret = req.headers.get('x-cron-secret')
    const authHeader = req.headers.get('authorization')

    let isAuthorized = false
    let initiatedBy: string | null = null

    // Check cron secret (for automated backups via Vercel Cron)
    if (cronSecret && cronSecret === process.env.CRON_SECRET) {
      isAuthorized = true
      initiatedBy = 'automated-cron'
    }
    // Check admin JWT via requireRole (for UI-triggered backups)
    else if (authHeader?.startsWith('Bearer ')) {
      const authResult = await requireRole(req, 'admin')
      if (!(authResult instanceof Response)) {
        isAuthorized = true
        initiatedBy = authResult.clinicUser.id
      }
    }

    if (!isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized — admin or cron access required' }, { status: 401 })
    }

    // Log backup start
    const { data: backupLog } = await admin
      .from('backup_log')
      .insert({
        backup_type: initiatedBy === 'automated-cron' ? 'full' : 'manual',
        status: 'started',
        tables_included: BACKUP_TABLES,
        initiated_by: initiatedBy !== 'automated-cron' ? initiatedBy : null,
      })
      .select('id')
      .single()

    // Fetch all tables
    const backupData: Record<string, any[]> = {}
    let totalRecords = 0

    for (const table of BACKUP_TABLES) {
      try {
        const { data, error } = await admin
          .from(table)
          .select('*')
          .order('created_at', { ascending: false })

        if (!error && data) {
          backupData[table] = data
          totalRecords += data.length
        } else {
          backupData[table] = []
        }
      } catch {
        backupData[table] = []
      }
    }

    const backup = {
      metadata: {
        createdAt: new Date().toISOString(),
        system: 'NexMedicon HMS',
        version: '2.0',
        type: 'full-backup',
        tables: BACKUP_TABLES,
        recordCounts: Object.fromEntries(
          Object.entries(backupData).map(([k, v]) => [k, v.length])
        ),
        totalRecords,
      },
      data: backupData,
    }

    const jsonStr   = JSON.stringify(backup)
    const sizeBytes = new Blob([jsonStr]).size

    // Update backup log
    if (backupLog?.id) {
      await admin
        .from('backup_log')
        .update({
          status: 'completed',
          record_count: totalRecords,
          file_size_bytes: sizeBytes,
          completed_at: new Date().toISOString(),
        })
        .eq('id', backupLog.id)
    }

    return new NextResponse(jsonStr, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="nexmedicon-backup-${new Date().toISOString().slice(0, 10)}.json"`,
        'X-Backup-Records': String(totalRecords),
        'X-Backup-Size': String(sizeBytes),
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Backup failed' }, { status: 500 })
  }
}

/**
 * GET — List recent backups (admin only)
 */
export async function GET(req: NextRequest) {
  // ── Auth gate ────────────────────────────────────────────────
  const auth = await requireRole(req, 'admin')
  if (auth instanceof Response) return auth
  // ────────────────────────────────────────────────────────────

  try {
    const admin = getAdminClient()

    const { data: backups } = await admin
      .from('backup_log')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(20)

    return NextResponse.json({ backups: backups || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}