/**
 * src/app/api/backup/route.ts
 *
 * Automated Backup API
 *
 * Creates a full backup of all critical tables as a downloadable JSON file.
 * Can be triggered:
 *   - Manually by admin from the UI
 *   - Automatically via cron (Vercel Cron or external scheduler)
 *
 * Backup includes:
 *   - All patient records
 *   - All encounters & prescriptions
 *   - Lab reports
 *   - Billing records
 *   - Audit log
 *   - Settings
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'

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

    // Auth check — verify admin or cron secret
    const cronSecret = req.headers.get('x-cron-secret')
    const authHeader = req.headers.get('authorization')

    let isAuthorized = false
    let initiatedBy: string | null = null

    // Check cron secret (for automated backups)
    if (cronSecret && cronSecret === process.env.CRON_SECRET) {
      isAuthorized = true
      initiatedBy = 'automated-cron'
    }
    // Check admin auth
    else if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '')
      const { data: { user } } = await admin.auth.getUser(token)

      if (user) {
        const { data: clinicUser } = await admin
          .from('clinic_users')
          .select('id, role')
          .eq('auth_id', user.id)
          .single()

        if (clinicUser?.role === 'admin') {
          isAuthorized = true
          initiatedBy = clinicUser.id
        }
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

    const jsonStr = JSON.stringify(backup)
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
 * GET — List recent backups
 */
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const admin = getAdminClient()
    const { data: { user } } = await admin.auth.getUser(token)

    if (!user) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const { data: clinicUser } = await admin
      .from('clinic_users')
      .select('role')
      .eq('auth_id', user.id)
      .single()

    if (!clinicUser || clinicUser.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

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
