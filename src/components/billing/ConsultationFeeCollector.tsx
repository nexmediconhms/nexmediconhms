'use client'

/**
 * ConsultationFeeCollector — Collects registration/consultation fee
 * for both new and existing (returning) patients before OPD consultation.
 *
 * Usage:
 *   <ConsultationFeeCollector
 *     patientId="uuid"
 *     patientName="John Doe"
 *     mrn="MRN-001"
 *     isNewCase={false}
 *     onPaymentComplete={(billId, invoiceNumber) => { ... }}
 *     onSkip={() => { ... }}
 *   />
 *
 * Features:
 *   - Differentiates New Case vs Old Case (follow-up) fees
 *   - Reads fee amounts from hospital settings (feeOPD / feeFollowUp)
 *   - Supports Cash, UPI, Card, Credit payment methods
 *   - Creates bill in `bills` table (visible in patient profile Bills tab)
 *   - Creates bill_payments record for paid bills
 *   - Creates encounter record for daily/monthly reports
 *   - Supports "Skip / Pay Later" (creates pending bill)
 */

import { useState, useEffect } from 'react'
import { CheckCircle, AlertCircle, IndianRupee, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getIndiaToday } from '@/lib/utils'

// ─── Props ────────────────────────────────────────────────────────
interface ConsultationFeeCollectorProps {
  patientId: string
  patientName: string
  mrn: string
  /** true = first-time patient (higher fee), false = returning patient (follow-up fee) */
  isNewCase?: boolean
  /** Called when payment is confirmed or bill is created */
  onPaymentComplete?: (billId: string, invoiceNumber: string, amount: number, method: string) => void
  /** Called when user skips payment (creates pending bill) */
  onSkip?: (billId: string, invoiceNumber: string) => void
  /** Called when user cancels without creating any bill */
  onCancel?: () => void
  /** Override the default fee amount */
  defaultAmount?: number
  /** Whether to show the cancel button */
  showCancel?: boolean
  /** Additional context label (e.g., "Before OPD Consultation") */
  contextLabel?: string
  /** Compact mode for inline display */
  compact?: boolean
}

// ─── Payment method type ──────────────────────────────────────────
type PaymentMethod = 'cash' | 'upi' | 'card' | 'credit' | ''

