/**
 * src/lib/pharmacy-safe.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * BUG #3 FIX: Race-Condition-Safe Pharmacy Dispensing
 * BUG #11 FIX: Expiry-Aware Stock Calculation
 * ═══════════════════════════════════════════════════════════════════════
 *
 * PROBLEM (Bug #3):
 * The original pharmacy.ts dispenseMedicine() function performs:
 * 1. SELECT current_stock FROM pharmacy_medicines WHERE id = X
 * 2. IF current_stock >= quantity → proceed
 * 3. UPDATE pharmacy_medicines SET current_stock = current_stock - quantity
 *
 * Between steps 1 and 3, another concurrent request from a second pharmacy
 * staff member can ALSO read the same stock value, ALSO pass the check,
 * and ALSO decrement. This is a classic TOCTOU (Time-Of-Check-Time-Of-Use)
 * race condition.
 *
 * Example: Medicine has 5 units. Staff A and Staff B both try to dispense 4.
 * - Staff A reads stock = 5, checks 5 >= 4 ✓, updates to 1
 * - Staff B reads stock = 5 (same moment), checks 5 >= 4 ✓, updates to -3
 * - Result: Stock is now NEGATIVE (-3), which is physically impossible
 *
 * EFFECT OF BUG:
 * - Inventory goes negative in production
 * - Financial reports show phantom dispensing
 * - Patients could be given medicine that doesn't physically exist
 * - Monthly reconciliation shows discrepancies
 *
 * SOLUTION:
 * This file provides `dispenseMedicineSafe()` which calls the database
 * function `atomic_dispense_medicine()` (created in migration 012).
 * That function uses SELECT ... FOR UPDATE to lock the row, ensuring
 * only one dispense can proceed at a time per medicine.
 *
 * If the DB function is not yet deployed (migration hasn't run),
 * this falls back to an optimistic-locking approach using a WHERE clause
 * that checks stock >= quantity in the UPDATE itself. This is not as
 * strong as FOR UPDATE but eliminates the separate read-then-write gap.
 *
 * AFTER FIX:
 * ✅ Stock can NEVER go below zero, even with concurrent pharmacy staff
 * ✅ Second dispense attempt correctly fails with "Insufficient stock"
 * ✅ No changes needed to pharmacy.ts — import this file instead
 * ✅ Falls back gracefully if migration hasn't been applied yet
 *
 * ─────────────────────────────────────────────────────────────────────
 *
 * PROBLEM (Bug #11):
 * hasStock() only checks current_stock >= requiredQty but doesn't
 * consider that some of that stock may be from expired batches.
 * A medicine could show "50 in stock" but 40 of those are expired.
 *
 * EFFECT OF BUG:
 * - Staff dispensing from inventory may give expired medicines
 * - Low-stock alerts don't fire when effective stock is actually low
 * - Regulatory compliance risk (expired medicine dispensing)
 *
 * SOLUTION:
 * getEffectiveStock() calculates stock excluding expired batches.
 * hasEffectiveStock() checks dispensable quantity accurately.
 *
 * AFTER FIX:
 * ✅ Stock display shows "effective" (non-expired) count
 * ✅ Low-stock alerts based on dispensable inventory
 * ✅ Expired batch quantity clearly separated
 *
 * ═══════════════════════════════════════════════════════════════════════
 *
 * USAGE:
 * // Replace: import { dispenseMedicine } from '@/lib/pharmacy'
 * // With:    import { dispenseMedicineSafe } from '@/lib/pharmacy-safe'
 *
 * const result = await dispenseMedicineSafe({
 * medicineId: 'uuid',
 * quantity: 5,
 * patientName: 'Patient Name',
 * prescriptionId: 'rx-uuid',
 * doneBy: 'Staff Name',
 * })
 *
 * if (!result.success) {
 * showError(result.error)
 * }
 */

import { supabase } from './supabase'

