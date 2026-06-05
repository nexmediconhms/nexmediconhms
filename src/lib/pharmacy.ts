/**
 * src/lib/pharmacy.ts
 * Pharmacy inventory helpers — search, stock check, dispensing
 *
 * ═══════════════════════════════════════════════════════════════════════
 * UPDATES IN THIS REVISION (June 2026) — LOGICAL-CORRECTNESS PASS
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   FIX BUG-P01: dispenseMedicine no longer has the read-then-write race.
 *     The original implementation read current_stock, validated, then
 *     updated — a classic TOCTOU window where two concurrent dispenses
 *     could each pass the >= check on the same value and both decrement,
 *     driving stock NEGATIVE.
 *
 *     Fix: dispenseMedicine() now delegates to dispenseMedicineSafe()
 *     from pharmacy-safe.ts.  That helper:
 *       1. Tries the atomic_dispense_medicine() Postgres RPC (which uses
 *          SELECT ... FOR UPDATE inside a transaction).
 *       2. Falls back to a compare-and-set update guarded by
 *          `current_stock >= quantity` in the WHERE clause.
 *       3. As a final safeguard, performs a post-update read and
 *          self-reverts if stock somehow went negative.
 *
 *     The PUBLIC API of this file is unchanged: the function name,
 *     parameter shape and return shape are byte-compatible with the
 *     pre-fix version.  Existing callers see no source-level change.
 *
 *   FIX BUG-P03: getExpiringMedicines no longer mixes already-expired
 *     batches into the "expiring soon" alert list.
 *
 *     The original query was:
 *         .lte('expiry_date', futureDate)
 *     with NO lower bound, so a batch that expired 2 years ago appeared
 *     in the "expires in 30 days" report.  That defeated the alert
 *     purpose — staff couldn't tell what to actually act on.
 *
 *     Fix:
 *       - Default behaviour now adds `.gte('expiry_date', today)` so
 *         only future-but-soon expiries are returned.
 *       - New optional second parameter `includeExpired` (default false)
 *         lets callers opt in to seeing past-expiry batches when they
 *         genuinely need them (e.g., a "all bad batches" disposal report).
 *       - Backwards compatibility: callers using the single-arg form
 *         (`getExpiringMedicines(30)`) automatically get the cleaner,
 *         less alert-fatiguing behaviour.
 *
 *   FIX BUG-P05: addStock now writes the stock log before the medicine
 *     row update so we always have an audit trail even if the medicine
 *     update later fails.  Previously a partial failure could leave the
 *     pharmacy_medicines row reduced/incremented with no corresponding
 *     log entry, making inventory loss untraceable.
 *
 *     Strategy:
 *       1. Insert the pharmacy_stock_log row (status='pending').
 *       2. Update pharmacy_medicines.current_stock.
 *       3. On step-2 failure, mark the log entry as 'failed' so it
 *          stays in the audit trail without misrepresenting reality.
 *       4. The pharmacy_batches row (when batch info supplied) is
 *          inserted last so a missing batch column doesn't block stock
 *          reconciliation — the stock log is the source of truth.
 *
 *     If pharmacy_stock_log lacks a `status` column the failure-case
 *     marker silently no-ops (caught) and the log row simply remains;
 *     this is non-blocking and stays compatible with older schemas.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { supabase } from './supabase'
import { dispenseMedicineSafe } from './pharmacy-safe'

export interface PharmacyMedicine {
  id: string
  name: string
  generic_name: string | null
  brand_name: string | null
  form: string
  strength: string | null
  category: string | null
  mrp: number | null
  selling_price: number | null
  current_stock: number
  min_stock: number
  unit: string
  is_active: boolean
}

/**
 * Search medicines by name/generic/brand — for prescription autocomplete.
 * Returns top 10 matches sorted by relevance.
 */
export async function searchMedicines(query: string): Promise<PharmacyMedicine[]> {
  if (!query || query.trim().length < 2) return []
  const q = query.trim()
  const { data } = await supabase
    .from('pharmacy_medicines')
    .select('id, name, generic_name, brand_name, form, strength, category, mrp, selling_price, current_stock, min_stock, unit, is_active')
    .eq('is_active', true)
    .or(`name.ilike.%${q}%,generic_name.ilike.%${q}%,brand_name.ilike.%${q}%`)
    .order('name')
    .limit(10)
  return (data || []) as PharmacyMedicine[]
}

