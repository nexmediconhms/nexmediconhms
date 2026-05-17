'use client'
/**
 * src/components/shared/PrintableReport.tsx
 *
 * Standardized printable/PDF report wrapper.
 * Ensures all printed reports:
 *  - Have attractive formatting
 *  - Show hospital header with logo
 *  - Have proper patient info
 *  - NO browser headers/footers/URLs
 *  - Consistent across all modules
 *
 * Usage:
 *   <PrintableReport title="Daily Patient Report" subtitle="15 Jan 2025">
 *     {content}
 *   </PrintableReport>
 */

import { ReactNode } from 'react'
import { getHospitalSettings } from '@/lib/utils'

interface PrintableReportProps {
  title: string
  subtitle?: string
  children: ReactNode
  showHeader?: boolean
  showFooter?: boolean
  patientInfo?: {
    name: string
    mrn: string
    age?: string | number
    gender?: string
    mobile?: string
  }
}

export default function PrintableReport({
  title,
  subtitle,
  children,
  showHeader = true,
  showFooter = true,
  patientInfo,
}: PrintableReportProps) {
  const hs = typeof window !== 'undefined' ? getHospitalSettings() : {} as any

  const handlePrint = () => {
    window.print()
  }

  return (
    <>
      {/* Print button (hidden in print) */}
      <div className="no-print mb-4 flex justify-end">
        <button
          onClick={handlePrint}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          🖨️ Print / Save PDF
        </button>
      </div>

      {/* Printable content */}
      <div className="pdf-report bg-white rounded-xl border border-gray-200 p-6 sm:p-8 print:border-0 print:shadow-none print:p-0">
        
        {/* Hospital Header */}
        {showHeader && (
          <div className="text-center pb-4 mb-5 border-b-2 border-blue-600 print:border-b print:border-gray-300">
            <h1 className="text-xl font-bold text-blue-900 print:text-black">
              {hs.hospitalName || 'NexMedicon Hospital'}
            </h1>
            {hs.address && (
              <p className="text-xs text-gray-500 mt-1">{hs.address}</p>
            )}
            <div className="flex justify-center gap-4 text-xs text-gray-500 mt-1">
              {hs.phone && <span>📞 {hs.phone}</span>}
              {hs.email && <span>✉️ {hs.email}</span>}
            </div>
            {hs.medRegNo && (
              <p className="text-[10px] text-gray-400 mt-1">Reg. No: {hs.medRegNo}</p>
            )}
          </div>
        )}

        {/* Report Title */}
        <div className="mb-4">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        </div>

        {/* Patient Info (if provided) */}
        {patientInfo && (
          <div className="bg-gray-50 rounded-lg p-3 mb-5 print:bg-white print:border print:border-gray-200">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
              <div>
                <span className="text-xs text-gray-500">Patient:</span>
                <p className="font-semibold text-gray-900">{patientInfo.name}</p>
              </div>
              <div>
                <span className="text-xs text-gray-500">MRN:</span>
                <p className="font-mono text-gray-800">{patientInfo.mrn}</p>
              </div>
              {patientInfo.age && (
                <div>
                  <span className="text-xs text-gray-500">Age/Gender:</span>
                  <p className="text-gray-800">{patientInfo.age}y {patientInfo.gender || ''}</p>
                </div>
              )}
              {patientInfo.mobile && (
                <div>
                  <span className="text-xs text-gray-500">Mobile:</span>
                  <p className="text-gray-800">{patientInfo.mobile}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Report Content */}
        <div className="report-content">
          {children}
        </div>

        {/* Footer */}
        {showFooter && (
          <div className="mt-8 pt-4 border-t border-gray-200 print:mt-6 print:pt-3">
            <div className="flex justify-between items-end text-xs text-gray-400">
              <div>
                <p>Generated: {new Date().toLocaleDateString('en-IN', { 
                  day: '2-digit', month: 'long', year: 'numeric', 
                  hour: '2-digit', minute: '2-digit' 
                })}</p>
                <p className="mt-0.5">{hs.hospitalName || 'NexMedicon HMS'}</p>
              </div>
              {hs.doctorName && (
                <div className="text-right">
                  <p className="font-medium text-gray-600">{hs.doctorName}</p>
                  {hs.doctorSpecialty && <p>{hs.doctorSpecialty}</p>}
                  {hs.medRegNo && <p>Reg: {hs.medRegNo}</p>}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

/**
 * Helper: Format data as a proper table for PDF/print
 */
export function ReportTable({ 
  headers, 
  rows, 
  footer 
}: { 
  headers: string[]
  rows: (string | number)[][]
  footer?: (string | number)[]
}) {
  return (
    <table className="w-full border-collapse text-sm my-4">
      <thead>
        <tr className="bg-gray-100 print:bg-gray-50">
          {headers.map((h, i) => (
            <th key={i} className="text-left px-3 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide border-b border-gray-200">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-b border-gray-100">
            {row.map((cell, j) => (
              <td key={j} className="px-3 py-2 text-gray-800">
                {typeof cell === 'number' ? `₹${cell.toLocaleString('en-IN')}` : cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {footer && (
        <tfoot>
          <tr className="bg-blue-50 font-bold print:bg-gray-100">
            {footer.map((cell, i) => (
              <td key={i} className="px-3 py-2 text-gray-900 border-t-2 border-gray-300">
                {typeof cell === 'number' ? `₹${cell.toLocaleString('en-IN')}` : cell}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  )
}