// ─── Types ────────────────────────────────────────────────────────────

export interface DispenseParams {
  medicineId: string
  quantity: number
  patientName?: string
  prescriptionId?: string
  doneBy?: string
}

export interface DispenseResult {
  success: boolean
  error?: string
  remainingStock?: number
  medicineName?: string
}

export interface EffectiveStockInfo {
  totalStock: number
  expiredQuantity: number
  effectiveStock: number
  earliestExpiry: string | null
  isLowStock: boolean
  minStock: number
}

// ─── Safe Dispense (Race-Condition Proof) ─────────────────────────────

/**
 * Dispense medicine using atomic database operation.
 *
 * Strategy:
 * 1. Try the atomic DB function (SELECT ... FOR UPDATE in transaction)
 * 2. If function doesn't exist, use optimistic-locking fallback
 *
 * This function is a DROP-IN REPLACEMENT for the original dispenseMedicine()
 * in pharmacy.ts. Same params, same return shape.
 */
export async function dispenseMedicineSafe(params: DispenseParams): Promise<DispenseResult> {
  const { medicineId, quantity, patientName, prescriptionId, doneBy } = params

  // Input validation
  if (!medicineId) {
    return { success: false, error: 'Medicine ID is required' }
  }
  if (!quantity || quantity <= 0) {
    return { success: false, error: 'Quantity must be a positive number' }
  }
  if (!Number.isInteger(quantity)) {
    return { success: false, error: 'Quantity must be a whole number' }
  }

  // ── Strategy 1: Atomic DB function (preferred) ──────────────────────
  try {
    const { data, error } = await supabase.rpc('atomic_dispense_medicine', {
      p_medicine_id: medicineId,
      p_quantity: quantity,
      p_patient_name: patientName || null,
      p_prescription_id: prescriptionId || null,
      p_done_by: doneBy || null,
    })

    if (!error && data) {
      // data is JSONB: { success: bool, error?: string, remaining_stock?: int }
      const result = typeof data === 'string' ? JSON.parse(data) : data
      return {
        success: result.success,
        error: result.error || undefined,
        remainingStock: result.remaining_stock,
        medicineName: result.medicine_name,
      }
    }

    // Check if error is because function doesn't exist (pre-migration)
    const errMsg = error?.message?.toLowerCase() || ''
    const errCode = (error as any)?.code || ''
    if (
      errCode === '42883' ||
      errMsg.includes('does not exist') ||
      errMsg.includes('could not find') ||
      errMsg.includes('function')
    ) {
      // Function not deployed yet — fall through to Strategy 2
      console.info('[pharmacy-safe] atomic_dispense_medicine not available, using fallback')
    } else if (error) {
      // Some other DB error
      return { success: false, error: `Database error: ${error.message}` }
    }
  } catch (rpcErr: any) {
    console.warn('[pharmacy-safe] RPC call failed, using fallback:', rpcErr?.message)
  }

  // ── Strategy 2: Optimistic-locking fallback ─────────────────────────
  // This approach does a conditional UPDATE that checks stock in the WHERE clause.
  // It's not as strong as FOR UPDATE (still has a tiny window) but is FAR better
  // than the original read-check-then-update pattern.
  return await dispenseFallback(params)
}

