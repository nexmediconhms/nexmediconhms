'use client'
/**
 * src/app/ipd/packages/page.tsx
 *
 * IPD Package Admin
 *
 * In-app CRUD for the `ipd_packages` table (previously editable only via SQL):
 *   - List all packages (active + inactive), ordered by sort_order
 *   - Create / edit a package with a line-item editor
 *   - Each item: category, description, quantity, rate → amount (auto qty×rate)
 *   - total_amount is auto-computed from the items (kept consistent with seed)
 *   - Activate / deactivate (is_active) and delete (with confirm)
 *
 * Table shape (ipd_packages):
 *   name, code (unique), category, description, total_amount,
 *   items JSONB [{category, description, quantity, rate, amount}],
 *   room_days, is_active, sort_order
 *
 * RLS already allows authenticated users FOR ALL on ipd_packages.
 */

import { useEffect, useState, useCallback } from 'react'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import {
  Package, Plus, Trash2, Save, X, Edit3, Copy,
  RefreshCw, IndianRupee, CheckCircle, AlertTriangle, Power,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────
type ItemCategory =
  | 'bed' | 'nursing' | 'doctor_visit' | 'surgical' | 'ot'
  | 'procedure' | 'medicine' | 'investigation' | 'other'

interface PackageItem {
  category: ItemCategory
  description: string
  quantity: number
  rate: number
  amount: number
}

interface IPDPackage {
  id?: string
  name: string
  code: string | null
  category: string
  description: string
  total_amount: number
  items: PackageItem[]
  room_days: number
  is_active: boolean
  sort_order: number
}

const ITEM_CATEGORIES: { key: ItemCategory; label: string }[] = [
  { key: 'bed', label: 'Bed Charges' },
  { key: 'nursing', label: 'Nursing Charges' },
  { key: 'doctor_visit', label: 'Doctor Visit' },
  { key: 'surgical', label: 'Surgical Charges' },
  { key: 'ot', label: 'OT Charges' },
  { key: 'procedure', label: 'Procedure Charges' },
  { key: 'medicine', label: 'Medicine / IV' },
  { key: 'investigation', label: 'Investigation' },
  { key: 'other', label: 'Other / Misc' },
]

// Package-level category (free grouping shown on the apply screen)
const PACKAGE_CATEGORIES = ['Obstetric', 'Gynaecology', 'General', 'Surgical', 'Other']

const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`

function emptyItem(): PackageItem {
  return { category: 'bed', description: '', quantity: 1, rate: 0, amount: 0 }
}

function emptyPackage(): IPDPackage {
  return {
    name: '', code: '', category: 'General', description: '',
    total_amount: 0, items: [emptyItem()], room_days: 0,
    is_active: true, sort_order: 0,
  }
}

/** Coerce a raw DB row (items may be JSON string or array) into IPDPackage. */
function normalizePackage(row: any): IPDPackage {
  let items: PackageItem[] = []
  try {
    const raw = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || [])
    items = (Array.isArray(raw) ? raw : []).map((it: any) => ({
      category: (it.category || 'other') as ItemCategory,
      description: String(it.description || ''),
      quantity: Number(it.quantity) || 0,
      rate: Number(it.rate) || 0,
      amount: Number(it.amount) || (Number(it.quantity) || 0) * (Number(it.rate) || 0),
    }))
  } catch { items = [] }
  return {
    id: row.id,
    name: row.name || '',
    code: row.code ?? '',
    category: row.category || 'General',
    description: row.description || '',
    total_amount: Number(row.total_amount) || 0,
    items,
    room_days: Number(row.room_days) || 0,
    is_active: row.is_active !== false,
    sort_order: Number(row.sort_order) || 0,
  }
}

// ── Page ───────────────────────────────────────────────────────
export default function IPDPackagesAdminPage() {
  const [packages, setPackages] = useState<IPDPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [editing, setEditing] = useState<IPDPackage | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: err } = await supabase
      .from('ipd_packages')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (err) {
      setError(`Failed to load packages: ${err.message}`)
      setPackages([])
    } else {
      setPackages((data || []).map(normalizePackage))
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function flash(msg: string) {
    setSuccess(msg)
    setTimeout(() => setSuccess(''), 3500)
  }

  function startNew() {
    setError('')
    setEditing({ ...emptyPackage(), sort_order: (packages.length ? Math.max(...packages.map(p => p.sort_order)) + 1 : 1) })
  }

  function startEdit(p: IPDPackage) {
    setError('')
    // deep clone so cancel discards changes
    setEditing(JSON.parse(JSON.stringify(p)))
  }

  function startDuplicate(p: IPDPackage) {
    setError('')
    const copy: IPDPackage = JSON.parse(JSON.stringify(p))
    delete copy.id
    copy.name = `${copy.name} (Copy)`
    copy.code = copy.code ? `${copy.code}-COPY` : ''
    copy.sort_order = (packages.length ? Math.max(...packages.map(pp => pp.sort_order)) + 1 : 1)
    setEditing(copy)
  }

  async function toggleActive(p: IPDPackage) {
    if (!p.id) return
    const { error: err } = await supabase
      .from('ipd_packages')
      .update({ is_active: !p.is_active, updated_at: new Date().toISOString() })
      .eq('id', p.id)
    if (err) { setError(err.message); return }
    flash(`${p.name} ${!p.is_active ? 'activated' : 'deactivated'}.`)
    load()
  }

  async function remove(p: IPDPackage) {
    if (!p.id) return
    if (!confirm(`Delete package "${p.name}"? This cannot be undone.`)) return
    const { error: err } = await supabase.from('ipd_packages').delete().eq('id', p.id)
    if (err) { setError(err.message); return }
    flash(`Deleted "${p.name}".`)
    if (editing?.id === p.id) setEditing(null)
    load()
  }

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Package className="w-6 h-6 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">IPD Packages</h1>
              <p className="text-sm text-gray-500">Create and manage fixed-price IPD packages.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={load} disabled={loading}
              className="btn-secondary flex items-center gap-2 text-xs disabled:opacity-60">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={startNew}
              className="btn-primary flex items-center gap-2 text-xs">
              <Plus className="w-3.5 h-3.5" /> New Package
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
            <button onClick={() => setError('')} className="ml-auto text-xs underline">Dismiss</button>
          </div>
        )}
        {success && (
          <div className="mb-4 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700 flex items-center gap-2">
            <CheckCircle className="w-4 h-4" /> {success}
          </div>
        )}

        {/* Editor */}
        {editing && (
          <PackageEditor
            value={editing}
            saving={saving}
            existingCodes={packages.filter(p => p.id !== editing.id).map(p => (p.code || '').toLowerCase())}
            onChange={setEditing}
            onCancel={() => setEditing(null)}
            onSave={async (pkg) => {
              setSaving(true); setError('')
              const total = pkg.items.reduce((s, it) => s + (Number(it.amount) || 0), 0)
              const payload: any = {
                name: pkg.name.trim(),
                code: pkg.code?.trim() ? pkg.code.trim() : null,
                category: pkg.category || 'General',
                description: pkg.description?.trim() || null,
                total_amount: total,
                items: pkg.items.map(it => ({
                  category: it.category,
                  description: it.description.trim(),
                  quantity: Number(it.quantity) || 0,
                  rate: Number(it.rate) || 0,
                  amount: Number(it.amount) || 0,
                })),
                room_days: Number(pkg.room_days) || 0,
                is_active: pkg.is_active,
                sort_order: Number(pkg.sort_order) || 0,
                updated_at: new Date().toISOString(),
              }
              let err
              if (pkg.id) {
                const r = await supabase.from('ipd_packages').update(payload).eq('id', pkg.id)
                err = r.error
              } else {
                const r = await supabase.from('ipd_packages').insert(payload)
                err = r.error
              }
              setSaving(false)
              if (err) {
                // Friendly message for the unique-code constraint.
                if ((err as any).code === '23505' || /duplicate|unique/i.test(err.message)) {
                  setError(`A package with code "${pkg.code}" already exists. Use a different code.`)
                } else {
                  setError(`Save failed: ${err.message}`)
                }
                return
              }
              flash(pkg.id ? 'Package updated.' : 'Package created.')
              setEditing(null)
              load()
            }}
          />
        )}

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : packages.length === 0 ? (
          <div className="card p-12 text-center text-gray-400">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="font-medium">No packages yet</p>
            <p className="text-sm mt-1">Click &quot;New Package&quot; to create your first IPD package.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {packages.map(p => (
              <div key={p.id} className={`card p-4 ${p.is_active ? '' : 'opacity-60'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-900">{p.name}</h3>
                      {p.code && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-mono">{p.code}</span>}
                      <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded">{p.category}</span>
                      {p.is_active
                        ? <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">Active</span>
                        : <span className="text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-medium">Inactive</span>}
                    </div>
                    {p.description && <p className="text-xs text-gray-500 mt-1">{p.description}</p>}
                    <p className="text-xs text-gray-400 mt-1">
                      {p.items.length} item{p.items.length !== 1 ? 's' : ''} · {p.room_days} room day{p.room_days !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-lg font-bold text-indigo-700 font-mono">{inr(p.total_amount)}</div>
                    <div className="flex gap-1 mt-2 justify-end">
                      <button onClick={() => startEdit(p)} title="Edit"
                        className="p-1.5 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded">
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => startDuplicate(p)} title="Duplicate"
                        className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => toggleActive(p)} title={p.is_active ? 'Deactivate' : 'Activate'}
                        className="p-1.5 text-gray-500 hover:text-amber-600 hover:bg-amber-50 rounded">
                        <Power className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => remove(p)} title="Delete"
                        className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}

