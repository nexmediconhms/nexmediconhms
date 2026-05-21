/**
 * src/lib/bill-versioning.ts
 *
 * Immutable Bill Version Tracking
 *
 * ARCHITECTURE:
 *   - Before ANY bill modification, a full snapshot is saved to `bill_versions` table
 *   - Each version has: version_number, full bill JSON, modifier info, reason, timestamp
 *   - The `bills` table always holds the CURRENT (latest) state
 *   - Version history is append-only — no updates or deletes allowed
 *   - Patient statements can be reconstructed from any version
 *
 * SETUP:
 *   Run the SQL migration below in Supabase SQL Editor to create the table:
 *
 *   CREATE TABLE IF NOT EXISTS bill_versions (
 *     id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
 *     bill_id UUID NOT NULL,
 *     version_number INTEGER NOT NULL DEFAULT 1,
 *     snapshot JSONB NOT NULL,
 *     modified_by TEXT NOT NULL,
 *     modification_type TEXT NOT NULL,
 *     reason TEXT NOT NULL,
 *     previous_amount NUMERIC(10,2),
 *     new_amount NUMERIC(10,2),
 *     created_at TIMESTAMPTZ DEFAULT NOW(),
 *     UNIQUE(bill_id, version_number)
 *   );
 *
 *   CREATE INDEX idx_bill_versions_bill_id ON bill_versions(bill_id);
 *   CREATE INDEX idx_bill_versions_created ON bill_versions(created_at DESC);
 *
 *   -- RLS: Only admin can view bill versions
 *   ALTER TABLE bill_versions ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "Admin can view bill versions" ON bill_versions
 *     FOR SELECT USING (is_admin());
 *   CREATE POLICY "Authenticated users can insert bill versions" ON bill_versions
 *     FOR INSERT WITH CHECK (is_active_user());
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
 * Call this in AdminBillModify BEFORE the update query.
 *
 * @param billId - The bill UUID being modified
 * @param currentBill - The FULL current bill object (snapshot)
 * @param modifier - Who is making the change (user full_name)
 * @param modificationType - 'discount' | 'tax' | 'amount' | 'items' | 'status'
 * @param reason - Why the modification is being made
 * @param newAmount - The new net_amount after modification
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

  try {
    // Get the next version number for this bill
    const { data: existing, error: countError } = await supabase
      .from('bill_versions')
      .select('version_number')
      .eq('bill_id', billId)
      .order('version_number', { ascending: false })
      .limit(1)

    const nextVersion = (existing?.[0]?.version_number || 0) + 1

    // Insert the version snapshot
    const { error: insertError } = await supabase
      .from('bill_versions')
      .insert({
        bill_id: billId,
        version_number: nextVersion,
        snapshot: currentBill, // Full bill object as JSON
        modified_by: modifier,
        modification_type: modificationType,
        reason: reason,
        previous_amount: Number(currentBill.net_amount || currentBill.total || 0),
        new_amount: newAmount,
      })

    if (insertError) {
      // Table might not exist yet — log warning but don't block the modification
      console.warn('[BillVersioning] Insert failed:', insertError.message)

      // If table doesn't exist, fall back gracefully
      if (insertError.message?.includes('relation') || insertError.code === '42P01') {
        console.warn('[BillVersioning] bill_versions table not found. Run the migration SQL.')
        return { success: false, versionNumber: 0, error: 'Table not found — run migration' }
      }

      return { success: false, versionNumber: 0, error: insertError.message }
    }

    return { success: true, versionNumber: nextVersion }
  } catch (err: any) {
    console.error('[BillVersioning] Error:', err)
    return { success: false, versionNumber: 0, error: err.message }
  }
}

/**
 * Get all version history for a specific bill.
 * Used in the admin bill detail view to show audit trail.
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
export async function getBillAtVersion(billId: string, versionNumber: number): Promise<Record<string, any> | null> {
  const { data, error } = await supabase
    .from('bill_versions')
    .select('snapshot')
    .eq('bill_id', billId)
    .eq('version_number', versionNumber)
    .single()

  if (error || !data) return null
  return data.snapshot
}