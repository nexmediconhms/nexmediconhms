/**
 * src/lib/lab-migration.ts
 *
 * ═══════════════════════════════════════════════════════════════
 * CRITICAL BUG FIX: Lab data localStorage → Supabase migration.
 *
 * PROBLEM:
 *   The original integration guide said:
 *   "If users have lab reports stored in localStorage, they can
 *    migrate manually: run this in the browser console..."
 *
 *   This created silent data loss:
 *   - Staff switching devices lose all historical lab reports
 *   - Clearing browser cache = losing patient lab history
 *   - No warning shown to users that localStorage data exists
 *   - No automated migration path
 *
 * FIX:
 *   This module provides:
 *
 *   1. detectLocalStorageLabs() — checks if the current browser
 *      has any lab reports in localStorage from the old format.
 *      Call this on the labs page mount.
 *
 *   2. migrateLocalStorageLabsToSupabase() — reads labs from
 *      localStorage, upserts each into Supabase (idempotent via
 *      local_storage_id column), then marks localStorage as migrated.
 *      Returns a migration result with counts and any errors.
 *
 *   3. clearMigratedLocalStorageLabs() — only called AFTER
 *      successful migration. Preserves the "migration done" flag.
 *
 * EDGE CASES:
 *   - Partial migration (network failure midway): safe to re-run.
 *     Uses upsert with local_storage_id to skip already-migrated records.
 *   - Corrupted localStorage data: per-record try/catch, bad records
 *     are logged and skipped without blocking migration of good ones.
 *   - localStorage not available (SSR/private mode): gracefully returns
 *     { hasPending: false }.
 *   - Already migrated: checks MIGRATION_DONE_KEY flag before scanning.
 * ═══════════════════════════════════════════════════════════════
 */

import { supabase } from '@/lib/supabase'

// Keys used in localStorage by the old lab system
const LAB_STORAGE_KEY   = 'lab_reports'          // original key used in old labs page
const MIGRATION_DONE_KEY = 'lab_migration_done_v1' // flag set after successful migration

// ── Types ────────────────────────────────────────────────────

export interface LocalStorageLab {
  id:           string   // local UUID
  patient_id?:  string
  patient_name?: string
  mrn?:         string
  test_name:    string
  result:       string
  unit?:        string
  reference_range?: string
  status?:      string
  notes?:       string
  created_at?:  string
  encounter_id?: string
}

export interface MigrationResult {
  total:     number
  migrated:  number
  skipped:   number
  errors:    { id: string; error: string }[]
  alreadyDone: boolean
}

// ── Helpers ──────────────────────────────────────────────────

function isLocalStorageAvailable(): boolean {
  try {
    const test = '__ls_test__'
    localStorage.setItem(test, '1')
    localStorage.removeItem(test)
    return true
  } catch {
    return false
  }
}

function readLocalStorageLabs(): LocalStorageLab[] {
  try {
    const raw = localStorage.getItem(LAB_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    // Handle both array format and object format
    if (Array.isArray(parsed)) return parsed
    if (typeof parsed === 'object' && parsed !== null) return Object.values(parsed)
    return []
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────────────────
// 1. Detect if migration is needed
// ─────────────────────────────────────────────────────────────

export interface DetectionResult {
  hasPending:  boolean
  count:       number
  alreadyDone: boolean
}

export function detectLocalStorageLabs(): DetectionResult {
  if (!isLocalStorageAvailable()) {
    return { hasPending: false, count: 0, alreadyDone: false }
  }

  const alreadyDone = localStorage.getItem(MIGRATION_DONE_KEY) === 'true'
  if (alreadyDone) {
    return { hasPending: false, count: 0, alreadyDone: true }
  }

  const labs = readLocalStorageLabs()
  return {
    hasPending:  labs.length > 0,
    count:       labs.length,
    alreadyDone: false,
  }
}

// ─────────────────────────────────────────────────────────────
// 2. Run migration: localStorage → Supabase
// ─────────────────────────────────────────────────────────────

export async function migrateLocalStorageLabsToSupabase(
  patientId?: string   // optional: scope migration to one patient
): Promise<MigrationResult> {
  if (!isLocalStorageAvailable()) {
    return { total: 0, migrated: 0, skipped: 0, errors: [], alreadyDone: false }
  }

  const alreadyDone = localStorage.getItem(MIGRATION_DONE_KEY) === 'true'
  if (alreadyDone) {
    return { total: 0, migrated: 0, skipped: 0, errors: [], alreadyDone: true }
  }

  let labs = readLocalStorageLabs()
  if (patientId) {
    labs = labs.filter(l => l.patient_id === patientId)
  }

  const result: MigrationResult = {
    total:       labs.length,
    migrated:    0,
    skipped:     0,
    errors:      [],
    alreadyDone: false,
  }

  if (labs.length === 0) return result

  for (const lab of labs) {
    try {
      // Validate minimum required fields
      if (!lab.test_name || !lab.result) {
        result.skipped++
        continue
      }

      // Upsert using local_storage_id for idempotency
      // If the lab was already migrated in a previous run, this updates it (no-op if unchanged)
      const { error } = await supabase
        .from('lab_reports')
        .upsert(
          {
            local_storage_id:  lab.id,
            patient_id:        lab.patient_id      ?? null,
            patient_name:      lab.patient_name    ?? null,
            mrn:               lab.mrn             ?? null,
            test_name:         lab.test_name,
            result:            lab.result,
            unit:              lab.unit            ?? null,
            reference_range:   lab.reference_range ?? null,
            status:            lab.status          ?? 'final',
            notes:             lab.notes           ?? null,
            encounter_id:      lab.encounter_id    ?? null,
            created_at:        lab.created_at      ?? new Date().toISOString(),
            migrated_from:     'localStorage',
          },
          { onConflict: 'local_storage_id', ignoreDuplicates: false }
        )

      if (error) {
        // If local_storage_id column doesn't exist yet, log but don't crash
        if (error.code === '42703') {
          console.error('[lab-migration] local_storage_id column missing. Run migration SQL first.')
          result.errors.push({ id: lab.id, error: 'Schema not updated. Run v14 migration SQL.' })
          break // No point continuing if schema is wrong
        }
        result.errors.push({ id: lab.id, error: error.message })
      } else {
        result.migrated++
      }
    } catch (e: any) {
      result.errors.push({ id: lab.id ?? 'unknown', error: e?.message ?? 'Unknown error' })
    }
  }

  // Mark migration as done ONLY if all records migrated without errors
  if (result.errors.length === 0 && result.migrated > 0) {
    localStorage.setItem(MIGRATION_DONE_KEY, 'true')
  }

  return result
}

// ─────────────────────────────────────────────────────────────
// 3. Clear localStorage labs after confirmed migration
//    Only call this after verifying records are in Supabase.
// ─────────────────────────────────────────────────────────────

export function clearMigratedLocalStorageLabs(): void {
  if (!isLocalStorageAvailable()) return
  localStorage.removeItem(LAB_STORAGE_KEY)
  localStorage.setItem(MIGRATION_DONE_KEY, 'true')
}