/**
 * Fallback dispensing using optimistic concurrency control (compare-and-set).
 *
 * BUG-P04 fix: the previous implementation called a generic `exec_sql`
 * RPC with the medicineId interpolated directly into a single-quoted
 * SQL string:
 *
 *     WHERE id = '${medicineId}'
 *       AND current_stock >= ${quantity}
 *
 * That is a textbook SQL-injection sink — a malicious medicineId
 * containing a single quote could break out of the literal and execute
 * arbitrary SQL with whatever role the RPC runs as.  Even with route-
 * level validation that's a footgun we shouldn't keep around, and
 * `exec_sql` itself (a generic-SQL-eval endpoint) shouldn't exist in a
 * production database.
 *
 * The replacement uses Supabase's parameterised query builder via a
 * compare-and-set loop:
 *
 *   1. SELECT current_stock for this medicine.
 *   2. Verify stock >= quantity.
 *   3. UPDATE SET current_stock = old - quantity
 *           WHERE id = :id
 *             AND current_stock = :old              ← the CAS guard
 *   4. If 0 rows were updated, another transaction changed the value
 *      between (1) and (3) — retry with the freshly-read value.
 *
 * Because every concurrent request will read a different "old" value
 * after the first update commits, only one writer per stock value wins.
 * After MAX_RETRIES the function gives up with an explicit "concurrent
 * dispense detected" error rather than blocking forever.
 *
 * No string interpolation into SQL.  All values are bound parameters.
 */
async function dispenseFallback(params: DispenseParams): Promise<DispenseResult> {
  const { medicineId, quantity, patientName, prescriptionId, doneBy } = params

  const MAX_RETRIES = 5

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // 1. Read current stock & name (parameterised)
    const { data: med, error: readErr } = await supabase
      .from('pharmacy_medicines')
      .select('current_stock, name')
      .eq('id', medicineId)
      .single()

    if (readErr || !med) {
      return { success: false, error: 'Medicine not found' }
    }

    const oldStock = Number(med.current_stock) || 0

    // 2. Stock check
    if (oldStock < quantity) {
      return {
        success: false,
        error: `Insufficient stock for ${med.name}. Available: ${oldStock}, Requested: ${quantity}`,
      }
    }

    const newStock = oldStock - quantity

    // 3. Compare-and-set update — only succeeds if current_stock is
    //    still oldStock when this UPDATE runs.  No string interpolation.
    const { data: updated, error: updateErr } = await supabase
      .from('pharmacy_medicines')
      .update({
        current_stock: newStock,
        updated_at: new Date().toISOString(),
      })
      .eq('id', medicineId)
      .eq('current_stock', oldStock)        // ← optimistic lock
      .select('current_stock, name')

    if (updateErr) {
      return { success: false, error: updateErr.message }
    }

    // 4. If 0 rows were affected, another writer beat us — retry.
    if (!updated || updated.length === 0) {
      // Stale read — retry with a fresh SELECT.
      continue
    }

    const row = updated[0]

    // Defensive post-update sanity check: stock should never be negative.
    // If it somehow is (e.g., out-of-band update with no CAS), revert.
    if (Number(row.current_stock) < 0) {
      console.error(
        '[pharmacy-safe] post-CAS negative stock detected, reverting',
      )
      await supabase
        .from('pharmacy_medicines')
        .update({ current_stock: oldStock, updated_at: new Date().toISOString() })
        .eq('id', medicineId)
      return {
        success: false,
        error: `Concurrent dispense detected for ${row.name}. Please try again.`,
      }
    }

    // 5. Log the transaction (audit trail).  This is best-effort: even
    //    if the log insert fails we don't reverse the dispense, but we
    //    DO surface the warning so ops can reconcile.
    const { error: logErr } = await supabase.from('pharmacy_stock_log').insert({
      medicine_id: medicineId,
      type: 'dispense',
      quantity: -quantity,
      reference_id: prescriptionId || null,
      notes: patientName ? `Dispensed to ${patientName}` : 'Dispensed',
      done_by: doneBy || null,
    })
    if (logErr) {
      console.warn(
        '[pharmacy-safe] dispense audit-log insert failed (non-fatal):',
        logErr.message,
      )
    }

    return {
      success: true,
      remainingStock: Number(row.current_stock),
      medicineName: String(row.name),
    }
  }

  // Exhausted retries — declare contention rather than silently failing.
  return {
    success: false,
    error:
      'Could not dispense due to concurrent stock updates after multiple retries. Please try again.',
  }
}

