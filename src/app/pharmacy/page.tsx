'use client'
/**
 * src/app/pharmacy/page.tsx
 * Pharmacy Inventory Management
 */
import { useCallback, useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  Pill, Search, Plus, X, Package,
  TrendingDown, ArrowLeft, Save, Trash2, RefreshCw,
} from 'lucide-react'

interface Medicine {
  id: string
  name: string
  generic_name: string | null
  brand_name: string | null
  form: string
  strength: string | null
  category: string | null
  manufacturer: string | null
  mrp: number | null
  selling_price: number | null
  current_stock: number
  min_stock: number
  unit: string
  is_active: boolean
}

const FORMS = ['tablet', 'capsule', 'syrup', 'injection', 'cream', 'ointment', 'drops', 'inhaler', 'sachet', 'suppository', 'gel', 'powder']
const CATEGORIES = ['Antibiotics', 'Analgesics', 'NSAIDs', 'Hormones', 'Supplements', 'Antidiabetics', 'Antihypertensives', 'GI', 'Antiemetics', 'Antifungals', 'Antispasmodics', 'Fertility', 'Oral Contraceptives', 'Tocolytics', 'Uterotonics', 'Haemostatics', 'Anticonvulsants', 'Other']

export default function PharmacyPage() {
  const [medicines, setMedicines] = useState<Medicine[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'list' | 'add' | 'stock'>('list')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all')

  const [form, setForm] = useState({
    name: '', generic_name: '', brand_name: '', form: 'tablet',
    strength: '', category: 'Other', manufacturer: '',
    mrp: '', selling_price: '', min_stock: '10', unit: 'strip',
  })

  const [stockMedicine, setStockMedicine] = useState<Medicine | null>(null)
  const [stockForm, setStockForm] = useState({
    quantity: '', batch_number: '', expiry_date: '', purchase_price: '', supplier: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('pharmacy_medicines')
      .select('*')
      .eq('is_active', true)
      .order('name')
    setMedicines((data || []) as Medicine[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = medicines.filter(m => {
    const matchesSearch = !search ||
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      (m.generic_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (m.brand_name || '').toLowerCase().includes(search.toLowerCase())
    const matchesFilter =
      filter === 'all' ? true :
        filter === 'low' ? m.current_stock <= m.min_stock && m.current_stock > 0 :
          m.current_stock === 0
    return matchesSearch && matchesFilter
  })

  const lowStockCount = medicines.filter(m => m.current_stock > 0 && m.current_stock <= m.min_stock).length
  const outOfStockCount = medicines.filter(m => m.current_stock === 0).length

  async function handleAddMedicine() {
    if (!form.name.trim()) { setError('Medicine name is required'); return }
    setSaving(true); setError('')
    const { error: e } = await supabase.from('pharmacy_medicines').insert({
      name: form.name.trim(),
      generic_name: form.generic_name.trim() || null,
      brand_name: form.brand_name.trim() || null,
      form: form.form,
      strength: form.strength.trim() || null,
      category: form.category,
      manufacturer: form.manufacturer.trim() || null,
      mrp: form.mrp ? Number(form.mrp) : null,
      selling_price: form.selling_price ? Number(form.selling_price) : null,
      min_stock: Number(form.min_stock) || 10,
      unit: form.unit,
      current_stock: 0,
    })
    setSaving(false)
    if (e) { setError(e.message); return }
    setForm({ name: '', generic_name: '', brand_name: '', form: 'tablet', strength: '', category: 'Other', manufacturer: '', mrp: '', selling_price: '', min_stock: '10', unit: 'strip' })
    setView('list')
    load()
  }

  async function handleAddStock() {
    if (!stockMedicine || !stockForm.quantity) return
    setSaving(true); setError('')
    const qty = Number(stockForm.quantity)
    if (qty <= 0) { setError('Quantity must be positive'); setSaving(false); return }

    const { error: e } = await supabase
      .from('pharmacy_medicines')
      .update({ current_stock: stockMedicine.current_stock + qty, updated_at: new Date().toISOString() })
      .eq('id', stockMedicine.id)
    if (e) { setError(e.message); setSaving(false); return }

    if (stockForm.batch_number && stockForm.expiry_date) {
      await supabase.from('pharmacy_batches').insert({
        medicine_id: stockMedicine.id,
        batch_number: stockForm.batch_number,
        expiry_date: stockForm.expiry_date,
        quantity: qty,
        purchase_price: stockForm.purchase_price ? Number(stockForm.purchase_price) : null,
        supplier: stockForm.supplier || null,
      })
    }

    await supabase.from('pharmacy_stock_log').insert({
      medicine_id: stockMedicine.id,
      type: 'purchase',
      quantity: qty,
      notes: stockForm.supplier ? `From ${stockForm.supplier}` : 'Stock added',
    })

    setSaving(false)
    setStockForm({ quantity: '', batch_number: '', expiry_date: '', purchase_price: '', supplier: '' })
    setStockMedicine(null)
    setView('list')
    load()
  }

  async function deleteMedicine(id: string, name: string) {
    if (!confirm(`Remove "${name}" from inventory?`)) return
    await supabase.from('pharmacy_medicines').update({ is_active: false }).eq('id', id)
    load()
  }

  // ═══ ADD STOCK VIEW ═══
  if (view === 'stock' && stockMedicine) {
    return (
      <AppShell>
        <div className="p-6 max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-5">
            <button onClick={() => { setView('list'); setStockMedicine(null) }} className="text-gray-400 hover:text-gray-700">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-xl font-bold text-gray-900">Add Stock</h1>
          </div>
          <div className="card p-5 mb-5 bg-blue-50 border-blue-200">
            <div className="font-semibold text-gray-900">{stockMedicine.name}</div>
            <div className="text-sm text-gray-500">
              {stockMedicine.strength} {stockMedicine.form} · Current: {stockMedicine.current_stock} {stockMedicine.unit}s
            </div>
          </div>
          {error && <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
          <div className="card p-5">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="label">Quantity *</label>
                <input className="input" type="number" min="1" placeholder="e.g. 100"
                  value={stockForm.quantity} onChange={e => setStockForm(p => ({ ...p, quantity: e.target.value }))} />
              </div>
              <div>
                <label className="label">Batch Number</label>
                <input className="input" placeholder="e.g. BAT-2025-001"
                  value={stockForm.batch_number} onChange={e => setStockForm(p => ({ ...p, batch_number: e.target.value }))} />
              </div>
              <div>
                <label className="label">Expiry Date</label>
                <input className="input" type="date"
                  value={stockForm.expiry_date} onChange={e => setStockForm(p => ({ ...p, expiry_date: e.target.value }))} />
              </div>
              <div>
                <label className="label">Purchase Price (per unit)</label>
                <input className="input" type="number" step="0.01" placeholder="₹"
                  value={stockForm.purchase_price} onChange={e => setStockForm(p => ({ ...p, purchase_price: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="label">Supplier</label>
                <input className="input" placeholder="e.g. ABC Pharma Distributors"
                  value={stockForm.supplier} onChange={e => setStockForm(p => ({ ...p, supplier: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={handleAddStock} disabled={saving || !stockForm.quantity}
                className="btn-primary flex items-center gap-2 disabled:opacity-60">
                <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Add Stock'}
              </button>
              <button onClick={() => { setView('list'); setStockMedicine(null) }} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      </AppShell>
    )
  }

  // ═══ ADD MEDICINE VIEW ═══
  if (view === 'add') {
    return (
      <AppShell>
        <div className="p-6 max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-5">
            <button onClick={() => setView('list')} className="text-gray-400 hover:text-gray-700">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-xl font-bold text-gray-900">Add Medicine to Inventory</h1>
          </div>
          {error && <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
          <div className="card p-5">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="col-span-2">
                <label className="label">Medicine Name *</label>
                <input className="input" placeholder="e.g. Amoxicillin 500mg Capsule"
                  value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Generic Name</label>
                <input className="input" placeholder="e.g. Amoxicillin"
                  value={form.generic_name} onChange={e => setForm(p => ({ ...p, generic_name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Brand Name</label>
                <input className="input" placeholder="e.g. Mox, Novamox"
                  value={form.brand_name} onChange={e => setForm(p => ({ ...p, brand_name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Form</label>
                <select className="input" value={form.form} onChange={e => setForm(p => ({ ...p, form: e.target.value }))}>
                  {FORMS.map(f => <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Strength</label>
                <input className="input" placeholder="e.g. 500mg"
                  value={form.strength} onChange={e => setForm(p => ({ ...p, strength: e.target.value }))} />
              </div>
              <div>
                <label className="label">Category</label>
                <select className="input" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Manufacturer</label>
                <input className="input" placeholder="e.g. Cipla"
                  value={form.manufacturer} onChange={e => setForm(p => ({ ...p, manufacturer: e.target.value }))} />
              </div>
              <div>
                <label className="label">MRP (₹)</label>
                <input className="input" type="number" step="0.01" placeholder="120.00"
                  value={form.mrp} onChange={e => setForm(p => ({ ...p, mrp: e.target.value }))} />
              </div>
              <div>
                <label className="label">Selling Price (₹)</label>
                <input className="input" type="number" step="0.01" placeholder="100.00"
                  value={form.selling_price} onChange={e => setForm(p => ({ ...p, selling_price: e.target.value }))} />
              </div>
              <div>
                <label className="label">Min Stock Alert</label>
                <input className="input" type="number" min="0" placeholder="10"
                  value={form.min_stock} onChange={e => setForm(p => ({ ...p, min_stock: e.target.value }))} />
              </div>
              <div>
                <label className="label">Unit</label>
                <select className="input" value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))}>
                  {['strip', 'bottle', 'vial', 'tube', 'packet', 'piece', 'box'].map(u => (
                    <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={handleAddMedicine} disabled={saving || !form.name.trim()}
                className="btn-primary flex items-center gap-2 disabled:opacity-60">
                <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Add Medicine'}
              </button>
              <button onClick={() => setView('list')} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      </AppShell>
    )
  }

  // ═══ LIST VIEW ═══
  return (
    <AppShell>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Pill className="w-6 h-6 text-green-600" /> Pharmacy Inventory
            </h1>
            <p className="text-sm text-gray-500">
              {medicines.length} medicines · {lowStockCount} low stock · {outOfStockCount} out of stock
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="btn-secondary flex items-center gap-1.5 text-xs">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <Link href="/pharmacy/import"
              className="btn-secondary flex items-center gap-2 text-sm">
              <RefreshCw className="w-4 h-4" /> Import Database
            </Link>
            <button onClick={() => setView('add')} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Medicine
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-5">
          <div className="card p-4 bg-green-50 cursor-pointer" onClick={() => setFilter('all')}>
            <div className="text-2xl font-bold text-green-700">{medicines.length}</div>
            <div className="text-xs font-semibold text-gray-600">Total Medicines</div>
          </div>
          <div className="card p-4 bg-orange-50 cursor-pointer" onClick={() => setFilter('low')}>
            <div className="text-2xl font-bold text-orange-700">{lowStockCount}</div>
            <div className="text-xs font-semibold text-gray-600 flex items-center gap-1">
              <TrendingDown className="w-3 h-3" /> Low Stock
            </div>
          </div>
          <div className="card p-4 bg-red-50 cursor-pointer" onClick={() => setFilter('out')}>
            <div className="text-2xl font-bold text-red-700">{outOfStockCount}</div>
            <div className="text-xs font-semibold text-gray-600">Out of Stock</div>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input className="input pl-9" placeholder="Search medicine name, generic, or brand…"
            value={search} onChange={e => setSearch(e.target.value)} />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-fit">
          {([['all', 'All'], ['low', 'Low Stock'], ['out', 'Out of Stock']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${filter === key ? 'bg-white shadow text-green-700' : 'text-gray-500'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="card p-12 text-center text-gray-400">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">{medicines.length === 0 ? 'No medicines in inventory' : 'No matches'}</p>
            {medicines.length === 0 && (
              <button onClick={() => setView('add')} className="btn-primary inline-flex items-center gap-2 text-xs mt-3">
                <Plus className="w-3.5 h-3.5" /> Add First Medicine
              </button>
            )}
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  {['Medicine', 'Form', 'Strength', 'Stock', 'Min', 'MRP', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => {
                  const isLow = m.current_stock > 0 && m.current_stock <= m.min_stock
                  const isOut = m.current_stock === 0
                  return (
                    <tr key={m.id} className={`border-b border-gray-50 hover:bg-gray-50 ${isOut ? 'bg-red-50/30' : isLow ? 'bg-orange-50/30' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{m.name}</div>
                        <div className="text-xs text-gray-400">
                          {m.generic_name && <span>{m.generic_name}</span>}
                          {m.brand_name && <span className="ml-1">({m.brand_name})</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 capitalize">{m.form}</td>
                      <td className="px-4 py-3 text-gray-600">{m.strength || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`font-mono font-semibold ${isOut ? 'text-red-600' : isLow ? 'text-orange-600' : 'text-green-700'}`}>
                          {m.current_stock}
                        </span>
                        <span className="text-xs text-gray-400 ml-1">{m.unit}s</span>
                        {isOut && <span className="ml-2 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-semibold">OUT</span>}
                        {isLow && !isOut && <span className="ml-2 text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-semibold">LOW</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 font-mono">{m.min_stock}</td>
                      <td className="px-4 py-3 text-gray-700 font-mono">{m.mrp ? `₹${m.mrp}` : '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={() => { setStockMedicine(m); setView('stock') }}
                            className="text-xs bg-green-50 text-green-700 hover:bg-green-100 px-2 py-1 rounded font-medium">
                            + Stock
                          </button>
                          <button onClick={() => deleteMedicine(m.id, m.name)}
                            className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}