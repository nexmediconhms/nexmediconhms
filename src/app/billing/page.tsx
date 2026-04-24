'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, getHospitalSettings } from '@/lib/utils'
import { loadSettings } from '@/lib/settings'
import {
  IndianRupee, Search, CheckCircle, Clock, Printer,
  CreditCard, Smartphone, Banknote, Plus, Trash2, X,
  ArrowLeft, Receipt, AlertCircle, Calculator, Mail,
  MessageCircle, ChevronDown, ChevronUp, Calendar,
} from 'lucide-react'

// ── Common fee presets ────────────────────────────────────────
function getFeePresets() {
  const hs = typeof window !== 'undefined' ? getHospitalSettings() : {} as any
  return [
    { label: 'OPD Consultation', amount: Number(hs.feeOPD) || 500 },
    { label: 'ANC Consultation', amount: Number(hs.feeANC) || 400 },
    { label: 'Follow-up Consultation', amount: Number(hs.feeFollowUp) || 300 },
    { label: 'Emergency Consultation', amount: Number(hs.feeEmergency) || 800 },
    { label: 'USG (Obstetric)', amount: 1200 },
    { label: 'USG (Pelvis)', amount: 1000 },
    { label: 'Colour Doppler', amount: 2000 },
    { label: 'PAP Smear', amount: 600 },
    { label: 'Colposcopy', amount: 2500 },
    { label: 'Dressing / Procedure', amount: 300 },
    { label: 'Injection Administration', amount: 100 },
    { label: 'IUD Insertion', amount: 800 },
    { label: 'IPD Admission (per day)', amount: 1500 },
    { label: 'OT Charges (minor)', amount: 5000 },
    { label: 'OT Charges (major)', amount: 15000 },
    { label: 'Blood Test (CBC)', amount: 300 },
    { label: 'Blood Test (panel)', amount: 800 },
    { label: 'Medicines / Pharmacy', amount: 0 },
  ]
}

interface BillItem { label: string; amount: number }
type PayMode = 'cash' | 'upi' | 'card'
type BillStatus = 'pending' | 'paid' | 'cancelled'
type Period = 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'this_year' | 'custom'

interface Bill {
  id: string
  patient_id: string
  patient_name: string
  mrn: string
  items: BillItem[]
  subtotal: number
  discount: number
  net_amount: number
  payment_mode: PayMode | null
  status: BillStatus
  razorpay_payment_id?: string
  notes: string
  encounter_id?: string
  created_at: string
  paid_at?: string
}

// ── CA Report types ───────────────────────────────────────────
interface CAReportData {
  period: string
  fromDate: string
  toDate: string
  totalGross: number
  totalDiscount: number
  totalNet: number
  billCount: number
  pendingCount: number
  pendingAmount: number
  paymentBreakdown: { mode: string; amount: number; count: number }[]
  serviceBreakdown: { label: string; amount: number; count: number }[]
}

// ── Razorpay loader ───────────────────────────────────────────
function loadRazorpay(): Promise<boolean> {
  return new Promise(resolve => {
    if ((window as any).Razorpay) { resolve(true); return }
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve(true)
    s.onerror = () => resolve(false)
    document.body.appendChild(s)
  })
}

const PAY_MODES: { mode: PayMode; icon: any; label: string; desc: string; activeClass: string; iconClass: string }[] = [
  { mode: 'cash', icon: Banknote, label: 'Cash', desc: 'Record cash received', activeClass: 'border-green-500 bg-green-50', iconClass: 'text-green-600' },
  { mode: 'upi', icon: Smartphone, label: 'UPI', desc: 'Razorpay UPI / GPay / PhonePe', activeClass: 'border-blue-500 bg-blue-50', iconClass: 'text-blue-600' },
  { mode: 'card', icon: CreditCard, label: 'Card', desc: 'Debit / Credit via Razorpay', activeClass: 'border-purple-500 bg-purple-50', iconClass: 'text-purple-600' },
]

// ── Date range helper ─────────────────────────────────────────
function getPeriodDates(period: Period, customFrom: string, customTo: string): { from: string; to: string; label: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() // 0-indexed

  const pad = (n: number) => String(n).padStart(2, '0')
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

  switch (period) {
    case 'this_month': {
      const from = new Date(y, m, 1)
      const to = new Date(y, m + 1, 0)
      return { from: iso(from), to: iso(to), label: from.toLocaleString('en-IN', { month: 'long', year: 'numeric' }) }
    }
    case 'last_month': {
      const from = new Date(y, m - 1, 1)
      const to = new Date(y, m, 0)
      return { from: iso(from), to: iso(to), label: from.toLocaleString('en-IN', { month: 'long', year: 'numeric' }) }
    }
    case 'this_quarter': {
      const qStart = Math.floor(m / 3) * 3
      const from = new Date(y, qStart, 1)
      const to = new Date(y, qStart + 3, 0)
      const qNames = ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec']
      return { from: iso(from), to: iso(to), label: `Q${Math.floor(m / 3) + 1} ${y} (${qNames[Math.floor(m / 3)]})` }
    }
    case 'last_quarter': {
      const lqStart = (Math.floor(m / 3) - 1 + 4) % 4 * 3
      const lqYear = m < 3 ? y - 1 : y
      const from = new Date(lqYear, lqStart, 1)
      const to = new Date(lqYear, lqStart + 3, 0)
      const qNames = ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec']
      return { from: iso(from), to: iso(to), label: `Q${Math.floor(lqStart / 3) + 1} ${lqYear} (${qNames[Math.floor(lqStart / 3)]})` }
    }
    case 'this_year': {
      const from = new Date(y, 0, 1)
      const to = new Date(y, 11, 31)
      return { from: iso(from), to: iso(to), label: `FY ${y}` }
    }
    case 'custom':
      return { from: customFrom, to: customTo, label: `${customFrom} to ${customTo}` }
    default:
      return { from: iso(new Date(y, m, 1)), to: iso(new Date()), label: 'Custom' }
  }
}

