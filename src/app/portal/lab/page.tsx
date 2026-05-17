'use client'
/**
 * Lab Partner Dashboard
 *
 * A separate portal for lab partners to:
 * 1. Upload reports directly for patients
 * 2. View their revenue summary
 * 3. See pending/completed reports
 *
 * Access: Via token-based URL (e.g., /portal/lab?token=xxx)
 */

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  FlaskConical, Upload, IndianRupee, FileText,
  CheckCircle, AlertTriangle, Clock, Loader2,
  BarChart3, Calendar
} from 'lucide-react'

interface LabPartner {
  id: string
  name: string
  hospital_pct: number
  lab_pct: number
}

interface LabReport {
  id: string
  patient_name: string
  report_date: string
  total_amount: number
  lab_amount: number
  hospital_amount: number
  entries: any[]
  created_at: string
}

export default function LabPortalPage() {
  const searchParams = useSearchParams()
  const partnerId = searchParams.get('partner') || searchParams.get('token') || ''

  const [partner, setPartner] = useState<LabPartner | null>(null)
  const [reports, setReports] = useState<LabReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadSuccess, setUploadSuccess] = useState(false)

  // Stats
  const [totalRevenue, setTotalRevenue] = useState(0)
  const [totalReports, setTotalReports] = useState(0)
  const [thisMonthRevenue, setThisMonthRevenue] = useState(0)

  useEffect(() => {
    if (!partnerId) {
      setError('No lab partner token provided. Please use the link shared by the hospital.')
      setLoading(false)
      return
    }
    loadPartnerData()
  }, [partnerId])

  async function loadPartnerData() {
    setLoading(true)

    // Load partner info
    const { data: partnerData, error: partnerErr } = await supabase
      .from('lab_partners')
      .select('id, name, hospital_pct, lab_pct')
      .eq('id', partnerId)
      .eq('is_active', true)
      .single()

    if (partnerErr || !partnerData) {
      setError('Lab partner not found or inactive. Please contact the hospital.')
      setLoading(false)
      return
    }

    setPartner(partnerData)

    // Load reports for this partner
    const { data: reportsData } = await supabase
      .from('lab_reports')
      .select(`
        id, report_date, total_amount, lab_amount, hospital_amount, entries, created_at,
        patients!inner ( full_name )
      `)
      .eq('lab_partner_id', partnerId)
      .order('created_at', { ascending: false })
      .limit(100)

    const mapped = (reportsData || []).map((r: any) => ({
      ...r,
      patient_name: r.patients?.full_name || 'Unknown',
    }))

    setReports(mapped)

    // Calculate stats
    const total = mapped.reduce((s: number, r: any) => s + (r.lab_amount || 0), 0)
    setTotalRevenue(total)
    setTotalReports(mapped.length)

    const thisMonth = new Date().toISOString().slice(0, 7) // YYYY-MM
    const monthReports = mapped.filter((r: any) => r.report_date?.startsWith(thisMonth))
    setThisMonthRevenue(monthReports.reduce((s: number, r: any) => s + (r.lab_amount || 0), 0))

    setLoading(false)
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !partner) return
    e.target.value = ''

    setUploading(true)
    setUploadSuccess(false)

    try {
      // Upload file
      const fileName = `lab-uploads/${partner.id}/${Date.now()}_${file.name}`
      const { error: uploadErr } = await supabase.storage
        .from('patient-documents')
        .upload(fileName, file, { contentType: file.type })

      if (uploadErr) throw new Error(uploadErr.message)

      // Create a pending lab report entry
      const { error: insertErr } = await supabase.from('lab_reports').insert({
        lab_partner_id: partner.id,
        report_date: new Date().toISOString().slice(0, 10),
        lab_name: partner.name,
        entries: [],
        notes: `Uploaded by lab partner: ${partner.name}\nFile: ${file.name}\nStatus: Pending patient assignment`,
      })

      if (insertErr) throw new Error(insertErr.message)

      setUploadSuccess(true)
      setTimeout(() => setUploadSuccess(false), 5000)
      loadPartnerData()
    } catch (err: any) {
      alert('Upload failed: ' + err.message)
    } finally {
      setUploading(false)
    }
  }

  const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto mb-3" />
          <p className="text-gray-500">Loading lab partner portal...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Access Error</h1>
          <p className="text-gray-500">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
              <FlaskConical className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h1 className="font-bold text-gray-900">{partner?.name} — Lab Portal</h1>
              <p className="text-xs text-gray-500">Revenue share: {partner?.lab_pct}% lab / {partner?.hospital_pct}% hospital</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">NexMedicon HMS</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-2">
              <IndianRupee className="w-4 h-4 text-green-600" />
              <span className="text-xs font-semibold text-gray-500">Your Revenue (All Time)</span>
            </div>
            <div className="text-2xl font-bold text-green-700">{inr(totalRevenue)}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-semibold text-gray-500">This Month</span>
            </div>
            <div className="text-2xl font-bold text-blue-700">{inr(thisMonthRevenue)}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="w-4 h-4 text-purple-600" />
              <span className="text-xs font-semibold text-gray-500">Total Reports</span>
            </div>
            <div className="text-2xl font-bold text-purple-700">{totalReports}</div>
          </div>
        </div>

        {/* Upload Section */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <Upload className="w-4 h-4 text-indigo-500" /> Upload Lab Report
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Upload a lab report PDF or image. The hospital will assign it to the correct patient.
          </p>
          <label className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold cursor-pointer transition-all ${
            uploading ? 'bg-gray-200 text-gray-400' : 'bg-indigo-600 text-white hover:bg-indigo-700'
          }`}>
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? 'Uploading...' : 'Choose File'}
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={handleUpload}
              disabled={uploading}
              className="hidden"
            />
          </label>
          {uploadSuccess && (
            <div className="mt-3 bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm text-green-700 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" /> Report uploaded successfully! Hospital will process it shortly.
            </div>
          )}
        </div>

        {/* Reports List */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <FileText className="w-4 h-4 text-gray-500" /> Recent Reports
            </h2>
          </div>
          {reports.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <FlaskConical className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>No reports yet</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {['Date', 'Patient', 'Total', 'Your Share', 'Tests'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reports.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 text-xs text-gray-500">{r.report_date}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{r.patient_name}</td>
                    <td className="px-4 py-3 font-mono">{inr(r.total_amount || 0)}</td>
                    <td className="px-4 py-3 font-mono font-semibold text-green-700">{inr(r.lab_amount || 0)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{r.entries?.length || 0} tests</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
