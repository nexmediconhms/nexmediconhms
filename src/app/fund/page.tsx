'use client'
/**
 * src/app/fund/page.tsx — FIXED v3 (872 lines, full preservation)
 *
 * FIXES vs v2:
 *   1. Date filter (Today / This Week / This Month / Last Month) now works.
 *      Root cause: `showDateFilter` toggled a client-side filter on an already-loaded
 *      dataset. The period buttons in the CA Report panel changed `reportPeriod` state
 *      but never re-queried Supabase, so the table showed the same data.
 *      Fix: a single `activePeriod` state drives BOTH the transaction table AND the
 *      CA report. Changing the period now re-fetches from Supabase with `.gte` / `.lte`.
 *
 *   2. ALL original code preserved: expense form, OCR receipt scan, approval workflow,
 *      top-up form, balance tiles, status filter tabs, transaction table, CA report
 *      with WhatsApp/Email/Print share — nothing removed.
 *
 *   3. Real-time balance tiles always reflect ALL-TIME totals (date-filter independent).
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, getHospitalSettings, getIndiaToday } from '@/lib/utils'
import { loadSettings } from '@/lib/settings'
import { useAuth } from '@/lib/auth'
import {
  IndianRupee, Plus, CheckCircle, XCircle, Clock,
  Printer, Coffee, ShoppingCart, Truck, Wrench, MoreHorizontal,
  TrendingDown, TrendingUp, RefreshCw, Download, AlertTriangle,
  Loader2, Camera, MessageCircle, Mail, Calendar, Calculator,
  FileText, ChevronDown, ChevronUp,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────

type ExpenseStatus = 'pending' | 'approved' | 'rejected'
type ReportPeriod = 'today' | 'this_week' | 'this_month' | 'last_month' | 'custom'

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

interface FundReportData {
  period: string
  fromDate: string
  toDate: string
  totalExpenses: number
  totalApproved: number
  totalPending: number
  totalRejected: number
  expenseCount: number
  categoryBreakdown: { category: string; amount: number; count: number }[]
  topupTotal: number
  netBalance: number
}

// ── Category config ────────────────────────────────────────────

const CATEGORIES = [
  { key: 'printing',    label: 'Printing / Stationery', icon: Printer,        color: 'text-blue-600   bg-blue-50'   },
  { key: 'food',        label: 'Food / Refreshments',   icon: Coffee,          color: 'text-orange-600 bg-orange-50' },
  { key: 'supplies',    label: 'Medical Supplies',      icon: ShoppingCart,    color: 'text-green-600  bg-green-50'  },
  { key: 'transport',   label: 'Transport',             icon: Truck,           color: 'text-purple-600 bg-purple-50' },
  { key: 'maintenance', label: 'Maintenance / Repairs', icon: Wrench,          color: 'text-red-600    bg-red-50'    },
  { key: 'other',       label: 'Other',                 icon: MoreHorizontal,  color: 'text-gray-600   bg-gray-50'   },
]

function CategoryIcon({ cat }: { cat: string }) {
  const found = CATEGORIES.find(c => c.key === cat)
  if (!found) return <MoreHorizontal className="w-4 h-4" />
  const Icon = found.icon
  return <Icon className="w-4 h-4" />
}

function statusBadge(s: ExpenseStatus) {
  if (s === 'approved') return <span className="badge-green text-xs flex items-center gap-1"><CheckCircle className="w-3 h-3" />Approved</span>
  if (s === 'rejected') return <span className="badge-red   text-xs flex items-center gap-1"><XCircle   className="w-3 h-3" />Rejected</span>
  return <span className="badge-yellow text-xs flex items-center gap-1"><Clock className="w-3 h-3" />Pending</span>
}

// ── Date helpers ───────────────────────────────────────────────

function getToday()                { return getIndiaToday() }
function getWeekStart()            { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().split('T')[0] }
function getMonthStart(offset = 0) { const d = new Date(); d.setMonth(d.getMonth() + offset, 1);    return d.toISOString().split('T')[0] }
function getMonthEnd(offset = 0)   { const d = new Date(); d.setMonth(d.getMonth() + 1 + offset, 0); return d.toISOString().split('T')[0] }

function getPeriodDates(
  period: ReportPeriod,
  customFrom: string,
  customTo: string,
): { from: string; to: string; label: string } {
  switch (period) {
    case 'today':
      return { from: getToday(), to: getToday(), label: `Today (${getToday()})` }
    case 'this_week':
      return { from: getWeekStart(), to: getToday(), label: 'This Week' }
    case 'this_month': {
      const s = getMonthStart(); const e = getMonthEnd()
      return { from: s, to: e, label: new Date(s).toLocaleString('en-IN', { month: 'long', year: 'numeric' }) }
    }
    case 'last_month': {
      const s = getMonthStart(-1); const e = getMonthEnd(-1)
      return { from: s, to: e, label: new Date(s).toLocaleString('en-IN', { month: 'long', year: 'numeric' }) }
    }
    case 'custom':
      return { from: customFrom, to: customTo, label: `${customFrom} to ${customTo}` }
    default:
      return { from: getMonthStart(), to: getMonthEnd(), label: 'This Month' }
  }
}

// ── Report computation ─────────────────────────────────────────

function computeFundReport(txns: FundTransaction[], from: string, to: string, label: string): FundReportData {
  const fromDate = new Date(from + 'T00:00:00')
  const toDate   = new Date(to   + 'T23:59:59')
  const inRange  = txns.filter(t => { const d = new Date(t.created_at); return d >= fromDate && d <= toDate })
  const expenses = inRange.filter(t => t.type === 'expense')
  const topups   = inRange.filter(t => t.type === 'topup')

  const totalApproved = expenses.filter(e => e.status === 'approved').reduce((s, e) => s + e.amount, 0)
  const totalPending  = expenses.filter(e => e.status === 'pending') .reduce((s, e) => s + e.amount, 0)
  const totalRejected = expenses.filter(e => e.status === 'rejected').reduce((s, e) => s + e.amount, 0)
  const topupTotal    = topups.reduce((s, t) => s + t.amount, 0)

  const catMap: Record<string, { amount: number; count: number }> = {}
  expenses.filter(e => e.status === 'approved').forEach(e => {
    if (!catMap[e.category]) catMap[e.category] = { amount: 0, count: 0 }
    catMap[e.category].amount += e.amount
    catMap[e.category].count  += 1
  })
  const categoryBreakdown = Object.entries(catMap)
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.amount - a.amount)

  return {
    period: label, fromDate: from, toDate: to,
    totalExpenses: totalApproved + totalPending + totalRejected,
    totalApproved, totalPending, totalRejected,
    expenseCount: expenses.length,
    categoryBreakdown, topupTotal,
    netBalance: topupTotal - totalApproved,
  }
}

// ── WhatsApp / Email builders ──────────────────────────────────

function buildFundWhatsApp(r: FundReportData, hs: any): string {
  const catLines = r.categoryBreakdown
    .map(c => { const cat = CATEGORIES.find(x => x.key === c.category); return `• ${cat?.label || c.category}: ₹${c.amount.toLocaleString('en-IN')} (${c.count} items)` })
    .join('\n')
  return encodeURIComponent(
    `*${hs.hospitalName || 'Hospital'} — Fund Expense Report*\n*Period: ${r.period}*\n\n*Summary*\nTotal Expenses (Approved): ₹${r.totalApproved.toLocaleString('en-IN')}\nPending Approval: ₹${r.totalPending.toLocaleString('en-IN')}\nRejected: ₹${r.totalRejected.toLocaleString('en-IN')}\nFund Top-ups: ₹${r.topupTotal.toLocaleString('en-IN')}\n*Net Balance: ₹${r.netBalance.toLocaleString('en-IN')}*\n\n*Category Breakdown (Approved)*\n${catLines || 'No approved expenses in this period.'}\n\n_Generated by NexMedicon HMS — ${new Date().toLocaleDateString('en-IN')}_`
  )
}

function buildFundEmail(r: FundReportData, hs: any): string {
  const catLines = r.categoryBreakdown
    .map(c => { const cat = CATEGORIES.find(x => x.key === c.category); return `  • ${cat?.label || c.category}: ₹${c.amount.toLocaleString('en-IN')} (${c.count} items)` })
    .join('\n')
  return encodeURIComponent(
    `Dear ${hs.caName || 'CA'},\n\nPlease find the Hospital Fund Expense Report for ${r.period}.\n\nSUMMARY\n-------\nTotal Expenses (Approved) : ₹${r.totalApproved.toLocaleString('en-IN')}\nPending Approval          : ₹${r.totalPending.toLocaleString('en-IN')}\nRejected                  : ₹${r.totalRejected.toLocaleString('en-IN')}\nFund Top-ups              : ₹${r.topupTotal.toLocaleString('en-IN')}\nNet Balance               : ₹${r.netBalance.toLocaleString('en-IN')}\nTotal Expense Entries     : ${r.expenseCount}\n\nCATEGORY BREAKDOWN (Approved)\n-----------------------------\n${catLines || 'No approved expenses in this period.'}\n\nPeriod: ${r.fromDate} to ${r.toDate}\nGenerated: ${new Date().toLocaleDateString('en-IN')} by NexMedicon HMS\n\nRegards,\n${hs.doctorName || 'Administrator'}\n${hs.hospitalName || ''}\n`
  )
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

// ── Component ──────────────────────────────────────────────────

export default function FundPage() {
  const { user, isAdmin: isAdminCtx, loading: authLoading } = useAuth()
  const hs        = typeof window !== 'undefined' ? getHospitalSettings() : {} as any
  // FIX: Use both context isAdmin AND direct role check for resilience
  const isAdmin   = isAdminCtx || user?.role === 'admin'
  const roleLoading = authLoading

  // FIX: Timeout for role loading — prevent permanent spinner
  const [roleTimeout, setRoleTimeout] = useState(false)
  useEffect(() => {
    if (authLoading) {
      const t = setTimeout(() => setRoleTimeout(true), 8000)
      return () => clearTimeout(t)
    }
  }, [authLoading])

  // All transactions — used for balance tiles (unfiltered, all-time)
  const [allTransactions,      setAllTransactions]      = useState<FundTransaction[]>([])
  // Filtered transactions shown in the table
  const [filteredTransactions, setFilteredTransactions] = useState<FundTransaction[]>([])
  const [loading,              setLoading]              = useState(true)

  const [showAddForm,    setShowAddForm]    = useState(false)
  const [showTopupForm,  setShowTopupForm]  = useState(false)
  const [activeFilter,   setActiveFilter]   = useState<'all' | 'pending' | 'approved'>('all')
  const [saving,         setSaving]         = useState(false)
  const [saveError,      setSaveError]      = useState('')
  const [receiptUploading, setReceiptUploading] = useState(false)

  const [expenseForm, setExpenseForm] = useState({
    category: 'printing', amount: '', description: '', receipt_note: '',
  })
  const [topupForm, setTopupForm] = useState({ amount: '', note: '' })

  // ── FIXED: Single period state drives BOTH table + CA report ──
  const [activePeriod, setActivePeriod] = useState<ReportPeriod>('this_month')
  const [customFrom,   setCustomFrom]   = useState(getMonthStart())
  const [customTo,     setCustomTo]     = useState(getToday())

  // CA Report panel state
  const [showCAReport, setShowCAReport] = useState(false)
  const [fundReport,   setFundReport]   = useState<FundReportData | null>(null)
  const [caSettings,   setCaSettings]   = useState({ caName: '', caWhatsApp: '', caEmail: '' })

  useEffect(() => {
    const s = loadSettings()
    setCaSettings({ caName: s.caName || '', caWhatsApp: s.caWhatsApp || '', caEmail: s.caEmail || '' })
  }, [])

  // Load ALL transactions (for balance tiles — never date-filtered)
  async function loadAllTransactions() {
    const { data } = await supabase
      .from('hospital_fund')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(2000)
    setAllTransactions((data || []) as FundTransaction[])
  }

  // FIXED: Load filtered transactions with server-side date range
  const loadFilteredTransactions = useCallback(async () => {
    setLoading(true)
    const { from, to } = getPeriodDates(activePeriod, customFrom, customTo)

    // FIX MAJOR #2: Use IST timezone offset (+05:30) instead of UTC (Z) for correct
    // date filtering in Indian timezone
    let q = supabase
      .from('hospital_fund')
      .select('*')
      .gte('created_at', `${from}T00:00:00+05:30`)
      .lte('created_at', `${to}T23:59:59.999+05:30`)
      .order('created_at', { ascending: false })

    // Also apply status tab filter at DB level
    if (activeFilter === 'pending')  q = (q as any).eq('status', 'pending').eq('type', 'expense')
    if (activeFilter === 'approved') q = (q as any).eq('status', 'approved')

    const { data } = await q
    setFilteredTransactions((data || []) as FundTransaction[])
    setLoading(false)
  }, [activePeriod, customFrom, customTo, activeFilter])

  useEffect(() => {
    loadAllTransactions()
  }, [])

  useEffect(() => {
    loadFilteredTransactions()
  }, [loadFilteredTransactions])

  // All-time balance tiles (NOT affected by date filter)
  const totalTopups   = allTransactions.filter(t => t.type === 'topup').reduce((s, t) => s + t.amount, 0)
  const totalApproved = allTransactions.filter(t => t.type === 'expense' && t.status === 'approved').reduce((s, t) => s + t.amount, 0)
  const totalPending  = allTransactions.filter(t => t.type === 'expense' && t.status === 'pending') .reduce((s, t) => s + t.amount, 0)
  const balance       = totalTopups - totalApproved

  // Generate CA Report using allTransactions so report covers the full period
  function generateFundReport() {
    const { from, to, label } = getPeriodDates(activePeriod, customFrom, customTo)
    if (activePeriod === 'custom' && (!customFrom || !customTo)) { alert('Please select both From and To dates.'); return }
    if (activePeriod === 'custom' && customFrom > customTo)       { alert('"From" date cannot be after "To" date.');  return }
    setFundReport(computeFundReport(allTransactions, from, to, label))
  }

  // Submit expense — FIX MAJOR #1: Expenses above ₹500 require admin approval
  // Small operational expenses (≤₹500) are auto-approved for workflow efficiency
  // Larger expenses go to 'pending' for admin review
  async function submitExpense() {
    if (!expenseForm.description.trim()) { alert('Please enter a description'); return }
    if (!expenseForm.amount || Number(expenseForm.amount) <= 0) { alert('Enter a valid amount'); return }
    setSaving(true); setSaveError('')

    const amount = Number(expenseForm.amount)
    const AUTO_APPROVE_THRESHOLD = 500 // ₹500 auto-approve limit
    const needsApproval = amount > AUTO_APPROVE_THRESHOLD && !isAdmin

    // Build description with receipt ref and submitter appended (these columns don't exist in DB)
    const descParts = [expenseForm.description.trim()]
    if (expenseForm.receipt_note.trim()) descParts.push(`[Ref: ${expenseForm.receipt_note.trim()}]`)
    descParts.push(`[By: ${user?.full_name || 'Unknown'}]`)
    const { error } = await supabase.from('hospital_fund').insert({
      type: 'expense', category: expenseForm.category,
      amount: amount,
      description: descParts.join(' '),
      submitted_by: user?.full_name || 'Unknown',
      approved_by: needsApproval ? null : (user?.full_name || 'Auto'),
      status: needsApproval ? 'pending' : 'approved',
    })
    setSaving(false)
    if (error) { setSaveError(`Failed to submit: ${error.message}`); return }
    setExpenseForm({ category: 'printing', amount: '', description: '', receipt_note: '' })
    setShowAddForm(false)
    await Promise.all([loadAllTransactions(), loadFilteredTransactions()])
  }

  // Admin: top up fund
  async function topUpFund() {
    if (!topupForm.amount || Number(topupForm.amount) <= 0) { alert('Enter a valid amount'); return }
    setSaving(true); setSaveError('')
    const { data, error } = await supabase.from('hospital_fund').insert({
      type: 'topup', category: 'topup', amount: Number(topupForm.amount),
      description: topupForm.note || `Fund top-up by ${user?.full_name}`,
      submitted_by: user?.full_name || 'Admin', approved_by: user?.full_name || 'Admin', status: 'approved',
    }).select().single()
    setSaving(false)
    if (error) { setSaveError(`Failed to add funds: ${error.message}. Check that the hospital_fund table exists and RLS allows inserts.`); return }

    // Audit log: every fund addition must be tracked
    try {
      const { audit } = await import('@/lib/audit')
      await audit('create', 'fund' as any, data?.id || 'unknown',
        `[FUND TOP-UP] Amount: ₹${Number(topupForm.amount).toLocaleString('en-IN')} | ` +
        `Note: ${topupForm.note || 'No note'} | By: ${user?.full_name || 'Admin'} | ` +
        `New Balance: ₹${(totalTopups + Number(topupForm.amount) - totalApproved).toLocaleString('en-IN')}`)
    } catch { /* audit non-fatal */ }

    setTopupForm({ amount: '', note: '' })
    setShowTopupForm(false)
    await Promise.all([loadAllTransactions(), loadFilteredTransactions()])
  }

  // Admin: approve / reject
  async function updateStatus(id: string, status: 'approved' | 'rejected') {
    await supabase
      .from('hospital_fund')
      .update({ status, approved_by: user?.full_name, updated_at: new Date().toISOString() })
      .eq('id', id)
    await Promise.all([loadAllTransactions(), loadFilteredTransactions()])
  }

  const { label: periodLabel } = getPeriodDates(activePeriod, customFrom, customTo)

  const PERIOD_BUTTONS: { key: ReportPeriod; label: string }[] = [
    { key: 'today',      label: 'Today'      },
    { key: 'this_week',  label: 'This Week'  },
    { key: 'this_month', label: 'This Month' },
    { key: 'last_month', label: 'Last Month' },
    { key: 'custom',     label: 'Custom'     },
  ]

  return (
    <AppShell>
      <div className="p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <IndianRupee className="w-6 h-6 text-emerald-500" /> Hospital Fund
            </h1>
            <p className="text-sm text-gray-500">Operational expenses — printing, food, supplies, transport</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => { loadAllTransactions(); loadFilteredTransactions() }} disabled={loading}
              className="btn-secondary flex items-center gap-2 text-xs">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {/* CA Report button */}
            <button onClick={() => setShowCAReport(!showCAReport)}
              className={`flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-xl transition-colors ${showCAReport ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100'}`}>
              <FileText className="w-3.5 h-3.5" /> CA Report
              {showCAReport ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            <button onClick={() => { setShowTopupForm(!showTopupForm); setSaveError('') }}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm shadow-emerald-200 transition-colors">
              <TrendingUp className="w-4 h-4" /> Add Funds
            </button>

            <button onClick={() => { setShowAddForm(!showAddForm); setSaveError('') }}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm shadow-blue-200 transition-colors">
              <Plus className="w-4 h-4" /> Record Expense
            </button>
          </div>
        </div>

        {/* Global error banner */}
        {saveError && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3 text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="flex-1">{saveError}</div>
            <button onClick={() => setSaveError('')} className="text-red-400 hover:text-red-600 text-xs">Dismiss</button>
          </div>
        )}

        {/* Balance tiles — ALL TIME (not affected by date filter) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Fund Balance',   value: balance,       icon: IndianRupee, color: balance >= 0 ? 'text-emerald-600' : 'text-red-600', bg: 'bg-emerald-50' },
            { label: 'Total Top-ups',  value: totalTopups,   icon: TrendingUp,  color: 'text-green-600',  bg: 'bg-green-50'  },
            { label: 'Approved Exp.',  value: totalApproved, icon: CheckCircle, color: 'text-blue-600',   bg: 'bg-blue-50'   },
            { label: 'Pending Appr.', value: totalPending,  icon: Clock,       color: 'text-amber-600',  bg: 'bg-amber-50'  },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className={`card p-4 ${bg}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500 font-medium">{label}</span>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <div className={`text-xl font-bold font-mono ${color}`}>{inr(value)}</div>
              <div className="text-xs text-gray-400 mt-0.5">All time</div>
            </div>
          ))}
        </div>

        {/* Top-up form */}
        {showTopupForm && (
          <div className="card p-5 mb-5 border-l-4 border-emerald-400">
            <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" /> Add Funds to Hospital Account
            </h3>
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <label className="label">Amount (₹) *</label>
                <input className="input" type="number" step="0.01" placeholder="5000"
                  value={topupForm.amount} onChange={e => setTopupForm(p => ({ ...p, amount: e.target.value }))} />
              </div>
              <div>
                <label className="label">Note (optional)</label>
                <input className="input" placeholder="Monthly fund allocation"
                  value={topupForm.note} onChange={e => setTopupForm(p => ({ ...p, note: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-3 mt-3">
              <button onClick={topUpFund} disabled={saving}
                className="btn-primary text-xs flex items-center gap-2 disabled:opacity-60">
                {saving ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <TrendingUp className="w-3.5 h-3.5" />}
                {saving ? 'Adding…' : 'Add Funds'}
              </button>
              <button onClick={() => { setShowTopupForm(false); setSaveError('') }} className="btn-secondary text-xs">Cancel</button>
            </div>
          </div>
        )}

        {/* Expense form */}
        {showAddForm && (
          <div className="card p-5 mb-5 border-l-4 border-blue-400">
            <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <Plus className="w-4 h-4 text-blue-500" /> Record Expense
            </h3>

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
                      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
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
                  value={expenseForm.amount} onChange={e => setExpenseForm(p => ({ ...p, amount: e.target.value }))} />
              </div>
              <div>
                <label className="label">Receipt / Bill No. (optional)</label>
                <input className="input" placeholder="Bill # or reference"
                  value={expenseForm.receipt_note} onChange={e => setExpenseForm(p => ({ ...p, receipt_note: e.target.value }))} />
              </div>
            </div>

            {/* Smart receipt upload with OCR auto-fill */}
            <div className="mb-3">
              <label className="label">Upload Receipt Photo (optional — AI reads amount & details)</label>
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700 font-medium cursor-pointer hover:bg-blue-100 transition-colors">
                  <Camera className="w-4 h-4" />
                  {receiptUploading ? 'Reading…' : 'Scan Receipt'}
                  <input
                    type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                    disabled={receiptUploading}
                    onChange={async (e) => {
                      const file = e.target.files?.[0]; if (!file) return
                      e.target.value = ''; setReceiptUploading(true)
                      try {
                        const fd = new FormData()
                        fd.append('image', file); fd.append('mode', 'autofill')
                        fd.append('context', 'Hospital expense receipt — extract date, bill number, total amount, vendor name, description of items purchased')
                        const { data: { session } } = await supabase.auth.getSession()
                        const token = session?.access_token
                        const res = await fetch('/api/doctor-note-ocr', {
                          method: 'POST',
                          headers: token ? { Authorization: `Bearer ${token}` } : {},
                          body: fd,
                        })
                        if (res.ok) {
                          const data = await res.json(); const f = data.fields || {}
                          if (f.amount || f.total_amount) setExpenseForm(p => ({ ...p, amount: String(f.amount || f.total_amount || '') }))
                          if (f.description || f.vendor || f.items) {
                            const desc = [f.vendor, f.description, f.items].filter(Boolean).join(' — ')
                            if (desc) setExpenseForm(p => ({ ...p, description: desc }))
                          }
                          if (f.bill_number || f.invoice_number) setExpenseForm(p => ({ ...p, receipt_note: f.bill_number || f.invoice_number || '' }))
                        }
                      } catch (err) { console.warn('[Fund OCR]', err) }
                      finally { setReceiptUploading(false) }
                    }}
                  />
                </label>
                {receiptUploading && <span className="text-xs text-blue-500 animate-pulse">AI reading receipt…</span>}
              </div>
              <p className="text-xs text-gray-400 mt-1">Take a photo of a printed receipt — AI extracts amount, vendor, and bill number automatically.</p>
            </div>

            <div className="mb-4">
              <label className="label">Description / Purpose *</label>
              <textarea className="input" rows={2}
                placeholder="e.g. Printed 50 copies of patient discharge forms · Ordered tea for night duty nurses · Purchased gloves (1 box)"
                value={expenseForm.description} onChange={e => setExpenseForm(p => ({ ...p, description: e.target.value }))} />
            </div>

            <div className="text-xs text-gray-500 mb-3 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5" />
              Submitted by <strong>{user?.full_name}</strong> · {isAdmin ? 'Auto-approved (admin)' : 'Amounts >₹500 need admin approval'}
            </div>

            <div className="flex gap-3">
              <button onClick={submitExpense} disabled={saving}
                className="btn-primary text-xs flex items-center gap-2 disabled:opacity-60">
                {saving ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                {saving ? 'Submitting…' : 'Submit Expense'}
              </button>
              <button onClick={() => { setShowAddForm(false); setSaveError('') }} className="btn-secondary text-xs">Cancel</button>
            </div>
          </div>
        )}

        {/* ── FIXED: CA Report Section (now uses same activePeriod state as filter) ── */}
        {showCAReport && (
          <div className="card p-5 mb-5 border-l-4 border-purple-400">
            <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4 text-purple-600" /> Expense Report for CA
            </h3>

            {/* Period selector — same state as the table filter */}
            <div className="flex flex-wrap gap-2 mb-4">
              {PERIOD_BUTTONS.map(({ key, label }) => (
                <button key={key} onClick={() => { setActivePeriod(key); setFundReport(null) }}
                  className={`text-xs font-semibold py-2 px-3 rounded-lg border transition-all
                    ${activePeriod === key ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200 hover:border-purple-300 hover:bg-purple-50'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Custom date inputs */}
            {activePeriod === 'custom' && (
              <div className="flex gap-3 mb-4 items-end">
                <div>
                  <label className="label">From Date</label>
                  <input type="date" className="input" value={customFrom} max={customTo || undefined}
                    onChange={e => { setCustomFrom(e.target.value); setFundReport(null) }} />
                </div>
                <div>
                  <label className="label">To Date</label>
                  <input type="date" className="input" value={customTo} min={customFrom || undefined} max={getToday()}
                    onChange={e => { setCustomTo(e.target.value); setFundReport(null) }} />
                </div>
              </div>
            )}

            <button onClick={generateFundReport} className="btn-primary flex items-center gap-2 mb-4">
              <Calculator className="w-4 h-4" /> Generate Report
            </button>

            {/* Report output */}
            {fundReport && (
              <div className="bg-white border border-purple-200 rounded-xl p-5">
                {/* Report header */}
                <div className="text-center pb-4 mb-4 border-b-2 border-purple-100">
                  <div className="text-lg font-bold text-gray-900">{hs.hospitalName || 'Hospital'}</div>
                  <div className="text-sm text-gray-500">Fund Expense Report — {fundReport.period}</div>
                  <div className="text-xs text-gray-400">{fundReport.fromDate} to {fundReport.toDate}</div>
                </div>

                {/* Summary grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                  {[
                    { label: 'Approved', value: inr(fundReport.totalApproved), color: 'text-green-700' },
                    { label: 'Pending',  value: inr(fundReport.totalPending),  color: 'text-yellow-700' },
                    { label: 'Rejected', value: inr(fundReport.totalRejected), color: 'text-red-600' },
                    { label: 'Net Balance', value: inr(fundReport.netBalance), color: 'text-blue-700 font-bold' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-gray-50 rounded-lg px-3 py-3 text-center">
                      <div className={`text-lg font-mono font-bold ${color}`}>{value}</div>
                      <div className="text-xs text-gray-500 mt-1">{label}</div>
                    </div>
                  ))}
                </div>

                {/* Category breakdown */}
                {fundReport.categoryBreakdown.length > 0 && (
                  <div className="mb-5">
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Category Breakdown (Approved)</h4>
                    <div className="space-y-1">
                      {fundReport.categoryBreakdown.map(c => {
                        const cat = CATEGORIES.find(x => x.key === c.category)
                        return (
                          <div key={c.category} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-50">
                            <span className="flex items-center gap-2 text-gray-700">
                              <CategoryIcon cat={c.category} />
                              {cat?.label || c.category}
                            </span>
                            <div className="text-right">
                              <span className="font-mono font-semibold">{inr(c.amount)}</span>
                              <span className="text-xs text-gray-400 ml-2">({c.count} items)</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Share buttons */}
                <div className="flex gap-2 flex-wrap pt-3 border-t border-purple-100">
                  {caSettings.caWhatsApp && (
                    <a href={`https://wa.me/${caSettings.caWhatsApp.replace(/\D/g, '')}?text=${buildFundWhatsApp(fundReport, { ...hs, caName: caSettings.caName })}`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs bg-green-50 text-green-700 border border-green-200 rounded-lg px-3 py-1.5 hover:bg-green-100">
                      <MessageCircle className="w-3.5 h-3.5" /> WhatsApp CA
                    </a>
                  )}
                  {caSettings.caEmail && (
                    <button
                      onClick={async () => {
                        if (!fundReport) return
                        try {
                          const { data: { session } } = await supabase.auth.getSession()
                          const res = await fetch('/api/billing/send-email', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
                            },
                            body: JSON.stringify({
                              recipientEmail: caSettings.caEmail,
                              recipientName: caSettings.caName || 'CA',
                              reportData: {
                                period: fundReport.period,
                                fromDate: fundReport.fromDate,
                                toDate: fundReport.toDate,
                                totalGross: fundReport.totalApproved,
                                totalDiscount: 0,
                                totalNet: fundReport.totalApproved,
                                billCount: fundReport.expenseCount,
                                pendingCount: 0,
                                pendingAmount: fundReport.totalPending,
                                paymentBreakdown: fundReport.categoryBreakdown.map(c => ({
                                  mode: c.category,
                                  amount: c.amount,
                                  count: c.count,
                                })),
                                serviceBreakdown: [],
                              },
                              hospitalSettings: hs,
                            }),
                          })
                          const data = await res.json()
                          if (data.success && data.method === 'email') {
                            alert(`Report sent to ${caSettings.caEmail} successfully!`)
                          } else if (data.mailtoUrl) {
                            window.open(data.mailtoUrl, '_self')
                          } else {
                            alert(data.message || 'Email service not configured. Configure RESEND_API_KEY in environment.')
                          }
                        } catch (err: any) {
                          alert('Failed to send email: ' + err.message)
                        }
                      }}
                      className="flex items-center gap-1.5 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-lg px-3 py-1.5 hover:bg-blue-100">
                      <Mail className="w-3.5 h-3.5" /> Email CA
                    </button>
                  )}
                  <button onClick={() => window.print()}
                    className="flex items-center gap-1.5 text-xs bg-gray-50 text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-100">
                    <Printer className="w-3.5 h-3.5" /> Print
                  </button>
                  {!caSettings.caWhatsApp && !caSettings.caEmail && (
                    <span className="text-xs text-gray-400 py-1.5">
                      Add CA contact in <Link href="/settings" className="text-blue-600 hover:underline">Settings</Link> to enable sharing.
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── FIXED: Date Period Filter (same activePeriod state — drives table) ── */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs font-semibold text-gray-500">Period:</span>
          {PERIOD_BUTTONS.map(({ key, label }) => (
            <button key={key}
              onClick={() => setActivePeriod(key)}
              className={`text-xs font-medium py-1.5 px-3 rounded-lg border transition-all ${
                activePeriod === key
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
              }`}>
              {label}
            </button>
          ))}
          {activePeriod === 'custom' && (
            <div className="flex items-center gap-2">
              <input type="date" className="input py-1 text-xs w-36" value={customFrom}
                onChange={e => setCustomFrom(e.target.value)} />
              <span className="text-xs text-gray-400">to</span>
              <input type="date" className="input py-1 text-xs w-36" value={customTo}
                onChange={e => setCustomTo(e.target.value)} />
            </div>
          )}
          <span className="text-xs text-gray-400 ml-1">({periodLabel})</span>
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-fit">
          {[
            { key: 'all',      label: 'All' },
            { key: 'pending',  label: `Pending (${allTransactions.filter(t => t.status === 'pending' && t.type === 'expense').length})` },
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
            <div className="w-7 h-7 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <IndianRupee className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p>No transactions found for <strong>{periodLabel}</strong></p>
            <p className="text-sm mt-1">Try selecting a different period or adjust your date range.</p>
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
                {filteredTransactions.map(tx => {
                  const cat = CATEGORIES.find(c => c.key === tx.category)
                  return (
                    <tr key={tx.id} className={`border-b border-gray-50 hover:bg-gray-50 ${tx.type === 'topup' ? 'bg-emerald-50/30' : ''}`}>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(tx.created_at)}</td>
                      <td className="px-4 py-3">
                        {tx.type === 'topup' ? (
                          <span className="flex items-center gap-1 text-emerald-700 text-xs font-medium">
                            <TrendingUp className="w-3.5 h-3.5" /> Fund Top-up
                          </span>
                        ) : (
                          <span className={`flex items-center gap-1 text-xs font-medium ${cat?.color.split(' ')[0] || 'text-gray-600'}`}>
                            <CategoryIcon cat={tx.category} /> {cat?.label || tx.category}
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
                                <CheckCircle className="w-3 h-3" /> Approve
                              </button>
                              <button onClick={() => updateStatus(tx.id, 'rejected')}
                                className="text-xs px-2 py-1 bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100 flex items-center gap-1">
                                <XCircle className="w-3 h-3" /> Reject
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