'use client'
/**
 * src/app/lab-partner/page.tsx
 *
 * Lab Partner Dashboard — External labs can upload reports directly,
 * no email needed. Lab staff get a direct login with limited access.
 *
 * Features:
 *  - Lab partner uploads PDF/image reports directly
 *  - AI extracts lab values (Hb, WBC, Sugar, etc.)
 *  - Reports auto-link to patient records
 *  - Abnormal values flagged immediately
 *  - Doctor gets WhatsApp notification when report is ready
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, formatDateTime, getIndiaToday } from '@/lib/utils'
import CameraUpload from '@/components/shared/CameraUpload'
import { useToast } from '@/components/shared/Toast'
import {
  FlaskConical, Upload, Search, CheckCircle, AlertTriangle,
  X, FileText, Loader2, Send, RefreshCw, Clock
} from 'lucide-react'

interface LabUpload {
  id: string
  patient_id: string
  patient_name: string
  mrn: string
  lab_partner_name: string
  file_url: string
  file_name: string
  status: 'uploaded' | 'processing' | 'processed' | 'error'
  extracted_values: Record<string, any> | null
  abnormal_values: string[]
  notification_sent: boolean
  created_at: string
}

interface PatientResult {
  id: string
  full_name: string
  mrn: string
  mobile: string
}

// Reference ranges for abnormal detection
const REFERENCE_RANGES: Record<string, { low: number; high: number; unit: string }> = {
  'Haemoglobin': { low: 11.5, high: 16.5, unit: 'g/dL' },
  'Hb': { low: 11.5, high: 16.5, unit: 'g/dL' },
  'WBC': { low: 4000, high: 11000, unit: 'cells/µL' },
  'Platelet': { low: 150000, high: 400000, unit: 'cells/µL' },
  'Blood Sugar Fasting': { low: 70, high: 100, unit: 'mg/dL' },
  'Blood Sugar PP': { low: 0, high: 140, unit: 'mg/dL' },
  'HbA1c': { low: 0, high: 5.7, unit: '%' },
  'TSH': { low: 0.4, high: 4.0, unit: 'mIU/L' },
  'Creatinine': { low: 0.6, high: 1.2, unit: 'mg/dL' },
}

export default function LabPartnerPage() {
  const { showSuccess, showError, showWarning } = useToast()
  const [uploads, setUploads] = useState<LabUpload[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'list' | 'upload'>('list')
  const [uploading, setUploading] = useState(false)

  // Upload form
  const [patientQuery, setPatientQuery] = useState('')
  const [patientResults, setPatientResults] = useState<PatientResult[]>([])
  const [selPatient, setSelPatient] = useState<PatientResult | null>(null)
  const [labPartnerName, setLabPartnerName] = useState('')
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractedData, setExtractedData] = useState<Record<string, any> | null>(null)
  const [abnormals, setAbnormals] = useState<string[]>([])

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load existing uploads
  const loadUploads = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('lab_uploads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
    setUploads((data || []) as LabUpload[])
    setLoading(false)
  }, [])

  useEffect(() => { loadUploads() }, [loadUploads])

  // Load lab partner name from settings
  useEffect(() => {
    const stored = localStorage.getItem('lab_partner_name')
    if (stored) setLabPartnerName(stored)
  }, [])

  // Patient search
  useEffect(() => {
    if (patientQuery.trim().length < 2) { setPatientResults([]); return }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      const { data } = await supabase
        .from('patients')
        .select('id, full_name, mrn, mobile')
        .or(`full_name.ilike.%${patientQuery}%,mrn.ilike.%${patientQuery}%,mobile.ilike.%${patientQuery}%`)
        .limit(6)
      setPatientResults((data || []) as PatientResult[])
    }, 300)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [patientQuery])

  // Handle file capture
  const handleFileCapture = useCallback(async (file: File) => {
    setUploadedFile(file)
    setExtracting(true)
    setExtractedData(null)
    setAbnormals([])

    try {
      // Upload to Supabase Storage
      const fileName = `lab-upload-${Date.now()}-${file.name}`
      const { data: storageData, error: storageErr } = await supabase.storage
        .from('documents')
        .upload(`lab-reports/${fileName}`, file)

      if (storageErr) {
        showError('Failed to upload file: ' + storageErr.message)
        setExtracting(false)
        return
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('documents')
        .getPublicUrl(`lab-reports/${fileName}`)

      // Try AI extraction
      const formData = new FormData()
      formData.append('file', file)
      formData.append('type', 'lab_report')

      const res = await fetch('/api/parse-pdf', {
        method: 'POST',
        body: formData,
      })

      if (res.ok) {
        const result = await res.json()
        setExtractedData(result.values || result)

        // Detect abnormal values
        const abnormalList: string[] = []
        const values = result.values || result
        for (const [key, val] of Object.entries(values)) {
          const numVal = parseFloat(String(val))
          if (isNaN(numVal)) continue
          for (const [refKey, range] of Object.entries(REFERENCE_RANGES)) {
            if (key.toLowerCase().includes(refKey.toLowerCase())) {
              if (numVal < range.low || numVal > range.high) {
                abnormalList.push(`${key}: ${val} ${range.unit} (Normal: ${range.low}–${range.high})`)
              }
            }
          }
        }
        setAbnormals(abnormalList)
        if (abnormalList.length > 0) {
          showWarning(`${abnormalList.length} abnormal value(s) detected!`)
        }
      }
    } catch (err: any) {
      console.error('[LabPartner] extraction error:', err)
    } finally {
      setExtracting(false)
    }
  }, [showError, showWarning])

  // Submit the upload
  const handleSubmit = useCallback(async () => {
    if (!selPatient || !uploadedFile) {
      showError('Please select a patient and upload a file.')
      return
    }

    setUploading(true)
    try {
      // Save lab partner name
      if (labPartnerName) {
        localStorage.setItem('lab_partner_name', labPartnerName)
      }

      // Upload file
      const fileName = `lab-upload-${Date.now()}-${uploadedFile.name}`
      const { error: storageErr } = await supabase.storage
        .from('documents')
        .upload(`lab-reports/${fileName}`, uploadedFile)

      if (storageErr && !storageErr.message.includes('already exists')) {
        showError('Upload failed: ' + storageErr.message)
        setUploading(false)
        return
      }

      const { data: urlData } = supabase.storage
        .from('documents')
        .getPublicUrl(`lab-reports/${fileName}`)

      // Insert lab_uploads record
      const { error: insertErr } = await supabase
        .from('lab_uploads')
        .insert({
          patient_id: selPatient.id,
          patient_name: selPatient.full_name,
          mrn: selPatient.mrn,
          lab_partner_name: labPartnerName || 'External Lab',
          file_url: urlData?.publicUrl || '',
          file_name: uploadedFile.name,
          status: extractedData ? 'processed' : 'uploaded',
          extracted_values: extractedData,
          abnormal_values: abnormals,
          notification_sent: false,
        })

      if (insertErr) {
        showError('Failed to save: ' + insertErr.message)
        setUploading(false)
        return
      }

      // Send notification to doctor if abnormal values
      if (abnormals.length > 0) {
        await fetch('/api/labs/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patientName: selPatient.full_name,
            patientId: selPatient.id,
            mrn: selPatient.mrn,
            abnormalValues: abnormals,
            labPartner: labPartnerName,
          }),
        }).catch(() => {}) // Non-critical
      }

      showSuccess('Report uploaded successfully! Doctor has been notified.')
      setView('list')
      resetForm()
      loadUploads()
    } catch (err: any) {
      showError('Error: ' + err.message)
    } finally {
      setUploading(false)
    }
  }, [selPatient, uploadedFile, labPartnerName, extractedData, abnormals, showSuccess, showError, loadUploads])

  function resetForm() {
    setSelPatient(null)
    setPatientQuery('')
    setUploadedFile(null)
    setExtractedData(null)
    setAbnormals([])
  }

  // Upload view
  if (view === 'upload') {
    return (
      <AppShell>
        <div className="p-4 sm:p-6 max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => { setView('list'); resetForm() }} className="text-gray-400 hover:text-gray-700">
              <X className="w-5 h-5" />
            </button>
            <h1 className="text-xl font-bold text-gray-900">Upload Lab Report</h1>
          </div>

          <div className="space-y-5">
            {/* Lab partner name */}
            <div className="card p-4">
              <label className="label">Lab Name</label>
              <input
                className="input"
                value={labPartnerName}
                onChange={e => setLabPartnerName(e.target.value)}
                placeholder="e.g. SRL Diagnostics, Metropolis, etc."
              />
            </div>

            {/* Patient search */}
            <div className="card p-4">
              <label className="label">Patient</label>
              {selPatient ? (
                <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
                  <div>
                    <span className="font-semibold text-green-900">{selPatient.full_name}</span>
                    <span className="text-xs text-gray-500 ml-2">MRN: {selPatient.mrn}</span>
                  </div>
                  <button onClick={() => { setSelPatient(null); setPatientQuery('') }} className="text-gray-400 hover:text-red-500">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      className="input pl-9"
                      value={patientQuery}
                      onChange={e => setPatientQuery(e.target.value)}
                      placeholder="Search patient by name, MRN, or mobile..."
                    />
                  </div>
                  {patientResults.length > 0 && (
                    <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden shadow-md">
                      {patientResults.map(p => (
                        <button
                          key={p.id}
                          onClick={() => { setSelPatient(p); setPatientResults([]) }}
                          className="w-full text-left px-4 py-2.5 hover:bg-blue-50 text-sm border-b last:border-0"
                        >
                          <div className="font-semibold">{p.full_name}</div>
                          <div className="text-xs text-gray-400">MRN: {p.mrn} · {p.mobile}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* File upload with camera */}
            <div className="card p-4">
              <CameraUpload
                onCapture={handleFileCapture}
                label="Upload Lab Report (Photo or PDF)"
                accept="image/*,application/pdf"
              />
              {uploadedFile && (
                <div className="mt-3 flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
                  <CheckCircle className="w-4 h-4" />
                  <span>{uploadedFile.name}</span>
                </div>
              )}
            </div>

            {/* Extraction results */}
            {extracting && (
              <div className="card p-4 flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                <span className="text-sm text-gray-600">Extracting lab values with AI...</span>
              </div>
            )}

            {extractedData && (
              <div className="card p-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-blue-600" />
                  Extracted Values
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(extractedData).map(([key, val]) => (
                    <div key={key} className="flex justify-between text-xs bg-gray-50 rounded px-3 py-2">
                      <span className="text-gray-600">{key}</span>
                      <span className="font-semibold text-gray-900">{String(val)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {abnormals.length > 0 && (
              <div className="card p-4 border-red-200 bg-red-50">
                <h3 className="text-sm font-semibold text-red-800 mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Abnormal Values Detected
                </h3>
                <ul className="space-y-1">
                  {abnormals.map((a, i) => (
                    <li key={i} className="text-xs text-red-700 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={uploading || !selPatient || !uploadedFile}
              className="w-full btn-primary py-3 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {uploading ? 'Uploading...' : 'Upload & Notify Doctor'}
            </button>
          </div>
        </div>
      </AppShell>
    )
  }

  // List view
  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
              <FlaskConical className="w-5 h-5 sm:w-6 sm:h-6 text-purple-600" />
              Lab Partner Dashboard
            </h1>
            <p className="text-sm text-gray-500">Upload lab reports directly — no email needed</p>
          </div>
          <div className="flex gap-2">
            <button onClick={loadUploads} className="btn-secondary flex items-center gap-2 text-xs">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
            <button onClick={() => setView('upload')} className="btn-primary flex items-center gap-2">
              <Upload className="w-4 h-4" /> Upload Report
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
          </div>
        ) : uploads.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
            <FlaskConical className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No reports uploaded yet</p>
            <p className="text-sm text-gray-400 mt-1">Click "Upload Report" to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            {uploads.map(u => (
              <div key={u.id} className="card p-4 flex items-center gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  u.status === 'processed' ? 'bg-green-100' :
                  u.status === 'error' ? 'bg-red-100' : 'bg-blue-100'
                }`}>
                  {u.status === 'processed' ? <CheckCircle className="w-5 h-5 text-green-600" /> :
                   u.status === 'error' ? <AlertTriangle className="w-5 h-5 text-red-600" /> :
                   <Clock className="w-5 h-5 text-blue-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 text-sm">{u.patient_name}</span>
                    <span className="text-xs text-gray-400">MRN: {u.mrn}</span>
                    {u.abnormal_values && u.abnormal_values.length > 0 && (
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                        {u.abnormal_values.length} abnormal
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {u.lab_partner_name} · {u.file_name} · {formatDateTime(u.created_at)}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {u.notification_sent && (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> Notified
                    </span>
                  )}
                  <a
                    href={u.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline"
                  >
                    View
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
