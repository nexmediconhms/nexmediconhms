
'use client'
/**
 * src/app/fund/page.tsx
 *
 * Hospital Operational Fund (Staff Petty Cash / Expense Tracker)
 *
 * Requirement #6: Allow staff to record hospital fund usage —
 *   - Printing documents
 *   - Ordering food for staff/nurses
 *   - Stationery, minor purchases
 *   - Any other operational expense
 *
 * Features:
 *  - Fund balance management (Admin tops up)
 *  - Expense submission (any staff)
 *  - Approval workflow (Admin approves / rejects)
 *  - Expense categories with icons
 *  - Audit trail for every transaction
 *  - Monthly summary / export
 */

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, formatDateTime, getHospitalSettings } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import {
  IndianRupee, Plus, CheckCircle, XCircle, Clock,
  Printer, Coffee, ShoppingCart, Truck, Wrench, MoreHorizontal,
  TrendingDown, TrendingUp, RefreshCw, Download, AlertTriangle
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────

type ExpenseStatus = 'pending' | 'approved' | 'rejected'

interface FundTransaction {
  id: string
  type: 'topup' | 'expense'
  amount: number
  category: string
  description: string
  submitted_by: string
  approved_by?: string
  status: ExpenseStatus
  receipt_note?: string
  created_at: string
  updated_at: string
}

// ── Category config ────────────────────────────────────────────

const CATEGORIES = [
  { key: 'printing',    label: 'Printing / Stationery', icon: Printer,       color: 'text-blue-600   bg-blue-50'   },
  { key: 'food',        label: 'Food / Refreshments',   icon: Coffee,        color: 'text-orange-600 bg-orange-50' },
  { key: 'supplies',    label: 'Medical Supplies',       icon: ShoppingCart,  color: 'text-green-600  bg-green-50'  },
  { key: 'transport',   label: 'Transport',              icon: Truck,         color: 'text-purple-600 bg-purple-50' },
  { key: 'maintenance', label: 'Maintenance / Repairs',  icon: Wrench,        color: 'text-red-600    bg-red-50'    },
  { key: 'other',       label: 'Other',                  icon: MoreHorizontal,color: 'text-gray-600   bg-gray-50'   },
]

function CategoryIcon({ cat }: { cat: string }) {
  const found = CATEGORIES.find(c => c.key === cat)
  if (!found) return <MoreHorizontal className="w-4 h-4"/>
  const Icon = found.icon
  return <Icon className="w-4 h-4"/>
}

function statusBadge(s: ExpenseStatus) {
  if (s === 'approved') return <span className="badge-green text-xs flex items-center gap-1"><CheckCircle className="w-3 h-3"/>Approved</span>
  if (s === 'rejected') return <span className="badge-red   text-xs flex items-center gap-1"><XCircle className="w-3 h-3"/>Rejected</span>
  return <span className="badge-yellow text-xs flex items-center gap-1"><Clock className="w-3 h-3"/>Pending</span>
}

// ── Component ──────────────────────────────────────────────────

export default function FundPage() {
  const { user, isAdmin } = useAuth()
  const hs = typeof window !== 'undefined' ? getHospitalSettings() : {} as any

  const [transactions, setTransactions] = useState<FundTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [showTopupForm, setShowTopupForm] = useState(false)
  const [activeFilter, setActiveFilter] = useState<'all' | 'pending' | 'approved'>('all')
  const [saving, setSaving] = useState(false)

  const [expenseForm, setExpenseForm] = useState({
    category: 'printing',
    amount: '',
    description: '',
    receipt_note: '',
  })

  const [topupForm, setTopupForm] = useState({
    amount: '',
    note: '',
  })

  useEffect(() => { loadTransactions() }, [])

  async function loadTransactions() {
    setLoading(true)
    const { data } = await supabase
      .from('hospital_fund')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    setTransactions((data || []) as FundTransaction[])
    setLoading(false)
  }

  // ── Computed balances ──
  const totalTopups   = transactions.filter(t => t.type === 'topup').reduce((s, t) => s + t.amount, 0)
  const totalApproved = transactions.filter(t => t.type === 'expense' && t.status === 'approved').reduce((s, t) => s + t.amount, 0)
  const totalPending  = transactions.filter(t => t.type === 'expense' && t.status === 'pending').reduce((s, t) => s + t.amount, 0)
  const balance       = totalTopups - totalApproved

  const filtered = transactions.filter(t => {
    if (activeFilter === 'pending')  return t.status === 'pending' && t.type === 'expense'
    if (activeFilter === 'approved') return t.status === 'approved'
    return true
  })

  // ── Submit expense ──
  async function submitExpense() {
    if (!expenseForm.description.trim()) { alert('Please enter a description'); return }
    if (!expenseForm.amount || Number(expenseForm.amount) <= 0) { alert('Enter a valid amount'); return }

    setSaving(true)
    await supabase.from('hospital_fund').insert({
      type:          'expense',
      category:      expenseForm.category,
      amount:        Number(expenseForm.amount),
      description:   expenseForm.description.trim(),
      receipt_note:  expenseForm.receipt_note.trim() || null,
      submitted_by:  user?.full_name || 'Unknown',
      status:        'pending',
    })
    setExpenseForm({ category: 'printing', amount: '', description: '', receipt_note: '' })
    setShowAddForm(false)
    await loadTransactions()
    setSaving(false)
  }

  // ── Admin: top up fund ──
  async function topUpFund() {
    if (!topupForm.amount || Number(topupForm.amount) <= 0) { alert('Enter a valid amount'); return }
    setSaving(true)
    await supabase.from('hospital_fund').insert({
      type:         'topup',
      category:     'topup',
      amount:       Number(topupForm.amount),
      description:  topupForm.note || `Fund top-up by ${user?.full_name}`,
      submitted_by: user?.full_name || 'Admin',
      approved_by:  user?.full_name || 'Admin',
      status:       'approved',
    })
    setTopupForm({ amount: '', note: '' })
    setShowTopupForm(false)
    await loadTransactions()
    setSaving(false)
  }

  // ── Admin: approve / reject ──
  async function updateStatus(id: string, status: 'approved' | 'rejected') {
    await supabase
      .from('hospital_fund')
      .update({ status, approved_by: user?.full_name, updated_at: new Date().toISOString() })
      .eq('id', id)
    await loadTransactions()
  }

  const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

  return (
    <AppShell>
      <div className="p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <IndianRupee className="w-6 h-6 text-emerald-500"/> Hospital Fund
            </h1>
            <p className="text-sm text-gray-500">Operational expenses — printing, food, supplies, transport</p>
          </div>
          <div className="flex gap-3">
            <button onClick={loadTransactions} disabled={loading}
              className="btn-secondary flex items-center gap-2 text-xs">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}/>
            </button>
            {isAdmin && (
              <button onClick={() => setShowTopupForm(!showTopupForm)}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm shadow-emerald-200 transition-colors">
                <TrendingUp className="w-4 h-4"/> Add Funds
              </button>
            )}
            <button onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm shadow-blue-200 transition-colors">
              <Plus className="w-4 h-4"/> Record Expense
            </button>
          </div>
        </div>

        {/* Balance tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Fund Balance',      value: inr(balance),       sub: 'available',           color: balance < 1000 ? 'text-red-700 bg-red-50' : 'text-emerald-700 bg-emerald-50', icon: IndianRupee },
            { label: 'Total Funded',      value: inr(totalTopups),   sub: 'all time top-ups',    color: 'text-blue-700 bg-blue-50',    icon: TrendingUp   },
            { label: 'Approved Expenses', value: inr(totalApproved), sub: 'paid out',            color: 'text-orange-700 bg-orange-50', icon: TrendingDown },
            { label: 'Pending Approval',  value: inr(totalPending),  sub: `${transactions.filter(t => t.status === 'pending' && t.type === 'expense').length} requests`, color: 'text-yellow-700 bg-yellow-50', icon: Clock },
          ].map(({ label, value, sub, color, icon: Icon }) => (
            <div key={label} className={`card p-4 ${color.split(' ')[1]}`}>
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`w-4 h-4 ${color.split(' ')[0]}`}/>
                <span className="text-xs font-semibold text-gray-600">{label}</span>
              </div>
              <div className={`text-2xl font-bold ${color.split(' ')[0]}`}>{value}</div>
              <div className="text-xs text-gray-400">{sub}</div>
            </div>
          ))}
        </div>

        {balance < 500 && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3 text-sm">
            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0"/>
            <span className="text-red-800">
              Fund balance is low ({inr(balance)}). {isAdmin ? 'Click "Add Funds" above to top up.' : 'Ask admin to top up the fund.'}
            </span>
            {isAdmin && (
              <button onClick={() => setShowTopupForm(true)}
                className="ml-auto flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0">
                <TrendingUp className="w-3.5 h-3.5"/> Add Funds Now
              </button>
            )}
          </div>
        )}

        {/* Top-up form */}
        {showTopupForm && isAdmin && (
          <div className="card p-5 mb-5 border-l-4 border-emerald-400">
            <h3 className="font-semibold text-gray-800 mb-3">Top Up Fund</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Amount (₹)</label>
                <input className="input" type="number" placeholder="5000"
                  value={topupForm.amount} onChange={e => setTopupForm(p => ({ ...p, amount: e.target.value }))}/>
              </div>
              <div>
                <label className="label">Note</label>
                <input className="input" placeholder="e.g. Monthly operational budget"
                  value={topupForm.note} onChange={e => setTopupForm(p => ({ ...p, note: e.target.value }))}/>
              </div>
            </div>
            <div className="flex gap-3 mt-3">
              <button onClick={topUpFund} disabled={saving}
                className="btn-primary text-xs flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5"/> Add Funds
              </button>
              <button onClick={() => setShowTopupForm(false)} className="btn-secondary text-xs">Cancel</button>
            </div>
          </div>
        )}

        {/* Expense form */}
        {showAddForm && (
          <div className="card p-5 mb-5 border-l-4 border-blue-400">
            <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <Plus className="w-4 h-4 text-blue-500"/> Record Expense
            </h3>

            {/* Category grid */}
            <div className="mb-4">
              <label className="label">Category</label>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORIES.map(cat => {
                  const Icon = cat.icon
                  const isSelected = expenseForm.category === cat.key
                  return (
                    <button key={cat.key} type="button"
                      onClick={() => setExpenseForm(p => ({ ...p, category: cat.key }))}
                      className={`flex items-center gap-2 p-2.5 rounded-lg border-2 text-xs font-medium transition-colors text-left ${
                        isSelected
                          ? `${cat.color.split(' ')[1]} border-current ${cat.color.split(' ')[0]}`
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}>
                      <Icon className="w-3.5 h-3.5 flex-shrink-0"/>
                      {cat.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <label className="label">Amount (₹) *</label>
                <input className="input" type="number" step="0.01" placeholder="250"
                  value={expenseForm.amount} onChange={e => setExpenseForm(p => ({ ...p, amount: e.target.value }))}/>
              </div>
              <div>
                <label className="label">Receipt / Bill No. (optional)</label>
                <input className="input" placeholder="Bill # or reference"
                  value={expenseForm.receipt_note} onChange={e => setExpenseForm(p => ({ ...p, receipt_note: e.target.value }))}/>
              </div>
            </div>

            <div className="mb-4">
              <label className="label">Description / Purpose *</label>
              <textarea className="input" rows={2}
                placeholder="e.g. Printed 50 copies of patient discharge forms · Ordered tea for night duty nurses · Purchased gloves (1 box)"
                value={expenseForm.description} onChange={e => setExpenseForm(p => ({ ...p, description: e.target.value }))}/>
            </div>

            <div className="text-xs text-gray-500 mb-3 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5"/>
              Submitted by <strong>{user?.full_name}</strong> · Will be sent for admin approval
            </div>

            <div className="flex gap-3">
              <button onClick={submitExpense} disabled={saving}
                className="btn-primary text-xs flex items-center gap-2 disabled:opacity-60">
                {saving ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"/>
                  : <CheckCircle className="w-3.5 h-3.5"/>}
                {saving ? 'Submitting…' : 'Submit for Approval'}
              </button>
              <button onClick={() => setShowAddForm(false)} className="btn-secondary text-xs">Cancel</button>
            </div>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-fit">
          {[
            { key: 'all',      label: 'All' },
            { key: 'pending',  label: `Pending (${transactions.filter(t => t.status === 'pending' && t.type === 'expense').length})` },
            { key: 'approved', label: 'Approved' },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => setActiveFilter(key as any)}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${activeFilter === key ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Transaction list */}
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-7 h-7 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin"/>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <IndianRupee className="w-10 h-10 mx-auto mb-3 opacity-20"/>
            <p>No transactions found</p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  {['Date', 'Category', 'Description', 'Amount', 'By', 'Status', isAdmin ? 'Action' : ''].filter(Boolean).map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(tx => {
                  const cat = CATEGORIES.find(c => c.key === tx.category)
                  return (
                    <tr key={tx.id} className={`border-b border-gray-50 hover:bg-gray-50
                      ${tx.type === 'topup' ? 'bg-emerald-50/30' : ''}`}>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {formatDate(tx.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        {tx.type === 'topup' ? (
                          <span className="flex items-center gap-1 text-emerald-700 text-xs font-medium">
                            <TrendingUp className="w-3.5 h-3.5"/> Fund Top-up
                          </span>
                        ) : (
                          <span className={`flex items-center gap-1 text-xs font-medium ${cat?.color.split(' ')[0] || 'text-gray-600'}`}>
                            <CategoryIcon cat={tx.category}/> {cat?.label || tx.category}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700 max-w-[220px]">
                        <div className="truncate">{tx.description}</div>
                        {tx.receipt_note && <div className="text-xs text-gray-400">Ref: {tx.receipt_note}</div>}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold">
                        <span className={tx.type === 'topup' ? 'text-emerald-600' : 'text-gray-900'}>
                          {tx.type === 'topup' ? '+' : ''}{inr(tx.amount)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{tx.submitted_by}</td>
                      <td className="px-4 py-3">{statusBadge(tx.status)}</td>
                      {isAdmin && (
                        <td className="px-4 py-3">
                          {tx.status === 'pending' && tx.type === 'expense' && (
                            <div className="flex gap-1">
                              <button onClick={() => updateStatus(tx.id, 'approved')}
                                className="text-xs px-2 py-1 bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100 flex items-center gap-1">
                                <CheckCircle className="w-3 h-3"/> Approve
                              </button>
                              <button onClick={() => updateStatus(tx.id, 'rejected')}
                                className="text-xs px-2 py-1 bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100 flex items-center gap-1">
                                <XCircle className="w-3 h-3"/> Reject
                              </button>
                            </div>
                          )}
                          {tx.status !== 'pending' && tx.approved_by && (
                            <span className="text-xs text-gray-400">by {tx.approved_by}</span>
                          )}
                        </td>
                      )}
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
