/**
 * src/lib/ipd-charge-capture.ts
 *
 * Reusable, DEDUP-SAFE auto-capture of IPD charges.
 *
 * WHY
 *   Clinical events (a MAR dose marked "given", an OT note saved, a lab
 *   order completed) should post a line item to ipd_charges so they appear
 *   on the IPD bill automatically — but they must NEVER double-bill when the
 *   component re-renders, the user re-saves, or a network retry fires.
 *
 * HOW (idempotency)
 *   Each call carries a stable (sourceType, sourceId) pair — e.g.
 *   ('mar', marRowId) or ('ot', otNoteId). We embed a deterministic marker
 *   `src:{sourceType}:{sourceId}` in the charge's `notes` and CHECK FOR AN
 *   EXISTING ROW WITH THAT MARKER before inserting. Re-calls are no-ops.
 *
 * SCHEMA RESILIENCE
 *   Mirrors the IPD billing page: tries the modern ipd_charges shape
 *   (charge_date / description / rate / created_by) and, on a schema-cache
 *   error, falls back to the legacy subset (item_name, no charge_date/rate).
 *
 * USAGE
 *   import { captureIpdCharge } from '@/lib/ipd-charge-capture'
 *   await captureIpdCharge(supabase, {
 *     admissionId, patientId,
 *     category: 'medicine',
 *     description: 'Inj. Ceftriaxone 1g',
 *     amount: 120, quantity: 1,
 *     sourceType: 'mar', sourceId: marRow.id,
 *     createdBy: currentUser,
 *   })
 *   // → { created: true }  on first call
 *   // → { created: false, skipped: true } on every repeat for the same source
 */

export type IPDChargeCategory =
  | 'bed' | 'nursing' | 'doctor_visit' | 'surgical' | 'ot'
  | 'procedure' | 'medicine' | 'investigation' | 'other'

export interface CaptureChargeInput {
  admissionId: string
  patientId?: string | null
  category: IPDChargeCategory
  description: string
  amount: number
  quantity?: number
  /** Defaults to today (IST-ish, yyyy-mm-dd). */
  chargeDate?: string
  /** Stable source identity for dedup, e.g. 'mar' + marRowId. */
  sourceType: string
  sourceId: string
  createdBy?: string | null
  /** Extra free-text appended to notes (the dedup marker is added too). */
  notes?: string | null
}

export interface CaptureChargeResult {
  created: boolean
  skipped: boolean
  id?: string
  error?: string
}

function isSchemaCacheError(err: any): boolean {
  if (!err) return false
  const code = String(err.code || '')
  const msg = String(err.message || '').toLowerCase()
  return (
    code === 'PGRST204' ||
    code === '42703' ||
    msg.includes('schema cache') ||
    (msg.includes('column') && (msg.includes('does not exist') || msg.includes('not found')))
  )
}

function todayStr(): string {
  // yyyy-mm-dd in the runtime's local time; callers may pass chargeDate to override.
  return new Date().toISOString().slice(0, 10)
}

/** Marker embedded in notes for idempotency. */
function sourceMarker(sourceType: string, sourceId: string): string {
  return `src:${String(sourceType).trim()}:${String(sourceId).trim()}`
}

/**
 * Post an ipd_charges row for a clinical event exactly once.
 * `client` is any supabase client (browser or service-role).
 */
export async function captureIpdCharge(
  client: any,
  input: CaptureChargeInput,
): Promise<CaptureChargeResult> {
  const {
    admissionId, patientId = null,
    category, description,
    amount, quantity = 1,
    chargeDate,
    sourceType, sourceId,
    createdBy = null,
    notes = null,
  } = input

  if (!admissionId) return { created: false, skipped: false, error: 'admissionId is required' }
  if (!sourceType || !sourceId) return { created: false, skipped: false, error: 'sourceType and sourceId are required for dedup' }
  const amt = Number(amount) || 0
  if (amt <= 0) {
    // Nothing to bill (e.g. price not found) — skip rather than insert a ₹0 line.
    return { created: false, skipped: true, error: 'amount <= 0; nothing captured' }
  }

  const marker = sourceMarker(sourceType, sourceId)

  // ── 1) DEDUP: has this exact source already produced a charge? ──
  try {
    const { data: existing } = await client
      .from('ipd_charges')
      .select('id, notes')
      .eq('admission_id', admissionId)
      .ilike('notes', `%${marker}%`)
      .limit(1)
      .maybeSingle()
    if (existing?.id) {
      return { created: false, skipped: true, id: existing.id }
    }
  } catch {
    // If the dedup probe fails we DO NOT insert — safer to skip than to
    // risk a duplicate. Caller can retry.
    return { created: false, skipped: true, error: 'dedup check failed; not inserting' }
  }

  const date = chargeDate || todayStr()
  const composedNotes = [notes, marker].filter(Boolean).join(' | ')

  // ── 2) INSERT (modern shape, legacy fallback) ──
  const modernRow: Record<string, any> = {
    admission_id: admissionId,
    patient_id: patientId,
    charge_date: date,
    category,
    description: description?.trim() || 'IPD Charge',
    quantity: Number(quantity) || 1,
    rate: amt / (Number(quantity) || 1),
    amount: amt,
    notes: composedNotes,
    created_by: createdBy,
  }

  try {
    const modern = await client.from('ipd_charges').insert(modernRow).select('id').single()
    if (!modern.error) return { created: true, skipped: false, id: modern.data?.id }

    if (isSchemaCacheError(modern.error)) {
      const legacyRow: Record<string, any> = {
        admission_id: admissionId,
        patient_id: patientId,
        item_name: description?.trim() || 'IPD Charge',
        category,
        amount: amt,
        quantity: Number(quantity) || 1,
        notes: composedNotes,
      }
      const legacy = await client.from('ipd_charges').insert(legacyRow).select('id').single()
      if (!legacy.error) return { created: true, skipped: false, id: legacy.data?.id }
      return { created: false, skipped: false, error: legacy.error.message }
    }

    return { created: false, skipped: false, error: modern.error.message }
  } catch (e: any) {
    return { created: false, skipped: false, error: e?.message || 'insert failed' }
  }
}