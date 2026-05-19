'use client'
/**
 * src/app/ipd/[bedId]/billing/page.tsx
 *
 * IPD Structured Indoor Billing
 *
 * Features:
 *   - Charge categories: Bed, Nursing, Doctor Visit, Surgical, OT, Procedure, Medicine, Investigation, Other
 *   - Auto-calculates admission duration (days)
 *   - Per-day charges with quantity × rate = amount
 *   - Category-wise subtotals + grand total
 *   - Discount + net bill
 *   - Payment mode selection
 *   - Save charges to ipd_charges table
 *   - Print-friendly receipt
 */

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, getIndiaToday } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import {
  ArrowLeft, Plus, Trash2, Save, Printer, IndianRupee,
  BedDouble, Stethoscope, Activity, AlertTriangle,
  CheckCircle, Calculator, RefreshCw,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────

type ChargeCategory = 'bed' | 'nursing' | 'doctor_visit' | 'surgical' | 'ot' | 'procedure' | 'medicine' | 'investigation' | 'other'

interface IPDCharge {
  id?: string
  charge_date: string
  category: ChargeCategory
  description: string
  quantity: number
  rate: number
  amount: number
  notes: string
}

interface ChargeRate {
  id: string
  category: string
  description: string
  default_rate: number
  per_unit: string
  sort_order: number
}

const CATEGORY_CONFIG: { key: ChargeCategory; label: string; color: string }[] = [
  { key: 'bed', label: 'Bed Charges', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { key: 'nursing', label: 'Nursing Charges', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  { key: 'doctor_visit', label: 'Doctor Visit', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  { key: 'surgical', label: 'Surgical Charges', color: 'bg-red-50 text-red-700 border-red-200' },
  { key: 'ot', label: 'OT Charges', color: 'bg-orange-50 text-orange-700 border-orange-200' },
  { key: 'procedure', label: 'Procedure Charges', color: 'bg-green-50 text-green-700 border-green-200' },
  { key: 'medicine', label: 'Medicine / IV', color: 'bg-teal-50 text-teal-700 border-teal-200' },
  { key: 'investigation', label: 'Investigation', color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  { key: 'other', label: 'Other / Misc', color: 'bg-gray-50 text-gray-700 border-gray-200' },
]

function getCatConfig(cat: ChargeCategory) {
  return CATEGORY_CONFIG.find(c => c.key === cat) || CATEGORY_CONFIG[8]
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

// ── Component ──────────────────────────────────────────────────

export default function IPDBillingPage() {
  const { bedId } = useParams<{ bedId: string }>()
  const router = useRouter()
  const { user } = useAuth()

  const [bed, setBed] = useState<any>(null)
  const [patient, setPatient] = useState<any>(null)
  const [admission, setAdmission] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Charges
  const [charges, setCharges] = useState<IPDCharge[]>([])
  const [chargeRates, setChargeRates] = useState<ChargeRate[]>([])
  const [discount, setDiscount] = useState<number>(0)
  const [paymentMode, setPaymentMode] = useState<string>('cash')
  const [showAddCharge, setShowAddCharge] = useState(false)

  // New charge form
  const [newCharge, setNewCharge] = useState<IPDCharge>({
    charge_date: new Date().toISOString().slice(0, 10),
    category: 'bed',
    description: '',
    quantity: 1,
    rate: 0,
    amount: 0,
    notes: '',
  })

  // ── Load data ──────────────────────────────────────────────
  useEffect(() => {
    if (!bedId) return
    loadAll()
  }, [bedId])

  async function loadAll() {
    setLoading(true)

    // Load bed
    const { data: b } = await supabase.from('beds').select('*').eq('id', bedId).single()
    setBed(b)

    // Load patient
    if (b?.patient_id) {
      const { data: p } = await supabase.from('patients').select('*').eq('id', b.patient_id).single()
      setPatient(p)
    }

    // Load admission
    if (b?.patient_id) {
      const { data: adm } = await supabase
        .from('ipd_admissions')
        .select('*')
        .eq('bed_id', bedId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      setAdmission(adm)

      // Load existing charges for this admission
      if (adm?.id) {
        const { data: existingCharges } = await supabase
          .from('ipd_charges')
          .select('*')
          .eq('admission_id', adm.id)
          .order('charge_date', { ascending: true })
          .order('created_at', { ascending: true })

        if (existingCharges) {
          setCharges(existingCharges.map((c: any) => ({
            id: c.id,
            charge_date: c.charge_date,
            category: c.category,
            description: c.description,
            quantity: Number(c.quantity) || 1,
            rate: Number(c.rate) || 0,
            amount: Number(c.amount) || 0,
            notes: c.notes || '',
          })))
        }

        // Load discount from admission
        setDiscount(Number(adm.discount) || 0)
        setPaymentMode(adm.payment_mode || 'cash')
      }
    }

    // Load charge rate templates
    const { data: rates } = await supabase
      .from('ipd_charge_rates')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')
    if (rates) setChargeRates(rates as ChargeRate[])

    setLoading(false)
  }

  // ── Computed values ────────────────────────────────────────
  const admissionDate = admission?.admission_date || admission?.created_at?.split('T')[0]
  const today = getIndiaToday()
  const daysAdmitted = admissionDate
    ? Math.max(1, Math.ceil((new Date(today).getTime() - new Date(admissionDate).getTime()) / (1000 * 60 * 60 * 24)) + 1)
    : 1

  const grandTotal = charges.reduce((s, c) => s + c.amount, 0)
  const netBill = Math.max(0, grandTotal - discount)

  // Category-wise subtotals
  const categoryTotals = CATEGORY_CONFIG.map(cat => ({
    ...cat,
    total: charges.filter(c => c.category === cat.key).reduce((s, c) => s + c.amount, 0),
    count: charges.filter(c => c.category === cat.key).length,
  })).filter(c => c.total > 0)

  // Per-day average
  const perDayCharge = daysAdmitted > 0 ? Math.round(grandTotal / daysAdmitted) : 0

  // ── Add charge ─────────────────────────────────────────────
  function handleRateSelect(rate: ChargeRate) {
    setNewCharge(prev => ({
      ...prev,
      category: rate.category as ChargeCategory,
      description: rate.description,
      rate: rate.default_rate,
      amount: prev.quantity * rate.default_rate,
    }))
  }

  function updateNewChargeField(field: keyof IPDCharge, value: any) {
    setNewCharge(prev => {
      const updated = { ...prev, [field]: value }
      // Auto-calculate amount
      if (field === 'quantity' || field === 'rate') {
        updated.amount = (Number(updated.quantity) || 0) * (Number(updated.rate) || 0)
      }
      return updated
    })
  }

  async function addCharge() {
    if (!newCharge.description.trim()) { setError('Enter a description'); return }
    if (newCharge.amount <= 0) { setError('Amount must be greater than 0'); return }
    if (!admission?.id) { setError('No active admission found'); return }

    setError('')
    const chargeToSave = {
      admission_id: admission.id,
      patient_id: patient?.id,
      charge_date: newCharge.charge_date,
      category: newCharge.category,
      description: newCharge.description.trim(),
      quantity: Number(newCharge.quantity) || 1,
      rate: Number(newCharge.rate) || 0,
      amount: Number(newCharge.amount) || 0,
      notes: newCharge.notes.trim() || null,
      created_by: user?.full_name || null,
    }

    const { data, error: err } = await supabase
      .from('ipd_charges')
      .insert(chargeToSave)
      .select()
      .single()

    if (err) { setError(`Failed to add charge: ${err.message}`); return }

    setCharges(prev => [...prev, {
      id: data.id,
      charge_date: data.charge_date,
      category: data.category,
      description: data.description,
      quantity: Number(data.quantity),
      rate: Number(data.rate),
      amount: Number(data.amount),
      notes: data.notes || '',
    }])

    // Reset form
    setNewCharge({
      charge_date: new Date().toISOString().slice(0, 10),
      category: 'bed',
      description: '',
      quantity: 1,
      rate: 0,
      amount: 0,
      notes: '',
    })
    setShowAddCharge(false)
  }

  // ── Auto-add bed charges for all days ─────────────────────
  async function autoAddBedCharges() {
    if (!admission?.id || !patient?.id) return
    const bedRate = chargeRates.find(r => r.category === 'bed') || { default_rate: 800, description: 'General Ward Bed' }
    const nursingRate = chargeRates.find(r => r.category === 'nursing') || { default_rate: 500, description: 'Nursing Charges' }

    const newCharges: IPDCharge[] = []
    for (let d = 0; d < daysAdmitted; d++) {
      const date = new Date(admissionDate)
      date.setDate(date.getDate() + d)
      const dateStr = date.toISOString().split('T')[0]

      // Check if bed charge already exists for this date
      const bedExists = charges.some(c => c.category === 'bed' && c.charge_date === dateStr)
      if (!bedExists) {
        newCharges.push({
          charge_date: dateStr,
          category: 'bed',
          description: bedRate.description,
          quantity: 1,
          rate: bedRate.default_rate,
          amount: bedRate.default_rate,
          notes: '',
        })
      }

      // Same for nursing
      const nursingExists = charges.some(c => c.category === 'nursing' && c.charge_date === dateStr)
      if (!nursingExists) {
        newCharges.push({
          charge_date: dateStr,
          category: 'nursing',
          description: nursingRate.description,
          quantity: 1,
          rate: nursingRate.default_rate,
          amount: nursingRate.default_rate,
          notes: '',
        })
      }
    }

    if (newCharges.length === 0) { setError('Bed & nursing charges already added for all days.'); return }

    const insertData = newCharges.map(c => ({
      admission_id: admission.id,
      patient_id: patient.id,
      charge_date: c.charge_date,
      category: c.category,
      description: c.description,
      quantity: c.quantity,
      rate: c.rate,
      amount: c.amount,
      notes: null,
      created_by: user?.full_name || null,
    }))

    const { data, error: err } = await supabase
      .from('ipd_charges')
      .insert(insertData)
      .select()

    if (err) { setError(`Failed: ${err.message}`); return }

    setCharges(prev => [...prev, ...(data || []).map((c: any) => ({
      id: c.id,
      charge_date: c.charge_date,
      category: c.category,
      description: c.description,
      quantity: Number(c.quantity),
      rate: Number(c.rate),
      amount: Number(c.amount),
      notes: '',
    }))])

    setSuccess(`Added ${newCharges.length} charges (bed + nursing for ${daysAdmitted} days)`)
    setTimeout(() => setSuccess(''), 3000)
  }

  // ── Delete charge ──────────────────────────────────────────
  async function deleteCharge(id: string | undefined, index: number) {
    if (!id) { setCharges(prev => prev.filter((_, i) => i !== index)); return }
    const { error: err } = await supabase.from('ipd_charges').delete().eq('id', id)
    if (err) { setError(err.message); return }
    setCharges(prev => prev.filter((_, i) => i !== index))
  }

  // ── Save bill summary to admission ────────────────────────
  async function saveBill() {
    if (!admission?.id) return
    setSaving(true)
    setError('')

    const { error: err } = await supabase
      .from('ipd_admissions')
      .update({
        total_charges: grandTotal,
        discount: discount,
        net_bill: netBill,
        bill_status: 'pending',
        payment_mode: paymentMode,
      })
      .eq('id', admission.id)

    setSaving(false)
    if (err) { setError(`Save failed: ${err.message}`); return }
    setSuccess('Bill saved successfully!')
    setTimeout(() => setSuccess(''), 3000)
  }

  // ── Finalize IPD Bill → Generate formal invoice in bills table ──
  async function finalizeBill() {
    if (!admission?.id || !patient?.id) return
    if (charges.length === 0) { setError('No charges to finalize'); return }
    if (!confirm(`Finalize IPD bill for ${patient.full_name}?\n\nGrand Total: ${inr(grandTotal)}\nDiscount: ${inr(discount)}\nNet Payable: ${inr(netBill)}\n\nThis will generate a formal invoice.`)) return

    setSaving(true)
    setError('')

    // Build bill items from charges grouped by category
    const billItems = charges.map(c => ({
      label: `${c.description}${c.quantity > 1 ? ` (×${c.quantity})` : ''}`,
      amount: c.amount,
    }))

    // Insert into bills table (invoice_number auto-generated by DB trigger)
    const { data: bill, error: billErr } = await supabase.from('bills').insert({
      patient_id: patient.id,
      patient_name: patient.full_name,
      mrn: patient.mrn,
      items: billItems,
      subtotal: grandTotal,
      discount: discount,
      gst_percent: 0,
      gst_amount: 0,
      net_amount: netBill,
      payment_mode: paymentMode,
      status: 'paid',
      notes: `IPD Bill — Bed ${bed.bed_number} (${bed.ward || ''}) — ${daysAdmitted} days — Admission: ${admissionDate || ''}`,
      created_by: user?.full_name || null,
      paid_at: new Date().toISOString(),
    }).select('id, invoice_number').single()

    if (billErr) {
      setSaving(false)
      setError(`Invoice generation failed: ${billErr.message}`)
      return
    }

    // Update admission with bill reference + mark paid
    await supabase.from('ipd_admissions').update({
      total_charges: grandTotal,
      discount: discount,
      net_bill: netBill,
      bill_status: 'paid',
      payment_mode: paymentMode,
      bill_id: bill?.id || null,
    }).eq('id', admission.id)

    setSaving(false)
    setSuccess(`Invoice ${bill?.invoice_number || ''} generated successfully! Net: ${inr(netBill)}`)

    // Audit log
    await supabase.from('audit_log').insert({
      action: 'ipd_bill_finalized',
      entity_type: 'bill',
      entity_id: bill?.id,
      entity_label: `IPD Bill for ${patient.full_name} — ${inr(netBill)}`,
      changes: JSON.stringify({
        admission_id: admission.id,
        bed: bed.bed_number,
        days: daysAdmitted,
        charges_count: charges.length,
        grand_total: grandTotal,
        discount,
        net_bill: netBill,
        payment_mode: paymentMode,
        invoice_number: bill?.invoice_number,
      }),
    })
  }

  // ── Auto-pull lab charges for this patient during admission ──
  async function pullLabCharges() {
    if (!admission?.id || !patient?.id || !admissionDate) return

    const { data: labs } = await supabase
      .from('lab_reports')
      .select('id, report_name, total_amount, hospital_amount, report_date')
      .eq('patient_id', patient.id)
      .gte('report_date', admissionDate)
      .gt('total_amount', 0)

    if (!labs || labs.length === 0) { setError('No billable lab reports found for this admission period.'); return }

    // Filter out labs already added as investigation charges
    const existingLabDescs = charges.filter(c => c.category === 'investigation').map(c => c.description.toLowerCase())
    const newLabs = labs.filter(l => !existingLabDescs.some(d => d.includes(l.report_name?.toLowerCase() || '')))

    if (newLabs.length === 0) { setError('All lab charges already added.'); return }

    const labCharges = newLabs.map(l => ({
      admission_id: admission.id,
      patient_id: patient.id,
      charge_date: l.report_date || getIndiaToday(),
      category: 'investigation',
      description: l.report_name || 'Lab Test',
      quantity: 1,
      rate: Number(l.hospital_amount || l.total_amount) || 0,
      amount: Number(l.hospital_amount || l.total_amount) || 0,
      notes: `Auto-pulled from lab report`,
      created_by: user?.full_name || null,
    }))

    const { data, error: err } = await supabase.from('ipd_charges').insert(labCharges).select()
    if (err) { setError(err.message); return }

    setCharges(prev => [...prev, ...(data || []).map((c: any) => ({
      id: c.id, charge_date: c.charge_date, category: c.category as ChargeCategory,
      description: c.description, quantity: Number(c.quantity), rate: Number(c.rate),
      amount: Number(c.amount), notes: c.notes || '',
    }))])
    setSuccess(`Added ${newLabs.length} lab investigation charge(s)`)
    setTimeout(() => setSuccess(''), 3000)
  }

  // ── Loading ────────────────────────────────────────────────
  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </AppShell>
    )
  }

  if (!bed || !patient) {
    return (
      <AppShell>
        <div className="p-6 text-center">
          <p className="text-gray-500">Bed or patient not found.</p>
          <Link href="/ipd" className="btn-primary mt-4 inline-flex">Back to IPD</Link>
        </div>
      </AppShell>
    )
  }


  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => router.push(`/ipd/${bedId}`)} className="text-gray-400 hover:text-gray-700">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <BedDouble className="w-6 h-6 text-green-600" />
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900">IPD Bill — Bed {bed.bed_number}</h1>
            <p className="text-sm text-gray-500">
              {patient.full_name} · MRN: {patient.mrn} · Admitted: {admissionDate ? formatDate(admissionDate) : '—'} · <strong>{daysAdmitted} day{daysAdmitted !== 1 ? 's' : ''}</strong>
            </p>
          </div>
          <button onClick={() => window.print()} className="btn-secondary flex items-center gap-2 text-xs no-print">
            <Printer className="w-3.5 h-3.5" /> Print
          </button>
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

        {/* Summary tiles */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          <div className="card p-3 bg-blue-50 text-center">
            <div className="text-2xl font-bold text-blue-700">{daysAdmitted}</div>
            <div className="text-xs text-blue-600">Days Admitted</div>
          </div>
          <div className="card p-3 bg-green-50 text-center">
            <div className="text-2xl font-bold text-green-700 font-mono">{inr(grandTotal)}</div>
            <div className="text-xs text-green-600">Grand Total</div>
          </div>
          <div className="card p-3 bg-orange-50 text-center">
            <div className="text-2xl font-bold text-orange-700 font-mono">{inr(discount)}</div>
            <div className="text-xs text-orange-600">Discount</div>
          </div>
          <div className="card p-3 bg-emerald-50 text-center">
            <div className="text-2xl font-bold text-emerald-700 font-mono">{inr(netBill)}</div>
            <div className="text-xs text-emerald-600">Net Bill</div>
          </div>
          <div className="card p-3 bg-purple-50 text-center">
            <div className="text-2xl font-bold text-purple-700 font-mono">{inr(perDayCharge)}</div>
            <div className="text-xs text-purple-600">Per Day Avg</div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2 mb-5 no-print">
          <button onClick={autoAddBedCharges}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-2 rounded-lg">
            <Calculator className="w-3.5 h-3.5" /> Auto-Add Bed + Nursing ({daysAdmitted} days)
          </button>
          <button onClick={pullLabCharges}
            className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold px-3 py-2 rounded-lg">
            <Activity className="w-3.5 h-3.5" /> Pull Lab Charges
          </button>
          <button onClick={() => setShowAddCharge(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-2 rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add Charge
          </button>
          <button onClick={saveBill} disabled={saving}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save Draft'}
          </button>
          {charges.length > 0 && (
            <button onClick={finalizeBill} disabled={saving}
              className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold px-4 py-2 rounded-lg disabled:opacity-50 border-2 border-emerald-500">
              <IndianRupee className="w-3.5 h-3.5" /> Finalize & Generate Invoice
            </button>
          )}
        </div>

        {/* Add charge form */}
        {showAddCharge && (
          <div className="card p-5 mb-5 border-l-4 border-indigo-400 no-print">
            <h3 className="font-semibold text-gray-800 mb-3">Add Charge</h3>

            {/* Quick presets from charge rates */}
            {chargeRates.length > 0 && (
              <div className="mb-4">
                <label className="label">Quick Select (click to auto-fill)</label>
                <div className="flex flex-wrap gap-1.5">
                  {chargeRates.slice(0, 12).map(rate => (
                    <button key={rate.id} onClick={() => handleRateSelect(rate)}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-700 transition-colors">
                      {rate.description} ({inr(rate.default_rate)})
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <div>
                <label className="label">Date</label>
                <input type="date" className="input" value={newCharge.charge_date}
                  onChange={e => updateNewChargeField('charge_date', e.target.value)} />
              </div>
              <div>
                <label className="label">Category</label>
                <select className="input" value={newCharge.category}
                  onChange={e => updateNewChargeField('category', e.target.value)}>
                  {CATEGORY_CONFIG.map(c => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="label">Description</label>
                <input className="input" placeholder="e.g. General Ward Bed, Doctor Visit"
                  value={newCharge.description}
                  onChange={e => updateNewChargeField('description', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <label className="label">Quantity</label>
                <input type="number" className="input" min="1" step="0.5"
                  value={newCharge.quantity}
                  onChange={e => updateNewChargeField('quantity', Number(e.target.value) || 1)} />
              </div>
              <div>
                <label className="label">Rate (₹)</label>
                <input type="number" className="input" min="0" step="1"
                  value={newCharge.rate}
                  onChange={e => updateNewChargeField('rate', Number(e.target.value) || 0)} />
              </div>
              <div>
                <label className="label">Amount (₹)</label>
                <input type="number" className="input font-bold bg-gray-50" readOnly
                  value={newCharge.amount} />
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={addCharge} className="btn-primary text-xs flex items-center gap-2">
                <Plus className="w-3.5 h-3.5" /> Add Charge
              </button>
              <button onClick={() => setShowAddCharge(false)} className="btn-secondary text-xs">Cancel</button>
            </div>
          </div>
        )}

        {/* Category breakdown */}
        {categoryTotals.length > 0 && (
          <div className="card p-4 mb-5">
            <h3 className="font-semibold text-gray-800 mb-3 text-sm">Category Breakdown</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {categoryTotals.map(cat => (
                <div key={cat.key} className={`rounded-lg border p-3 ${cat.color}`}>
                  <div className="text-lg font-bold font-mono">{inr(cat.total)}</div>
                  <div className="text-xs font-medium">{cat.label} ({cat.count})</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Charges table */}
        {charges.length === 0 ? (
          <div className="card p-12 text-center text-gray-400">
            <IndianRupee className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="font-medium">No charges added yet</p>
            <p className="text-sm mt-1">Click &quot;Auto-Add Bed + Nursing&quot; or &quot;Add Charge&quot; to start billing</p>
          </div>
        ) : (
          <div className="card overflow-hidden mb-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  {['Date', 'Category', 'Description', 'Qty', 'Rate', 'Amount', ''].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {charges.map((c, i) => {
                  const catCfg = getCatConfig(c.category)
                  return (
                    <tr key={c.id || i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-3 py-2.5 text-xs text-gray-500">{formatDate(c.charge_date)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${catCfg.color}`}>
                          {catCfg.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-gray-800">{c.description}</td>
                      <td className="px-3 py-2.5 font-mono text-gray-600">{c.quantity}</td>
                      <td className="px-3 py-2.5 font-mono text-gray-600">{inr(c.rate)}</td>
                      <td className="px-3 py-2.5 font-mono font-bold text-gray-900">{inr(c.amount)}</td>
                      <td className="px-3 py-2.5 no-print">
                        <button onClick={() => deleteCharge(c.id, i)}
                          className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {/* Totals row */}
                <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold">
                  <td colSpan={5} className="px-3 py-3 text-right text-xs text-gray-600 uppercase">Grand Total</td>
                  <td className="px-3 py-3 font-mono text-lg text-gray-900">{inr(grandTotal)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Discount + Net + Payment */}
        {charges.length > 0 && (
          <div className="card p-5 no-print">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Discount (₹)</label>
                <input type="number" className="input" min="0" value={discount}
                  onChange={e => setDiscount(Number(e.target.value) || 0)} />
              </div>
              <div>
                <label className="label">Net Bill</label>
                <div className="input bg-green-50 font-bold text-green-800 text-lg font-mono flex items-center">
                  {inr(netBill)}
                </div>
              </div>
              <div>
                <label className="label">Payment Mode</label>
                <select className="input" value={paymentMode} onChange={e => setPaymentMode(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="card">Card</option>
                  <option value="mixed">Mixed</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Print footer */}
        <div className="print-only mt-6 pt-4 border-t text-center text-xs text-gray-500">
          Generated: {new Date().toLocaleString('en-IN')} · NexMedicon HMS
        </div>
      </div>
    </AppShell>
  )
}
