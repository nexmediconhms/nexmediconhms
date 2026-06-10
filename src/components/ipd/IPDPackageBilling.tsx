'use client'
/**
 * src/components/ipd/IPDPackageBilling.tsx
 *
 * Package-based billing for IPD admissions.
 * Loads packages from ipd_packages table and auto-adds all items
 * to ipd_charges when a package is selected.
 *
 * Common packages: Normal Delivery, LSCS, Hysterectomy, D&C, Laparoscopy.
 *
 * USAGE: Place at the top of the billing page.
 *   <IPDPackageBilling admissionId="..." onPackageApplied={() => reloadCharges()} />
 */

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { getIndiaToday } from '@/lib/utils'
import {
  Package, Loader2, CheckCircle, AlertCircle,
  IndianRupee, ChevronDown, ChevronUp, Plus,
  Eye, ShoppingBag,
} from 'lucide-react'

interface PackageData {
  id: string
  name: string
  code: string
  category: string
  description: string
  total_amount: number
  room_days: number
  items: PackageItem[]
  is_active: boolean
}

interface PackageItem {
  category: string
  description: string
  quantity: number
  rate: number
  amount: number
}

interface Props {
  admissionId: string
  onPackageApplied?: () => void
}

export default function IPDPackageBilling({ admissionId, onPackageApplied }: Props) {
  const [packages, setPackages] = useState<PackageData[]>([])
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)
  const [error, setError] = useState('')
  const [selectedPkg, setSelectedPkg] = useState<PackageData | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [tableExists, setTableExists] = useState(true)

  useEffect(() => {
    loadPackages()
  }, [])

  async function loadPackages() {
    setLoading(true)
    try {
      const { data, error: err } = await supabase
        .from('ipd_packages')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })

      if (err) {
        if (err.message?.includes('does not exist')) {
          setTableExists(false)
        } else throw err
        setLoading(false)
        return
      }

      const parsed = (data || []).map((p: any) => ({
        ...p,
        items: typeof p.items === 'string' ? JSON.parse(p.items) : (p.items || []),
      }))
      setPackages(parsed)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function applyPackage() {
    if (!selectedPkg) return

    const proceed = window.confirm(
      `Apply "${selectedPkg.name}" package (₹${selectedPkg.total_amount.toLocaleString('en-IN')})?\n\n` +
      `This will add ${selectedPkg.items.length} charge items to the IPD billing.\n` +
      `You can still add, remove, or modify individual items after applying.`
    )
    if (!proceed) return

    setApplying(true)
    setError('')

    try {
      const today = getIndiaToday()
      const chargeRows = selectedPkg.items.map((item) => ({
        admission_id: admissionId,
        charge_date: today,
        category: item.category,
        description: `[${selectedPkg.code}] ${item.description}`,
        item_name: item.description,
        quantity: item.quantity,
        unit_rate: item.rate,
        rate: item.rate,
        amount: item.amount,
        notes: `Package: ${selectedPkg.name}`,
      }))

      const { error: insErr } = await supabase.from('ipd_charges').insert(chargeRows)
      if (insErr) throw insErr

      setApplied(true)
      setShowPreview(false)
      setTimeout(() => setApplied(false), 4000)

      if (onPackageApplied) onPackageApplied()
    } catch (err: any) {
      setError(`Failed to apply package: ${err.message}`)
    } finally {
      setApplying(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading packages...
      </div>
    )
  }

  if (!tableExists) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-700 mb-4">
        <span className="font-medium">Package billing not set up.</span> Run <code className="bg-yellow-100 px-1 rounded">surgery_and_packages_migration.sql</code> in Supabase.
      </div>
    )
  }

  if (packages.length === 0) return null

  // Group by category
  const grouped: Record<string, PackageData[]> = {}
  packages.forEach(p => {
    const cat = p.category || 'General'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(p)
  })

  return (
    <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-4 mb-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-indigo-800 flex items-center gap-2">
          <Package className="w-4 h-4" /> Quick Package Billing
        </h3>
        {applied && (
          <span className="text-xs text-green-600 flex items-center gap-1">
            <CheckCircle className="w-3 h-3" /> Package applied! Charges added below.
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-700 mb-3 flex items-start gap-1">
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* Package cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {Object.entries(grouped).map(([cat, pkgs]) => (
          pkgs.map(pkg => {
            const isSelected = selectedPkg?.id === pkg.id
            return (
              <button
                key={pkg.id}
                onClick={() => { setSelectedPkg(isSelected ? null : pkg); setShowPreview(!isSelected) }}
                className={`text-left p-3 rounded-lg border-2 transition-all ${
                  isSelected
                    ? 'border-indigo-500 bg-white shadow-md'
                    : 'border-gray-200 bg-white hover:border-indigo-300 hover:shadow-sm'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-indigo-500">{cat}</span>
                    <p className="text-sm font-medium text-gray-800 mt-0.5">{pkg.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{pkg.description}</p>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <p className="text-base font-bold text-indigo-700">₹{pkg.total_amount.toLocaleString('en-IN')}</p>
                    <p className="text-[10px] text-gray-400">{pkg.room_days} day{pkg.room_days !== 1 ? 's' : ''} · {pkg.items.length} items</p>
                  </div>
                </div>
              </button>
            )
          })
        ))}
      </div>

      {/* Package preview */}
      {showPreview && selectedPkg && (
        <div className="mt-4 bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <Eye className="w-4 h-4 text-gray-400" /> {selectedPkg.name} — Item Breakdown
            </h4>
            <button onClick={() => setShowPreview(false)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
          </div>

          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 uppercase">
              <tr>
                <th className="text-left p-2">Category</th>
                <th className="text-left p-2">Description</th>
                <th className="text-right p-2">Qty</th>
                <th className="text-right p-2">Rate</th>
                <th className="text-right p-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {selectedPkg.items.map((item, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="p-2"><span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px]">{item.category}</span></td>
                  <td className="p-2 text-gray-700">{item.description}</td>
                  <td className="p-2 text-right text-gray-600">{item.quantity}</td>
                  <td className="p-2 text-right text-gray-600">₹{item.rate.toLocaleString('en-IN')}</td>
                  <td className="p-2 text-right font-medium text-gray-800">₹{item.amount.toLocaleString('en-IN')}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-300 font-semibold text-sm">
                <td colSpan={4} className="p-2 text-right text-gray-700">Package Total:</td>
                <td className="p-2 text-right text-indigo-700">₹{selectedPkg.total_amount.toLocaleString('en-IN')}</td>
              </tr>
            </tbody>
          </table>

          <div className="flex justify-end mt-3">
            <button onClick={applyPackage} disabled={applying}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
              {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingBag className="w-4 h-4" />}
              Apply Package — Add {selectedPkg.items.length} Charges
            </button>
          </div>
        </div>
      )}
    </div>
  )
}