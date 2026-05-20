'use client'
/**
 * src/components/ipd/IPDFileUpload.tsx
 *
 * Photo & Document Upload Component for IPD Management
 *
 * Features:
 *  - Camera capture (mobile) or file picker
 *  - Drag-and-drop support
 *  - Category selection (wound, report, xray, consent, prescription, nursing, general)
 *  - AI data extraction toggle
 *  - Preview uploaded files
 *  - Shows AI-extracted data that can auto-fill nursing chart fields
 *
 * Used in:
 *  - IPD Nursing Chart (src/app/ipd/page.tsx)
 *  - Patient Profile attachment section
 */

import { useState, useCallback, useRef } from 'react'
import {
  Camera, Upload, FileText, Image, Trash2, Loader2,
  Sparkles, CheckCircle, AlertCircle, X, Eye,
  Stethoscope, ClipboardList, FileImage, Shield,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────

interface UploadedFile {
  id: string
  file_name: string
  file_type: string
  file_size: number
  file_url: string | null
  file_data: string | null
  category: string
  description: string
  ai_extracted_data: Record<string, any>
  uploaded_by: string
  uploaded_by_role: string
  created_at: string
}

interface IPDFileUploadProps {
  ipdAdmissionId: string
  patientId: string
  uploadedBy: string
  uploadedByRole: 'doctor' | 'nurse' | 'staff'
  onFileUploaded?: (file: UploadedFile, aiData: Record<string, any>) => void
  existingFiles?: UploadedFile[]
  onRefreshFiles?: () => void
}

const CATEGORIES = [
  { value: 'wound',        label: 'Wound Photo',       icon: Camera,        color: 'text-red-600 bg-red-50' },
  { value: 'report',       label: 'Lab/Test Report',   icon: FileText,      color: 'text-blue-600 bg-blue-50' },
  { value: 'xray',         label: 'X-Ray / USG / CT',  icon: FileImage,     color: 'text-purple-600 bg-purple-50' },
  { value: 'consent',      label: 'Consent Form',      icon: Shield,        color: 'text-green-600 bg-green-50' },
  { value: 'prescription', label: 'Prescription',      icon: ClipboardList, color: 'text-orange-600 bg-orange-50' },
  { value: 'nursing',      label: 'Nursing Document',  icon: Stethoscope,   color: 'text-pink-600 bg-pink-50' },
  { value: 'general',      label: 'General',           icon: Image,         color: 'text-gray-600 bg-gray-50' },
]

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function IPDFileUpload({
  ipdAdmissionId,
  patientId,
  uploadedBy,
  uploadedByRole,
  onFileUploaded,
  existingFiles = [],
  onRefreshFiles,
}: IPDFileUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [category, setCategory] = useState('general')
  const [description, setDescription] = useState('')
  const [extractAI, setExtractAI] = useState(true)
  const [previewFile, setPreviewFile] = useState<UploadedFile | null>(null)
  const [aiResult, setAiResult] = useState<Record<string, any> | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const handleUpload = useCallback(async (file: File) => {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setError('File too large (max 10 MB)')
      return
    }

    setUploading(true)
    setError('')
    setSuccess('')
    setProgress('Uploading...')
    setAiResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('ipd_admission_id', ipdAdmissionId)
      formData.append('patient_id', patientId)
      formData.append('category', category)
      formData.append('description', description)
      formData.append('uploaded_by', uploadedBy)
      formData.append('uploaded_by_role', uploadedByRole)
      formData.append('extract_ai', extractAI ? 'true' : 'false')

      if (extractAI) setProgress('Uploading + AI extraction (may take 10-15s)...')

      const res = await fetch('/api/ipd/files', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Upload failed')
        return
      }

      setSuccess(`File "${file.name}" uploaded successfully!`)
      setDescription('')

      if (data.ai_data && Object.keys(data.ai_data).length > 0) {
        setAiResult(data.ai_data)
      }

      if (onFileUploaded) {
        onFileUploaded(data.file, data.ai_data || {})
      }
      if (onRefreshFiles) {
        onRefreshFiles()
      }

      setTimeout(() => setSuccess(''), 5000)
    } catch (err: any) {
      setError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
      setProgress('')
    }
  }, [ipdAdmissionId, patientId, category, description, uploadedBy, uploadedByRole, extractAI, onFileUploaded, onRefreshFiles])

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleUpload(file)
    e.target.value = '' // Reset so same file can be re-selected
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleUpload(file)
  }

  async function handleDelete(fileId: string) {
    if (!confirm('Delete this file permanently?')) return
    const res = await fetch(`/api/ipd/files?file_id=${fileId}`, { method: 'DELETE' })
    if (res.ok && onRefreshFiles) onRefreshFiles()
  }

  return (
    <div className="space-y-4">
      {/* Upload Area */}
      <div
        className={`border-2 border-dashed rounded-2xl p-5 text-center transition-all ${
          dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-gray-50 hover:border-blue-300'
        }`}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <div className="flex items-center justify-center gap-4 mb-4">
          {/* Camera button (mobile-friendly) */}
          <button
            onClick={() => cameraInputRef.current?.click()}
            disabled={uploading}
            className="flex flex-col items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-5 py-3 rounded-xl font-semibold text-sm disabled:opacity-50 transition-colors"
          >
            <Camera className="w-5 h-5" />
            Take Photo
          </button>

          {/* File picker button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex flex-col items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white px-5 py-3 rounded-xl font-semibold text-sm disabled:opacity-50 transition-colors"
          >
            <Upload className="w-5 h-5" />
            Choose File
          </button>
        </div>

        <p className="text-xs text-gray-400">
          or drag & drop a file here · Max 10 MB · JPG, PNG, PDF, HEIC supported
        </p>

        {/* Hidden inputs */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileSelect}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf,.doc,.docx"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {/* Category & Options */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">File Category</label>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
          >
            {CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Description (optional)</label>
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="e.g. Wound photo Day 3"
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
      </div>

      {/* AI Extraction Toggle */}
      <label className="flex items-center gap-3 cursor-pointer bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl px-4 py-3">
        <input
          type="checkbox"
          checked={extractAI}
          onChange={e => setExtractAI(e.target.checked)}
          className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
        />
        <Sparkles className="w-4 h-4 text-indigo-500" />
        <div>
          <span className="text-sm font-semibold text-indigo-700">AI Auto-Extraction</span>
          <p className="text-xs text-indigo-500">Automatically extract data from photos/PDFs to fill nursing chart fields</p>
        </div>
      </label>

      {/* Status messages */}
      {uploading && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
          <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
          <span className="text-sm font-medium text-blue-700">{progress}</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-500" />
          <span className="text-sm text-red-700">{error}</span>
          <button onClick={() => setError('')} className="ml-auto"><X className="w-4 h-4 text-red-400" /></button>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <CheckCircle className="w-4 h-4 text-green-500" />
          <span className="text-sm text-green-700">{success}</span>
        </div>
      )}

      {/* AI Extraction Results */}
      {aiResult && Object.keys(aiResult).length > 0 && !aiResult._error && (
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-indigo-500" />
            <span className="text-sm font-bold text-indigo-700">AI Extracted Data</span>
            <span className="text-xs bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full">Auto-filled</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(aiResult)
              .filter(([k]) => !k.startsWith('_'))
              .map(([key, value]) => (
                <div key={key} className="bg-white rounded-lg px-3 py-2 border border-indigo-100">
                  <div className="text-xs text-gray-500 capitalize">{key.replace(/_/g, ' ')}</div>
                  <div className="text-sm font-medium text-gray-800 truncate">
                    {typeof value === 'object' ? JSON.stringify(value).slice(0, 50) : String(value)}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Existing Files List */}
      {existingFiles.length > 0 && (
        <div>
          <h4 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
            <FileText className="w-4 h-4 text-gray-400" />
            Uploaded Files ({existingFiles.length})
          </h4>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {existingFiles.map(f => {
              const catCfg = CATEGORIES.find(c => c.value === f.category) || CATEGORIES[6]
              const CatIcon = catCfg.icon
              return (
                <div key={f.id} className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-3 py-2.5 hover:bg-gray-50">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${catCfg.color}`}>
                    <CatIcon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">{f.file_name}</div>
                    <div className="text-xs text-gray-400">
                      {catCfg.label} · {formatFileSize(f.file_size || 0)} · {f.uploaded_by}
                      {f.created_at && ` · ${new Date(f.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/* Preview button */}
                    {(f.file_url || f.file_data) && (
                      <button
                        onClick={() => setPreviewFile(f)}
                        className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500"
                        title="Preview"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    )}
                    {/* AI badge */}
                    {f.ai_extracted_data && Object.keys(f.ai_extracted_data).length > 0 && !f.ai_extracted_data._error && (
                      <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded-full border border-indigo-200">
                        AI
                      </span>
                    )}
                    {/* Delete button */}
                    <button
                      onClick={() => handleDelete(f.id)}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* File Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          onClick={() => setPreviewFile(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-auto p-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-gray-900">{previewFile.file_name}</h3>
              <button onClick={() => setPreviewFile(null)}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            {previewFile.file_type?.startsWith('image/') ? (
              <img
                src={previewFile.file_url || previewFile.file_data || ''}
                alt={previewFile.file_name}
                className="w-full rounded-xl"
              />
            ) : previewFile.file_type === 'application/pdf' && previewFile.file_url ? (
              <iframe
                src={previewFile.file_url}
                className="w-full h-96 rounded-xl border"
              />
            ) : (
              <div className="text-center py-12 text-gray-400">
                <FileText className="w-12 h-12 mx-auto mb-3" />
                <p>Preview not available for this file type</p>
                {previewFile.file_url && (
                  <a href={previewFile.file_url} target="_blank" rel="noopener noreferrer"
                    className="text-blue-600 underline text-sm mt-2 inline-block">
                    Download File
                  </a>
                )}
              </div>
            )}
            {/* Show AI data for this file */}
            {previewFile.ai_extracted_data && Object.keys(previewFile.ai_extracted_data).length > 0 && !previewFile.ai_extracted_data._error && (
              <div className="mt-4 bg-indigo-50 border border-indigo-200 rounded-xl p-3">
                <div className="text-xs font-bold text-indigo-700 mb-2 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> AI Extracted Data
                </div>
                <pre className="text-xs text-gray-700 whitespace-pre-wrap">
                  {JSON.stringify(previewFile.ai_extracted_data, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}