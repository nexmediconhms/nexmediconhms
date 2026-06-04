/**
 * src/lib/billing-gst.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * FIX: calculateTotals() now delegates to billing-tax-unified.ts
 * BUG #7: Dual tax calculation → single source of truth
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHAT CHANGED:
 *   - calculateTotals() now calls calculateBillTax() internally
 *   - Return shape is identical — no breaking changes
 *   - All other functions (loadPackages, packageToItems, formatGSTLine,
 *     gstInvoiceNote, GSTSelectorMarkup) are UNCHANGED
 *
 * BACKWARD COMPATIBILITY:
 *   Same function signatures, same return types.
 *   Any code importing calculateTotals from this file continues to work.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { supabase } from '@/lib/supabase'
import { calculateBillTax } from '@/lib/billing-tax-unified'

// ── Types (unchanged) ────────────────────────────────────────

export interface BillingPackage {
  id:          string
  name:        string
  description: string | null
  items:       { label: string; amount: number }[]
  total:       number
  is_active:   boolean
  category:    string
}

/** GST exempt categories (most healthcare services in India) */
export const GST_RATES = [
  { label: 'Exempt (0%) — Medical services', value: 0 },
  { label: '5%',   value: 5   },
  { label: '12%',  value: 12  },
  { label: '18%',  value: 18  },
]

/**
 * Calculate bill totals including GST.
 *
 * ═══ FIX: Delegates to billing-tax-unified.ts ═══
 * BEFORE: gstAmount = Math.round((afterDiscount * gstPercent / 100) * 100) / 100
 * AFTER:  Uses calculateBillTax() — single source of truth for all modules
 */
export function calculateTotals(
  subtotal:   number,
  discount:   number,
  gstPercent: number,
): { afterDiscount: number; gstAmount: number; netAmount: number } {
  // Delegate to the unified tax calculation
  const taxBreakdown = calculateBillTax(subtotal, discount, gstPercent)

  return {
    afterDiscount: taxBreakdown.taxableAmount,
    gstAmount:     taxBreakdown.gstAmount,
    netAmount:     taxBreakdown.totalWithTax,
  }
}

/** Load all active billing packages from Supabase */
export async function loadPackages(): Promise<BillingPackage[]> {
  const { data } = await supabase
    .from('billing_packages')
    .select('*')
    .eq('is_active', true)
    .order('category')
    .order('name')
  return (data ?? []) as BillingPackage[]
}

/** Expand a package into individual BillItems for the form */
export function packageToItems(pkg: BillingPackage): { label: string; amount: number }[] {
  return pkg.items.map(item => ({ label: item.label, amount: item.amount }))
}

// ── React components (unchanged) ─────────────────────────────

export type GSTSelectorProps = {
  gstPercent: number
  onChange:   (pct: number) => void
}

export function GSTSelectorMarkup(gstPercent: number, onChange: (v: number) => void) {
  return `
<div>
  <label className="label">GST</label>
  <select
    className="input"
    value={gstPercent}
    onChange={e => onChange(Number(e.target.value))}
  >
    ${GST_RATES.map(r => `<option value={${r.value}}>${r.label}</option>`).join('\n    ')}
  </select>
  {gstPercent > 0 && (
    <p className="text-xs text-amber-700 mt-1">
      Note: Most medical services in India are GST-exempt. Apply only for
      non-medical items (cosmetic, etc.).
    </p>
  )}
</div>`
}

/** Format a GST breakdown line for the bill printout */
export function formatGSTLine(gstPercent: number, gstAmount: number): string {
  if (gstPercent === 0) return ''
  return `GST @ ${gstPercent}%: ₹${gstAmount.toFixed(2)}`
}

/** Generate GSTIN-compliant invoice note */
export function gstInvoiceNote(
  hospitalGSTIN: string | undefined,
  gstPercent:    number,
  gstAmount:     number,
  netAmount:     number,
): string {
  if (gstPercent === 0 || !hospitalGSTIN) return ''
  return [
    `GSTIN: ${hospitalGSTIN}`,
    `Taxable Amount: ₹${(netAmount - gstAmount).toFixed(2)}`,
    `CGST @ ${gstPercent / 2}%: ₹${(gstAmount / 2).toFixed(2)}`,
    `SGST @ ${gstPercent / 2}%: ₹${(gstAmount / 2).toFixed(2)}`,
    `Total GST: ₹${gstAmount.toFixed(2)}`,
    `Invoice Total: ₹${netAmount.toFixed(2)}`,
  ].join('\n')
}