// ── Compute CA report from bills ──────────────────────────────
function computeCAReport(bills: Bill[], from: string, to: string, label: string): CAReportData {
  const fromDate = new Date(from + 'T00:00:00')
  const toDate = new Date(to + 'T23:59:59')

  const inRange = bills.filter(b => {
    const d = new Date(b.created_at)
    return d >= fromDate && d <= toDate
  })

  const paid = inRange.filter(b => b.status === 'paid')
  const pending = inRange.filter(b => b.status === 'pending')

  const totalGross = paid.reduce((s, b) => s + (Number(b.subtotal) || 0), 0)
  const totalDiscount = paid.reduce((s, b) => s + (Number(b.discount) || 0), 0)
  const totalNet = paid.reduce((s, b) => s + (Number(b.net_amount) || 0), 0)

  // Payment mode breakdown
  const modeMap: Record<string, { amount: number; count: number }> = {}
  paid.forEach(b => {
    const mode = b.payment_mode || 'unknown'
    if (!modeMap[mode]) modeMap[mode] = { amount: 0, count: 0 }
    modeMap[mode].amount += Number(b.net_amount) || 0
    modeMap[mode].count += 1
  })
  const paymentBreakdown = Object.entries(modeMap).map(([mode, v]) => ({ mode, ...v }))
    .sort((a, b) => b.amount - a.amount)

  // Service breakdown — flatten all bill items
  const serviceMap: Record<string, { amount: number; count: number }> = {}
  paid.forEach(b => {
    if (!Array.isArray(b.items)) return
    b.items.forEach((item: BillItem) => {
      const key = item.label || 'Other'
      if (!serviceMap[key]) serviceMap[key] = { amount: 0, count: 0 }
      serviceMap[key].amount += Number(item.amount) || 0
      serviceMap[key].count += 1
    })
  })
  const serviceBreakdown = Object.entries(serviceMap).map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.amount - a.amount)

  return {
    period: label,
    fromDate: from,
    toDate: to,
    totalGross,
    totalDiscount,
    totalNet,
    billCount: paid.length,
    pendingCount: pending.length,
    pendingAmount: pending.reduce((s, b) => s + (Number(b.net_amount) || 0), 0),
    paymentBreakdown,
    serviceBreakdown,
  }
}

// ── Format currency ───────────────────────────────────────────
function inr(n: number) { return `₹${n.toLocaleString('en-IN')}` }

// ── Build WhatsApp message text ───────────────────────────────
function buildWhatsAppMessage(r: CAReportData, hs: any): string {
  const modeLines = r.paymentBreakdown
    .map(m => `• ${m.mode.toUpperCase()}: ${inr(m.amount)} (${m.count} bills)`)
    .join('\n')
  const svcLines = r.serviceBreakdown.slice(0, 8)
    .map(s => `• ${s.label}: ${inr(s.amount)}`)
    .join('\n')

  return encodeURIComponent(
    `*${hs.hospitalName || 'Clinic'} — Revenue Report*
*Period: ${r.period}*

*Summary*
Total Billed (Gross): ${inr(r.totalGross)}
Total Discounts Given: ${inr(r.totalDiscount)}
*Net Collected: ${inr(r.totalNet)}*
Bills Paid: ${r.billCount}
Pending Bills: ${r.pendingCount} (${inr(r.pendingAmount)})

*Payment Mode Breakdown*
${modeLines || 'No paid bills in this period.'}

*Top Services*
${svcLines || '—'}

_Generated by NexMedicon HMS — ${new Date().toLocaleDateString('en-IN')}_`
  )
}

// ── Build Email body ──────────────────────────────────────────
function buildEmailBody(r: CAReportData, hs: any): string {
  const modeLines = r.paymentBreakdown
    .map(m => `  • ${m.mode.toUpperCase()}: ${inr(m.amount)} (${m.count} bills)`)
    .join('\n')
  const svcLines = r.serviceBreakdown.slice(0, 10)
    .map(s => `  • ${s.label}: ${inr(s.amount)}`)
    .join('\n')

  return encodeURIComponent(
    `Dear ${hs.caName || 'CA'},

Please find the revenue report for ${r.period} from ${hs.hospitalName || 'our clinic'}.

SUMMARY
-------
Gross Revenue (before discounts) : ${inr(r.totalGross)}
Total Discounts Given             : ${inr(r.totalDiscount)}
Net Revenue Collected             : ${inr(r.totalNet)}
Number of Paid Bills              : ${r.billCount}
Pending Bills                     : ${r.pendingCount} (${inr(r.pendingAmount)})

PAYMENT MODE BREAKDOWN
----------------------
${modeLines || 'No paid bills in this period.'}

SERVICE-WISE REVENUE
--------------------
${svcLines || '—'}

Period: ${r.fromDate} to ${r.toDate}
Generated: ${new Date().toLocaleDateString('en-IN')} by NexMedicon HMS

Regards,
${hs.doctorName || 'Doctor'}
${hs.hospitalName || ''}
${hs.phone || ''}
`
  )
}


