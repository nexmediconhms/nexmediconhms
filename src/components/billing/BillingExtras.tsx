'use client'
/**
 * src/components/billing/BillingExtras.tsx
 * D. Billing → GST + Package Billing
 *
 * Drop these two components into billing/page.tsx.
 *
 * USAGE in billing/page.tsx:
 *
 *   import { GSTSelector, PackageSelector } from '@/components/billing/BillingExtras'
 *
 *   // Add to state:
 *   const [gstPercent,  setGstPercent]  = useState(0)
 *   const [gstAmount,   setGstAmount]   = useState(0)
 *   const [packageId,   setPackageId]   = useState('')
 *   const [packageName, setPackageName] = useState('')
 *
 *   // In your JSX form, beside the Discount field:
 *   <GSTSelector gstPercent={gstPercent} subtotalAfterDiscount={subtotal - discount}
 *                onChange={(pct, amt) => { setGstPercent(pct); setGstAmount(amt) }} />
 *
 *   // Package picker (replaces or supplements manual item entry):
 *   <PackageSelector
 *     onSelect={(pkg) => {
 *       setItems(pkg.items)
 *       setPackageId(pkg.id)
 *       setPackageName(pkg.name)
 *     }}
 *   />
 *
 *   // In your Supabase insert/update add:
 *   gst_percent: gstPercent, gst_amount: gstAmount,
 *   package_id: packageId || null, package_name: packageName || null,
 */

import { useEffect, useState } from 'react'
import { supabase }            from '@/lib/supabase'
import { loadPackages, GST_RATES, calculateTotals } from '@/lib/billing-gst'
import type { BillingPackage } from '@/lib/billing-gst'
import { Package, ChevronDown, ChevronUp, Info } from 'lucide-react'

// ── GST Selector ──────────────────────────────────────────────

interface GSTSelectorProps {
  gstPercent:              number
  subtotalAfterDiscount:   number
  onChange: (percent: number, amount: number) => void
}

export function GSTSelector({ gstPercent, subtotalAfterDiscount, onChange }: GSTSelectorProps) {
  function handleChange(pct: number) {
    const amt = Math.round((subtotalAfterDiscount * pct / 100) * 100) / 100
    onChange(pct, amt)
  }

  return (
    <div>
      <label className="label flex items-center gap-1.5">
        GST
        <span className="text-xs font-normal text-gray-400">(most medical = 0%)</span>
      </label>
      <select
        className="input"
        value={gstPercent}
        onChange={e => handleChange(Number(e.target.value))}
      >
        {GST_RATES.map(r => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>

      {gstPercent > 0 && (
        <div className="mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"/>
          <span>
            GST ₹{(subtotalAfterDiscount * gstPercent / 100).toFixed(2)} will be added.
            Most medical consultation services are GST-exempt under HSN 9993.
            Apply GST only for cosmetic, wellness, or non-medical services.
          </span>
        </div>
      )}
    </div>
  )
}

// ── Package Selector ──────────────────────────────────────────

interface PackageSelectorProps {
  onSelect: (pkg: BillingPackage) => void
}

const CATEGORY_LABELS: Record<string, string> = {
  maternity: '🤱 Maternity',
  anc:       '🩺 ANC',
  surgery:   '⚕️ Surgery',
  general:   '📋 General',
}

export function PackageSelector({ onSelect }: PackageSelectorProps) {
  const [packages,  setPackages]  = useState<BillingPackage[]>([])
  const [loading,   setLoading]   = useState(false)
  const [open,      setOpen]      = useState(false)
  const [selected,  setSelected]  = useState<BillingPackage | null>(null)

  async function fetchPackages() {
    setLoading(true)
    const pkgs = await loadPackages()
    setPackages(pkgs)
    setLoading(false)
  }

  useEffect(() => { fetchPackages() }, [])

  function pick(pkg: BillingPackage) {
    setSelected(pkg)
    setOpen(false)
    onSelect(pkg)
  }

  const categories = Array.from(new Set(packages.map(p => p.category)))

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-sm text-indigo-700 font-medium hover:underline"
      >
        <Package className="w-4 h-4"/>
        {selected ? `Package: ${selected.name}` : 'Apply a billing package'}
        {open ? <ChevronUp className="w-3.5 h-3.5"/> : <ChevronDown className="w-3.5 h-3.5"/>}
      </button>

      {open && (
        <div className="mt-2 border border-gray-200 rounded-xl shadow-md bg-white overflow-hidden">
          {loading ? (
            <p className="px-4 py-3 text-sm text-gray-400">Loading packages…</p>
          ) : packages.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-400">
              No packages set up. Add them in Supabase → billing_packages table.
            </p>
          ) : (
            categories.map(cat => (
              <div key={cat}>
                <div className="px-4 py-2 text-xs font-semibold text-gray-500 bg-gray-50 border-b border-gray-100">
                  {CATEGORY_LABELS[cat] ?? cat}
                </div>
                {packages.filter(p => p.category === cat).map(pkg => (
                  <button
                    key={pkg.id}
                    type="button"
                    onClick={() => pick(pkg)}
                    className="w-full text-left px-4 py-3 hover:bg-indigo-50 border-b border-gray-100 last:border-0 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-gray-900">{pkg.name}</span>
                      <span className="font-semibold text-indigo-700 text-sm">₹{pkg.total.toLocaleString('en-IN')}</span>
                    </div>
                    {pkg.description && (
                      <p className="text-xs text-gray-500 mt-0.5">{pkg.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {pkg.items.map((item, i) => (
                        <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                          {item.label} ₹{item.amount.toLocaleString('en-IN')}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── Bill Total Summary (with GST) ─────────────────────────────

interface BillTotalProps {
  subtotal:   number
  discount:   number
  gstPercent: number
  gstAmount:  number
  netAmount:  number
}

export function BillTotalSummary({ subtotal, discount, gstPercent, gstAmount, netAmount }: BillTotalProps) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
      <div className="flex justify-between text-sm text-gray-600">
        <span>Subtotal</span>
        <span>₹{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
      </div>
      {discount > 0 && (
        <div className="flex justify-between text-sm text-green-700">
          <span>Discount</span>
          <span>− ₹{discount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
        </div>
      )}
      {gstPercent > 0 && (
        <>
          <div className="flex justify-between text-sm text-gray-600">
            <span>After discount</span>
            <span>₹{(subtotal - discount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between text-sm text-amber-700">
            <span>GST @ {gstPercent}%</span>
            <span>+ ₹{gstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
        </>
      )}
      <div className="flex justify-between font-bold text-gray-900 border-t border-gray-300 pt-2 text-base">
        <span>Total</span>
        <span>₹{netAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
      </div>
    </div>
  )
}