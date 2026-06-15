'use client'
/**
 * src/app/ipd/[bedId]/billing/page.tsx
 *
 * IPD Structured Indoor Billing
 *
 * Features:
 * - Charge categories: Bed, Nursing, Doctor Visit, Surgical, OT, Procedure, Medicine, Investigation, Other
 * - Auto-calculates admission duration (days)
 * - Per-day charges with quantity × rate = amount
 * - Category-wise subtotals + grand total
 * - Discount + net bill
 * - Payment mode selection
 * - Save charges to ipd_charges table
 * - Print-friendly receipt
 */

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, getIndiaToday, getHospitalSettings } from '@/lib/utils'
import { resolveUpiId } from '@/lib/settings'
import { useAuth } from '@/lib/auth'
import {
  ArrowLeft, Plus, Trash2, Save, Printer, IndianRupee,
  BedDouble, Stethoscope, Activity, AlertTriangle,
  CheckCircle, Calculator, RefreshCw,
} from 'lucide-react'
import IPDPackageBilling from '@/components/ipd/IPDPackageBilling'
import { printDocument, buildIPDBillHtml } from '@/lib/printUtils'

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

// ─────────────────────────────────────────────────────────────────────
// Schema-resilient helpers — fix for "Could not find the 'charge_date'
// column of 'ipd_charges' in the schema cache".
// ─────────────────────────────────────────────────────────────────────

function isSchemaCacheError(err: any): boolean {
  if (!err) return false
  const code = String(err.code || '')
  const msg = String(err.message || '').toLowerCase()
  return (
    code === 'PGRST204' ||
    code === '42703' ||
    msg.includes('schema cache') ||
    (msg.includes('column') && (msg.includes('does not exist') || msg.includes('not found')))
  )
}

function mapChargeRowToUI(c: any): IPDCharge {
  const qty   = Number(c.quantity) || 1
  const amt   = Number(c.amount) || 0
  const rate  =
    c.rate !== undefined && c.rate !== null
      ? Number(c.rate)
      : qty > 0
        ? Math.round((amt / qty) * 100) / 100
        : 0
  const date =
    c.charge_date ??
    (typeof c.created_at === 'string' ? c.created_at.slice(0, 10) : '')
  return {
    id:          c.id,
    charge_date: date,
    category:    c.category,
    description: c.description ?? c.item_name ?? '',
    quantity:    qty,
    rate,
    amount:      amt,
    notes:       c.notes || '',
  }
}

function mapRateRowToUI(r: any): ChargeRate {
  return {
    id:           r.id,
    category:     r.category ?? '',
    description:  r.description ?? r.name ?? '',
    default_rate: Number(r.default_rate ?? r.amount ?? 0),
    per_unit:     r.per_unit ?? r.unit ?? 'per day',
    sort_order:   Number(r.sort_order ?? 0),
  }
}

