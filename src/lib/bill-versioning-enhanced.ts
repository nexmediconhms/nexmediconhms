/**
 * FILE: src/lib/bill-versioning-enhanced.ts
 *
 * ISSUE #10 FIX: Bill Versioning — Schema, Race Condition, Statement Propagation
 *
 * PROBLEMS FOUND:
 *   1. bill_versions table migration is in source code comments, not actually run
 *   2. Version number has race condition (two concurrent modifiers read same max)
 *   3. Bill update changes net_amount but NOT total/paid/due columns (stale data)
 *   4. Patient statement (encounters table) is NOT updated with new amount
 *
 * FIX:
 *   1. Migration SQL provided separately (see bill_versions_migration.sql)
 *   2. Use UNIQUE constraint + retry loop for version_number collision
 *   3. Update all bill amount columns atomically
 *   4. Propagate new amount to linked encounters/statements
 *
 * HOW TO USE:
 *   Replace the existing saveBillVersion import in AdminBillModify.tsx:
 *
 *   // OLD:
 *   import { saveBillVersion } from '@/lib/bill-versioning'
 *
 *   // NEW:
 *   import { saveBillVersion, updateBillAmountsAtomic } from '@/lib/bill-versioning-enhanced'
 *
 *   Then, after calling saveBillVersion(), call updateBillAmountsAtomic()
 *   instead of the individual .update() call.
 *
 * WHAT THIS DOES NOT CHANGE:
 *   - Does not modify the bills table schema
 *   - Does not modify AdminBillModify.tsx directly
 *   - Does not change the API contract
 */

import { supabase } from './supabase'

export interface BillVersion {
  id: string
  bill_id: string
  version_number: number
  snapshot: Record<string, any>
  modified_by: string
  modification_type: string
  reason: string
  previous_amount: number
  new_amount: number
  created_at: string
}

/**
 * Save a version snapshot BEFORE modifying a bill.
 *
 * RACE CONDITION FIX:
 *   The original code reads max(version_number) then inserts max+1.
 *   If two users modify the same bill simultaneously, both read the
 *   same max and try to insert the same version_number — one fails
 *   with a UNIQUE constraint violation.
 *
 *   Fix: Retry loop. If insert fails with duplicate key, increment
 *   and retry up to 3 times. The UNIQUE(bill_id, version_number)
 *   constraint guarantees correctness.
 */
export async function saveBillVersion(params: {
  billId: string
  currentBill: Record<string, any>
  modifier: string
  modificationType: string
  reason: string
  newAmount: number
}): Promise<{ success: boolean; versionNumber: number; error?: string }> {
  const { billId, currentBill, modifier, modificationType, reason, newAmount } = params

  const MAX_RETRIES = 3

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Get the next version number
      const { data: existing } = await supabase
        .from('bill_versions')
        .select('version_number')
        .eq('bill_id', billId)
        .order('version_number', { ascending: false })
        .limit(1)

      const nextVersion = (existing?.[0]?.version_number || 0) + 1 + attempt

      // Attempt to insert
      const { error: insertError } = await supabase
        .from('bill_versions')
        .insert({
          bill_id: billId,
          version_number: nextVersion,
          snapshot: currentBill,
          modified_by: modifier,
          modification_type: modificationType,
          reason: reason,
          previous_amount: Number(currentBill.net_amount || currentBill.total || 0),
          new_amount: newAmount,
        })

      if (!insertError) {
        return { success: true, versionNumber: nextVersion }
      }

      // Check if it's a duplicate key error — retry
      if (
        insertError.code === '23505' ||
        insertError.message?.includes('duplicate') ||
        insertError.message?.includes('unique')
      ) {
        console.warn(
          `[BillVersioning] Version ${nextVersion} collision for bill ${billId}, attempt ${attempt + 1}/${MAX_RETRIES}`
        )
        continue // Retry with next version number
      }

      // Table doesn't exist
      if (insertError.message?.includes('relation') || insertError.code === '42P01') {
        console.warn('[BillVersioning] bill_versions table not found. Run the migration SQL.')
        return { success: false, versionNumber: 0, error: 'Table not found — run migration' }
      }

      // Other error — don't retry
      return { success: false, versionNumber: 0, error: insertError.message }

    } catch (err: any) {
      console.error('[BillVersioning] Error:', err)
      if (attempt === MAX_RETRIES - 1) {
        return { success: false, versionNumber: 0, error: err.message }
      }
    }
  }

  return { success: false, versionNumber: 0, error: 'Max retries exceeded' }
}

