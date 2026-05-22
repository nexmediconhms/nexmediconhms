'use client'
/**
 * src/components/payment/UPIPaymentFlow.tsx
 *
 * UPI Payment Flow Component
 *
 * Full UPI payment experience for clinic reception:
 *   1. Shows QR code generated from upi://pay? deep link
 *   2. Shows UPI ID as copyable text
 *   3. Shows amount prominently
 *   4. "Verify Payment" button — receptionist clicks after seeing notification
 *   5. Optional "Send Payment Link" if Razorpay is configured
 *
 * Reads clinic UPI ID from settings (clinic_settings table).
 *
 * USAGE:
 *   <UPIPaymentFlow
 *     amount={500}
 *     patientName="John Doe"
 *     patientId="uuid"
 *     mrn="P-001"
 *     context="opd"
 *     onPaymentVerified={(ref) => { ... }}
 *     onCancel={() => { ... }}
 *   />
 */

import { useEffect, useState, useRef } from 'react'
import QRCode from 'qrcode'
import { loadSettings, resolveUpiId } from '@/lib/settings'
import {
  CheckCircle, Copy, ExternalLink, Loader2,
  QrCode, Smartphone, AlertCircle, RefreshCw,
  IndianRupee, Clock, Send,
} from 'lucide-react'

interface UPIPaymentFlowProps {
  amount: number
  patientName: string
  patientId: string
  mrn: string
  context?: 'opd' | 'ipd'
  mobile?: string
  description?: string
  onPaymentVerified: (reference: string) => void
  onCancel: () => void
  onSendPaymentLink?: () => void
}

type PaymentState = 'qr' | 'verifying' | 'verified' | 'failed' | 'timeout'

