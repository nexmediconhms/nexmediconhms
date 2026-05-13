'use client'
/**
 * src/components/shared/LabMigrationBanner.tsx
 *
 * ═══════════════════════════════════════════════════════════════
 * Displays a persistent warning banner when the browser has
 * lab reports in localStorage that haven't been migrated to
 * Supabase yet.
 *
 * HOW TO USE:
 *   Add to the labs page (src/app/labs/page.tsx):
 *
 *   import LabMigrationBanner from '@/components/shared/LabMigrationBanner'
 *
 *   // Inside the page JSX, before the lab list:
 *   <LabMigrationBanner onMigrationComplete={() => loadLabReports()} />
 *
 * BEHAVIOUR:
 *   - On mount, checks detectLocalStorageLabs()
 *   - If pending labs found: shows an amber warning banner with
 *     record count and a "Migrate Now" button
 *   - On click: runs migration, shows progress, shows result
 *   - On success: banner shows green confirmation, hides after 5s
 *   - On partial failure: shows error count, lets user retry
 *   - If already migrated (flag set): renders nothing
 * ═══════════════════════════════════════════════════════════════
 */

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle, Loader2, HardDrive, X } from 'lucide-react'
import {
  detectLocalStorageLabs,
  migrateLocalStorageLabsToSupabase,
  clearMigratedLocalStorageLabs,
  type MigrationResult,
} from '@/lib/lab-migration'

interface Props {
  onMigrationComplete?: () => void
}

type BannerState = 'checking' | 'hidden' | 'pending' | 'migrating' | 'done' | 'error'

export default function LabMigrationBanner({ onMigrationComplete }: Props) {
  const [state,       setState]       = useState<BannerState>('checking')
  const [pendingCount, setPendingCount] = useState(0)
  const [result,      setResult]      = useState<MigrationResult | null>(null)
  const [dismissed,   setDismissed]   = useState(false)

  useEffect(() => {
    // Run detection client-side only (localStorage doesn't exist server-side)
    try {
      const detection = detectLocalStorageLabs()
      if (detection.alreadyDone || !detection.hasPending) {
        setState('hidden')
      } else {
        setPendingCount(detection.count)
        setState('pending')
      }
    } catch {
      setState('hidden')
    }
  }, [])

  async function runMigration() {
    setState('migrating')
    try {
      const migResult = await migrateLocalStorageLabsToSupabase()
      setResult(migResult)

      if (migResult.errors.length === 0) {
        // Full success — clear localStorage after confirmed Supabase upsert
        clearMigratedLocalStorageLabs()
        setState('done')
        onMigrationComplete?.()
        // Auto-hide success banner after 6 seconds
        setTimeout(() => setState('hidden'), 6000)
      } else {
        setState('error')
      }
    } catch (e: any) {
      setResult({
        total: pendingCount,
        migrated: 0,
        skipped: 0,
        errors: [{ id: 'unknown', error: e?.message ?? 'Migration failed' }],
        alreadyDone: false,
      })
      setState('error')
    }
  }

  if (state === 'hidden' || state === 'checking' || dismissed) return null

  // ── Pending state ──────────────────────────────────────────
  if (state === 'pending') {
    return (
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900">
            {pendingCount} lab report{pendingCount !== 1 ? 's' : ''} found in browser storage
          </p>
          <p className="text-xs text-amber-700 mt-0.5">
            These records are stored only in this browser. They will be lost if you clear your cache
            or switch devices. Migrate them to your secure database now.
          </p>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={runMigration}
              className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              <HardDrive className="w-3.5 h-3.5" />
              Migrate {pendingCount} Record{pendingCount !== 1 ? 's' : ''} to Database
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="text-xs text-amber-600 hover:underline"
            >
              Remind me later
            </button>
          </div>
        </div>
        <button onClick={() => setDismissed(true)} className="text-amber-400 hover:text-amber-600">
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  // ── Migrating state ────────────────────────────────────────
  if (state === 'migrating') {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
        <Loader2 className="w-5 h-5 text-blue-600 animate-spin flex-shrink-0" />
        <p className="text-sm font-semibold text-blue-900">
          Migrating {pendingCount} record{pendingCount !== 1 ? 's' : ''} to database…
        </p>
      </div>
    )
  }

  // ── Success state ──────────────────────────────────────────
  if (state === 'done' && result) {
    return (
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 p-4">
        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-green-900">
            Migration complete!
          </p>
          <p className="text-xs text-green-700 mt-0.5">
            {result.migrated} record{result.migrated !== 1 ? 's' : ''} successfully saved to your
            secure database. {result.skipped > 0 ? `${result.skipped} skipped (incomplete data).` : ''}
          </p>
        </div>
      </div>
    )
  }

  // ── Error / partial failure state ─────────────────────────
  if (state === 'error' && result) {
    return (
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
        <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-red-900">
            Migration partially failed
          </p>
          <p className="text-xs text-red-700 mt-0.5">
            {result.migrated} migrated, {result.errors.length} failed.
            {result.errors[0] ? ` Error: ${result.errors[0].error}` : ''}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={runMigration}
              className="text-xs font-semibold text-red-700 underline hover:no-underline"
            >
              Retry Migration
            </button>
            <span className="text-red-300">|</span>
            <button
              onClick={() => setDismissed(true)}
              className="text-xs text-red-600 hover:underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    )
  }

  return null
}