// ══════════════════════════════════════════════════════════════
// MAIN PAGE COMPONENT
// ══════════════════════════════════════════════════════════════
export default function BillingPage() {
  const [view, setView] = useState<'list' | 'new' | 'receipt'>('list')
  const [bills, setBills] = useState<Bill[]>([])
  const [loadingBills, setLoadingBills] = useState(true)

  // New bill form
  const [patientQuery, setPatientQuery] = useState('')
  const [patientResults, setPatientResults] = useState<any[]>([])
  const [selPatient, setSelPatient] = useState<any>(null)
  const [billItems, setBillItems] = useState<BillItem[]>([])
  const [discount, setDiscount] = useState(0)
  const [payMode, setPayMode] = useState<PayMode>('cash')
  const [notes, setNotes] = useState('')
  const [customLabel, setCustomLabel] = useState('')
  const [customAmt, setCustomAmt] = useState('')
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState('')

  // Receipt
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null)
  const [cashSuccess, setCashSuccess] = useState(false)

  // Filters
  const [filterStatus, setFilterStatus] = useState<'all' | 'paid' | 'pending'>('all')
  const [filterMode, setFilterMode] = useState<'all' | 'cash' | 'upi' | 'card'>('all')

  // CA Report state
  const [showCAReport, setShowCAReport] = useState(false)
  const [period, setPeriod] = useState<Period>('this_month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [caReport, setCAReport] = useState<CAReportData | null>(null)
  const [caLoading, setCALoading] = useState(false)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchParams = useSearchParams()
  const hs = typeof window !== 'undefined' ? getHospitalSettings() : {} as any
  // Load CA settings separately (includes caName, caWhatsApp, caEmail)
  const caSettings = typeof window !== 'undefined' ? loadSettings() : { caName: '', caWhatsApp: '', caEmail: '' }

  // ── Load bills ───────────────────────────────────────────────
  const loadBills = useCallback(async () => {
    setLoadingBills(true)
    const { data } = await supabase.from('bills').select('*').order('created_at', { ascending: false }).limit(500)
    setBills((data || []) as Bill[])
    setLoadingBills(false)
  }, [])

  useEffect(() => { loadBills() }, [loadBills])

  // Auto-add fee from encounter type URL param
  useEffect(() => {
    const encType = searchParams.get('encounterType')
    if (encType && billItems.length === 0) {
      const hs2 = getHospitalSettings()
      const feeMap: Record<string, { label: string; amount: number }> = {
        OPD: { label: 'OPD Consultation', amount: Number(hs2.feeOPD) || 500 },
        ANC: { label: 'ANC Consultation', amount: Number(hs2.feeANC) || 400 },
        FollowUp: { label: 'Follow-up Consultation', amount: Number(hs2.feeFollowUp) || 300 },
        IPD: { label: 'IPD Admission (per day)', amount: Number(hs2.feeIPD) || 1500 },
        Emergency: { label: 'Emergency Consultation', amount: Number(hs2.feeEmergency) || 800 },
      }
      if (feeMap[encType]) setBillItems([feeMap[encType]])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Pre-fill patient from URL
  useEffect(() => {
    const patientId = searchParams.get('patientId')
    const patientName = searchParams.get('patientName')
    const mrn = searchParams.get('mrn')
    if (patientId && patientName && mrn && !selPatient) {
      setSelPatient({ id: patientId, full_name: decodeURIComponent(patientName), mrn, age: '', mobile: '' })
      setView('new')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // ── Patient search ───────────────────────────────────────────
  function searchPatients(q: string) {
    setPatientQuery(q); setSelPatient(null)
    if (q.trim().length < 2) { setPatientResults([]); return }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      const { data } = await supabase.from('patients')
        .select('id, full_name, mrn, age, mobile')
        .or(`full_name.ilike.%${q}%,mrn.ilike.%${q}%,mobile.ilike.%${q}%`)
        .limit(6)
      setPatientResults(data || [])
    }, 300)
  }

  function addPreset(p: { label: string; amount: number }) {
    const amt = p.amount > 0 ? p.amount : Number(prompt(`Enter amount for "${p.label}":`) || 0)
    if (amt > 0) setBillItems(prev => [...prev, { label: p.label, amount: amt }])
  }

  function addCustom() {
    if (!customLabel.trim() || !customAmt) return
    setBillItems(prev => [...prev, { label: customLabel.trim(), amount: Number(customAmt) }])
    setCustomLabel(''); setCustomAmt('')
  }

  function removeItem(i: number) { setBillItems(prev => prev.filter((_, j) => j !== i)) }

  const subtotal = billItems.reduce((s, i) => s + i.amount, 0)
  const netAmount = Math.max(0, subtotal - discount)

  // ── Save bill ────────────────────────────────────────────────
  async function saveBill(razorpayId: string | null, mode: PayMode): Promise<Bill | null> {
    const hs2 = getHospitalSettings()
    const payload = {
      patient_id: selPatient.id,
      patient_name: selPatient.full_name,
      mrn: selPatient.mrn,
      items: billItems,
      subtotal,
      discount,
      net_amount: netAmount,
      payment_mode: mode,
      status: 'paid' as BillStatus,
      razorpay_payment_id: razorpayId || null,
      notes: notes.trim() || null,
      created_by: hs2.doctorName || null,
      paid_at: new Date().toISOString(),
    }
    const { data, error } = await supabase.from('bills').insert(payload).select().single()
    if (error) { console.error('Bill save error:', error); return null }
    return data as Bill
  }

  // ── Handle payment ───────────────────────────────────────────
  async function handlePay() {
    if (!selPatient || billItems.length === 0) return
    setPaying(true); setPayError('')

    if (payMode === 'cash') {
      const bill = await saveBill(null, 'cash')
      setPaying(false)
      if (!bill) { setPayError('Failed to save bill. Check Supabase connection.'); return }
      await loadBills()
      setSelectedBill(bill); setCashSuccess(true); setView('receipt'); resetForm()
      return
    }

    const loaded = await loadRazorpay()
    if (!loaded) { setPaying(false); setPayError('Could not load Razorpay checkout.'); return }

    const rzpKey = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID
    if (!rzpKey || rzpKey === 'rzp_test_YOUR_KEY_HERE') {
      setPaying(false)
      setPayError('Razorpay Key not configured. Add NEXT_PUBLIC_RAZORPAY_KEY_ID to .env.local and restart.')
      return
    }

    const options = {
      key: rzpKey,
      amount: netAmount * 100,
      currency: 'INR',
      name: hs.hospitalName || 'NexMedicon HMS',
      description: billItems.map(i => i.label).join(', ').slice(0, 100),
      prefill: { name: selPatient.full_name, contact: selPatient.mobile },
      theme: { color: '#2563eb' },
      handler: async (response: any) => {
        const bill = await saveBill(response.razorpay_payment_id, payMode)
        setPaying(false)
        if (!bill) { setPayError('Payment received but bill save failed.'); return }
        await loadBills()
        setSelectedBill(bill); setView('receipt'); resetForm()
      },
      modal: { ondismiss: () => setPaying(false) },
    }

    try {
      const rzp = new (window as any).Razorpay(options)
      rzp.on('payment.failed', (resp: any) => { setPaying(false); setPayError(`Payment failed: ${resp.error.description}`) })
      rzp.open()
    } catch (e: any) { setPaying(false); setPayError(`Razorpay error: ${e.message}`) }
  }

  function resetForm() {
    setSelPatient(null); setPatientQuery(''); setPatientResults([])
    setBillItems([]); setDiscount(0); setPayMode('cash'); setNotes(''); setPayError('')
  }

  // ── CA Report generation ─────────────────────────────────────
  function generateCAReport() {
    setCALoading(true)
    const { from, to, label } = getPeriodDates(period, customFrom, customTo)

    // Validate custom date range
    if (period === 'custom') {
      if (!customFrom || !customTo) {
        alert('Please select both From and To dates for custom range.')
        setCALoading(false)
        return
      }
      if (new Date(customFrom) > new Date(customTo)) {
        alert('"From" date cannot be after "To" date.')
        setCALoading(false)
        return
      }
      // Warn if range > 1 year
      const diffDays = (new Date(customTo).getTime() - new Date(customFrom).getTime()) / (1000 * 60 * 60 * 24)
      if (diffDays > 366) {
        if (!confirm('The selected range is over 1 year. This may take a moment. Continue?')) {
          setCALoading(false)
          return
        }
      }
    }

    const report = computeCAReport(bills, from, to, label)
    setCAReport(report)
    setCALoading(false)
  }

  // ── Derived stats ────────────────────────────────────────────
  const todayStr = new Date().toDateString()
  const todayBills = bills.filter(b => new Date(b.created_at).toDateString() === todayStr && b.status === 'paid')
  const todayTotal = todayBills.reduce((s, b) => s + b.net_amount, 0)
  const allTotal = bills.filter(b => b.status === 'paid').reduce((s, b) => s + b.net_amount, 0)
  const filtered = bills.filter(b => {
    const statusOk = filterStatus === 'all' || b.status === filterStatus
    const modeOk = filterMode === 'all' || b.payment_mode === filterMode
    return statusOk && modeOk
  })

  // ─────────────────────────────────────────────────────────────
  // RECEIPT VIEW
  // ─────────────────────────────────────────────────────────────
  if (view === 'receipt' && selectedBill) {
    return (
      <AppShell>
        <div className="p-6 max-w-2xl mx-auto">
          <div className="no-print flex items-center gap-3 mb-5">
            <button onClick={() => { setView('list'); setSelectedBill(null); setCashSuccess(false) }}
              className="text-gray-400 hover:text-gray-700"><ArrowLeft className="w-5 h-5" /></button>
            <h1 className="text-xl font-bold text-gray-900">Payment Receipt</h1>
            <div className="ml-auto flex gap-2">
              <button onClick={() => window.print()} className="btn-secondary flex items-center gap-2 text-xs">
                <Printer className="w-3.5 h-3.5" /> Print
              </button>
              <Link href={`/patients/${selectedBill.patient_id}`} className="btn-secondary text-xs">Patient Record</Link>
              <button onClick={() => { resetForm(); setView('new') }} className="btn-primary text-xs">New Bill</button>
            </div>
          </div>
          {cashSuccess && (
            <div className="no-print mb-4 bg-green-50 border border-green-200 rounded-xl px-5 py-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-2xl">💵</span>
              </div>
              <div>
                <p className="font-bold text-green-800 text-sm">Cash Payment Received ✓</p>
                <p className="text-xs text-green-700">
                  {inr(selectedBill.net_amount)} collected in cash.
                  Bill #{selectedBill.id.slice(-6).toUpperCase()} marked as Paid.
                </p>
              </div>
            </div>
          )}
          <div className="no-print"><ReceiptDoc bill={selectedBill} hs={hs} /></div>
        </div>
        <div className="print-only p-8"><ReceiptDoc bill={selectedBill} hs={hs} /></div>
      </AppShell>
    )
  }

  // ─────────────────────────────────────────────────────────────
  // NEW BILL VIEW
  // ─────────────────────────────────────────────────────────────
  if (view === 'new') {
    const feePresets = getFeePresets()
    return (
      <AppShell>
        <div className="p-6 max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-5">
            <button onClick={() => { resetForm(); setView('list') }} className="text-gray-400 hover:text-gray-700">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-xl font-bold text-gray-900">New Bill</h1>
          </div>

          {payError && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {payError}
            </div>
          )}

          <div className="grid grid-cols-5 gap-6">
            {/* Left: fee selection */}
            <div className="col-span-3 space-y-5">
              {/* Step 1: Patient */}
              <div className="card p-5">
                <h2 className="section-title">1. Select Patient</h2>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input className="input pl-9" placeholder="Search patient by name, MRN, mobile..."
                    value={patientQuery} onChange={e => searchPatients(e.target.value)} />
                </div>
                {patientResults.length > 0 && !selPatient && (
                  <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden shadow-lg">
                    {patientResults.map(p => (
                      <button key={p.id} onClick={() => { setSelPatient(p); setPatientResults([]) }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50 text-left border-b border-gray-50 last:border-0">
                        <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-blue-700">{p.full_name.charAt(0)}</span>
                        </div>
                        <div>
                          <div className="text-sm font-semibold">{p.full_name}</div>
                          <div className="text-xs text-gray-400">{p.mrn} · {p.age}y · {p.mobile}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {selPatient && (
                  <div className="mt-2 flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5">
                    <div>
                      <span className="font-semibold text-blue-900">{selPatient.full_name}</span>
                      <span className="text-xs text-gray-500 ml-2">{selPatient.mrn}</span>
                    </div>
                    <button onClick={() => { setSelPatient(null); setPatientQuery('') }} className="text-gray-400 hover:text-red-500">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Step 2: Services */}
              <div className="card p-5">
                <h2 className="section-title">2. Add Services</h2>
                <div className="grid grid-cols-2 gap-2 mb-4 max-h-64 overflow-y-auto pr-1">
                  {feePresets.map(p => (
                    <button key={p.label} onClick={() => addPreset(p)}
                      className="text-left px-3 py-2 text-xs rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all">
                      <div className="font-medium text-gray-800">{p.label}</div>
                      <div className="text-gray-500 font-mono">{p.amount > 0 ? inr(p.amount) : 'Custom ₹'}</div>
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 mt-2 pt-3 border-t border-gray-100">
                  <input className="input flex-1 text-sm" placeholder="Custom service name"
                    value={customLabel} onChange={e => setCustomLabel(e.target.value)} />
                  <input className="input w-28 text-sm font-mono" placeholder="₹ amount" type="number" min="0"
                    value={customAmt} onChange={e => setCustomAmt(e.target.value)} />
                  <button onClick={addCustom} className="btn-secondary text-xs px-3">Add</button>
                </div>
              </div>
            </div>

            {/* Right: bill summary */}
            <div className="col-span-2 space-y-5">
              <div className="card p-5 sticky top-20">
                <h2 className="section-title">Bill Summary</h2>
                {billItems.length === 0 ? (
                  <p className="text-xs text-gray-400 italic py-4 text-center">Add services from the left panel.</p>
                ) : (
                  <div className="space-y-1 mb-4 max-h-48 overflow-y-auto">
                    {billItems.map((item, i) => (
                      <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 hover:bg-gray-100 group">
                        <span className="text-sm text-gray-800">{item.label}</span>
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-semibold text-gray-900">{inr(item.amount)}</span>
                          <button onClick={() => removeItem(i)} className="text-gray-300 hover:text-red-500 group-hover:text-gray-400 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {billItems.length > 0 && (
                  <div className="border-t border-gray-200 pt-3 space-y-2">
                    <div className="flex justify-between text-sm text-gray-500">
                      <span>Subtotal</span>
                      <span className="font-mono">{inr(subtotal)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">Discount (₹)</span>
                      <input className="input w-28 font-mono text-sm py-1 text-right" type="number" min="0" max={subtotal}
                        value={discount} onChange={e => setDiscount(Math.min(Number(e.target.value), subtotal))} />
                    </div>
                    <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2">
                      <span>Net Amount</span>
                      <span className="font-mono text-blue-700 text-lg">{inr(netAmount)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Step 3: Payment method */}
          <div className="card p-5 mb-5 mt-5">
            <h2 className="section-title">3. Payment Method</h2>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {PAY_MODES.map(({ mode, icon: Icon, label, desc, activeClass, iconClass }) => (
                <button key={mode} onClick={() => setPayMode(mode)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center
                    ${payMode === mode ? activeClass : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                  <Icon className={`w-6 h-6 ${payMode === mode ? iconClass : 'text-gray-400'}`} />
                  <div className="text-sm font-semibold text-gray-800">{label}</div>
                  <div className="text-xs text-gray-400 leading-tight">{desc}</div>
                </button>
              ))}
            </div>
            {(payMode === 'upi' || payMode === 'card') && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800 mb-4">
                <strong>Setup required:</strong> Add your Razorpay Key ID to{' '}
                <code className="bg-amber-100 px-1 rounded">NEXT_PUBLIC_RAZORPAY_KEY_ID</code> in{' '}
                <code className="bg-amber-100 px-1 rounded">.env.local</code> and restart.
              </div>
            )}
            <div>
              <label className="label">Notes (optional)</label>
              <input className="input" placeholder="e.g. Partial payment, insurance, instalment…"
                value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button onClick={() => { resetForm(); setView('list') }} className="btn-secondary">Cancel</button>
            <button onClick={handlePay}
              disabled={paying || !selPatient || billItems.length === 0 || netAmount === 0}
              className="btn-primary flex items-center gap-2 px-8 disabled:opacity-60 text-base">
              {paying
                ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <IndianRupee className="w-5 h-5" />}
              {paying ? 'Processing…' : payMode === 'cash'
                ? `Collect ${inr(netAmount)} Cash`
                : `Pay ${inr(netAmount)} via ${payMode.toUpperCase()}`}
            </button>
          </div>
        </div>
      </AppShell>
    )
  }

  // ─────────────────────────────────────────────────────────────
  // BILL LIST VIEW (default)
  // ─────────────────────────────────────────────────────────────
  return (
    <AppShell>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <IndianRupee className="w-6 h-6 text-green-600" /> Billing & Payments
            </h1>
            <p className="text-sm text-gray-500">Collect payments and generate receipts for patients.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowCAReport(v => !v)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all
                ${showCAReport
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-white text-purple-700 border-purple-300 hover:bg-purple-50'}`}>
              <Calculator className="w-4 h-4" />
              CA Report
              {showCAReport ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            <button onClick={() => { resetForm(); setView('new') }} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> New Bill
            </button>
          </div>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="card p-5 bg-green-50">
            <div className="text-3xl font-bold text-green-700 mb-1">{inr(todayTotal)}</div>
            <div className="text-xs font-semibold text-gray-600">Collected Today</div>
            <div className="text-xs text-gray-400">{todayBills.length} bill{todayBills.length !== 1 ? 's' : ''}</div>
          </div>
          <div className="card p-5 bg-blue-50">
            <div className="text-3xl font-bold text-blue-700 mb-1">
              {bills.filter(b => new Date(b.created_at).toDateString() === todayStr).length}
            </div>
            <div className="text-xs font-semibold text-gray-600">Bills Today</div>
            <div className="text-xs text-gray-400">all statuses</div>
          </div>
          <div className="card p-5 bg-purple-50">
            <div className="text-3xl font-bold text-purple-700 mb-1">{inr(allTotal)}</div>
            <div className="text-xs font-semibold text-gray-600">Total Collected</div>
            <div className="text-xs text-gray-400">all time</div>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════
            CA REPORT PANEL (collapsible)
        ══════════════════════════════════════════════════════ */}
        {showCAReport && (
          <div className="card p-6 mb-6 border-purple-200 bg-purple-50/40">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 bg-purple-100 rounded-xl flex items-center justify-center">
                <Calculator className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">CA Revenue Report</h2>
                <p className="text-xs text-gray-500">
                  Generate a financial summary and share it directly with your Chartered Accountant.
                </p>
              </div>
            </div>

            {/* Period selector */}
            <div className="grid grid-cols-3 gap-3 mb-4 sm:grid-cols-6">
              {([
                ['this_month', 'This Month'],
                ['last_month', 'Last Month'],
                ['this_quarter', 'This Quarter'],
                ['last_quarter', 'Last Quarter'],
                ['this_year', 'This Year'],
                ['custom', 'Custom Range'],
              ] as [Period, string][]).map(([p, label]) => (
                <button key={p} onClick={() => { setPeriod(p); setCAReport(null) }}
                  className={`text-xs font-semibold py-2 px-3 rounded-lg border transition-all
                    ${period === p
                      ? 'bg-purple-600 text-white border-purple-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-purple-300 hover:bg-purple-50'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Custom date inputs */}
            {period === 'custom' && (
              <div className="flex gap-3 mb-4 items-end">
                <div>
                  <label className="label">From Date</label>
                  <input type="date" className="input"
                    max={customTo || undefined}
                    value={customFrom} onChange={e => { setCustomFrom(e.target.value); setCAReport(null) }} />
                </div>
                <div>
                  <label className="label">To Date</label>
                  <input type="date" className="input"
                    min={customFrom || undefined}
                    max={new Date().toISOString().split('T')[0]}
                    value={customTo} onChange={e => { setCustomTo(e.target.value); setCAReport(null) }} />
                </div>
                {customFrom && customTo && (
                  <p className="text-xs text-gray-400 pb-2">
                    {Math.ceil((new Date(customTo).getTime() - new Date(customFrom).getTime()) / (1000 * 60 * 60 * 24))} days selected
                  </p>
                )}
              </div>
            )}

            <button onClick={generateCAReport} disabled={caLoading || loadingBills}
              className="btn-primary flex items-center gap-2 mb-5 disabled:opacity-60">
              {caLoading
                ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <Calculator className="w-4 h-4" />}
              {caLoading ? 'Generating...' : 'Generate Report'}
            </button>

            {/* ── CA settings warning ── */}
            {!caSettings.caWhatsApp && !caSettings.caEmail && (
              <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  CA contact details not configured. Go to{' '}
                  <Link href="/settings" className="underline font-semibold">Settings → CA Details</Link>
                  {' '}to add your CA&apos;s WhatsApp number and email so you can share reports in one tap.
                </span>
              </div>
            )}

            {/* ── Report output ── */}
            {caReport && (
              <div className="bg-white border border-purple-200 rounded-xl p-5">

                {/* Report header */}
                <div className="text-center pb-4 mb-5 border-b-2 border-purple-100">
                  <div className="text-lg font-bold text-gray-900">{hs.hospitalName || 'Clinic'}</div>
                  <div className="text-sm text-gray-500">Revenue Report — {caReport.period}</div>
                  <div className="text-xs text-gray-400">{caReport.fromDate} to {caReport.toDate}</div>
                </div>

                {/* Summary grid */}
                <div className="grid grid-cols-2 gap-4 mb-5 sm:grid-cols-4">
                  {[
                    { label: 'Gross Revenue', value: inr(caReport.totalGross), color: 'text-gray-800' },
                    { label: 'Total Discounts', value: inr(caReport.totalDiscount), color: 'text-orange-600' },
                    { label: 'Net Collected', value: inr(caReport.totalNet), color: 'text-green-700 font-bold text-lg' },
                    { label: 'Bills Paid', value: String(caReport.billCount), color: 'text-blue-700' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-gray-50 rounded-lg px-4 py-3 text-center">
                      <div className={`text-xl font-mono font-bold ${color}`}>{value}</div>
                      <div className="text-xs text-gray-500 mt-1">{label}</div>
                    </div>
                  ))}
                </div>

                {/* Pending bills alert */}
                {caReport.pendingCount > 0 && (
                  <div className="mb-4 bg-orange-50 border border-orange-200 rounded-lg px-4 py-2 text-sm text-orange-800 flex items-center gap-2">
                    <Clock className="w-4 h-4 flex-shrink-0" />
                    {caReport.pendingCount} pending bill{caReport.pendingCount > 1 ? 's' : ''} — {inr(caReport.pendingAmount)} not yet collected (not included in Net above)
                  </div>
                )}

                {/* Zero bills warning */}
                {caReport.billCount === 0 && (
                  <div className="mb-4 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-500 text-center">
                    No paid bills found for this period.
                  </div>
                )}

                <div className="grid grid-cols-2 gap-5">
                  {/* Payment mode breakdown */}
                  <div>
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Payment Mode Breakdown</h3>
                    {caReport.paymentBreakdown.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">No data</p>
                    ) : (
                      <div className="space-y-1">
                        {caReport.paymentBreakdown.map(m => (
                          <div key={m.mode} className="flex items-center justify-between text-sm py-1 border-b border-gray-50">
                            <span className="capitalize font-medium text-gray-700">
                              {m.mode === 'cash' ? '💵' : m.mode === 'upi' ? '📱' : '💳'} {m.mode}
                            </span>
                            <div className="text-right">
                              <div className="font-mono font-semibold text-gray-900">{inr(m.amount)}</div>
                              <div className="text-xs text-gray-400">{m.count} bill{m.count > 1 ? 's' : ''}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Service breakdown */}
                  <div>
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Top Services</h3>
                    {caReport.serviceBreakdown.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">No data</p>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {caReport.serviceBreakdown.map(s => (
                          <div key={s.label} className="flex items-center justify-between text-sm py-1 border-b border-gray-50">
                            <span className="text-gray-700 truncate max-w-[160px]" title={s.label}>{s.label}</span>
                            <div className="text-right flex-shrink-0 ml-2">
                              <div className="font-mono font-semibold text-gray-900">{inr(s.amount)}</div>
                              <div className="text-xs text-gray-400">×{s.count}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Share buttons */}
                <div className="mt-5 pt-4 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Share with CA</p>
                  <div className="flex flex-wrap gap-2">

                    {/* WhatsApp share */}
                    {caSettings.caWhatsApp ? (
                      <a
                        href={`https://wa.me/91${caSettings.caWhatsApp.replace(/\D/g, '')}?text=${buildWhatsAppMessage(caReport, { ...hs, caName: caSettings.caName })}`}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                        <MessageCircle className="w-4 h-4" />
                        WhatsApp {caSettings.caName ? `— ${caSettings.caName}` : 'CA'}
                      </a>
                    ) : (
                      <a
                        href={`https://wa.me/?text=${buildWhatsAppMessage(caReport, { ...hs, caName: caSettings.caName })}`}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                        <MessageCircle className="w-4 h-4" />
                        Share via WhatsApp
                      </a>
                    )}

                    {/* Email share */}
                    <a
                      href={`mailto:${caSettings.caEmail || ''}?subject=${encodeURIComponent(`Revenue Report — ${caReport.period} | ${hs.hospitalName || 'Clinic'}`)}&body=${buildEmailBody(caReport, { ...hs, caName: caSettings.caName })}`}
                      className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                      <Mail className="w-4 h-4" />
                      {caSettings.caEmail ? `Email — ${caSettings.caName || caSettings.caEmail}` : 'Send Email'}
                    </a>

                    {/* Print */}
                    <button onClick={() => window.print()}
                      className="flex items-center gap-2 btn-secondary text-sm">
                      <Printer className="w-4 h-4" />
                      Print / Save PDF
                    </button>

                  </div>
                  {(!caSettings.caWhatsApp || !caSettings.caEmail) && (
                    <p className="text-xs text-gray-400 mt-2">
                      <Link href="/settings" className="underline text-blue-600">Configure CA contact details in Settings</Link>
                      {' '}to pre-fill WhatsApp number and email automatically.
                    </p>
                  )}
                </div>

                <div className="mt-3 text-xs text-gray-400 text-right">
                  Generated {new Date().toLocaleString('en-IN')} · NexMedicon HMS
                </div>
              </div>
            )}
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex flex-wrap gap-2 mb-4 items-center">
          <span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Status:</span>
          {(['all', 'paid', 'pending'] as const).map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full capitalize transition-all
                ${filterStatus === s ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {s}
            </button>
          ))}
          <span className="text-xs text-gray-300 mx-1">|</span>
          <span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Mode:</span>
          {([['all', 'All'], ['cash', '💵 Cash'], ['upi', '📱 UPI'], ['card', '💳 Card']] as const).map(([m, label]) => (
            <button key={m} onClick={() => setFilterMode(m as any)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-all
                ${filterMode === m ? 'bg-green-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Bill list */}
        {loadingBills ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="card p-12 text-center text-gray-400">
            <Receipt className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium mb-1">{bills.length === 0 ? 'No bills yet' : 'No bills match this filter'}</p>
            {bills.length === 0 && (
              <button onClick={() => { resetForm(); setView('new') }}
                className="btn-primary inline-flex items-center gap-2 text-xs mt-3">
                <Plus className="w-3.5 h-3.5" /> Create First Bill
              </button>
            )}
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {['Date', 'Patient', 'Items', 'Amount', 'Mode', 'Status', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(bill => (
                  <tr key={bill.id}
                    className="border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => { setSelectedBill(bill); setView('receipt') }}>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{formatDate(bill.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{bill.patient_name}</div>
                      <div className="text-xs text-gray-400">{bill.mrn}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs max-w-[200px] truncate">
                      {Array.isArray(bill.items) ? bill.items.map((i: any) => i.label).join(', ') : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-gray-900 whitespace-nowrap">
                      {inr(Number(bill.net_amount))}
                      {Number(bill.discount) > 0 && (
                        <div className="text-xs text-gray-400 font-normal">-{inr(Number(bill.discount))} disc.</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize
                        ${bill.payment_mode === 'cash' ? 'bg-green-100 text-green-700' :
                          bill.payment_mode === 'upi' ? 'bg-blue-100 text-blue-700' :
                            bill.payment_mode === 'card' ? 'bg-purple-100 text-purple-700' :
                              'bg-gray-100 text-gray-600'}`}>
                        {bill.payment_mode || 'pending'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {bill.status === 'paid' ? (
                        <span className="flex items-center gap-1 text-xs text-green-700 font-semibold">
                          <CheckCircle className="w-3.5 h-3.5" /> Paid
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-orange-700 font-semibold">
                          <Clock className="w-3.5 h-3.5" /> Pending
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-blue-600 flex items-center gap-1">
                        <Printer className="w-3 h-3" /> Receipt
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}

// ── Receipt document component ────────────────────────────────
function ReceiptDoc({ bill, hs }: { bill: Bill; hs: any }) {
  const items = Array.isArray(bill.items) ? bill.items : []
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-8 shadow-sm">
      <div className="text-center pb-4 mb-5 border-b-2 border-gray-800">
        <div className="text-xl font-bold tracking-wide uppercase">{hs.hospitalName || 'NexMedicon Hospital'}</div>
        {hs.address && <div className="text-sm text-gray-500">{hs.address}</div>}
        {hs.phone && <div className="text-sm text-gray-500">Tel: {hs.phone}</div>}
        {(hs.regNo || hs.gstin) && (
          <div className="text-xs text-gray-400">
            {hs.regNo && `Reg: ${hs.regNo}`}{hs.regNo && hs.gstin && ' · '}{hs.gstin && `GSTIN: ${hs.gstin}`}
          </div>
        )}
        <div className="text-lg font-bold mt-2 uppercase tracking-wider">Payment Receipt</div>
      </div>
      <div className="grid grid-cols-2 gap-4 mb-5 text-sm">
        <div className="space-y-1">
          <div><span className="font-semibold">Patient: </span>{bill.patient_name}</div>
          <div><span className="font-semibold">MRN: </span><span className="font-mono">{bill.mrn}</span></div>
        </div>
        <div className="space-y-1 text-right">
          <div><span className="font-semibold">Receipt No: </span><span className="font-mono text-xs">{bill.id.slice(-10).toUpperCase()}</span></div>
          <div><span className="font-semibold">Date: </span>{formatDate(bill.created_at)}</div>
        </div>
      </div>
      <table className="w-full text-sm mb-4">
        <thead>
          <tr className="border-b-2 border-gray-300">
            <th className="text-left py-2 pr-4 font-semibold text-gray-600">#</th>
            <th className="text-left py-2 font-semibold text-gray-600">Description</th>
            <th className="text-right py-2 font-semibold text-gray-600">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item: any, i: number) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="py-2 pr-4 text-gray-400">{i + 1}</td>
              <td className="py-2">{item.label}</td>
              <td className="py-2 text-right font-mono">{inr(Number(item.amount))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-200">
            <td colSpan={2} className="py-2 text-right text-gray-500 pr-4">Subtotal</td>
            <td className="py-2 text-right font-mono">{inr(Number(bill.subtotal))}</td>
          </tr>
          {Number(bill.discount) > 0 && (
            <tr>
              <td colSpan={2} className="py-1 text-right text-gray-500 pr-4">Discount</td>
              <td className="py-1 text-right font-mono text-green-700">− {inr(Number(bill.discount))}</td>
            </tr>
          )}
          <tr className="border-t-2 border-gray-800">
            <td colSpan={2} className="py-2 text-right font-bold text-base pr-4">Net Amount Paid</td>
            <td className="py-2 text-right font-bold font-mono text-base">{inr(Number(bill.net_amount))}</td>
          </tr>
        </tfoot>
      </table>
      <div className="flex justify-between items-center border border-green-200 rounded-lg px-4 py-3 mb-4 bg-green-50">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-600" />
          <span className="font-semibold text-green-800">Payment Received</span>
        </div>
        <div className="text-sm text-gray-600">
          Mode: <strong className="capitalize">{bill.payment_mode}</strong>
          {bill.razorpay_payment_id && (
            <span className="ml-2 text-xs text-gray-400 font-mono">Ref: {bill.razorpay_payment_id}</span>
          )}
        </div>
      </div>
      {bill.notes && <div className="text-xs text-gray-500 mb-3">Notes: {bill.notes}</div>}
      <div className="text-center text-xs text-gray-400 border-t border-gray-100 pt-3">
        Thank you for choosing {hs.hospitalName || 'NexMedicon Hospital'}. Wishing you good health!
      </div>
    </div>
  )
}