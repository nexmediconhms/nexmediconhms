'use client'
/**
 * src/app/lab-partner-portal/page.tsx
 *
 * Lab Partner Dashboard — Labs can upload reports directly without email.
 * Features:
 *  - Token-based authentication (no Supabase auth needed)
 *  - Upload PDF lab reports for patients
 *  - Patient MRN search
 *  - Upload history
 *  - Auto-notifies doctor + patient when report is uploaded
 */

import { useCallback, useEffect, useState } from 'react'
import {
  FlaskConical, Upload, CheckCircle, AlertCircle, Search,
  FileText, Loader2, LogIn, X, RefreshCw, Clock,
} from 'lucide-react'

interface PortalUser {
  name: string
  email: string
  lab_name: string
}

interface UploadHistory {
  id: string
  report_name: string
  patient_name: string
  mrn: string
  uploaded_at: string
  status: string
}

export default function LabPartnerPortalPage() {
  const [token, setToken] = useState('')
  const [inputToken, setInputToken] = useState('')
  const [user, setUser] = useState<PortalUser | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState('')

  // Upload state
  const [mrn, setMrn] = useState('')
  const [patientName, setPatientName] = useState('')
  const [reportName, setReportName] = useState('')
  const [reportDate, setReportDate] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }))
  const [notes, setNotes] = useState('')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<any>(null)
  const [uploadError, setUploadError] = useState('')

  // History
  const [history, setHistory] = useState<UploadHistory[]>([])
  const [showHistory, setShowHistory] = useState(false)

  // Check stored token on mount OR token from URL query param
  useEffect(() => {
    // Priority 1: Token from URL (shareable link from admin)
    const urlParams = new URLSearchParams(window.location.search)
    const urlToken = urlParams.get('token')
    if (urlToken) {
      setInputToken(urlToken)
      verifyToken(urlToken)
      // Clean URL without reloading (remove token from address bar for security)
      window.history.replaceState({}, '', '/lab-partner-portal')
      return
    }

    // Priority 2: Previously stored token in localStorage
    const stored = localStorage.getItem('lab-portal-token')
    if (stored) {
      setToken(stored)
      verifyToken(stored)
    }
  }, [])

  async function verifyToken(t: string) {
    setAuthLoading(true)
    setAuthError('')
    try {
      const res = await fetch(`/api/labs/lab-portal?token=${encodeURIComponent(t)}`)
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
        setToken(t)
        localStorage.setItem('lab-portal-token', t)
      } else {
        const err = await res.json().catch(() => ({}))
        setAuthError(err.error || 'Invalid or expired token')
        setUser(null)
        localStorage.removeItem('lab-portal-token')
      }
    } catch {
      setAuthError('Network error. Please try again.')
    }
    setAuthLoading(false)
  }

  function handleLogin() {
    if (!inputToken.trim()) return
    verifyToken(inputToken.trim())
  }

  function handleLogout() {
    setToken('')
    setUser(null)
    localStorage.removeItem('lab-portal-token')
  }

  async function handleUpload() {
    if (!mrn && !patientName) { setUploadError('Enter patient MRN or name'); return }
    if (!reportName) { setUploadError('Enter report name'); return }
    if (!pdfFile) { setUploadError('Select a PDF file to upload'); return }

    setUploading(true)
    setUploadError('')
    setUploadResult(null)

    try {
      const fd = new FormData()
      fd.append('token', token)
      fd.append('mrn', mrn)
      fd.append('patient_name', patientName)
      fd.append('report_name', reportName)
      fd.append('report_date', reportDate)
      fd.append('notes', notes)
      fd.append('pdf_file', pdfFile)

      const res = await fetch('/api/labs/lab-portal', { method: 'POST', body: fd })
      const data = await res.json()

      if (res.ok && data.success) {
        setUploadResult(data)
        // Reset form
        setMrn('')
        setPatientName('')
        setReportName('')
        setNotes('')
        setPdfFile(null)
        setReportDate(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }))
        // Add to history
        setHistory(prev => [{
          id: data.reportId,
          report_name: reportName,
          patient_name: data.patientName || patientName,
          mrn: mrn,
          uploaded_at: new Date().toISOString(),
          status: 'completed',
        }, ...prev])
      } else {
        setUploadError(data.error || 'Upload failed')
      }
    } catch (err: any) {
      setUploadError(err.message || 'Network error')
    }
    setUploading(false)
  }

  // ── Login Screen ────────────────────────────────────────────
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <FlaskConical className="w-12 h-12 text-blue-600 mx-auto mb-3" />
            <h1 className="text-2xl font-bold text-gray-900">Lab Partner Portal</h1>
            <p className="text-sm text-gray-500 mt-1">Upload lab reports directly — no email needed</p>
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
            <h2 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
              <LogIn className="w-4 h-4" /> Enter Your Portal Token
            </h2>

            {authError && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5" /> {authError}
              </div>
            )}

            <input
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-3"
              placeholder="Enter your access token…"
              value={inputToken}
              onChange={e => setInputToken(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
            />

            <button
              onClick={handleLogin}
              disabled={authLoading || !inputToken.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {authLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              {authLoading ? 'Verifying…' : 'Login'}
            </button>

            <p className="text-xs text-gray-400 mt-4 text-center">
              Contact the hospital admin to get your portal access token.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Main Dashboard ──────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FlaskConical className="w-6 h-6 text-blue-600" />
            <div>
              <h1 className="text-lg font-bold text-gray-900">Lab Partner Portal</h1>
              <p className="text-xs text-gray-500">{user.lab_name} · {user.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowHistory(h => !h)}
              className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg font-medium flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> History
            </button>
            <button onClick={handleLogout}
              className="text-xs text-red-600 hover:text-red-700 font-medium px-3 py-2">
              Logout
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6">

        {/* Success Banner */}
        {uploadResult && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-green-800">Report Uploaded Successfully!</h3>
              <p className="text-xs text-green-700 mt-1">
                "{uploadResult.reportName}" for <strong>{uploadResult.patientName}</strong> has been uploaded.
                Doctor and patient have been notified.
              </p>
              <button onClick={() => setUploadResult(null)} className="text-xs text-green-600 underline mt-2">Dismiss</button>
            </div>
          </div>
        )}

        {/* Upload Form */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-5">
            <Upload className="w-5 h-5 text-blue-600" /> Upload Lab Report
          </h2>

          {uploadError && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5" /> {uploadError}
              <button onClick={() => setUploadError('')} className="ml-auto text-xs underline">Dismiss</button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Patient MRN *</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. P-042" value={mrn} onChange={e => setMrn(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Patient Name (fallback)</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="If MRN unknown" value={patientName} onChange={e => setPatientName(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Report Name *</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. CBC, Thyroid Profile" value={reportName} onChange={e => setReportName(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Report Date</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-700 mb-1">Notes (optional)</label>
              <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                rows={2} placeholder="Any additional notes…" value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
          </div>

          {/* File upload */}
          <div className="mb-5">
            <label className="block text-xs font-semibold text-gray-700 mb-2">PDF Report File *</label>
            <label className="flex items-center justify-center gap-3 border-2 border-dashed border-gray-300 rounded-xl p-6 cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-all">
              {pdfFile ? (
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-600" />
                  <span className="text-sm font-medium text-gray-700">{pdfFile.name}</span>
                  <span className="text-xs text-gray-400">({(pdfFile.size / 1024).toFixed(0)} KB)</span>
                  <button onClick={(e) => { e.preventDefault(); setPdfFile(null) }} className="text-red-400 hover:text-red-600 ml-2">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="text-center">
                  <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">Click to select PDF file</p>
                  <p className="text-xs text-gray-400 mt-1">Max 20 MB · PDF only</p>
                </div>
              )}
              <input
                type="file"
                accept="application/pdf"
                onChange={e => { if (e.target.files?.[0]) setPdfFile(e.target.files[0]) }}
                className="hidden"
              />
            </label>
          </div>

          <button
            onClick={handleUpload}
            disabled={uploading || (!mrn && !patientName) || !reportName || !pdfFile}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? 'Uploading…' : 'Upload Report'}
          </button>
        </div>

        {/* Upload History */}
        {showHistory && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-gray-500" /> Recent Uploads
            </h3>
            {history.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No uploads in this session.</p>
            ) : (
              <div className="space-y-2">
                {history.map(h => (
                  <div key={h.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-4 py-3">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-800">{h.report_name}</span>
                      <span className="text-xs text-gray-500 ml-2">for {h.patient_name} ({h.mrn})</span>
                    </div>
                    <span className="text-xs text-gray-400">
                      {new Date(h.uploaded_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Instructions */}
        <div className="mt-6 bg-blue-50 border border-blue-100 rounded-xl p-5">
          <h3 className="text-sm font-bold text-blue-800 mb-3">How to Use</h3>
          <ol className="space-y-2 text-xs text-blue-700">
            <li className="flex gap-2"><span className="w-5 h-5 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center font-bold flex-shrink-0">1</span> Enter the patient MRN (e.g. P-042) as provided by the hospital.</li>
            <li className="flex gap-2"><span className="w-5 h-5 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center font-bold flex-shrink-0">2</span> Enter the report name (e.g. "CBC", "Thyroid Profile", "USG Report").</li>
            <li className="flex gap-2"><span className="w-5 h-5 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center font-bold flex-shrink-0">3</span> Upload the PDF report file (scanned or digital).</li>
            <li className="flex gap-2"><span className="w-5 h-5 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center font-bold flex-shrink-0">4</span> Click "Upload Report" — the doctor and patient will be notified automatically.</li>
          </ol>
          <p className="text-xs text-blue-600 mt-3 italic">
            No email required. Reports go directly into the patient record.
          </p>
        </div>
      </div>
    </div>
  )
}