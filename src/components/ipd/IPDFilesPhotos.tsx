'use client'
/**
 * src/components/ipd/IPDFilesPhotos.tsx
 *
 * IPD File & Photo Management
 * Allows doctors and staff to:
 *  - Upload/capture photos (wound photos, X-rays, prescriptions)
 *  - Upload PDFs (discharge summaries, referral letters)
 *  - AI reads photos/handwriting and fills appropriate IPD fields
 *  - View all uploaded documents in a gallery
 *  - Documents linked to IPD admission
 */

import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import CameraUpload from '@/components/shared/CameraUpload'
import { useToast } from '@/components/shared/Toast'
import {
  FileText, Image, Trash2, Download, Eye,
  Loader2, Camera, Plus, X, ZoomIn, AlertTriangle
} from 'lucide-react'

interface IPDFile {
  id: string
  ipd_admission_id: string
  file_url: string
  file_name: string
  file_type: 'image' | 'pdf' | 'document'
  description: string
  uploaded_by: string
  ocr_data: Record<string, any> | null
  created_at: string
}

interface IPDFilesPhotosProps {
  admissionId: string
  patientName: string
  onOCRExtracted?: (data: Record<string, any>) => void
}

export default function IPDFilesPhotos({ admissionId, patientName, onOCRExtracted }: IPDFilesPhotosProps) {
  const { showSuccess, showError } = useToast()
  const [files, setFiles] = useState<IPDFile[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [description, setDescription] = useState('')
  const [selectedFile, setSelectedFile] = useState<IPDFile | null>(null)
  const [processing, setProcessing] = useState(false)

  // Load files
  const loadFiles = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('ipd_files')
      .select('*')
      .eq('ipd_admission_id', admissionId)
      .order('created_at', { ascending: false })
    setFiles((data || []) as IPDFile[])
    setLoading(false)
  }, [admissionId])

  useEffect(() => { loadFiles() }, [loadFiles])

  // Handle file upload with OCR
  const handleCapture = useCallback(async (file: File) => {
    setUploading(true)
    setProcessing(true)

    try {
      // Upload to Supabase Storage
      const fileName = `ipd-${admissionId}-${Date.now()}-${file.name}`
      const { error: storageErr } = await supabase.storage
        .from('documents')
        .upload(`ipd-files/${fileName}`, file)

      if (storageErr) {
        showError('Upload failed: ' + storageErr.message)
        setUploading(false)
        setProcessing(false)
        return
      }

      const { data: urlData } = supabase.storage
        .from('documents')
        .getPublicUrl(`ipd-files/${fileName}`)

      const fileUrl = urlData?.publicUrl || ''
      const fileType = file.type.startsWith('image/') ? 'image' : 'pdf'

      // Try OCR extraction for images
      let ocrData: Record<string, any> | null = null
      if (file.type.startsWith('image/')) {
        try {
          const formData = new FormData()
          formData.append('file', file)
          formData.append('type', 'opd_consultation')

          const res = await fetch('/api/ocr-free', {
            method: 'POST',
            body: formData,
          })

          if (res.ok) {
            const result = await res.json()
            ocrData = result
            if (onOCRExtracted && result) {
              onOCRExtracted(result)
            }
            showSuccess('Photo analyzed! Data extracted.')
          }
        } catch {
          // OCR is non-critical
        }
      }

      // Save file record
      const { error: insertErr } = await supabase
        .from('ipd_files')
        .insert({
          ipd_admission_id: admissionId,
          file_url: fileUrl,
          file_name: file.name,
          file_type: fileType,
          description: description || `${fileType === 'image' ? 'Photo' : 'Document'} for ${patientName}`,
          uploaded_by: 'staff',
          ocr_data: ocrData,
        })

      if (insertErr) {
        showError('Failed to save record: ' + insertErr.message)
      } else {
        showSuccess('File uploaded successfully!')
        setShowUpload(false)
        setDescription('')
        loadFiles()
      }
    } catch (err: any) {
      showError('Error: ' + err.message)
    } finally {
      setUploading(false)
      setProcessing(false)
    }
  }, [admissionId, patientName, description, onOCRExtracted, showSuccess, showError, loadFiles])

  // Delete file
  const handleDelete = useCallback(async (fileId: string, fileName: string) => {
    if (!confirm('Delete this file? This cannot be undone.')) return

    await supabase.from('ipd_files').delete().eq('id', fileId)
    // Also try to delete from storage (best-effort)
    await supabase.storage.from('documents').remove([`ipd-files/${fileName}`]).catch(() => {})
    showSuccess('File deleted')
    loadFiles()
  }, [loadFiles, showSuccess])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
          <Camera className="w-4 h-4 text-blue-600" />
          Files & Photos
          {files.length > 0 && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{files.length}</span>
          )}
        </h3>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700"
        >
          {showUpload ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {showUpload ? 'Cancel' : 'Upload'}
        </button>
      </div>

      {/* Upload section */}
      {showUpload && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
          <div>
            <label className="label">Description (optional)</label>
            <input
              className="input"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Wound photo Day 3, X-ray chest, Doctor's notes..."
            />
          </div>
          <CameraUpload
            onCapture={handleCapture}
            label="Upload or Capture"
            accept="image/*,application/pdf"
          />
          {processing && (
            <div className="flex items-center gap-2 text-xs text-blue-700">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Analyzing image with AI...
            </div>
          )}
        </div>
      )}

      {/* Files gallery */}
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
        </div>
      ) : files.length === 0 ? (
        <div className="text-center py-6 text-gray-400 border border-dashed border-gray-200 rounded-lg">
          <Image className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-xs">No files uploaded yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {files.map(f => (
            <div key={f.id} className="relative group rounded-lg border border-gray-200 overflow-hidden bg-white hover:shadow-md transition-shadow">
              {/* Thumbnail */}
              {f.file_type === 'image' ? (
                <img
                  src={f.file_url}
                  alt={f.description}
                  className="w-full h-24 object-cover cursor-pointer"
                  onClick={() => setSelectedFile(f)}
                />
              ) : (
                <div
                  className="w-full h-24 bg-gray-50 flex items-center justify-center cursor-pointer"
                  onClick={() => setSelectedFile(f)}
                >
                  <FileText className="w-8 h-8 text-red-400" />
                </div>
              )}

              {/* Info */}
              <div className="px-2 py-1.5">
                <p className="text-xs text-gray-700 truncate font-medium">{f.description || f.file_name}</p>
                <p className="text-[10px] text-gray-400">
                  {new Date(f.created_at).toLocaleDateString('en-IN')}
                </p>
                {f.ocr_data && (
                  <span className="text-[10px] text-green-600 font-medium">AI extracted</span>
                )}
              </div>

              {/* Actions overlay */}
              <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <a
                  href={f.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 bg-white rounded shadow-sm hover:bg-blue-50"
                  title="View full"
                >
                  <ZoomIn className="w-3 h-3 text-blue-600" />
                </a>
                <button
                  onClick={() => handleDelete(f.id, f.file_name)}
                  className="p-1 bg-white rounded shadow-sm hover:bg-red-50"
                  title="Delete"
                >
                  <Trash2 className="w-3 h-3 text-red-500" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Full-screen preview modal */}
      {selectedFile && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setSelectedFile(null)}>
          <div className="max-w-3xl w-full max-h-[90vh] bg-white rounded-xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div>
                <p className="text-sm font-semibold text-gray-800">{selectedFile.description || selectedFile.file_name}</p>
                <p className="text-xs text-gray-400">{new Date(selectedFile.created_at).toLocaleString('en-IN')}</p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={selectedFile.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary text-xs flex items-center gap-1"
                >
                  <Download className="w-3 h-3" /> Download
                </a>
                <button onClick={() => setSelectedFile(null)} className="text-gray-400 hover:text-gray-700">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="overflow-auto max-h-[70vh] p-4 bg-gray-50">
              {selectedFile.file_type === 'image' ? (
                <img src={selectedFile.file_url} alt={selectedFile.description} className="max-w-full h-auto mx-auto rounded" />
              ) : (
                <iframe src={selectedFile.file_url} className="w-full h-[60vh] border-0 rounded" />
              )}
            </div>
            {selectedFile.ocr_data && (
              <div className="px-4 py-3 border-t bg-green-50">
                <p className="text-xs font-semibold text-green-800 mb-2 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> AI Extracted Data
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(selectedFile.ocr_data).slice(0, 10).map(([k, v]) => (
                    <div key={k} className="text-xs">
                      <span className="text-gray-500">{k}:</span>{' '}
                      <span className="font-medium text-gray-800">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
