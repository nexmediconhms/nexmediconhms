'use client'
/**
 * src/components/payment/PaymentReceipt.tsx
 *
 * Payment Receipt Component
 *
 * Generates and displays a professional payment receipt after payment is confirmed.
 * Links to the patient profile. Can be printed.
 *
 * This receipt is:
 *   - Generated immediately after payment confirmation
 *   - Linked to the patient's profile (bill_id stored)
 *   - Visible in patient history via the bills table
 *   - Synced to dashboard/revenue via the same bills + bill_payments tables
 *
 * USAGE:
 *   <PaymentReceipt
 *     billId="uuid"
 *     invoiceNumber="REG-20260522-001"
 *     patientName="John Doe"
 *     patientId="uuid"
 *     mrn="P-001"
 *     amount={500}
 *     paymentMethod="upi"
 *     paymentRef="UPI-ABC123"
 *     description="OPD Registration Fee"
 *   />
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { loadSettings } from '@/lib/settings'
import {
  CheckCircle, Printer, ExternalLink, Download,
  IndianRupee, User, FileText, Calendar,
  Share2,
} from 'lucide-react'

interface PaymentReceiptProps {
  billId: string
  invoiceNumber: string
  patientName: string
  patientId: string
  mrn: string
  amount: number
  paymentMethod: string
  paymentRef?: string
  description?: string
  createdAt?: string
}

export default function PaymentReceipt({
  billId,
  invoiceNumber,
  patientName,
  patientId,
  mrn,
  amount,
  paymentMethod,
  paymentRef,
  description = 'OPD Registration Fee',
  createdAt,
}: PaymentReceiptProps) {
  const [settings, setSettings] = useState<any>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setSettings(loadSettings())
  }, [])

  const receiptDate = createdAt
    ? new Date(createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  const receiptTime = createdAt
    ? new Date(createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })

  const payMethodLabel: Record<string, string> = {
    cash: 'Cash',
    upi: 'UPI',
    card: 'Card',
    credit: 'Credit Card',
    pending: 'Pending',
  }

  function handlePrint() {
    const receiptContent = document.getElementById('payment-receipt-printable')?.innerHTML || ''
    const w = window.open('', '_blank')
    if (w) {
      w.document.write(`<!DOCTYPE html><html><head><title>Payment Receipt - ${invoiceNumber}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px; color: #1a1a2e; max-width: 600px; margin: 0 auto; }
          .header { background: #1e40af; color: white; padding: 24px; text-align: center; border-radius: 12px; margin-bottom: 24px; }
          .header h1 { font-size: 18px; font-weight: 800; letter-spacing: 1px; margin: 0; }
          .header p { font-size: 11px; opacity: 0.8; margin: 4px 0 0; }
          .title-bar { text-align: center; padding: 12px 0; border-bottom: 2px solid #e5e7eb; margin-bottom: 20px; }
          .title-bar h2 { font-size: 13px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 3px; margin: 0; }
          .info-grid { display: flex; justify-content: space-between; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px dashed #d1d5db; }
          .info-grid .left, .info-grid .right { font-size: 13px; }
          .info-grid .right { text-align: right; }
          .info-grid strong { color: #111827; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th { text-align: left; padding: 10px 8px; border-bottom: 2px solid #1f2937; font-size: 12px; font-weight: 700; color: #374151; }
          td { padding: 10px 8px; border-bottom: 1px solid #f3f4f6; font-size: 13px; }
          .total-row { border-top: 2px solid #1f2937; padding-top: 12px; display: flex; justify-content: space-between; align-items: center; font-size: 16px; font-weight: 800; }
          .status-badge { background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; margin-top: 20px; }
          .status-badge .label { font-weight: 700; color: #065f46; font-size: 13px; }
          .status-badge .mode { font-size: 12px; color: #4b5563; }
          .footer { text-align: center; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; }
          @media print { body { padding: 20px; } }
        </style></head><body>
        <div class="header">
          <h1>${settings?.hospitalName || 'NexMedicon Hospital'}</h1>
          ${settings?.address && settings.address !== 'Your Hospital Address, City, PIN' ? `<p>${settings.address}</p>` : ''}
          ${settings?.phone ? `<p>Tel: ${settings.phone}${settings.regNo ? ` | Reg: ${settings.regNo}` : ''}</p>` : ''}
        </div>
        <div class="title-bar"><h2>Payment Receipt</h2></div>
        <div class="info-grid">
          <div class="left">
            <div><strong>Patient:</strong> ${patientName}</div>
            <div><strong>MRN:</strong> ${mrn}</div>
          </div>
          <div class="right">
            <div><strong>Receipt:</strong> ${invoiceNumber}</div>
            <div><strong>Date:</strong> ${receiptDate} ${receiptTime}</div>
          </div>
        </div>
        <table>
          <thead><tr><th>#</th><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
          <tbody><tr><td>1</td><td>${description}</td><td style="text-align:right; font-weight:600;">&#8377;${amount.toLocaleString('en-IN')}</td></tr></tbody>
        </table>
        <div class="total-row">
          <span>Total Paid</span>
          <span>&#8377;${amount.toLocaleString('en-IN')}</span>
        </div>
        <div class="status-badge">
          <span class="label">&#10003; Payment Received</span>
          <span class="mode">Mode: ${payMethodLabel[paymentMethod] || paymentMethod}${paymentRef ? ` | Ref: ${paymentRef}` : ''}</span>
        </div>
        <div class="footer">
          <p>${settings?.footerNote || 'Thank you for visiting. Please follow the advice given above.'}</p>
          ${settings?.doctorName ? `<p style="margin-top:8px"><strong>${settings.doctorName}</strong>${settings.doctorQual ? ` — ${settings.doctorQual}` : ''}</p>` : ''}
        </div>
      </body></html>`)
      w.document.close()
      setTimeout(() => w.print(), 400)
    }
  }

  function handleShareWhatsApp() {
    const text = `Payment Receipt\n\nPatient: ${patientName}\nMRN: ${mrn}\nAmount: \u20B9${amount}\nMethod: ${payMethodLabel[paymentMethod] || paymentMethod}\nReceipt: ${invoiceNumber}\nDate: ${receiptDate}\n\nThank you!\n${settings?.hospitalName || 'Hospital'}`
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      {/* Receipt Card */}
      <div id="payment-receipt-printable" className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-700 via-blue-800 to-indigo-900 px-6 py-4 text-white text-center">
          <h1 className="text-lg font-bold tracking-wide uppercase">
            {settings?.hospitalName || 'NexMedicon Hospital'}
          </h1>
          {settings?.address && settings.address !== 'Your Hospital Address, City, PIN' && (
            <p className="text-blue-200 text-[11px] mt-0.5">{settings.address}</p>
          )}
          {settings?.phone && (
            <p className="text-blue-200 text-[11px]">
              Tel: {settings.phone}
              {settings?.regNo && <span className="ml-2">| Reg: {settings.regNo}</span>}
            </p>
          )}
        </div>

        {/* Title */}
        <div className="bg-gray-50 border-b border-gray-200 px-6 py-2.5 text-center">
          <h2 className="text-xs font-bold text-gray-600 uppercase tracking-[3px]">Payment Receipt</h2>
        </div>

        {/* Patient + Receipt Info */}
        <div className="px-6 py-4">
          <div className="flex justify-between items-start mb-4 pb-3 border-b border-dashed border-gray-200">
            <div className="space-y-0.5">
              <div className="text-sm"><span className="font-bold text-gray-700">Patient:</span> <span className="text-gray-800">{patientName}</span></div>
              <div className="text-sm"><span className="font-bold text-gray-700">MRN:</span> <span className="font-mono text-gray-600">{mrn}</span></div>
            </div>
            <div className="text-right space-y-0.5">
              <div className="text-sm"><span className="font-bold text-gray-700">Receipt:</span> <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{invoiceNumber}</span></div>
              <div className="text-sm"><span className="font-bold text-gray-700">Date:</span> <span className="text-gray-600">{receiptDate} {receiptTime}</span></div>
            </div>
          </div>

          {/* Items */}
          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="border-b-2 border-gray-800">
                <th className="text-left py-2 pr-4 font-bold text-gray-700 w-8">#</th>
                <th className="text-left py-2 font-bold text-gray-700">Description</th>
                <th className="text-right py-2 font-bold text-gray-700 w-28">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="py-2.5 pr-4 text-gray-400 font-mono text-xs">1</td>
                <td className="py-2.5 text-gray-800">{description}</td>
                <td className="py-2.5 text-right font-mono font-semibold text-gray-800">
                  {`\u20B9${amount.toLocaleString('en-IN')}`}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Total */}
          <div className="border-t-2 border-gray-800 pt-3">
            <div className="flex justify-between items-center">
              <span className="text-base font-bold text-gray-900">Total Paid</span>
              <span className="text-lg font-bold font-mono text-gray-900">
                {`\u20B9${amount.toLocaleString('en-IN')}`}
              </span>
            </div>
          </div>

          {/* Payment Status */}
          <div className="mt-4 flex justify-between items-center border border-green-200 rounded-xl px-4 py-3 bg-green-50">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="font-bold text-green-800 text-sm">Payment Received</span>
            </div>
            <div className="text-xs text-gray-600">
              Mode: <strong className="capitalize">{payMethodLabel[paymentMethod] || paymentMethod}</strong>
              {paymentRef && <span className="ml-1 text-gray-400">| Ref: {paymentRef}</span>}
            </div>
          </div>

          {/* Footer */}
          {settings?.footerNote && (
            <p className="text-[10px] text-gray-400 text-center mt-4 pt-3 border-t border-gray-100">
              {settings.footerNote}
            </p>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        <button onClick={handlePrint}
          className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-colors">
          <Printer className="w-3.5 h-3.5" /> Print Receipt
        </button>
        <button onClick={handleShareWhatsApp}
          className={`flex-1 flex items-center justify-center gap-2 text-xs font-semibold px-4 py-2.5 rounded-xl transition-colors ${
            copied
              ? 'bg-green-100 text-green-700'
              : 'bg-green-50 border border-green-200 text-green-700 hover:bg-green-100'
          }`}>
          <Share2 className="w-3.5 h-3.5" /> {copied ? 'Copied!' : 'Copy Receipt'}
        </button>
        <Link href={`/patients/${patientId}`}
          className="flex-1 flex items-center justify-center gap-2 bg-gray-50 border border-gray-200 text-gray-700 text-xs font-semibold px-4 py-2.5 rounded-xl hover:bg-gray-100 transition-colors">
          <User className="w-3.5 h-3.5" /> Patient Profile
        </Link>
      </div>
    </div>
  )
}
