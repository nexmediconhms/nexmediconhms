/**
 * src/lib/offline-queue-v2.ts
 *
 * BUG #16 FIX: Offline Queue Conflict Resolution
 *
 * PROBLEM: Original offline-queue.ts syncs queued operations without any
 * conflict detection. If another user modified the same record while this
 * client was offline, the queued UPDATE overwrites their changes silently.
 *
 * SOLUTION: This module wraps the sync operation with:
 *   1. updated_at version checking before applying UPDATEs
 *   2. Conflict detection that returns "conflict" status for manual resolution
 *   3. INSERT operations check for duplicate keys first
 *
 * USAGE:
 *   import { syncWithConflictCheck } from '@/lib/offline-queue-v2'
 *   const result = await syncWithConflictCheck(operation)
 */

import { supabase } from './supabase'

export interface ConflictCheckResult {
  success: boolean
  status: 'synced' | 'conflict' | 'error'
  error?: string
  serverVersion?: string  // The server's updated_at if conflict
  localVersion?: string   // What we expected
}

export interface OfflineOperation {
  table: string
  method: 'INSERT' | 'UPDATE' | 'UPSERT'
  data: Record<string, unknown>
  matchColumn?: string
  matchValue?: string
  /** Timestamp when the operation was queued offline */
  queuedAt: string
  /** The updated_at value we last saw before going offline */
  lastKnownUpdatedAt?: string
}

/**
 * Sync a single offline operation with conflict detection.
 *
 * For UPDATEs:
 *   - Fetches the current server row
 *   - Compares server updated_at with our lastKnownUpdatedAt
 *   - If server version is newer → CONFLICT (another user modified it)
 *   - If server version matches → safe to apply our change
 *
 * For INSERTs:
 *   - Checks if a record with the same primary identifiers already exists
 *   - If exists → skip (idempotent) or conflict
 *   - If not exists → insert normally
 */
export async function syncWithConflictCheck(
  op: OfflineOperation
): Promise<ConflictCheckResult> {
  try {
    if (op.method === 'UPDATE' && op.matchColumn && op.matchValue) {
      return await handleUpdate(op)
    }

    if (op.method === 'INSERT') {
      return await handleInsert(op)
    }

    if (op.method === 'UPSERT') {
      return await handleUpsert(op)
    }

    return { success: false, status: 'error', error: 'Unknown method: ' + op.method }
  } catch (err: any) {
    return { success: false, status: 'error', error: err.message || 'Sync failed' }
  }
}

async function handleUpdate(op: OfflineOperation): Promise<ConflictCheckResult> {
  const { table, data, matchColumn, matchValue, lastKnownUpdatedAt } = op

  // Step 1: Fetch current server version
  const { data: serverRow, error: fetchErr } = await supabase
    .from(table)
    .select('updated_at')
    .eq(matchColumn!, matchValue!)
    .maybeSingle()

  if (fetchErr) {
    return { success: false, status: 'error', error: fetchErr.message }
  }

  if (!serverRow) {
    return { success: false, status: 'error', error: 'Record not found on server' }
  }

  // Step 2: Compare versions
  if (lastKnownUpdatedAt && serverRow.updated_at) {
    const serverTime = new Date(serverRow.updated_at).getTime()
    const knownTime = new Date(lastKnownUpdatedAt).getTime()

    if (serverTime > knownTime) {
      // CONFLICT: Server has a newer version
      return {
        success: false,
        status: 'conflict',
        error: 'Record was modified by another user while you were offline',
        serverVersion: serverRow.updated_at,
        localVersion: lastKnownUpdatedAt,
      }
    }
  }

  // Step 3: Apply the update
  const updateData = { ...data, updated_at: new Date().toISOString() }
  const { error: updateErr } = await supabase
    .from(table)
    .update(updateData)
    .eq(matchColumn!, matchValue!)

  if (updateErr) {
    return { success: false, status: 'error', error: updateErr.message }
  }

  return { success: true, status: 'synced' }
}

async function handleInsert(op: OfflineOperation): Promise<ConflictCheckResult> {
  const { table, data } = op

  // Check for duplicate by ID if provided
  const id = data.id as string | undefined
  if (id) {
    const { data: existing } = await supabase
      .from(table)
      .select('id')
      .eq('id', id)
      .maybeSingle()

    if (existing) {
      // Already exists — idempotent, treat as success
      return { success: true, status: 'synced' }
    }
  }

  const { error: insertErr } = await supabase.from(table).insert(data)

  if (insertErr) {
    // Handle unique constraint violations as conflicts
    if (insertErr.code === '23505') {
      return {
        success: false,
        status: 'conflict',
        error: 'Duplicate record exists on server',
      }
    }
    return { success: false, status: 'error', error: insertErr.message }
  }

  return { success: true, status: 'synced' }
}

async function handleUpsert(op: OfflineOperation): Promise<ConflictCheckResult> {
  const { table, data, matchColumn } = op

  const { error } = await supabase
    .from(table)
    .upsert(data, { onConflict: matchColumn || 'id' })

  if (error) {
    return { success: false, status: 'error', error: error.message }
  }

  return { success: true, status: 'synced' }
}

/**
 * Enhanced enqueue helper that captures updated_at for conflict detection.
 * Use this instead of raw offlineQueue.enqueue() for UPDATE operations.
 */
export function buildOfflineUpdate(
  table: string,
  matchColumn: string,
  matchValue: string,
  data: Record<string, unknown>,
  currentUpdatedAt: string
): OfflineOperation {
  return {
    table,
    method: 'UPDATE',
    data,
    matchColumn,
    matchValue,
    queuedAt: new Date().toISOString(),
    lastKnownUpdatedAt: currentUpdatedAt,
  }
}