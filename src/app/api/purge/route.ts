/**
 * src/app/api/purge/route.ts
 *
 * Auto-Purge API — runs on a cron schedule (weekly) or manually from Settings.
 *
 * What it does:
 *   1. Reads all retention policies from `data_retention_policies` table
 *   2. For policies with auto_purge=true, deletes records older than retention_days
 *   3. NEVER purges critical tables: audit_log, patients, encounters, prescriptions, lab_reports, bills
 *   4. Logs the purge action to audit trail
 *
 * Security:
 *   - Requires admin auth (Bearer token) OR Vercel cron secret
 *   - Vercel crons pass the CRON_SECRET header automatically
 *
 * Schedule: Weekly on Sunday at 3:00 AM IST (vercel.json cron)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// Tables that are NEVER auto-purged regardless of policy settings
const NEVER_PURGE = ['audit_log', 'patients', 'encounters', 'prescriptions', 'lab_reports', 'bills']

export async function POST(req: NextRequest) {
  // Auth: accept either admin Bearer token or Vercel cron secret
  const cronSecret = req.headers.get('authorization')
  const isCron = cronSecret === `Bearer ${process.env.CRON_SECRET}`

  if (!isCron) {
    const auth = await requireRole(req, 'admin')
    if (auth instanceof Response) return auth
  }

  try {
    const admin = getAdminClient()

    // Fetch retention policies with auto_purge enabled
    const { data: policies, error: policyError } = await admin
      .from('data_retention_policies')
      .select('*')
      .eq('auto_purge', true)

    if (policyError) {
      return NextResponse.json(
        { error: 'Failed to fetch retention policies', details: policyError.message },
        { status: 500 }
      )
    }

    if (!policies || policies.length === 0) {
      return NextResponse.json({
        message: 'No auto-purge policies enabled',
        purged: [],
        errors: [],
      })
    }

    const purged: { table: string; count: number }[] = []
    const errors: { table: string; error: string }[] = []

    for (const policy of policies) {
      const tableName = policy.entity_type

      // Safety check — never purge critical tables
      if (NEVER_PURGE.includes(tableName)) {
        continue
      }

      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - policy.retention_days)
      const cutoffISO = cutoffDate.toISOString()

      try {
        // Count records eligible for purging
        const { count, error: countError } = await admin
          .from(tableName)
          .select('*', { count: 'exact', head: true })
          .lt('created_at', cutoffISO)

        if (countError) {
          errors.push({ table: tableName, error: countError.message })
          continue
        }

        if (!count || count === 0) continue

        // Delete expired records
        const { error: deleteError } = await admin
          .from(tableName)
          .delete()
          .lt('created_at', cutoffISO)

        if (deleteError) {
          errors.push({ table: tableName, error: deleteError.message })
        } else {
          purged.push({ table: tableName, count })
        }
      } catch (err: any) {
        errors.push({ table: tableName, error: err.message || 'Unknown error' })
      }
    }

    // Audit the purge operation
    const totalPurged = purged.reduce((sum, p) => sum + p.count, 0)
    if (totalPurged > 0 || errors.length > 0) {
      await audit('purge', 'settings', undefined, `Auto-purge: ${totalPurged} records from ${purged.length} tables`, {
        after: { purged, errors, triggeredBy: isCron ? 'cron' : 'manual' },
      })
    }

    return NextResponse.json({
      message: `Purge complete: ${totalPurged} records removed from ${purged.length} tables`,
      triggeredBy: isCron ? 'cron' : 'manual',
      purged,
      errors,
      timestamp: new Date().toISOString(),
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Purge failed' },
      { status: 500 }
    )
  }
}

// GET endpoint for Vercel cron (crons call GET by default)
export async function GET(req: NextRequest) {
  // Only allow from Vercel cron
  const cronSecret = req.headers.get('authorization')
  const isCron = cronSecret === `Bearer ${process.env.CRON_SECRET}`

  if (!isCron) {
    return NextResponse.json(
      { error: 'Unauthorized. This endpoint is for cron jobs only. Use POST with admin auth for manual purge.' },
      { status: 401 }
    )
  }

  // Reuse POST logic
  return POST(req)
}