// ── Editor ─────────────────────────────────────────────────────
function PackageEditor({
  value, saving, existingCodes, onChange, onSave, onCancel,
}: {
  value: IPDPackage
  saving: boolean
  existingCodes: string[]
  onChange: (p: IPDPackage) => void
  onSave: (p: IPDPackage) => void
  onCancel: () => void
}) {
  const total = value.items.reduce((s, it) => s + (Number(it.amount) || 0), 0)

  function set<K extends keyof IPDPackage>(key: K, v: IPDPackage[K]) {
    onChange({ ...value, [key]: v })
  }

  function setItem(idx: number, patch: Partial<PackageItem>) {
    const items = value.items.map((it, i) => {
      if (i !== idx) return it
      const next = { ...it, ...patch }
      next.amount = (Number(next.quantity) || 0) * (Number(next.rate) || 0)
      return next
    })
    onChange({ ...value, items })
  }

  function addItem() {
    onChange({ ...value, items: [...value.items, emptyItem()] })
  }

  function removeItem(idx: number) {
    onChange({ ...value, items: value.items.filter((_, i) => i !== idx) })
  }

  const nameInvalid = !value.name.trim()
  const codeDup = !!value.code?.trim() && existingCodes.includes(value.code.trim().toLowerCase())
  const canSave = !nameInvalid && !codeDup && value.items.length > 0 && !saving

  return (
    <div className="card p-5 mb-5 border-l-4 border-indigo-400">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">{value.id ? 'Edit Package' : 'New Package'}</h3>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
      </div>

      {/* Header fields */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div className="col-span-2">
          <label className="label">Package Name *</label>
          <input className="input" value={value.name} placeholder="e.g. Normal Delivery Package"
            onChange={e => set('name', e.target.value)} />
          {nameInvalid && <p className="text-xs text-red-500 mt-1">Name is required.</p>}
        </div>
        <div>
          <label className="label">Code</label>
          <input className="input font-mono" value={value.code || ''} placeholder="PKG-XYZ"
            onChange={e => set('code', e.target.value)} />
          {codeDup && <p className="text-xs text-red-500 mt-1">Code already in use.</p>}
        </div>
        <div>
          <label className="label">Category</label>
          <select className="input" value={value.category} onChange={e => set('category', e.target.value)}>
            {PACKAGE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="col-span-2 sm:col-span-4">
          <label className="label">Description</label>
          <input className="input" value={value.description} placeholder="Short summary of what's included"
            onChange={e => set('description', e.target.value)} />
        </div>
        <div>
          <label className="label">Room Days</label>
          <input className="input" type="number" min="0" value={value.room_days}
            onChange={e => set('room_days', Number(e.target.value) || 0)} />
        </div>
        <div>
          <label className="label">Sort Order</label>
          <input className="input" type="number" value={value.sort_order}
            onChange={e => set('sort_order', Number(e.target.value) || 0)} />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-gray-700 pb-2 cursor-pointer">
            <input type="checkbox" checked={value.is_active} onChange={e => set('is_active', e.target.checked)} />
            Active
          </label>
        </div>
      </div>

      {/* Items editor */}
      <div className="mt-2">
        <div className="flex items-center justify-between mb-2">
          <label className="label mb-0">Package Items</label>
          <button onClick={addItem} className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-medium">
            <Plus className="w-3.5 h-3.5" /> Add Item
          </button>
        </div>
        <div className="overflow-x-auto border border-gray-100 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                {['Category', 'Description', 'Qty', 'Rate', 'Amount', ''].map(h => (
                  <th key={h} className="text-left px-2 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {value.items.map((it, idx) => (
                <tr key={idx} className="border-b border-gray-50">
                  <td className="px-2 py-1.5">
                    <select className="input py-1 text-xs" value={it.category}
                      onChange={e => setItem(idx, { category: e.target.value as ItemCategory })}>
                      {ITEM_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5 min-w-[180px]">
                    <input className="input py-1 text-xs" value={it.description} placeholder="Line item"
                      onChange={e => setItem(idx, { description: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5 w-20">
                    <input className="input py-1 text-xs" type="number" min="0" step="0.5" value={it.quantity}
                      onChange={e => setItem(idx, { quantity: Number(e.target.value) || 0 })} />
                  </td>
                  <td className="px-2 py-1.5 w-24">
                    <input className="input py-1 text-xs" type="number" min="0" value={it.rate}
                      onChange={e => setItem(idx, { rate: Number(e.target.value) || 0 })} />
                  </td>
                  <td className="px-2 py-1.5 w-24 font-mono font-semibold text-gray-800">{inr(it.amount)}</td>
                  <td className="px-2 py-1.5">
                    <button onClick={() => removeItem(idx)} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {value.items.length === 0 && (
                <tr><td colSpan={6} className="text-center text-gray-400 text-xs py-4">No items — add at least one.</td></tr>
              )}
              <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold">
                <td colSpan={4} className="px-2 py-2 text-right text-xs text-gray-600 uppercase">Package Total</td>
                <td className="px-2 py-2 font-mono text-indigo-700 flex items-center gap-0.5"><IndianRupee className="w-3.5 h-3.5" />{total.toLocaleString('en-IN')}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-1">Amount = Qty × Rate (auto). Package total is the sum of all items and is saved to <span className="font-mono">total_amount</span>.</p>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 mt-4">
        <button onClick={onCancel} className="btn-secondary text-xs">Cancel</button>
        <button onClick={() => onSave({ ...value, total_amount: total })} disabled={!canSave}
          className="btn-primary flex items-center gap-2 text-xs disabled:opacity-50">
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? 'Saving…' : (value.id ? 'Update Package' : 'Create Package')}
        </button>
      </div>
    </div>
  )
}