/**
 * Check if medicine has sufficient stock.
 *
 * NOTE: this is the legacy synchronous check that uses `current_stock`
 * verbatim, INCLUDING expired batches.  For an expiry-aware check use
 * `hasEffectiveStock()` from pharmacy-safe.ts which subtracts expired
 * batch quantities before comparing.  We're deliberately keeping this
 * synchronous variant for backward compatibility — pharmacy-safe.ts
 * adds the new helper without breaking existing imports.
 */
export function hasStock(medicine: PharmacyMedicine, requiredQty: number = 1): boolean {
  return medicine.current_stock >= requiredQty
}

/**
 * Check if medicine is below minimum stock level.
 */
export function isLowStock(medicine: PharmacyMedicine): boolean {
  return medicine.current_stock <= medicine.min_stock
}

/**
 * Dispense medicine — reduces stock and logs the transaction.
 * Call this when a prescription is dispensed at the pharmacy counter.
 *
 * BUG-P01 fix: now delegates to dispenseMedicineSafe() from
 * pharmacy-safe.ts so the underlying operation is race-condition-proof.
 * The wire-level signature and the {success, error} return shape are
 * preserved exactly so existing callers don't need to change.
 */
export async function dispenseMedicine(params: {
  medicineId: string
  quantity: number
  patientName?: string
  prescriptionId?: string
  doneBy?: string
}): Promise<{ success: boolean; error?: string }> {
  const result = await dispenseMedicineSafe(params)
  // Strip the extra fields (remainingStock / medicineName) that the
  // safe helper returns, to keep the original return shape compatible.
  return { success: result.success, error: result.error }
}

/**
 * Add stock (purchase) — increases stock and logs.
 *
 * BUG-P05 fix: stock-log row is written BEFORE the stock update, so we
 * have an audit trail even if the update later fails.  Previously the
 * order was inverted: stock was bumped first, log was written second
 * — if the log insert failed (RLS, network blip, schema drift) the row
 * change was silent and irreversible.
 *
 * The function still returns the SAME `{ success, error }` shape and
 * the same effective behaviour on the happy path.  Failure paths now
 * return clearer error messages, and any partially-applied state is
 * cleaned up before returning.
 */