/**
 * Update ALL bill amount columns atomically.
 *
 * PROBLEM IN ORIGINAL:
 *   AdminBillModify only updates `net_amount` but NOT `total`, `paid`, `due`.
 *   This leaves stale data — the bill detail page shows the old total
 *   but new net_amount, which is confusing and incorrect.
 *
 * FIX:
 *   This function updates all relevant amount fields in a single query,
 *   AND propagates the new amount to linked patient statements.
 */
export async function updateBillAmountsAtomic(params: {
  billId: string
  newNetAmount: number
  newTotal?: number          // If items changed, pass new total
  newDiscount?: number       // New discount amount
  newDiscountPercent?: number
  newTaxAmount?: number
  modifier: string
  reason: string
}): Promise<{ success: boolean; error?: string }> {
  const {
    billId,
    newNetAmount,
    newTotal,
    newDiscount,
    newDiscountPercent,
    newTaxAmount,
    modifier,
    reason,
  } = params

  try {
    // Step 1: Fetch current bill to compute changes
    const { data: bill, error: fetchErr } = await supabase
      .from('bills')
      .select('*')
      .eq('id', billId)
      .single()

    if (fetchErr || !bill) {
      return { success: false, error: 'Bill not found: ' + (fetchErr?.message || 'unknown') }
    }

    // Step 2: Build the update payload — only include changed fields
    const updatePayload: Record<string, any> = {
      net_amount: newNetAmount,
      updated_at: new Date().toISOString(),
    }

    if (newTotal !== undefined) updatePayload.total = newTotal
    if (newDiscount !== undefined) updatePayload.discount_amount = newDiscount
    if (newDiscountPercent !== undefined) updatePayload.discount_percent = newDiscountPercent
    if (newTaxAmount !== undefined) updatePayload.tax_amount = newTaxAmount

    // Recalculate 'due' based on paid amount
    const currentPaid = Number(bill.paid_amount || bill.paid || 0)
    updatePayload.due_amount = Math.max(0, newNetAmount - currentPaid)

    // Update bill status based on payment
    if (currentPaid >= newNetAmount) {
      updatePayload.status = 'paid'
      updatePayload.due_amount = 0
    } else if (currentPaid > 0) {
      updatePayload.status = 'partial'
    }

    // Step 3: Update the bill
    const { error: updateErr } = await supabase
      .from('bills')
      .update(updatePayload)
      .eq('id', billId)

    if (updateErr) {
      return { success: false, error: 'Bill update failed: ' + updateErr.message }
    }

    // Step 4: Propagate to linked patient encounters/statements
    // If the bill is linked to an encounter, update the encounter's billing info
    if (bill.encounter_id) {
      await supabase
        .from('encounters')
        .update({
          bill_amount: newNetAmount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', bill.encounter_id)
        .then(({ error }) => {
          if (error) {
            console.warn('[BillVersioning] Encounter update failed (non-fatal):', error.message)
          }
        })
    }

    // Step 5: Log the modification in audit_log
    await supabase
      .from('audit_log')
      .insert({
        action: 'update',
        entity: 'bills',
        entity_id: billId,
        details: `Bill modified by ${modifier}. Reason: ${reason}. ` +
          `Old amount: ₹${Number(bill.net_amount || 0).toLocaleString('en-IN')} → ` +
          `New amount: ₹${newNetAmount.toLocaleString('en-IN')}. ` +
          `Due: ₹${updatePayload.due_amount.toLocaleString('en-IN')}.`,
      })
      .then(() => { /* non-fatal */ })

    return { success: true }

  } catch (err: any) {
    console.error('[BillVersioning] Atomic update error:', err)
    return { success: false, error: err.message }
  }
}

/**
 * Get all version history for a specific bill.
 */
export async function getBillVersionHistory(billId: string): Promise<BillVersion[]> {
  const { data, error } = await supabase
    .from('bill_versions')
    .select('*')
    .eq('bill_id', billId)
    .order('version_number', { ascending: false })

  if (error) {
    console.warn('[BillVersioning] Fetch failed:', error.message)
    return []
  }

  return (data || []) as BillVersion[]
}

/**
 * Get a specific version of a bill (for reconstruction/comparison).
 */
export async function getBillAtVersion(
  billId: string,
  versionNumber: number
): Promise<Record<string, any> | null> {
  const { data, error } = await supabase
    .from('bill_versions')
    .select('snapshot')
    .eq('bill_id', billId)
    .eq('version_number', versionNumber)
    .single()

  if (error || !data) return null
  return data.snapshot
}