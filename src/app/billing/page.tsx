'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, getHospitalSettings } from '@/lib/utils'
import {
  IndianRupee, Search, CheckCircle, Clock, Printer,
  CreditCard, Smartphone, Banknote, Plus, Trash2, X,
  ArrowLeft, Receipt, AlertCircle
} from 'lucide-react'

// ── Common fee presets ────────────────────────────────────────
// Dynamic fee presets — reads from Settings so doctor's custom fees are used
function getFeePresets() {
  const hs = typeof window !== 'undefined' ? getHospitalSettings() : {} as any
  return [
    { label: 'OPD Consultation',         amount: Number(hs.feeOPD)       || 500  },
    { label: 'ANC Consultation',         amount: Number(hs.feeANC)       || 400  },
    { label: 'Follow-up Consultation',   amount: Number(hs.feeFollowUp)  || 300  },
    { label: 'Emergency Consultation',   amount: Number(hs.feeEmergency) || 800  },
  { label: 'USG (Obstetric)',          amount: 1200 },
  { label: 'USG (Pelvis)',             amount: 1000 },
  { label: 'Colour Doppler',           amount: 2000 },
  { label: 'PAP Smear',               amount: 600  },
  { label: 'Colposcopy',              amount: 2500 },
  { label: 'Dressing / Procedure',    amount: 300  },
  { label: 'Injection Administration',amount: 100  },
  { label: 'IUD Insertion',           amount: 800  },
  { label: 'IPD Admission (per day)', amount: 1500 },
  { label: 'OT Charges (minor)',      amount: 5000 },
  { label: 'OT Charges (major)',      amount: 15000},
  { label: 'Blood Test (CBC)',        amount: 300  },
  { label: 'Blood Test (panel)',      amount: 800  },
  { label: 'Medicines / Pharmacy',    amount: 0    },   // custom amount
  ]
}

interface BillItem { label: string; amount: number }
type PayMode   = 'cash' | 'upi' | 'card'
type BillStatus = 'pending' | 'paid' | 'cancelled'

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

// ── Razorpay script loader ────────────────────────────────────
function loadRazorpay(): Promise<boolean> {
  return new Promise(resolve => {
    if ((window as any).Razorpay) { resolve(true); return }
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload  = () => resolve(true)
    s.onerror = () => resolve(false)
    document.body.appendChild(s)
  })
}

// ── Payment mode card ─────────────────────────────────────────
// Using static class names to avoid Tailwind purge issues
const PAY_MODES: { mode: PayMode; icon: any; label: string; desc: string;
  activeClass: string; iconClass: string }[] = [
  {
    mode: 'cash', icon: Banknote, label: 'Cash', desc: 'Record cash received',
    activeClass: 'border-green-500 bg-green-50',
    iconClass:   'text-green-600',
  },
  {
    mode: 'upi', icon: Smartphone, label: 'UPI', desc: 'Razorpay UPI / GPay / PhonePe',
    activeClass: 'border-blue-500 bg-blue-50',
    iconClass:   'text-blue-600',
  },
  {
    mode: 'card', icon: CreditCard, label: 'Card', desc: 'Debit / Credit via Razorpay',
    activeClass: 'border-purple-500 bg-purple-50',
    iconClass:   'text-purple-600',
  },
]

