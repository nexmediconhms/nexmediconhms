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
//
// CONTEXT
//   The original ipd_charges schema (migrations/archive/fix-all-permissions.sql)
//   was created before the structured IPD billing UI existed. It used:
//       (item_name, category, amount, quantity, notes, created_at)
//   The current UI writes columns the legacy schema doesn't have:
//       (charge_date, description, rate, created_by)
//   On a Supabase project that hasn't run migrations/018_align_ipd_charges_schema.sql
//   any insert from the UI fails with the PostgREST schema-cache error.
//
// WHAT THESE HELPERS DO
//   - isSchemaCacheError(err): detects the PGRST204-class error so we can
//     branch on it instead of treating it as a generic write failure.
//   - mapChargeRowToUI(row): coalesces (description ?? item_name),
//     (rate ?? amount/quantity) and (charge_date ?? created_at::date) so
//     historical legacy rows render correctly in the modern UI.
//   - mapRateRowToUI(row): same idea for ipd_charge_rates — coalesces
//     name → description, amount → default_rate, unit → per_unit.
//   - toLegacyChargeRow(row): converts a modern insert payload into the
//     subset of columns the legacy schema accepts, so a fallback insert
//     succeeds even when the migration hasn't been run. We preserve as
//     much information as the legacy schema can hold (description goes
//     into item_name; rate is derived back from amount/quantity).
//
// AFTER THE MIGRATION RUNS
//   The modern insert succeeds on the first attempt and the fallback
//   path is never exercised — these helpers become a quiet safety net.
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

      // Load existing charges for this admission
      if (adm?.id) {
        // Schema-resilient read: if the modern `charge_date` column doesn't
        // exist on this Supabase project (pre-migration-018), the order()
        // call below would fail with a schema-cache error. We try the
        // modern ordering first and fall back to created_at — both paths
        // map their results through mapChargeRowToUI() which coalesces
        // legacy column names (item_name / amount-derived rate).
        let existingCharges: any[] | null = null
        const modernRead = await supabase
          .from('ipd_charges')
          .select('*')
          .eq('admission_id', adm.id)
          .order('charge_date', { ascending: true })
          .order('created_at', { ascending: true })

        if (modernRead.error && isSchemaCacheError(modernRead.error)) {
          // Legacy schema: no charge_date column. Order by created_at only.
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

        // Load discount from admission
        setDiscount(Number(adm.discount) || 0)
        setPaymentMode(adm.payment_mode || 'cash')
      }
    }

    // Load charge rate templates — schema-resilient read.
    // Pre-migration-018 the `sort_order` column doesn't exist either, so
    // .order('sort_order') fails and rates silently come back empty —
    // that's why "Auto-Add" was falling through to the hardcoded ₹800
    // default. We try the modern ordering first and fall back to a sort
    // by category/name on legacy schemas.
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

    // Schema-resilient insert: try the modern shape first; on schema-cache
    // error fall back to the legacy column subset (item_name in place of
    // description, no charge_date / rate / created_by). The legacy fallback
    // preserves the most clinically important data — admission link,
    // patient, line item, amount and quantity.
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

    // Map the freshly inserted row through the same coalescer used on read,
    // so the UI gets a consistent shape regardless of which schema actually
    // stored the row.
    const uiRow = mapChargeRowToUI(data)
    // Auto-add helpers store charge_date / rate from the input even when
    // the legacy schema didn't persist them, so UI staleness can't drift.
    if (!uiRow.charge_date) uiRow.charge_date = chargeToSave.charge_date
    if (!uiRow.rate) uiRow.rate = chargeToSave.rate
    setCharges(prev => [...prev, uiRow])

    // Reset form
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

    // Schema-resilient bulk insert. Same dual-schema strategy as
    // addCharge() above: try the modern column set first; on schema-cache
    // error fall back to the legacy subset. The button that triggers this
    // function is the one the user reported as broken with
    //   "Could not find the 'charge_date' column of 'ipd_charges' in
    //    the schema cache"
    // — this fallback fixes that case immediately even before the admin
    // applies migration 018. After the migration the modern path
    // succeeds first-try and the fallback never fires.
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

    // Map results through the coalescer; preserve charge_date / rate from
    // our input when the legacy schema didn't persist them, so the just-
    // added rows display correctly even though the DB doesn't (yet) have
    // those columns.
    const inserted = (data || []).map((c: any, i: number) => {
      const ui = mapChargeRowToUI(c)
      if (!ui.charge_date) ui.charge_date = insertData[i]?.charge_date ?? ''
      if (!ui.rate) ui.rate = Number(insertData[i]?.rate) || 0
      if (!ui.description) ui.description = insertData[i]?.description ?? ''
      return ui
    })
    setCharges(prev => [...prev, ...inserted])

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
  //
  // SCHEMA-RESILIENCE FIX (June 2026)
  // ─────────────────────────────────
  // Reported error:
  //     Save failed: Could not find the 'bill_status' column of
  //     'ipd_admissions' in the schema cache
  //
  // Root cause: the early ipd_admissions schema didn't carry the
  // billing-summary columns (total_charges, discount, net_bill,
  // bill_status, payment_mode); they were added later when the
  // structured IPD billing UI was introduced.  Supabase projects that
  // haven't run migrations/019_align_ipd_admissions_bill_columns.sql
  // reject the entire UPDATE because PostgREST can't find any of
  // those columns in its schema cache.
  //
  // Resolution (paired with migration 019, but works independently):
  //   1. Try the modern UPDATE first — full payload.
  //   2. On a schema-cache error (PGRST204 / 42703 / "could not find /
  //      does not exist") retry with a *progressively narrower*
  //      payload, dropping the unknown column on each pass.  The most
  //      important field (bill_status, used everywhere downstream) is
  //      preserved as long as possible.
  //
  // ╔════════════════════════════════════════════════════════════════╗
  // ║  ADDITIONAL FIX — IPD-NEW-1 (June 2026)                       ║
  // ║                                                                ║
  // ║  Pre-fix saveBill() ONLY updated ipd_admissions and never      ║
  // ║  inserted a row in the `bills` table.  Every other module of  ║
  // ║  the system (CA reports, daily closing, finance ledger,       ║
  // ║  doctor earnings, refund flow) reads from `bills` — so IPD    ║
  // ║  revenue was invisible to all of them.                         ║
  // ║                                                                ║
  // ║  We now ALSO upsert a corresponding bills row via the          ║
  // ║  /api/billing/generate-bill endpoint.  The endpoint already    ║
  // ║  knows how to:                                                 ║
  // ║    - allocate a sequential IPD invoice number                  ║
  // ║    - cross-check totals server-side                            ║
  // ║    - sync to hospital_fund                                     ║
  // ║  All we have to do is hand it the items + admission_id, with  ║
  // ║  an idempotency_key keyed on the admission so repeated saves  ║
  // ║  return the existing bill instead of creating duplicates.      ║
  // ║                                                                ║
  // ║  This makes IPD admissions visible to:                         ║
  // ║    - daily revenue reports (bills.paid_at)                     ║
  // ║    - the refund flow (refunds need a bills.id)                 ║
  // ║    - doctor earnings                                           ║
  // ║    - the finance ledger                                        ║
  // ╚════════════════════════════════════════════════════════════════╝
  async function payBillNow() {
    if (!admission?.id || !patient?.id) return
    setPaying(true)
    setError('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      // 1) Strict lookup by admission_id.
      let { data: existingBill } = await supabase
        .from('bills')
        .select('id, bill_number, invoice_number, net_amount, status')
        .eq('admission_id', admission.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      // 2) FALLBACK: on installs where bills has no admission_id column (it is
      //    stripped at insert time), the strict lookup returns nothing even
      //    though the bill exists. Fall back to this patient's most recent bill,
      //    trying both column namings so it works on any schema variant.
      if (!existingBill && patient?.id) {
        for (const col of ['patient_id', 'patientid'] as const) {
          const { data: fb, error: fbErr } = await supabase
            .from('bills')
            .select('id, bill_number, invoice_number, net_amount, status')
            .eq(col, patient.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (!fbErr && fb) { existingBill = fb; break }
        }
      }

      // 3) FINAL FALLBACK: mirror the discharge page — most recent IPD-module
      //    bill. Covers rows where both admission_id and the patient column
      //    are null/mismatched (which is why the discharge page finds it but
      //    the strict lookups above don't).
      if (!existingBill) {
        const { data: fb } = await supabase
          .from('bills')
          .select('id, bill_number, invoice_number, net_amount, status, admission_id')
          .eq('bill_module', 'IPD')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (fb) existingBill = fb
      }

      if (!existingBill) {
        setError('No bill found. Please save the bill first before paying.')
        setPaying(false)
        return
      }

      if (existingBill.status === 'paid') {
        setBillPaid(true)
        setSuccess('This bill has already been paid.')
        setPaying(false)
        return
      }

      const payRes = await fetch('/api/billing/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          billId: existingBill.id,        // route reads billId
          bill_id: existingBill.id,       // and bill_id — send both, safe either way
          amount: netBill,
          paymentMode: paymentMode,       // route reads paymentMode
          payment_mode: paymentMode,      // and payment_mode
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
      setSuccess('Payment received successfully! Bill has been marked as Paid.')
      setTimeout(() => setSuccess(''), 8000)
    } catch (e: any) {
      setError(`Payment error: ${e?.message || 'Unknown error'}`)
    } finally {
      setPaying(false)
    }
  }

  async function saveBill() {
    if (!admission?.id) return
    setSaving(true)
    setError('')

    // Compose the canonical (modern) payload once.
    const fullPayload: Record<string, any> = {
      total_charges: grandTotal,
      discount,
      net_bill: netBill,
      bill_status: 'pending',
      payment_mode: paymentMode,
    }

    // Helper: detect "column not found in schema cache" errors so we
    // can narrow the payload and retry rather than failing outright.
    function isSchemaCacheUpdateError(e: any): boolean {
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

    // Extract the offending column name from the supabase error message
    // so we can drop just that column from the next attempt.
    function unknownColumnFrom(e: any): string | null {
      const msg = String(e?.message || '')
      // Match the most common shapes reported by PostgREST + PG:
      //   Could not find the 'X' column of 'Y' in the schema cache
      //   column "X" of relation "Y" does not exist
      let m = msg.match(/['"]([a-z_][a-z0-9_]*)['"][^'\"]*column/i)
      if (m) return m[1]
      m = msg.match(/column\s+['"]?([a-z_][a-z0-9_]*)['"]?/i)
      if (m) return m[1]
      m = msg.match(/the\s+['"]?([a-z_][a-z0-9_]*)['"]?\s+column/i)
      if (m) return m[1]
      return null
    }

    // Try the update with progressively narrower payloads, removing
    // unknown columns one at a time. Bounded to 6 attempts so a
    // pathological loop can't run away.
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
        // We can't tell which column to drop — bail out.
        break
      }

      console.warn(
        `[IPD billing saveBill] '${offending}' not in ipd_admissions schema cache; ` +
        `retrying without that column.  Apply migration 019 to remove this fallback.`,
      )
      droppedCols.push(offending)
      const { [offending as keyof typeof payload]: _drop, ...rest } = payload
      payload = rest
      // If we've dropped every billing column, give up — there's
      // nothing useful left to write through this path.
      if (Object.keys(payload).length === 0) break
    }

    if (lastErr) {
      setSaving(false)
      setError(`Save failed: ${lastErr.message}`)
      return
    }

    // ── IPD-NEW-1 fix: also create / upsert the corresponding bills row ──
    //
    // This is the change that makes IPD admissions visible to the rest
    // of the financial system (CA reports, finance ledger, refund
    // flow, doctor earnings).  The /api/billing/generate-bill endpoint
    // is the canonical entry point for bills creation; we hand it the
    // admission's charges and let it do the heavy lifting.
    //
    // Idempotency: we key the request by `ipd-admission-{id}` so a
    // repeated saveBill() click returns the existing bill instead of
    // creating duplicates.  The endpoint already supports this via the
    // `idempotency_key` body field.
    let billsSyncOk = true
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
          gst_percent: 0, // IPD bills typically not GST-applicable for medical services
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
          'created.  CA reports, refunds, and doctor earnings will not see ' +
          'this admission until the bill is created via Billing → IPD → ' +
          `Generate.  Detail: ${errBody?.error || billRes.statusText}`,
        )
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
      // Save partially succeeded but the bills-table sync didn't —
      // surface a clear warning so reception knows to re-generate.
      setError(
        'Bill summary saved on the admission, but creating the formal bill ' +
        'in the billing system failed.  Please go to Billing → New IPD Bill ' +
        'and generate it manually so revenue reports stay in sync.',
      )
    } else {
      setSuccess('Bill saved successfully!')
    }
    setTimeout(() => { setSuccess('') }, 6000)
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
          <button onClick={() => {
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
          }} className="btn-secondary flex items-center gap-2 text-xs no-print">
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
﻿            {paymentMode === 'upi' && (
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

        {billPaid && (
          <div className="mt-5 bg-green-50 border border-green-300 rounded-xl p-5 no-print">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <h3 className="font-semibold text-green-800 text-sm">Payment Completed</h3>
            </div>
            <p className="text-sm text-green-700">
              Amount of {inr(netBill)} has been paid successfully. Bill status updated across all modules (IPD, Billing, Patient Profile, Reports).
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
            </div>
          </div>
        )}

        {success && admission && !billPaid && (
          <div className="mt-5 bg-blue-50 border border-blue-200 rounded-xl p-5 no-print">
            <h3 className="font-semibold text-blue-800 text-sm mb-2">Bill Saved — Pay Now or Later</h3>
            <p className="text-xs text-blue-700 mb-3">
              Bill saved with status &quot;Unpaid&quot;. You can pay now or collect later during discharge.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={payBillNow}
                disabled={paying}
                className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50">
                {paying ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <IndianRupee className="w-3.5 h-3.5" />}
                {paying ? 'Processing...' : `Pay ${inr(netBill)} Now`}
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