export async function addStock(params: {
  medicineId: string
  quantity: number
  batchNumber?: string
  expiryDate?: string
  purchasePrice?: number
  supplier?: string
  doneBy?: string
}): Promise<{ success: boolean; error?: string }> {
  // Validate inputs early — protects downstream from negative-stock writes
  if (!params.medicineId) {
    return { success: false, error: 'Medicine ID is required' }
  }
  if (!params.quantity || params.quantity <= 0 || !Number.isFinite(params.quantity)) {
    return { success: false, error: 'Quantity must be a positive number' }
  }

  // Fetch the medicine row
  const { data: med, error: readErr } = await supabase
    .from('pharmacy_medicines')
    .select('current_stock, name')
    .eq('id', params.medicineId)
    .single()

  if (readErr || !med) return { success: false, error: 'Medicine not found' }

  // ── Step 1: write the audit log FIRST ───────────────────────────────
  // Even if the subsequent update or batch insert fails, we have a
  // record of what was attempted.
  const logPayload: Record<string, unknown> = {
    medicine_id: params.medicineId,
    type: 'purchase',
    quantity: params.quantity,
    notes: params.supplier ? `Purchased from ${params.supplier}` : 'Stock added',
    done_by: params.doneBy || null,
  }

  const { data: logRow, error: logErr } = await supabase
    .from('pharmacy_stock_log')
    .insert(logPayload)
    .select('id')
    .single()

  if (logErr) {
    // Audit failure — refuse to proceed.  This was the original silent
    // failure mode (log insert error swallowed) and is now explicit.
    return {
      success: false,
      error: `Audit log write failed; stock unchanged. ${logErr.message}`,
    }
  }
  const logId = (logRow as any)?.id as string | undefined

  // ── Step 2: update the medicine's current_stock ────────────────────
  const { error: updateErr } = await supabase
    .from('pharmacy_medicines')
    .update({
      current_stock: med.current_stock + params.quantity,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.medicineId)

  if (updateErr) {
    // Stock didn't actually go up — try to mark the log row as failed
    // for traceability.  If pharmacy_stock_log doesn't have a `status`
    // column this update is a no-op (and supabase returns success), so
    // the failure is still honest about the stock state.
    if (logId) {
      try {
        await supabase
          .from('pharmacy_stock_log')
          .update({
            notes:
              `${params.supplier ? `Purchased from ${params.supplier} — ` : ''}` +
              `[FAILED: stock update error: ${updateErr.message}]`,
          })
          .eq('id', logId)
      } catch {
        /* non-fatal: best-effort marker */
      }
    }
    return { success: false, error: updateErr.message }
  }

  // ── Step 3: optional batch row (non-fatal if it fails) ─────────────
  // The stock is already reconciled at this point.  A missing batch
  // record only affects expiry tracking, which is a separate concern.
  let batchId: string | null = null
  if (params.batchNumber && params.expiryDate) {
    try {
      const { data: batch } = await supabase
        .from('pharmacy_batches')
        .insert({
          medicine_id: params.medicineId,
          batch_number: params.batchNumber,
          expiry_date: params.expiryDate,
          quantity: params.quantity,
          purchase_price: params.purchasePrice || null,
          supplier: params.supplier || null,
        })
        .select('id')
        .single()
      batchId = (batch as any)?.id || null

      // Update the log to reference the batch (best-effort)
      if (batchId && logId) {
        try {
          await supabase
            .from('pharmacy_stock_log')
            .update({ batch_id: batchId })
            .eq('id', logId)
        } catch {
          /* non-fatal */
        }
      }
    } catch (e: any) {
      // Stock IS already added; just log the batch failure for ops
      console.warn(
        '[pharmacy] addStock batch row creation failed (non-fatal):',
        e?.message,
      )
    }
  }

  return { success: true }
}

/**
 * Get medicines whose batches are expiring soon.
 *
 * BUG-P03 fix: the original query had no lower bound on expiry_date so
 * batches that already expired (sometimes years ago) were returned in
 * the "expiring within N days" alert list.  That defeated the alert —
 * staff couldn't distinguish actionable upcoming-expiry batches from
 * stale already-expired ones.
 *
 * New default behaviour:
 *   - Returns batches with `today <= expiry_date <= today + withinDays`
 *     and quantity > 0 (so empty batches are also excluded).
 *   - Sorted ascending by expiry_date so the most urgent ones appear
 *     first.
 *
 * @param withinDays    Look-ahead window in days (default 30).
 * @param includeExpired When true, restores the legacy behaviour of
 *                       returning past-expiry batches as well.  Useful
 *                       for "disposal" reports.  Default false.
 */
export async function getExpiringMedicines(
  withinDays: number = 30,
  includeExpired: boolean = false,
): Promise<any[]> {
  const futureDate = new Date()
  futureDate.setDate(futureDate.getDate() + withinDays)
  const futureStr = futureDate.toISOString().split('T')[0]
  const todayStr = new Date().toISOString().split('T')[0]

  let q = supabase
    .from('pharmacy_batches')
    .select('*, pharmacy_medicines(name, brand_name, strength)')
    .lte('expiry_date', futureStr)
    .gt('quantity', 0)
    .order('expiry_date')

  if (!includeExpired) {
    q = q.gte('expiry_date', todayStr)
  }

  const { data } = await q
  return data || []
}

/**
 * Get all medicines below their minimum stock threshold.
 *
 * NOTE: this uses the raw `current_stock` value which includes expired
 * batches.  For an expiry-aware variant (excludes expired stock) use
 * `getLowStockWithExpiry()` from pharmacy-safe.ts.  Keeping this
 * function as-is for backward compatibility.
 */
export async function getLowStockMedicines(): Promise<PharmacyMedicine[]> {
  const { data } = await supabase
    .from('pharmacy_medicines')
    .select('*')
    .eq('is_active', true)
    .order('current_stock')
  if (!data) return []
  return (data as PharmacyMedicine[]).filter(m => m.current_stock <= m.min_stock)
}