/** Build the column subset that the legacy ipd_charges schema accepts. */
function toLegacyChargeRow(row: Record<string, any>) {
  return {
    admission_id: row.admission_id,
    patient_id:   row.patient_id,
    item_name:
      (row.description && String(row.description).trim()) ||
      (row.item_name && String(row.item_name).trim()) ||
      'IPD Charge',
    category:     row.category,
    amount:       Number(row.amount) || 0,
    quantity:     Number(row.quantity) || 1,
    notes:        row.notes ?? null,
  }
}

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
  const [upiId, setUpiId] = useState<string>('')
  const [paymentRef, setPaymentRef] = useState<string>('')
  const [billPaid, setBillPaid] = useState(false)
  const [paying, setPaying] = useState(false)
  const [savedBillId, setSavedBillId] = useState<string | null>(null)
  const [paidSoFar, setPaidSoFar] = useState<number>(0)
  const [billDbId, setBillDbId] = useState<string | null>(null)
  const [showAddCharge, setShowAddCharge] = useState(false)

  useEffect(() => {
    if (paymentMode === 'upi') {
      const resolved = resolveUpiId('ipd')
      setUpiId(resolved)
    } else {
      setUpiId('')
    }
  }, [paymentMode])

  // New charge form
  const [newCharge, setNewCharge] = useState<IPDCharge>({
    charge_date: getIndiaToday(),
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

      if (adm?.id) {
        let existingCharges: any[] | null = null
        const modernRead = await supabase
          .from('ipd_charges')
          .select('*')
          .eq('admission_id', adm.id)
          .order('charge_date', { ascending: true })
          .order('created_at', { ascending: true })

        if (modernRead.error && isSchemaCacheError(modernRead.error)) {
          console.warn(
            '[IPD billing] ipd_charges.charge_date not found in schema cache; ' +
            'reading legacy schema. Run migrations/018_align_ipd_charges_schema.sql ' +
            'in your Supabase SQL Editor to fix this permanently.',
          )
          const legacyRead = await supabase
            .from('ipd_charges')
            .select('*')
            .eq('admission_id', adm.id)
            .order('created_at', { ascending: true })
          existingCharges = legacyRead.data
        } else {
          existingCharges = modernRead.data
        }

        if (existingCharges) {
          setCharges(existingCharges.map(mapChargeRowToUI))
        }

        setDiscount(Number(adm.discount) || 0)
        setPaymentMode(adm.payment_mode || 'cash')

        await refreshBillStatus(adm.id, patient?.id ?? b?.patient_id ?? null)
      }
    }

    {
      const modernRates = await supabase
        .from('ipd_charge_rates')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')

      if (modernRates.error && isSchemaCacheError(modernRates.error)) {
        console.warn(
          '[IPD billing] ipd_charge_rates.sort_order not found in schema cache; ' +
          'reading legacy schema. Run migrations/018_align_ipd_charges_schema.sql ' +
          'to align the rates table.',
        )
        const legacyRates = await supabase
          .from('ipd_charge_rates')
          .select('*')
          .eq('is_active', true)
          .order('category')
          .order('name' as any)
        if (legacyRates.data) {
          setChargeRates(legacyRates.data.map(mapRateRowToUI))
        }
      } else if (modernRates.data) {
        setChargeRates(modernRates.data.map(mapRateRowToUI))
      }
    }

    setLoading(false)
  }

  // ── Computed values ────────────────────────────────────────
  const admissionDate = admission?.admission_date || admission?.created_at?.split('T')[0]
  const today = getIndiaToday()
  const dischargeDate =
    admission?.discharge_date ||
    admission?.actual_discharge_date ||
    admission?.discharged_at ||
    (admission?.discharge_datetime ? String(admission.discharge_datetime).split('T')[0] : null) ||
    (admission?.expected_discharge_date && admission?.status !== 'active'
      ? admission.expected_discharge_date
      : null) ||
    null
  const billingEndDate = dischargeDate ? String(dischargeDate).split('T')[0] : today
  const daysAdmitted = admissionDate
    ? Math.max(1, Math.ceil((new Date(billingEndDate).getTime() - new Date(admissionDate).getTime()) / (1000 * 60 * 60 * 24)) + 1)
    : 1

  const grandTotal = charges.reduce((s, c) => s + c.amount, 0)
  const netBill = Math.max(0, grandTotal - discount)

  const outstanding = Math.max(0, netBill - paidSoFar)
  const isFullyPaid = billPaid || (paidSoFar > 0 && netBill > 0 && outstanding <= 0)

  const categoryTotals = CATEGORY_CONFIG.map(cat => ({
    ...cat,
    total: charges.filter(c => c.category === cat.key).reduce((s, c) => s + c.amount, 0),
    count: charges.filter(c => c.category === cat.key).length,
  })).filter(c => c.total > 0)

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

    let data: any = null
    let err: any = null
    {
      const modern = await supabase
        .from('ipd_charges')
        .insert(chargeToSave)
        .select()
        .single()
      if (modern.error && isSchemaCacheError(modern.error)) {
        console.warn(
          '[IPD billing] modern ipd_charges insert failed (schema cache); ' +
          'retrying with legacy column names. Apply migration 018 to remove ' +
          'this fallback path.',
        )
        const legacy = await supabase
          .from('ipd_charges')
          .insert(toLegacyChargeRow(chargeToSave))
          .select()
          .single()
        data = legacy.data
        err  = legacy.error
      } else {
        data = modern.data
        err  = modern.error
      }
    }

    if (err) { setError(`Failed to add charge: ${err.message}`); return }

    const uiRow = mapChargeRowToUI(data)
    if (!uiRow.charge_date) uiRow.charge_date = chargeToSave.charge_date
    if (!uiRow.rate) uiRow.rate = chargeToSave.rate
    setCharges(prev => [...prev, uiRow])

    setSavedBillId(null)

    setNewCharge({
      charge_date: getIndiaToday(),
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

    let data: any[] | null = null
    let err: any = null
    {
      const modern = await supabase
        .from('ipd_charges')
        .insert(insertData)
        .select()
      if (modern.error && isSchemaCacheError(modern.error)) {
        console.warn(
          '[IPD billing] auto-add modern insert hit schema-cache error; ' +
          'retrying with legacy column subset. Apply ' +
          'migrations/018_align_ipd_charges_schema.sql to remove this fallback.',
        )
        const legacy = await supabase
          .from('ipd_charges')
          .insert(insertData.map(toLegacyChargeRow))
          .select()
        data = legacy.data
        err  = legacy.error
      } else {
        data = modern.data
        err  = modern.error
      }
    }

    if (err) { setError(`Failed: ${err.message}`); return }

    const inserted = (data || []).map((c: any, i: number) => {
      const ui = mapChargeRowToUI(c)
      if (!ui.charge_date) ui.charge_date = insertData[i]?.charge_date ?? ''
      if (!ui.rate) ui.rate = Number(insertData[i]?.rate) || 0
      if (!ui.description) ui.description = insertData[i]?.description ?? ''
      return ui
    })
    setCharges(prev => [...prev, ...inserted])

    setSavedBillId(null)

    setSuccess(`Added ${newCharges.length} charges (bed + nursing for ${daysAdmitted} days)`)
    setTimeout(() => setSuccess(''), 3000)
  }

  // ── Delete charge ──────────────────────────────────────────
  async function deleteCharge(id: string | undefined, index: number) {
    if (!id) { setCharges(prev => prev.filter((_, i) => i !== index)); return }
    const { error: err } = await supabase.from('ipd_charges').delete().eq('id', id)
    if (err) { setError(err.message); return }
    setCharges(prev => prev.filter((_, i) => i !== index))
    setSavedBillId(null)
  }

  // ── Bill paid-status tracking ───────────────────
  async function findAdmissionBill(admissionId: string, patientId: string | null): Promise<any | null> {
    let { data: hit } = await supabase
      .from('bills')
      .select('*')
      .eq('admission_id', admissionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!hit && patientId) {
      for (const col of ['patient_id', 'patientid'] as const) {
        const { data: fb, error: fbErr } = await supabase
          .from('bills')
          .select('*')
          .eq(col, patientId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (!fbErr && fb) { hit = fb; break }
      }
    }

    if (!hit) {
      const { data: fb } = await supabase
        .from('bills')
        .select('*')
        .eq('bill_module', 'IPD')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (fb) hit = fb
    }

    return hit || null
  }

  async function refreshBillStatus(admissionId: string, patientId: string | null) {
    try {
      const bill = await findAdmissionBill(admissionId, patientId)
      if (bill) {
        setBillDbId(bill.id)
        setPaidSoFar(Number(bill.paid || 0))
      } else {
        setBillDbId(null)
        setPaidSoFar(0)
      }
    } catch {
      // non-fatal
    }
  }

  // ── Pay Bill Now ───────────────────────────────────────────
  async function payBillNow(): Promise<void> {
    if (!admission?.id || !patient?.id) return
    setPaying(true)
    setError('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const resolveExistingBill = async (): Promise<any | null> => {
        let { data: hit } = await supabase
          .from('bills')
          .select('id, bill_number, invoice_number, net_amount, status')
          .eq('admission_id', admission.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (!hit && patient?.id) {
          for (const col of ['patient_id', 'patientid'] as const) {
            const { data: fb, error: fbErr } = await supabase
              .from('bills')
              .select('id, bill_number, invoice_number, net_amount, status')
              .eq(col, patient.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            if (!fbErr && fb) { hit = fb; break }
          }
        }

        if (!hit) {
          const { data: fb } = await supabase
            .from('bills')
            .select('id, bill_number, invoice_number, net_amount, status, admission_id')
            .eq('bill_module', 'IPD')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (fb) hit = fb
        }

        return hit || null
      }

      let bill: any = savedBillId ? { id: savedBillId, status: 'unpaid' } : await resolveExistingBill()

      if (!bill?.id) {
        const createdId = await saveBill()
        if (createdId) {
          bill = { id: createdId, status: 'unpaid' }
        } else {
          bill = await resolveExistingBill()
        }
      }

      if (!bill?.id) {
        setError('Could not create or find a bill to pay. Please click "Save Bill" and try again.')
        setPaying(false)
        return
      }

      let paidOnBill = 0
      try {
        const { data: billRow } = await supabase
          .from('bills')
          .select('*')
          .eq('id', bill.id)
          .maybeSingle()
        paidOnBill = Number(billRow?.paid || 0)
      } catch { /* fall back to 0 */ }

      const outstanding = Math.max(0, netBill - paidOnBill)

      if (outstanding <= 0) {
        setBillPaid(true)
        setPaidSoFar(paidOnBill)
        setSuccess('This bill is already fully paid.')
        setPaying(false)
        return
      }

      try {
        await supabase
          .from('bills')
          .update({
            total: netBill,
            net_amount: netBill,
            due: outstanding,
            status: paidOnBill > 0 ? 'partial' : 'unpaid',
          })
          .eq('id', bill.id)
      } catch { /* non-fatal */ }

      const payRes = await fetch('/api/billing/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          billId: bill.id,
          bill_id: bill.id,
          amount: outstanding,
          paymentMode: paymentMode,
          payment_mode: paymentMode,
          reference: paymentRef || (paymentMode === 'upi' ? upiId : undefined),
          notes: `IPD Bill Payment`,
        }),
      })

      const payData = await payRes.json().catch(() => ({}))

      if (!payRes.ok) {
        setError(`Payment failed: ${payData?.error || payRes.statusText}`)
        setPaying(false)
        return
      }

      setBillPaid(true)
      setPaidSoFar(netBill)
      setSuccess('Payment received successfully! Bill has been marked as Paid.')
      setTimeout(() => setSuccess(''), 8000)
    } catch (e: any) {
      setError(`Payment error: ${e?.message || 'Unknown error'}`)
    } finally {
      setPaying(false)
    }
  }

  // ── Save Bill Summary ──────────────────────────────────────
  async function saveBill(): Promise<string | null> {
    if (!admission?.id) return null
    setSaving(true)
    setError('')

    const fullPayload: Record<string, any> = {
      total_charges: grandTotal,
      discount,
      net_bill: netBill,
      bill_status: 'pending',
      payment_mode: paymentMode,
    }

    const isSchemaCacheUpdateError = (e: any): boolean => {
      if (!e) return false
      const code = String(e.code || '')
      const msg  = String(e.message || '').toLowerCase()
      return (
        code === 'PGRST204' ||
        code === '42703' ||
        msg.includes('schema cache') ||
        (msg.includes('column') &&
         (msg.includes('does not exist') || msg.includes('not found')))
      )
    }

    const unknownColumnFrom = (e: any): string | null => {
      const msg = String(e?.message || '')
      let m = msg.match(/['"]([a-z_][a-z0-9_]*)['"][^'\"]*column/i)
      if (m) return m[1]
      m = msg.match(/column\s+['"]?([a-z_][a-z0-9_]*)['"]?/i)
      if (m) return m[1]
      m = msg.match(/the\s+['"]?([a-z_][a-z0-9_]*)['"]?\s+column/i)
      if (m) return m[1]
      return null
    }

    let payload = { ...fullPayload }
    let lastErr: any = null
    let droppedCols: string[] = []

    for (let attempt = 0; attempt < 6; attempt++) {
      const { error: err } = await supabase
        .from('ipd_admissions')
        .update(payload)
        .eq('id', admission.id)

      if (!err) {
        lastErr = null
        break
      }

      lastErr = err
      if (!isSchemaCacheUpdateError(err)) break

      const offending = unknownColumnFrom(err)
      if (!offending || !(offending in payload)) {
        break
      }

      console.warn(
        `[IPD billing saveBill] '${offending}' not in ipd_admissions schema cache; ` +
        `retrying without that column.  Apply migration 019 to remove this fallback.`,
      )
      droppedCols.push(offending)
      const { [offending as keyof typeof payload]: _drop, ...rest } = payload
      payload = rest
      if (Object.keys(payload).length === 0) break
    }

    if (lastErr) {
      setSaving(false)
      setError(`Save failed: ${lastErr.message}`)
      return null
    }

    let billsSyncOk = true
    let createdBillId: string | null = null
    try {
      const items = charges.map(c => ({
        label: c.description || c.category,
        amount: c.amount,
        quantity: c.quantity,
      }))
      const subtotal = charges.reduce((s, c) => s + c.amount, 0)
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const billRes = await fetch('/api/billing/generate-bill', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          module: 'IPD',
          patient_id: patient.id,
          patient_name: patient.full_name,
          mrn: patient.mrn,
          items,
          subtotal,
          discount,
          gst_percent: 0,
          net_amount: netBill,
          payment_mode: paymentMode,
          status: 'unpaid',
          admission_id: admission.id,
          notes: `IPD admission stay`,
          idempotency_key: `ipd-admission-${admission.id}`,
        }),
      })

      if (!billRes.ok) {
        const errBody = await billRes.json().catch(() => ({}))
        billsSyncOk = false
        console.warn(
          '[IPD billing saveBill] /api/billing/generate-bill failed; the IPD ' +
          'admission summary was saved but the bill row in `bills` was NOT ' +
          'created. Detail: ' + (errBody?.error || billRes.statusText),
        )
      } else {
        const okBody = await billRes.json().catch(() => ({}))
        createdBillId =
          okBody?.bill?.id ??
          okBody?.id ??
          okBody?.billId ??
          okBody?.bill_id ??
          okBody?.data?.id ??
          okBody?.data?.bill?.id ??
          null
        if (createdBillId) {
          setSavedBillId(createdBillId)
          setBillDbId(createdBillId)
          try {
            const { data: cur } = await supabase
              .from('bills')
              .select('*')
              .eq('id', createdBillId)
              .maybeSingle()
            const paidAmt = Number(cur?.paid || 0)
            const newDue = Math.max(0, netBill - paidAmt)
            await supabase
              .from('bills')
              .update({
                total: netBill,
                net_amount: netBill,
                due: newDue,
                status: paidAmt <= 0 ? 'unpaid' : (newDue <= 0 ? 'paid' : 'partial'),
              })
              .eq('id', createdBillId)
            setPaidSoFar(paidAmt)
          } catch { /* non-fatal */ }
        }
      }
    } catch (e: any) {
      billsSyncOk = false
      console.warn(
        '[IPD billing saveBill] generate-bill API call failed (non-fatal): ' +
        (e?.message || e),
      )
    }

    setSaving(false)

    if (droppedCols.length > 0 && billsSyncOk) {
      setSuccess(
        `Bill saved (partial — schema is missing column${droppedCols.length > 1 ? 's' : ''} ` +
        `${droppedCols.join(', ')}; run migration 019 for full support).`,
      )
    } else if (!billsSyncOk) {
      setError(
        'Bill summary saved on the admission, but creating the formal bill ' +
        'in the billing system failed.  Please go to Billing → New IPD Bill ' +
        'and generate it manually so revenue reports stay in sync.',
      )
    } else {
      setSuccess('Bill saved successfully!')
    }
    setTimeout(() => { setSuccess('') }, 6000)

    return createdBillId
  }

  // ── Print Bill ─────────────────────────────────────────────
  function printBill() {
    const hs = getHospitalSettings()
    printDocument(buildIPDBillHtml({
      patientName: patient?.full_name || '',
      mrn: patient?.mrn || '',
      bedNumber: bed?.bed_number || '',
      admissionDate: admissionDate || '',
      daysAdmitted,
      charges: charges.map(cc => ({ charge_date: cc.charge_date, category: cc.category, description: cc.description, quantity: cc.quantity, rate: cc.rate, amount: cc.amount })),
      subtotal: grandTotal,
      discount,
      netBill,
    }), {
      title: 'IPD Bill',
      hospitalName: hs.hospitalName,
      address: hs.address,
      phone: hs.phone,
      doctorName: hs.doctorName,
    })
  }

  // ── Loading state UI ───────────────────────────────────────
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
          <button onClick={printBill} className="btn-secondary flex items-center gap-2 text-xs no-print">
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

        {/* Package Billing */}
        {admission && (
          <IPDPackageBilling
            admissionId={admission.id}
            onPackageApplied={() => loadAll()}
          />
        )}

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2 mb-5 no-print">
          <button onClick={autoAddBedCharges}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-2 rounded-lg">
            <Calculator className="w-3.5 h-3.5" /> Auto-Add Bed + Nursing ({daysAdmitted} days)
          </button>
          <button onClick={() => setShowAddCharge(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-2 rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add Charge
          </button>
          <button onClick={saveBill} disabled={saving}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save Bill'}
          </button>
        </div>

        {/* Add charge form */}
        {showAddCharge && (
          <div className="card p-5 mb-5 border-l-4 border-indigo-400 no-print">
            <h3 className="font-semibold text-gray-800 mb-3">Add Charge</h3>

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
                <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold">
                  <td colSpan={5} className="px-3 py-3 text-right text-xs text-gray-600 uppercase">Grand Total</td>
                  <td className="px-3 py-3 font-mono text-lg text-gray-900">{inr(grandTotal)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Discount + Net + Payment inputs */}
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
            {paymentMode === 'upi' && (
              <div className="mt-3 grid grid-cols-2 gap-4">
                <div>
                  <label className="label">UPI ID (Receiving)</label>
                  <input className="input bg-blue-50 font-mono" value={upiId}
                    onChange={e => setUpiId(e.target.value)}
                    placeholder="yourname@upi" />
                  <p className="text-xs text-gray-500 mt-1">Patient will pay to this UPI ID</p>
                </div>
                <div>
                  <label className="label">Transaction Ref (optional)</label>
                  <input className="input" value={paymentRef}
                    onChange={e => setPaymentRef(e.target.value)}
                    placeholder="UTR / Transaction ID" />
                </div>
              </div>
            )}
            {paymentMode === 'card' && (
              <div className="mt-3">
                <div>
                  <label className="label">Card Ref (optional)</label>
                  <input className="input" value={paymentRef}
                    onChange={e => setPaymentRef(e.target.value)}
                    placeholder="Auth code / Last 4 digits" />
                </div>
              </div>
            )}
          </div>
        )}

        {isFullyPaid && (
          <div className="mt-5 bg-green-50 border border-green-300 rounded-xl p-5 no-print">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <h3 className="font-semibold text-green-800 text-sm">Bill Fully Paid</h3>
            </div>
            <p className="text-sm text-green-700">
              {inr(paidSoFar > 0 ? paidSoFar : netBill)} has been collected for this admission. The bill is marked <strong>Paid</strong> and that status is shared across all modules (IPD, Billing &amp; Finance, Patient Profile, Reports).
            </p>
            <p className="text-xs text-green-600 mt-1">
              Add more services above to bill any additional charges — a new outstanding balance will appear here to collect.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <Link
                href={`/ipd/discharge/${admission?.id}?tab=billing`}
                className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-4 py-2 rounded-lg">
                <IndianRupee className="w-3.5 h-3.5" /> Proceed to Discharge
              </Link>
              <Link
                href={`/billing?patientId=${patient?.id}&patientName=${encodeURIComponent(patient?.full_name || '')}&mrn=${patient?.mrn || ''}&source=ipd&admissionId=${admission?.id}`}
                className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold px-4 py-2 rounded-lg border">
                View in Billing Page
              </Link>
              <button
                onClick={printBill}
                className="flex items-center gap-1.5 bg-white hover:bg-gray-50 text-green-700 text-xs font-semibold px-4 py-2 rounded-lg border border-green-300">
                <Printer className="w-3.5 h-3.5" /> Print / Download Bill
              </button>
            </div>
          </div>
        )}

        {admission && charges.length > 0 && !isFullyPaid && (
          <div className="mt-5 bg-blue-50 border border-blue-200 rounded-xl p-5 no-print">
            <h3 className="font-semibold text-blue-800 text-sm mb-2">Pay Now or Collect Later</h3>
            <p className="text-xs text-blue-700 mb-3">
              {paidSoFar > 0
                ? `${inr(paidSoFar)} already collected. Outstanding balance for the current charges is ${inr(outstanding)}.`
                : 'Pay the net bill now, or collect later during discharge. The bill is saved automatically when you pay.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={payBillNow}
                disabled={paying}
                className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50">
                {paying ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <IndianRupee className="w-3.5 h-3.5" />}
                {paying ? 'Processing...' : `Pay ${inr(outstanding)} Now`}
              </button>
              <Link
                href={`/ipd/discharge/${admission.id}?tab=billing`}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2 rounded-lg">
                <IndianRupee className="w-3.5 h-3.5" /> Collect via Discharge
              </Link>
              <Link
                href={`/billing?patientId=${patient?.id}&patientName=${encodeURIComponent(patient?.full_name || '')}&mrn=${patient?.mrn || ''}&source=ipd&admissionId=${admission?.id}`}
                className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold px-4 py-2 rounded-lg border">
                Open Billing Page
              </Link>
            </div>
          </div>
        )}

        <div className="print-only mt-6 pt-4 border-t text-center text-xs text-gray-500">
          Generated: {new Date().toLocaleString('en-IN')} · NexMedicon HMS
        </div>
      </div>
    </AppShell>
  )
}