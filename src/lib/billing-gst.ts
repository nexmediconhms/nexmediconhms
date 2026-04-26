/**
 * src/lib/billing-gst.ts
 * D. Billing → GST + Package Billing
 *
 * Drop-in helpers used by billing/page.tsx
 * Import these into the existing billing page to add GST + package support.
 *
 * INTEGRATION STEPS for billing/page.tsx:
 *   1. Add `gstPercent`, `gstAmount`, `packageId`, `packageName`, `isPackageBill`
 *      to the Bill interface and useState forms
 *   2. Replace the subtotal/total calculation with `calculateTotals()`
 *   3. Render <GSTSelector> and <PackageSelector> components in the form
 *   4. Pass gst_percent, gst_amount, package_id, package_name to Supabase insert/update
 */

import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────

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

/** Calculate bill totals including GST */
export function calculateTotals(
  subtotal:   number,
  discount:   number,
  gstPercent: number,
): { afterDiscount: number; gstAmount: number; netAmount: number } {
  const afterDiscount = Math.max(0, subtotal - discount)
  const gstAmount     = Math.round((afterDiscount * gstPercent / 100) * 100) / 100
  const netAmount     = afterDiscount + gstAmount
  return { afterDiscount, gstAmount, netAmount }
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

// ── React components (inline JSX — paste into billing/page.tsx) ──

/**
 * GSTSelector — drop into the billing form beside the discount field.
 *
 * <GSTSelector
 *   gstPercent={gstPercent}
 *   onChange={setGstPercent}
 * />
 */
export type GSTSelectorProps = {
  gstPercent: number
  onChange:   (pct: number) => void
}

// JSX version — copy into billing page as an inline component or import from here
export function GSTSelectorMarkup(gstPercent: number, onChange: (v: number) => void) {
  // Returns the JSX string — actual component is in BillingGSTSelector.tsx
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