// ─── Component ────────────────────────────────────────────────────
export default function ConsultationFeeCollector({
  patientId,
  patientName,
  mrn,
  isNewCase = true,
  onPaymentComplete,
  onSkip,
  onCancel,
  defaultAmount,
  showCancel = true,
  contextLabel = '',
  compact = false,
}: ConsultationFeeCollectorProps) {
  // ── State ─────────────────────────────────────────────────────
  const [caseType, setCaseType] = useState<'new' | 'followup'>(isNewCase ? 'new' : 'followup')
  const [amount, setAmount] = useState<string>('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('')
  const [paymentRef, setPaymentRef] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<{ billId: string; invoiceNumber: string; amount: number } | null>(null)

  // ── Load fee settings ─────────────────────────────────────────
  useEffect(() => {
    if (defaultAmount) {
      setAmount(String(defaultAmount))
      return
    }
    // Load from hospital settings
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('nexmedicon_settings') : null
      if (stored) {
        const settings = JSON.parse(stored)
        const fee = caseType === 'new'
          ? (settings.feeOPD || '500')
          : (settings.feeFollowUp || '300')
        setAmount(fee)
      } else {
        setAmount(caseType === 'new' ? '500' : '300')
      }
    } catch {
      setAmount(caseType === 'new' ? '500' : '300')
    }
  }, [caseType, defaultAmount])

  // ── Handle case type change ───────────────────────────────────
  function handleCaseTypeChange(type: 'new' | 'followup') {
    setCaseType(type)
    setError('')
  }

  // ── Create bill and record payment ────────────────────────────
  async function handleConfirmPayment() {
    if (!paymentMethod) {
      setError('Please select a payment method')
      return
    }
    const amountNum = parseFloat(amount)
    if (!amountNum || amountNum <= 0) {
      setError('Please enter a valid amount')
      return
    }

    setProcessing(true)
    setError('')

    try {
      const now = new Date()
      const todayStr = now.toISOString().slice(0, 10)
      const todayCompact = todayStr.replace(/-/g, '')

      // Generate invoice number
      const { count } = await supabase
        .from('bills')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', todayStr + 'T00:00:00')

      const invoiceNumber = `REG-${todayCompact}-${String((count || 0) + 1).padStart(3, '0')}`

      const description = caseType === 'new'
        ? 'OPD Registration Fee (New Case)'
        : 'OPD Consultation Fee (Follow-up)'

      // Create the bill
      const billPayload = {
        patient_id: patientId,
        patient_name: patientName,
        mrn: mrn,
        invoice_number: invoiceNumber,
        items: [{ label: description, description, qty: 1, rate: amountNum, amount: amountNum }],
        subtotal: amountNum,
        total: amountNum,
        net_amount: amountNum,
        discount: 0,
        tax: 0,
        gst_amount: 0,
        paid: amountNum,
        due: 0,
        status: 'paid',
        payment_mode: paymentMethod,
        payment_ref: paymentRef || null,
        paid_at: now.toISOString(),
        notes: `${caseType === 'new' ? 'New case registration' : 'Follow-up consultation'} payment — ${paymentMethod}${paymentRef ? ` (Ref: ${paymentRef})` : ''}`,
      }

      const { data: bill, error: billError } = await supabase
        .from('bills')
        .insert(billPayload)
        .select('id, invoice_number')
        .single()

      if (billError) {
        console.error('[ConsultationFee] Bill insert failed:', billError.message)
        setError(`Failed to create bill: ${billError.message}`)
        setProcessing(false)
        return
      }

      if (!bill) {
        setError('Bill creation returned no data')
        setProcessing(false)
        return
      }

      // Record payment in bill_payments (non-fatal if fails)
      try {
        await supabase.from('bill_payments').insert({
          bill_id: bill.id,
          patient_id: patientId,
          amount: amountNum,
          payment_mode: paymentMethod,
          reference: paymentRef || null,
          received_by: 'reception',
          notes: `${description} for ${patientName}`,
          transaction_type: 'payment',
        })
      } catch {
        // Non-fatal — bill itself was created
        console.warn('[ConsultationFee] bill_payments insert failed (non-fatal)')
      }

      // Create encounter record for reports (non-fatal)
      try {
        const { data: existingEnc } = await supabase
          .from('encounters')
          .select('id')
          .eq('patient_id', patientId)
          .eq('encounter_date', todayStr)
          .limit(1)

        if (existingEnc && existingEnc.length > 0) {
          // Link bill to existing encounter
          await supabase
            .from('encounters')
            .update({ revenue_status: 'paid', bill_id: bill.id, updated_at: now.toISOString() })
            .eq('id', existingEnc[0].id)
          await supabase
            .from('bills')
            .update({ encounter_id: existingEnc[0].id })
            .eq('id', bill.id)
        } else {
          // Create new encounter
          const { data: newEnc } = await supabase
            .from('encounters')
            .insert({
              patient_id: patientId,
              encounter_date: todayStr,
              encounter_type: 'OPD',
              chief_complaint: caseType === 'new' ? 'New Case Registration' : 'Follow-up Consultation',
              notes: `Payment: ₹${amountNum} via ${paymentMethod}`,
              revenue_status: 'paid',
              bill_id: bill.id,
            })
            .select('id')
            .single()

          if (newEnc) {
            await supabase.from('bills').update({ encounter_id: newEnc.id }).eq('id', bill.id)
          }
        }
      } catch {
        // Non-fatal — encounter creation is optional
        console.warn('[ConsultationFee] Encounter create/link failed (non-fatal)')
      }

      setSuccess({ billId: bill.id, invoiceNumber: bill.invoice_number || invoiceNumber, amount: amountNum })
      onPaymentComplete?.(bill.id, bill.invoice_number || invoiceNumber, amountNum, paymentMethod)
    } catch (err: any) {
      console.error('[ConsultationFee] Unexpected error:', err)
      setError(err?.message || 'An unexpected error occurred')
    } finally {
      setProcessing(false)
    }
  }

  // ── Skip payment (create pending bill) ────────────────────────
  async function handleSkipPayment() {
    setProcessing(true)
    setError('')

    try {
      const amountNum = parseFloat(amount) || (caseType === 'new' ? 500 : 300)
      const now = new Date()
      const todayStr = now.toISOString().slice(0, 10)
      const todayCompact = todayStr.replace(/-/g, '')

      const { count } = await supabase
        .from('bills')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', todayStr + 'T00:00:00')

      const invoiceNumber = `REG-${todayCompact}-${String((count || 0) + 1).padStart(3, '0')}`

      const description = caseType === 'new'
        ? 'OPD Registration Fee (New Case)'
        : 'OPD Consultation Fee (Follow-up)'

      const { data: bill, error: billError } = await supabase
        .from('bills')
        .insert({
          patient_id: patientId,
          patient_name: patientName,
          mrn: mrn,
          invoice_number: invoiceNumber,
          items: [{ label: description, description, qty: 1, rate: amountNum, amount: amountNum }],
          subtotal: amountNum,
          total: amountNum,
          net_amount: amountNum,
          discount: 0,
          tax: 0,
          gst_amount: 0,
          paid: 0,
          due: amountNum,
          status: 'pending',
          payment_mode: null,
          payment_ref: null,
          paid_at: null,
          notes: `${caseType === 'new' ? 'New case' : 'Follow-up'} — payment pending`,
        })
        .select('id, invoice_number')
        .single()

      if (billError) {
        console.error('[ConsultationFee] Pending bill insert failed:', billError.message)
        // Still allow skip even if bill creation fails
        onSkip?.('', '')
      } else if (bill) {
        onSkip?.(bill.id, bill.invoice_number || invoiceNumber)
      } else {
        onSkip?.('', '')
      }
    } catch (err: any) {
      console.warn('[ConsultationFee] Skip payment bill creation failed:', err?.message)
      onSkip?.('', '')
    } finally {
      setProcessing(false)
    }
  }

  // ── Success state ─────────────────────────────────────────────
  if (success) {
    return (
      <div className={`${compact ? 'p-4' : 'p-6'} bg-green-50 border border-green-200 rounded-2xl`}>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
            <CheckCircle className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-green-800">Payment Collected ✓</p>
            <p className="text-xs text-green-600">
              ₹{success.amount} — Invoice #{success.invoiceNumber}
            </p>
          </div>
        </div>
        <p className="text-xs text-green-700 mt-1">
          Bill has been created and is visible in the patient&apos;s Bills tab.
        </p>
      </div>
    )
  }

  // ── Payment method button classes ─────────────────────────────
  const methodClasses: Record<string, string> = {
    cash: 'border-green-400 bg-green-50 text-green-700 ring-2 ring-green-200',
    upi: 'border-purple-400 bg-purple-50 text-purple-700 ring-2 ring-purple-200',
    card: 'border-blue-400 bg-blue-50 text-blue-700 ring-2 ring-blue-200',
    credit: 'border-indigo-400 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-200',
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className={`${compact ? '' : 'bg-white rounded-2xl shadow-lg border border-gray-100 p-6'}`}>
      {/* Header */}
      {!compact && (
        <div className="mb-5">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <IndianRupee className="w-5 h-5 text-green-600" />
            Collect Consultation Fee
          </h2>
          {contextLabel && (
            <p className="text-sm text-gray-500 mt-0.5">{contextLabel}</p>
          )}
          <p className="text-xs text-gray-400 mt-1">
            Patient: <span className="font-semibold text-gray-600">{patientName}</span>
            {mrn && <span className="ml-2 font-mono">({mrn})</span>}
          </p>
        </div>
      )}

      {/* Case Type Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Case Type</label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => handleCaseTypeChange('new')}
            className={`py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all duration-200 ${
              caseType === 'new'
                ? 'border-blue-400 bg-blue-50 text-blue-700 ring-2 ring-blue-200'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            }`}
          >
            🆕 New Case
            <div className="text-xs font-normal mt-0.5 opacity-75">First visit / New complaint</div>
          </button>
          <button
            type="button"
            onClick={() => handleCaseTypeChange('followup')}
            className={`py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all duration-200 ${
              caseType === 'followup'
                ? 'border-amber-400 bg-amber-50 text-amber-700 ring-2 ring-amber-200'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            }`}
          >
            🔄 Follow-up / Old Case
            <div className="text-xs font-normal mt-0.5 opacity-75">Returning for same issue</div>
          </button>
        </div>
      </div>

      {/* Amount */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Amount (₹)</label>
        <input
          type="number"
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-lg font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={amount}
          onChange={e => { setAmount(e.target.value); setError('') }}
          min="0"
          placeholder="Enter fee amount"
        />
        <p className="text-xs text-gray-400 mt-1">
          {caseType === 'new' ? 'Registration fee for new case' : 'Consultation fee for follow-up'}
        </p>
      </div>

      {/* Payment Method */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Payment Method</label>
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: 'cash' as const, label: '💵 Cash' },
            { key: 'upi' as const, label: '📱 UPI' },
            { key: 'card' as const, label: '💳 Debit Card' },
            { key: 'credit' as const, label: '💳 Credit Card' },
          ].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => { setPaymentMethod(key); setError('') }}
              className={`py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all duration-200 ${
                paymentMethod === key
                  ? methodClasses[key]
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Transaction Reference (for non-cash) */}
      {paymentMethod && paymentMethod !== 'cash' && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Transaction Reference (optional)
          </label>
          <input
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Card last 4 digits / UPI Transaction ID"
            value={paymentRef}
            onChange={e => setPaymentRef(e.target.value)}
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={handleConfirmPayment}
          disabled={!paymentMethod || processing}
          className={`w-full py-3.5 rounded-xl text-white font-bold text-sm transition-all duration-200 flex items-center justify-center gap-2 ${
            paymentMethod && !processing
              ? 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 shadow-lg shadow-green-200'
              : 'bg-gray-300 cursor-not-allowed'
          }`}
        >
          {processing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Processing...
            </>
          ) : (
            <>✓ Confirm Payment — ₹{amount || '0'}</>
          )}
        </button>

        <button
          type="button"
          onClick={handleSkipPayment}
          disabled={processing}
          className="w-full py-3 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-all duration-200 disabled:opacity-50"
        >
          Skip Payment / Pay Later
        </button>

        {showCancel && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={processing}
            className="w-full py-2.5 text-sm text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