/**
 * Last resort: Read-then-update with immediate re-verification.
 * This matches the original pharmacy.ts logic but adds a secondary
 * verification read after the update to detect races.
 *
 * @deprecated  As of the BUG-P04 fix, dispenseFallback() no longer
 * calls this function — it uses a parameterised compare-and-set loop
 * instead, which closes the TOCTOU window completely.  This routine
 * is retained for backward compatibility only and should not be added
 * to any new call sites.  Slated for removal once all callers (none
 * known at the time of this commit) are confirmed migrated.
 */
async function dispenseLastResort(params: DispenseParams): Promise<DispenseResult> {
  const { medicineId, quantity, patientName, prescriptionId, doneBy } = params

  // Read current stock
  const { data: med, error: readErr } = await supabase
    .from('pharmacy_medicines')
    .select('current_stock, name')
    .eq('id', medicineId)
    .single()

  if (readErr || !med) {
    return { success: false, error: 'Medicine not found' }
  }

  if (med.current_stock < quantity) {
    return {
      success: false,
      error: `Insufficient stock for ${med.name}. Available: ${med.current_stock}, Requested: ${quantity}`,
    }
  }

  // Perform the update
  const newStock = med.current_stock - quantity
  const { error: updateErr } = await supabase
    .from('pharmacy_medicines')
    .update({
      current_stock: newStock,
      updated_at: new Date().toISOString(),
    })
    .eq('id', medicineId)

  if (updateErr) {
    return { success: false, error: updateErr.message }
  }

  // Post-update verification: re-read stock to detect if it went negative
  const { data: afterMed } = await supabase
    .from('pharmacy_medicines')
    .select('current_stock')
    .eq('id', medicineId)
    .single()

  if (afterMed && afterMed.current_stock < 0) {
    // RACE DETECTED! Revert the dispense.
    console.error('[pharmacy-safe] RACE CONDITION DETECTED. Stock went negative. Reverting.')
    await supabase
      .from('pharmacy_medicines')
      .update({
        current_stock: afterMed.current_stock + quantity,
        updated_at: new Date().toISOString(),
      })
      .eq('id', medicineId)

    return {
      success: false,
      error: `Concurrent dispense detected for ${med.name}. Please try again.`,
    }
  }

  // Log the transaction
  await supabase.from('pharmacy_stock_log').insert({
    medicine_id: medicineId,
    type: 'dispense',
    quantity: -quantity,
    reference_id: prescriptionId || null,
    notes: patientName ? `Dispensed to ${patientName}` : 'Dispensed',
    done_by: doneBy || null,
  })

  return {
    success: true,
    remainingStock: newStock,
    medicineName: med.name,
  }
}

// ─── Effective Stock (Expiry-Aware) ───────────────────────────────────

/**
 * Get the effective (dispensable) stock for a medicine, excluding expired batches.
 *
 * This calls the DB function `get_effective_stock()` if available,
 * otherwise computes it client-side from pharmacy_batches.
 */
