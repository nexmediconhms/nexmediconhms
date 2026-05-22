'use client'

import { useState, useEffect, useRef } from 'react'
import { IndianRupee, X, CreditCard, Smartphone, Banknote, Clock, CheckCircle } from 'lucide-react'
import { loadSettings } from '@/lib/settings'

interface PatientInfo {
  id: string
  name: string
  mrn: string
  mobile?: string
}

interface PayAndQueueModalProps {
  isOpen: boolean
  patient: PatientInfo
  onClose: () => void
  onConfirm: (paymentMethod: string | null, amount: number) => void
}

type PaymentMethod = 'cash' | 'upi' | 'card' | 'credit'

export default function PayAndQueueModal({ isOpen, patient, onClose, onConfirm }: PayAndQueueModalProps) {
  const [amount, setAmount] = useState<string>('500')
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null)
  const [upiConfirmStep, setUpiConfirmStep] = useState(false)
  const [processing, setProcessing] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) {
      try {
        const settings = loadSettings()
        const fee = settings.feeOPD || '500'
        setAmount(fee)
      } catch {
        setAmount('500')
      }
      setSelectedMethod(null)
      setUpiConfirmStep(false)
      setProcessing(false)
    }
  }, [isOpen])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
    }
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose])

  function handleMethodSelect(method: PaymentMethod) {
    setSelectedMethod(method)

    if (method === 'cash' || method === 'card') {
      handleConfirmPayment(method)
    } else if (method === 'upi') {
      setUpiConfirmStep(true)
    } else if (method === 'credit') {
      handleConfirmPayment(method)
    }
  }

  function handleConfirmPayment(method: PaymentMethod) {
    setProcessing(true)
    const numAmount = parseFloat(amount) || 0
    onConfirm(method, numAmount)
  }

  function handleUpiConfirm() {
    handleConfirmPayment('upi')
  }

  function handleSkipPayment() {
    setProcessing(true)
    onConfirm(null, parseFloat(amount) || 0)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={modalRef}
        className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-md overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-green-50 to-emerald-50">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Payment & Queue</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-gray-600 font-medium">{patient.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-white rounded text-gray-500 border border-gray-200">
                {patient.mrn}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/80 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Amount Section */}
        <div className="px-5 py-4">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Consultation Fee
          </label>
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden flex-1">
              <span className="flex items-center px-3 py-2.5 bg-gray-50 border-r border-gray-200">
                <IndianRupee className="w-4 h-4 text-gray-500" />
              </span>
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="flex-1 px-3 py-2.5 text-lg font-bold text-gray-900 outline-none focus:ring-0"
                min="0"
                step="50"
              />
            </div>
          </div>
        </div>

        {/* Payment Methods */}
        {!upiConfirmStep ? (
          <div className="px-5 pb-4">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2 block">
              Payment Method
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleMethodSelect('cash')}
                disabled={processing}
                className="flex items-center justify-center gap-2 px-4 py-3 border border-gray-200 rounded-lg hover:border-green-300 hover:bg-green-50 transition-all group disabled:opacity-50"
              >
                <Banknote className="w-5 h-5 text-green-600 group-hover:text-green-700" />
                <span className="text-sm font-medium text-gray-700 group-hover:text-green-700">Cash</span>
              </button>

              <button
                onClick={() => handleMethodSelect('upi')}
                disabled={processing}
                className="flex items-center justify-center gap-2 px-4 py-3 border border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 transition-all group disabled:opacity-50"
              >
                <Smartphone className="w-5 h-5 text-purple-600 group-hover:text-purple-700" />
                <span className="text-sm font-medium text-gray-700 group-hover:text-purple-700">UPI</span>
              </button>

              <button
                onClick={() => handleMethodSelect('card')}
                disabled={processing}
                className="flex items-center justify-center gap-2 px-4 py-3 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-all group disabled:opacity-50"
              >
                <CreditCard className="w-5 h-5 text-blue-600 group-hover:text-blue-700" />
                <span className="text-sm font-medium text-gray-700 group-hover:text-blue-700">Card</span>
              </button>

              <button
                onClick={() => handleMethodSelect('credit')}
                disabled={processing}
                className="flex items-center justify-center gap-2 px-4 py-3 border border-gray-200 rounded-lg hover:border-amber-300 hover:bg-amber-50 transition-all group disabled:opacity-50"
              >
                <Clock className="w-5 h-5 text-amber-600 group-hover:text-amber-700" />
                <span className="text-sm font-medium text-gray-700 group-hover:text-amber-700">Credit</span>
              </button>
            </div>
          </div>
        ) : (
          /* UPI Confirmation Step */
          <div className="px-5 pb-4">
            <div className="bg-purple-50 border border-purple-100 rounded-lg p-4 mb-3">
              <div className="flex items-center gap-2 mb-2">
                <Smartphone className="w-4 h-4 text-purple-600" />
                <span className="text-sm font-medium text-purple-800">UPI Payment</span>
              </div>
              <p className="text-xs text-purple-600">
                Collect payment via Razorpay/UPI app, then confirm below once the payment is received.
              </p>
              <div className="mt-2 bg-white rounded-md px-3 py-2 border border-purple-100">
                <span className="text-xs text-gray-500">Amount:</span>
                <span className="text-sm font-bold text-gray-900 ml-1">
                  ₹{parseFloat(amount).toLocaleString('en-IN')}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleUpiConfirm}
                disabled={processing}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium text-sm transition-colors disabled:opacity-50"
              >
                <CheckCircle className="w-4 h-4" />
                {processing ? 'Processing...' : 'Payment Received'}
              </button>
              <button
                onClick={() => { setUpiConfirmStep(false); setSelectedMethod(null) }}
                className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* Skip Payment */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50">
          <button
            onClick={handleSkipPayment}
            disabled={processing}
            className="w-full text-center text-xs text-gray-500 hover:text-gray-700 py-1.5 transition-colors disabled:opacity-50"
          >
            Skip payment — add to queue without billing
          </button>
        </div>
      </div>
    </div>
  )
}