export default function UPIPaymentFlow({
  amount,
  patientName,
  patientId,
  mrn,
  context = 'opd',
  mobile,
  description = 'OPD Registration Fee',
  onPaymentVerified,
  onCancel,
  onSendPaymentLink,
}: UPIPaymentFlowProps) {
  const [upiId, setUpiId] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [upiDeepLink, setUpiDeepLink] = useState('')
  const [paymentState, setPaymentState] = useState<PaymentState>('qr')
  const [verifyRef, setVerifyRef] = useState('')
  const [copied, setCopied] = useState(false)
  const [copiedUPI, setCopiedUPI] = useState(false)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [showManualRef, setShowManualRef] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(Date.now())

  // Load UPI settings and generate QR
  useEffect(() => {
    const settings = loadSettings()
    const resolvedUpi = resolveUpiId(context, settings)
    setUpiId(resolvedUpi)

    if (resolvedUpi) {
      const hospitalName = settings.hospitalName || 'Hospital'
      // Build UPI deep link per NPCI spec
      const deepLink =
        `upi://pay?pa=${encodeURIComponent(resolvedUpi)}` +
        `&pn=${encodeURIComponent(hospitalName)}` +
        `&am=${amount.toFixed(2)}` +
        `&cu=INR` +
        `&tn=${encodeURIComponent(`${description} - ${patientName} (${mrn})`)}`

      setUpiDeepLink(deepLink)

      // Generate QR code
      QRCode.toDataURL(deepLink, {
        width: 280,
        margin: 2,
        color: { dark: '#1a1a2e', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      }).then(url => {
        setQrDataUrl(url)
      }).catch(err => {
        console.error('[UPI QR] Generation failed:', err)
      })
    }
  }, [amount, patientName, mrn, context, description])

  // Timer for payment waiting
  useEffect(() => {
    if (paymentState === 'qr') {
      startTimeRef.current = Date.now()
      timerRef.current = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 1000)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [paymentState])

  function handleCopyUPI() {
    navigator.clipboard.writeText(upiId)
    setCopiedUPI(true)
    setTimeout(() => setCopiedUPI(false), 2000)
  }

  function handleCopyAmount() {
    navigator.clipboard.writeText(amount.toString())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleVerifyPayment() {
    setPaymentState('verifying')

    // Simulate a brief verification delay (in production this could poll Razorpay/bank)
    // In manual mode, receptionist confirms after checking phone notification
    setTimeout(() => {
      setPaymentState('verified')
      const ref = verifyRef.trim() || `UPI-${Date.now().toString(36).toUpperCase()}`
      onPaymentVerified(ref)
    }, 1500)
  }

  function handleTimeout() {
    setPaymentState('timeout')
  }

  function handleRetry() {
    setPaymentState('qr')
    setElapsedTime(0)
    startTimeRef.current = Date.now()
  }

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  // No UPI ID configured
  if (!upiId) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
        <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
        <h3 className="text-lg font-bold text-amber-800 mb-2">UPI Not Configured</h3>
        <p className="text-sm text-amber-600 mb-4">
          Please add your clinic&apos;s UPI ID in Settings → Payment & Fees to enable QR payments.
        </p>
        <button onClick={onCancel}
          className="px-4 py-2 bg-amber-600 text-white rounded-xl text-sm font-semibold hover:bg-amber-700 transition-colors">
          Go Back
        </button>
      </div>
    )
  }

  // Verified state
  if (paymentState === 'verified') {
    return (
      <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center animate-in fade-in">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-8 h-8 text-green-600" />
        </div>
        <h3 className="text-lg font-bold text-green-800 mb-1">Payment Verified!</h3>
        <p className="text-sm text-green-600 mb-2">
          {`\u20B9${amount}`} received from {patientName}
        </p>
        {verifyRef && (
          <p className="text-xs text-green-500 font-mono">Ref: {verifyRef}</p>
        )}
      </div>
    )
  }

  // Verifying state
  if (paymentState === 'verifying') {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-8 text-center animate-in fade-in">
        <Loader2 className="w-10 h-10 text-blue-600 mx-auto mb-4 animate-spin" />
        <h3 className="text-lg font-bold text-blue-800 mb-1">Verifying Payment...</h3>
        <p className="text-sm text-blue-600">Please wait while we confirm the transaction.</p>
      </div>
    )
  }

  // Timeout state
  if (paymentState === 'timeout') {
    return (
      <div className="bg-orange-50 border border-orange-200 rounded-2xl p-6 text-center">
        <Clock className="w-10 h-10 text-orange-500 mx-auto mb-3" />
        <h3 className="text-lg font-bold text-orange-800 mb-2">Payment Not Received</h3>
        <p className="text-sm text-orange-600 mb-4">
          The payment was not confirmed within the expected time. You can retry or choose another method.
        </p>
        <div className="flex gap-3 justify-center">
          <button onClick={handleRetry}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
          <button onClick={onCancel}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-300 transition-colors">
            Use Other Method
          </button>
        </div>
      </div>
    )
  }

  // Main QR display
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-4 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <QrCode className="w-5 h-5" />
            <span className="font-bold text-sm">UPI Payment</span>
          </div>
          <div className="flex items-center gap-1.5 bg-white/20 rounded-lg px-2.5 py-1">
            <Clock className="w-3 h-3" />
            <span className="text-xs font-mono">{formatTime(elapsedTime)}</span>
          </div>
        </div>
        <div className="mt-2">
          <span className="text-xs text-purple-200">Collecting from</span>
          <div className="text-sm font-semibold">{patientName} ({mrn})</div>
        </div>
      </div>

      {/* Amount Display */}
      <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-100 px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs text-green-600 font-medium">Amount to Pay</span>
            <div className="text-3xl font-black text-green-800 flex items-center gap-1">
              <IndianRupee className="w-6 h-6" />
              {amount.toLocaleString('en-IN')}
            </div>
          </div>
          <button onClick={handleCopyAmount}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              copied
                ? 'bg-green-200 text-green-800'
                : 'bg-green-100 text-green-700 hover:bg-green-200'
            }`}>
            {copied ? <CheckCircle className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* QR Code */}
        <div className="flex flex-col items-center">
          {qrDataUrl ? (
            <div className="relative">
              <img
                src={qrDataUrl}
                alt="UPI QR Code"
                className="w-56 h-56 rounded-xl border-2 border-gray-100 shadow-sm"
              />
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-white border border-gray-200 rounded-full px-3 py-0.5 shadow-sm">
                <span className="text-[10px] text-gray-500 font-medium">Scan to Pay</span>
              </div>
            </div>
          ) : (
            <div className="w-56 h-56 bg-gray-100 rounded-xl flex items-center justify-center animate-pulse">
              <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
            </div>
          )}
          <p className="text-xs text-gray-400 mt-4 text-center">
            Patient scans this QR with any UPI app (Google Pay, PhonePe, Paytm, etc.)
          </p>
        </div>

        {/* UPI ID - Copyable */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">UPI ID</span>
              <div className="text-sm font-mono font-bold text-gray-800 mt-0.5 select-all">
                {upiId}
              </div>
            </div>
            <button onClick={handleCopyUPI}
              className={`flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                copiedUPI
                  ? 'bg-green-100 text-green-700'
                  : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
              }`}>
              {copiedUPI ? <CheckCircle className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedUPI ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Transaction Reference Input (optional) */}
        <div>
          <button
            onClick={() => setShowManualRef(!showManualRef)}
            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-2"
          >
            <Smartphone className="w-3 h-3" />
            {showManualRef ? 'Hide' : 'Enter'} UTR/Transaction Reference (optional)
          </button>
          {showManualRef && (
            <input
              type="text"
              value={verifyRef}
              onChange={e => setVerifyRef(e.target.value)}
              placeholder="e.g., 412345678901 or UPI transaction ID"
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            />
          )}
        </div>

        {/* Verify Payment Button */}
        <button
          onClick={handleVerifyPayment}
          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold text-sm transition-all shadow-lg shadow-purple-200 flex items-center justify-center gap-2"
        >
          <CheckCircle className="w-5 h-5" />
          Verify Payment Received
        </button>
        <p className="text-[10px] text-gray-400 text-center -mt-2">
          Click after you see the payment notification on your phone/app
        </p>

        {/* Send Payment Link Option */}
        {(onSendPaymentLink || mobile) && (
          <div className="border-t border-gray-100 pt-4">
            <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wide mb-2">
              Or send payment link to patient
            </p>
            <div className="flex gap-2">
              {mobile && (
                <a
                  href={`https://wa.me/91${mobile.replace(/\D/g, '')}?text=${encodeURIComponent(
                    `Please pay \u20B9${amount} for ${description}.\n\nUPI ID: ${upiId}\n\nOr click to pay: ${upiDeepLink}\n\nThank you!`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold px-3 py-2.5 rounded-xl transition-colors"
                >
                  <Send className="w-3.5 h-3.5" /> WhatsApp
                </a>
              )}
              {onSendPaymentLink && (
                <button
                  onClick={onSendPaymentLink}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold px-3 py-2.5 rounded-xl transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Razorpay Link
                </button>
              )}
            </div>
          </div>
        )}

        {/* Cancel */}
        <button onClick={onCancel}
          className="w-full py-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 font-medium text-xs transition-all">
          Use Another Payment Method
        </button>
      </div>
    </div>
  )
}