export default function BillingPage() {
  const [view,         setView]         = useState<'list'|'new'|'receipt'>('list')
  const [bills,        setBills]        = useState<Bill[]>([])
  const [loadingBills, setLoadingBills] = useState(true)

  // New bill form state
  const [patientQuery,   setPatientQuery]   = useState('')
  const [patientResults, setPatientResults] = useState<any[]>([])
  const [selPatient,     setSelPatient]     = useState<any>(null)
  const [billItems,      setBillItems]      = useState<BillItem[]>([])
  const [discount,       setDiscount]       = useState(0)
  const [payMode,        setPayMode]        = useState<PayMode>('cash')
  const [notes,          setNotes]          = useState('')
  const [customLabel,    setCustomLabel]    = useState('')
  const [customAmt,      setCustomAmt]      = useState('')
  const [paying,         setPaying]         = useState(false)
  const [payError,       setPayError]       = useState('')

  // Receipt view
  const [selectedBill,   setSelectedBill]   = useState<Bill | null>(null)

  // Filter
  const [filterStatus,   setFilterStatus]   = useState<'all'|'paid'|'pending'>('all')
  const [filterMode,     setFilterMode]     = useState<'all'|'cash'|'upi'|'card'>('all')
  const searchTimer = useRef<ReturnType<typeof setTimeout>|null>(null)

  const searchParams = useSearchParams()
  const hs = typeof window !== 'undefined' ? getHospitalSettings() : {} as any

  // ── Load bills from Supabase ───────────────────────────────
  const loadBills = useCallback(async () => {
    setLoadingBills(true)
    const { data } = await supabase
      .from('bills')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    setBills((data || []) as Bill[])
    setLoadingBills(false)
  }, [])

  useEffect(() => { loadBills() }, [loadBills])

  // Auto-add fee based on encounter type when arriving from OPD flow
  useEffect(() => {
    const encType = searchParams.get('encounterType')
    if (encType && billItems.length === 0) {
      const hs2 = getHospitalSettings()
      const feeMap: Record<string, { label:string; amount:number }> = {
        OPD:       { label:'OPD Consultation',       amount: Number(hs2.feeOPD)       || 500  },
        ANC:       { label:'ANC Consultation',       amount: Number(hs2.feeANC)       || 400  },
        FollowUp:  { label:'Follow-up Consultation', amount: Number(hs2.feeFollowUp)  || 300  },
        IPD:       { label:'IPD Admission (per day)',amount: Number(hs2.feeIPD)       || 1500 },
        Emergency: { label:'Emergency Consultation', amount: Number(hs2.feeEmergency) || 800  },
      }
      if (feeMap[encType]) setBillItems([feeMap[encType]])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Pre-fill patient from URL params (e.g. from patient registration success screen)
  useEffect(() => {
    const patientId   = searchParams.get('patientId')
    const patientName = searchParams.get('patientName')
    const mrn         = searchParams.get('mrn')
    if (patientId && patientName && mrn && !selPatient) {
      setSelPatient({ id: patientId, full_name: decodeURIComponent(patientName), mrn, age: '', mobile: '' })
      setView('new')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // ── Patient search ─────────────────────────────────────────
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
    // If preset has 0 amount (like Medicines), prompt for amount
    const amt = p.amount > 0 ? p.amount : Number(prompt(`Enter amount for "${p.label}":`) || 0)
    if (amt > 0) setBillItems(prev => [...prev, { label: p.label, amount: amt }])
  }

  function addCustom() {
    if (!customLabel.trim() || !customAmt) return
    setBillItems(prev => [...prev, { label: customLabel.trim(), amount: Number(customAmt) }])
    setCustomLabel(''); setCustomAmt('')
  }

  function removeItem(i: number) { setBillItems(prev => prev.filter((_, j) => j !== i)) }

  const subtotal  = billItems.reduce((s, i) => s + i.amount, 0)
  const netAmount = Math.max(0, subtotal - discount)

  // ── Save bill to Supabase ──────────────────────────────────
  async function saveBill(razorpayId: string | null, mode: PayMode): Promise<Bill | null> {
    const hs2 = getHospitalSettings()
    const payload = {
      patient_id:          selPatient.id,
      patient_name:        selPatient.full_name,
      mrn:                 selPatient.mrn,
      items:               billItems,
      subtotal,
      discount,
      net_amount:          netAmount,
      payment_mode:        mode,
      status:              'paid' as BillStatus,
      razorpay_payment_id: razorpayId || null,
      notes:               notes.trim() || null,
      created_by:          hs2.doctorName || null,
      paid_at:             new Date().toISOString(),
    }
    const { data, error } = await supabase.from('bills').insert(payload).select().single()
    if (error) { console.error('Bill save error:', error); return null }
    return data as Bill
  }

  // ── Handle payment ─────────────────────────────────────────
  async function handlePay() {
    if (!selPatient || billItems.length === 0) return
    setPaying(true); setPayError('')

    if (payMode === 'cash') {
      const bill = await saveBill(null, 'cash')
      setPaying(false)
      if (!bill) { setPayError('Failed to save bill. Check Supabase connection.'); return }
      await loadBills()
      setSelectedBill(bill); setView('receipt'); resetForm()
      return
    }

    // UPI / Card via Razorpay
    const loaded = await loadRazorpay()
    if (!loaded) {
      setPaying(false)
      setPayError('Could not load Razorpay checkout. Check your internet connection.')
      return
    }

    const rzpKey = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID
    if (!rzpKey || rzpKey === 'rzp_test_YOUR_KEY_HERE') {
      setPaying(false)
      setPayError('Razorpay Key not configured. Add NEXT_PUBLIC_RAZORPAY_KEY_ID to .env.local and restart the server.')
      return
    }

    const options = {
      key:         rzpKey,
      amount:      netAmount * 100,   // paise
      currency:    'INR',
      name:        hs.hospitalName || 'NexMedicon HMS',
      description: billItems.map(i => i.label).join(', ').slice(0, 100),
      prefill:     { name: selPatient.full_name, contact: selPatient.mobile },
      theme:       { color: '#2563eb' },
      handler: async (response: any) => {
        const bill = await saveBill(response.razorpay_payment_id, payMode)
        setPaying(false)
        if (!bill) { setPayError('Payment received but bill save failed. Contact support.'); return }
        await loadBills()
        setSelectedBill(bill); setView('receipt'); resetForm()
      },
      modal: { ondismiss: () => setPaying(false) },
    }

    try {
      const rzp = new (window as any).Razorpay(options)
      rzp.on('payment.failed', (resp: any) => {
        setPaying(false)
        setPayError(`Payment failed: ${resp.error.description}`)
      })
      rzp.open()
    } catch (e: any) {
      setPaying(false)
      setPayError(`Razorpay error: ${e.message}`)
    }
  }

  function resetForm() {
    setSelPatient(null); setPatientQuery(''); setPatientResults([])
    setBillItems([]); setDiscount(0); setPayMode('cash'); setNotes(''); setPayError('')
  }

  // ── Derived stats ──────────────────────────────────────────
  const todayStr    = new Date().toDateString()
  const todayBills  = bills.filter(b => new Date(b.created_at).toDateString() === todayStr && b.status === 'paid')
  const todayTotal  = todayBills.reduce((s, b) => s + b.net_amount, 0)
  const allTotal    = bills.filter(b => b.status === 'paid').reduce((s, b) => s + b.net_amount, 0)
  const filtered    = bills.filter(b => {
    const statusOk = filterStatus === 'all' || b.status === filterStatus
    const modeOk   = filterMode   === 'all' || b.payment_mode === filterMode
    return statusOk && modeOk
  })

  // ─────────────────────────────────────────────────────────
  // RECEIPT VIEW
  // ─────────────────────────────────────────────────────────
  if (view === 'receipt' && selectedBill) {
    return (
      <AppShell>
        <div className="p-6 max-w-2xl mx-auto">
          <div className="no-print flex items-center gap-3 mb-5">
            <button onClick={() => { setView('list'); setSelectedBill(null) }}
              className="text-gray-400 hover:text-gray-700"><ArrowLeft className="w-5 h-5"/></button>
            <h1 className="text-xl font-bold text-gray-900">Payment Receipt</h1>
            <div className="ml-auto flex gap-2">
              <button onClick={() => window.print()}
                className="btn-secondary flex items-center gap-2 text-xs">
                <Printer className="w-3.5 h-3.5"/> Print
              </button>
              <Link href={`/patients/${selectedBill.patient_id}`}
                className="btn-secondary text-xs">Patient Record</Link>
              <button onClick={() => { resetForm(); setView('new') }}
                className="btn-primary text-xs">New Bill</button>
            </div>
          </div>
          <div className="no-print"><ReceiptDoc bill={selectedBill} hs={hs} /></div>
        </div>
        <div className="print-only p-8"><ReceiptDoc bill={selectedBill} hs={hs} /></div>
      </AppShell>
    )
  }

  // ─────────────────────────────────────────────────────────
  // NEW BILL VIEW
  // ─────────────────────────────────────────────────────────
  if (view === 'new') {
    return (
      <AppShell>
        <div className="p-6 max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-5">
            <button onClick={() => { resetForm(); setView('list') }}
              className="text-gray-400 hover:text-gray-700"><ArrowLeft className="w-5 h-5"/></button>
            <h1 className="text-xl font-bold text-gray-900">New Bill</h1>
          </div>

          {payError && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0"/>{payError}
            </div>
          )}

          {/* Step 1: Patient */}
          <div className="card p-5 mb-4">
            <h2 className="section-title">1. Select Patient</h2>
            {selPatient ? (
              <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                <div>
                  <div className="font-semibold text-gray-900">{selPatient.full_name}</div>
                  <div className="text-xs text-gray-500">{selPatient.mrn} · {selPatient.age}y · {selPatient.mobile}</div>
                </div>
                <button onClick={() => { setSelPatient(null); setPatientQuery(''); setPatientResults([]) }}
                  className="text-gray-400 hover:text-red-500 p-1"><X className="w-4 h-4"/></button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
                <input className="input pl-9"
                  placeholder="Search by patient name, MRN, or mobile number…"
                  value={patientQuery} onChange={e => searchPatients(e.target.value)} autoFocus/>
                {patientResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-20 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 overflow-hidden">
                    {patientResults.map(p => (
                      <button key={p.id} onClick={() => { setSelPatient(p); setPatientResults([]) }}
                        className="w-full text-left px-4 py-3 hover:bg-blue-50 flex items-center gap-3 border-b border-gray-50 last:border-0">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-blue-700">{p.full_name[0]}</span>
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-gray-900">{p.full_name}</div>
                          <div className="text-xs text-gray-400">{p.mrn} · {p.age}y · {p.mobile}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Step 2: Fee items */}
          <div className="card p-5 mb-4">
            <h2 className="section-title">2. Fee Items</h2>

            {/* Quick add from preset */}
            <div className="mb-3">
              <label className="label">Quick Add</label>
              <select className="input"
                onChange={e => {
                  const found = getFeePresets().find(p => p.label === e.target.value)
                  if (found) addPreset(found)
                  e.target.value = ''
                }}>
                <option value="">+ Add from common fees list…</option>
                {getFeePresets().map(p => (
                  <option key={p.label} value={p.label}>
                    {p.label}{p.amount > 0 ? ` — ₹${p.amount}` : ' — custom amount'}
                  </option>
                ))}
              </select>
            </div>

            {/* Custom item */}
            <div className="flex gap-2 mb-4 items-end">
              <div className="flex-1">
                <label className="label">Custom Description</label>
                <input className="input" placeholder="e.g. Scanning charges, Lab test…"
                  value={customLabel} onChange={e => setCustomLabel(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addCustom()}/>
              </div>
              <div className="w-36">
                <label className="label">Amount (₹)</label>
                <input className="input font-mono" type="number" min="0" placeholder="0"
                  value={customAmt} onChange={e => setCustomAmt(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addCustom()}/>
              </div>
              <button onClick={addCustom} className="btn-secondary flex items-center gap-1 text-xs mb-0.5">
                <Plus className="w-3.5 h-3.5"/> Add
              </button>
            </div>

            {/* Items table */}
            {billItems.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-5 border-2 border-dashed border-gray-100 rounded-lg">
                No items yet. Use the dropdown or add a custom item above.
              </p>
            ) : (
              <div>
                <div className="space-y-1 mb-3">
                  {billItems.map((item, i) => (
                    <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 hover:bg-gray-100 group">
                      <span className="text-sm text-gray-800">{item.label}</span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-semibold text-gray-900">
                          ₹{item.amount.toLocaleString('en-IN')}
                        </span>
                        <button onClick={() => removeItem(i)}
                          className="text-gray-300 hover:text-red-500 group-hover:text-gray-400 transition-colors">
                          <Trash2 className="w-3.5 h-3.5"/>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Totals */}
                <div className="border-t border-gray-200 pt-3 space-y-2">
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>Subtotal</span>
                    <span className="font-mono">₹{subtotal.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Discount (₹)</span>
                    <input className="input w-32 font-mono text-sm py-1 text-right"
                      type="number" min="0" max={subtotal} value={discount}
                      onChange={e => setDiscount(Math.min(Number(e.target.value), subtotal))}/>
                  </div>
                  <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2">
                    <span>Net Amount</span>
                    <span className="font-mono text-blue-700 text-lg">
                      ₹{netAmount.toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Step 3: Payment method */}
          <div className="card p-5 mb-5">
            <h2 className="section-title">3. Payment Method</h2>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {PAY_MODES.map(({ mode, icon: Icon, label, desc, activeClass, iconClass }) => (
                <button key={mode} onClick={() => setPayMode(mode)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center
                    ${payMode === mode ? activeClass : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                  <Icon className={`w-6 h-6 ${payMode === mode ? iconClass : 'text-gray-400'}`}/>
                  <div className="text-sm font-semibold text-gray-800">{label}</div>
                  <div className="text-xs text-gray-400 leading-tight">{desc}</div>
                </button>
              ))}
            </div>

            {(payMode === 'upi' || payMode === 'card') && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800 mb-4">
                <strong>Setup required:</strong> Add your Razorpay Key ID to <code className="bg-amber-100 px-1 rounded">NEXT_PUBLIC_RAZORPAY_KEY_ID</code> in <code className="bg-amber-100 px-1 rounded">.env.local</code> and restart the dev server.
                Get your key from <strong>dashboard.razorpay.com → Settings → API Keys</strong>.
              </div>
            )}

            <div>
              <label className="label">Notes (optional)</label>
              <input className="input" placeholder="e.g. Partial payment, insurance, instalment…"
                value={notes} onChange={e => setNotes(e.target.value)}/>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button onClick={() => { resetForm(); setView('list') }} className="btn-secondary">Cancel</button>
            <button onClick={handlePay}
              disabled={paying || !selPatient || billItems.length === 0 || netAmount === 0}
              className="btn-primary flex items-center gap-2 px-8 disabled:opacity-60 text-base">
              {paying
                ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"/>
                : <IndianRupee className="w-5 h-5"/>}
              {paying
                ? 'Processing…'
                : payMode === 'cash'
                  ? `Collect ₹${netAmount.toLocaleString('en-IN')} Cash`
                  : `Pay ₹${netAmount.toLocaleString('en-IN')} via ${payMode.toUpperCase()}`}
            </button>
          </div>
        </div>
      </AppShell>
    )
  }

  // ─────────────────────────────────────────────────────────
  // BILL LIST VIEW
  // ─────────────────────────────────────────────────────────
  return (
    <AppShell>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <IndianRupee className="w-6 h-6 text-green-600"/> Billing & Payments
            </h1>
            <p className="text-sm text-gray-500">Collect payments and generate receipts for patients.</p>
          </div>
          <button onClick={() => { resetForm(); setView('new') }}
            className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4"/> New Bill
          </button>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="card p-5 bg-green-50">
            <div className="text-3xl font-bold text-green-700 mb-1">
              ₹{todayTotal.toLocaleString('en-IN')}
            </div>
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
            <div className="text-3xl font-bold text-purple-700 mb-1">
              ₹{allTotal.toLocaleString('en-IN')}
            </div>
            <div className="text-xs font-semibold text-gray-600">Total Collected</div>
            <div className="text-xs text-gray-400">all time</div>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex flex-wrap gap-2 mb-4 items-center">
          <span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Status:</span>
          {(['all', 'paid', 'pending'] as const).map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full capitalize transition-all
                ${filterStatus === s
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {s}
            </button>
          ))}
          <span className="text-xs text-gray-300 mx-1">|</span>
          <span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Mode:</span>
          {([['all','All'], ['cash','💵 Cash'], ['upi','📱 UPI'], ['card','💳 Card']] as const).map(([m,label]) => (
            <button key={m} onClick={() => setFilterMode(m as any)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-all
                ${filterMode === m
                  ? 'bg-green-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Bill list */}
        {loadingBills ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card p-12 text-center text-gray-400">
            <Receipt className="w-10 h-10 mx-auto mb-3 opacity-30"/>
            <p className="font-medium mb-1">
              {bills.length === 0 ? 'No bills yet' : 'No bills match this filter'}
            </p>
            {bills.length === 0 && (
              <button onClick={() => { resetForm(); setView('new') }}
                className="btn-primary inline-flex items-center gap-2 text-xs mt-3">
                <Plus className="w-3.5 h-3.5"/> Create First Bill
              </button>
            )}
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {['Date','Patient','Items','Amount','Mode','Status',''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(bill => (
                  <tr key={bill.id}
                    className="border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => { setSelectedBill(bill); setView('receipt') }}>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {formatDate(bill.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{bill.patient_name}</div>
                      <div className="text-xs text-gray-400">{bill.mrn}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs max-w-[200px] truncate">
                      {Array.isArray(bill.items)
                        ? bill.items.map((i: any) => i.label).join(', ')
                        : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-gray-900 whitespace-nowrap">
                      ₹{Number(bill.net_amount).toLocaleString('en-IN')}
                      {Number(bill.discount) > 0 && (
                        <div className="text-xs text-gray-400 font-normal">
                          -₹{Number(bill.discount).toLocaleString('en-IN')} disc.
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize
                        ${bill.payment_mode === 'cash'   ? 'bg-green-100 text-green-700'  :
                          bill.payment_mode === 'upi'    ? 'bg-blue-100 text-blue-700'    :
                          bill.payment_mode === 'card'   ? 'bg-purple-100 text-purple-700' :
                                                           'bg-gray-100 text-gray-600'}`}>
                        {bill.payment_mode || 'pending'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {bill.status === 'paid' ? (
                        <span className="flex items-center gap-1 text-xs text-green-700 font-semibold">
                          <CheckCircle className="w-3.5 h-3.5"/> Paid
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-orange-700 font-semibold">
                          <Clock className="w-3.5 h-3.5"/> Pending
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-blue-600 flex items-center gap-1">
                        <Printer className="w-3 h-3"/> Receipt
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
      {/* Header */}
      <div className="text-center pb-4 mb-5 border-b-2 border-gray-800">
        <div className="text-xl font-bold tracking-wide uppercase">
          {hs.hospitalName || 'NexMedicon Hospital'}
        </div>
        {hs.address && <div className="text-sm text-gray-500">{hs.address}</div>}
        {hs.phone   && <div className="text-sm text-gray-500">Tel: {hs.phone}</div>}
        {(hs.regNo || hs.gstin) && (
          <div className="text-xs text-gray-400">
            {hs.regNo && `Reg: ${hs.regNo}`}{hs.regNo && hs.gstin && ' · '}{hs.gstin && `GSTIN: ${hs.gstin}`}
          </div>
        )}
        <div className="text-lg font-bold mt-2 uppercase tracking-wider">Payment Receipt</div>
      </div>

      {/* Patient + bill meta */}
      <div className="grid grid-cols-2 gap-4 mb-5 text-sm">
        <div className="space-y-1">
          <div><span className="font-semibold">Patient: </span>{bill.patient_name}</div>
          <div><span className="font-semibold">MRN: </span><span className="font-mono">{bill.mrn}</span></div>
        </div>
        <div className="space-y-1 text-right">
          <div>
            <span className="font-semibold">Receipt No: </span>
            <span className="font-mono text-xs">{bill.id.slice(-10).toUpperCase()}</span>
          </div>
          <div><span className="font-semibold">Date: </span>{formatDate(bill.created_at)}</div>
        </div>
      </div>

      {/* Items */}
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
              <td className="py-2 text-right font-mono">₹{Number(item.amount).toLocaleString('en-IN')}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-200">
            <td colSpan={2} className="py-2 text-right text-gray-500 pr-4">Subtotal</td>
            <td className="py-2 text-right font-mono">₹{Number(bill.subtotal).toLocaleString('en-IN')}</td>
          </tr>
          {Number(bill.discount) > 0 && (
            <tr>
              <td colSpan={2} className="py-1 text-right text-gray-500 pr-4">Discount</td>
              <td className="py-1 text-right font-mono text-green-700">
                − ₹{Number(bill.discount).toLocaleString('en-IN')}
              </td>
            </tr>
          )}
          <tr className="border-t-2 border-gray-800">
            <td colSpan={2} className="py-2 text-right font-bold text-base pr-4">Net Amount Paid</td>
            <td className="py-2 text-right font-bold font-mono text-base">
              ₹{Number(bill.net_amount).toLocaleString('en-IN')}
            </td>
          </tr>
        </tfoot>
      </table>

      {/* Payment confirmation */}
      <div className="flex justify-between items-center border border-green-200 rounded-lg px-4 py-3 mb-4 bg-green-50">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-600"/>
          <span className="font-semibold text-green-800">Payment Received</span>
        </div>
        <div className="text-sm text-gray-600">
          Mode: <strong className="capitalize">{bill.payment_mode}</strong>
          {bill.razorpay_payment_id && (
            <span className="ml-2 text-xs text-gray-400 font-mono">
              Ref: {bill.razorpay_payment_id}
            </span>
          )}
        </div>
      </div>

      {bill.notes && (
        <div className="text-xs text-gray-500 mb-3">Notes: {bill.notes}</div>
      )}

      <div className="text-center text-xs text-gray-400 border-t border-gray-100 pt-3">
        Thank you for choosing {hs.hospitalName || 'NexMedicon Hospital'}. Wishing you good health!
      </div>
    </div>
  )
}