export async function getEffectiveStock(medicineId: string): Promise<EffectiveStockInfo> {
  // Try DB function first
  try {
    const { data, error } = await supabase.rpc('get_effective_stock', {
      p_medicine_id: medicineId,
    })

    if (!error && data && (Array.isArray(data) ? data.length > 0 : true)) {
      const row = Array.isArray(data) ? data[0] : data

      // Get min_stock for low-stock calculation
      const { data: med } = await supabase
        .from('pharmacy_medicines')
        .select('min_stock')
        .eq('id', medicineId)
        .single()

      const minStock = med?.min_stock || 0
      const effective = row.effective_stock || 0

      return {
        totalStock: row.total_stock || 0,
        expiredQuantity: row.expired_quantity || 0,
        effectiveStock: effective,
        earliestExpiry: row.earliest_expiry || null,
        isLowStock: effective <= minStock,
        minStock,
      }
    }
  } catch {
    // Function not available — fallback to client-side
  }

  // ── Client-side fallback ─────────────────────────────────────────────
  const { data: med } = await supabase
    .from('pharmacy_medicines')
    .select('current_stock, min_stock')
    .eq('id', medicineId)
    .single()

  if (!med) {
    return {
      totalStock: 0,
      expiredQuantity: 0,
      effectiveStock: 0,
      earliestExpiry: null,
      isLowStock: true,
      minStock: 0,
    }
  }

  // Query expired batches
  const today = new Date().toISOString().split('T')[0]
  const { data: expiredBatches } = await supabase
    .from('pharmacy_batches')
    .select('quantity, expiry_date')
    .eq('medicine_id', medicineId)
    .lt('expiry_date', today)
    .gt('quantity', 0)

  const expiredQty = (expiredBatches || []).reduce(
    (sum, b) => sum + (Number(b.quantity) || 0), 0
  )

  const effectiveStock = Math.max(0, med.current_stock - expiredQty)

  // Find earliest expiry among non-expired batches (for alerts)
  const { data: nextExpiry } = await supabase
    .from('pharmacy_batches')
    .select('expiry_date')
    .eq('medicine_id', medicineId)
    .gte('expiry_date', today)
    .gt('quantity', 0)
    .order('expiry_date', { ascending: true })
    .limit(1)

  return {
    totalStock: med.current_stock,
    expiredQuantity: expiredQty,
    effectiveStock,
    earliestExpiry: nextExpiry?.[0]?.expiry_date || null,
    isLowStock: effectiveStock <= (med.min_stock || 0),
    minStock: med.min_stock || 0,
  }
}

/**
 * Check if medicine has sufficient EFFECTIVE (non-expired) stock.
 * Drop-in replacement for hasStock() from pharmacy.ts.
 */
export async function hasEffectiveStock(
  medicineId: string,
  requiredQty: number = 1
): Promise<boolean> {
  const info = await getEffectiveStock(medicineId)
  return info.effectiveStock >= requiredQty
}

/**
 * Get all medicines that are below minimum stock when considering expiry.
 * Enhanced version of getLowStockMedicines() from pharmacy.ts.
 */
export async function getLowStockWithExpiry(): Promise<Array<{
  id: string
  name: string
  currentStock: number
  effectiveStock: number
  expiredQty: number
  minStock: number
  earliestExpiry: string | null
}>> {
  const { data: medicines } = await supabase
    .from('pharmacy_medicines')
    .select('id, name, current_stock, min_stock')
    .eq('is_active', true)
    .order('current_stock', { ascending: true })

  if (!medicines) return []

  const today = new Date().toISOString().split('T')[0]
  const results: Array<{
    id: string
    name: string
    currentStock: number
    effectiveStock: number
    expiredQty: number
    minStock: number
    earliestExpiry: string | null
  }> = []

  for (const med of medicines) {
    const { data: expBatches } = await supabase
      .from('pharmacy_batches')
      .select('quantity, expiry_date')
      .eq('medicine_id', med.id)
      .lt('expiry_date', today)
      .gt('quantity', 0)

    const expiredQty = (expBatches || []).reduce(
      (sum, b) => sum + (Number(b.quantity) || 0), 0
    )
    const effectiveStock = Math.max(0, med.current_stock - expiredQty)

    if (effectiveStock <= (med.min_stock || 0)) {
      const { data: nextExp } = await supabase
        .from('pharmacy_batches')
        .select('expiry_date')
        .eq('medicine_id', med.id)
        .gte('expiry_date', today)
        .gt('quantity', 0)
        .order('expiry_date', { ascending: true })
        .limit(1)

      results.push({
        id: med.id,
        name: med.name,
        currentStock: med.current_stock,
        effectiveStock,
        expiredQty,
        minStock: med.min_stock || 0,
        earliestExpiry: nextExp?.[0]?.expiry_date || null,
      })
    }
  }

  return results
}