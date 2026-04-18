'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDateTime } from '@/lib/utils'
import {
  Paperclip, Upload, Camera, X, FileText,
  Image, Trash2, Download, Eye, Loader2, AlertCircle
} from 'lucide-react'

interface Attachment {
  id:          string
  file_name:   string
  file_type:   string
  file_size:   number
  storage_key: string
  notes:       string
  created_at:  string
  url?:        string
}

interface Props {
  patientId:   string
  encounterId?: string   // optional — if given, scoped to one encounter
  compact?:    boolean   // compact mode for inline use
}

const BUCKET = 'consultation-files'
const MAX_MB  = 20

export default function ConsultationAttachments({ patientId, encounterId, compact = false }: Props) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loading,     setLoading]     = useState(true)
  const [uploading,   setUploading]   = useState(false)
  const [error,       setError]       = useState('')
  const [noteInput,   setNoteInput]   = useState('')
  const [preview,     setPreview]     = useState<Attachment|null>(null)
  const [previewUrl,  setPreviewUrl]  = useState('')

  const uid    = useId()
  const fileId = `attach-file-${uid}`
  const camId  = `attach-cam-${uid}`

  // Camera state
  const [camOpen,   setCamOpen]   = useState(false)
  const videoRef    = useRef<HTMLVideoElement>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const streamRef   = useRef<MediaStream|null>(null)

  useEffect(() => { load() }, [patientId, encounterId])
  useEffect(() => () => stopCam(), [])

  async function load() {
    setLoading(true)
    let q = supabase.from('consultation_attachments')
      .select('*').eq('patient_id', patientId).order('created_at', { ascending: false })
    if (encounterId) q = q.eq('encounter_id', encounterId)
    const { data, error } = await q
    if (error) {
      setError('Could not load attachments. Run supabase_v6_updates.sql first.')
      setLoading(false)
      return
    }
    setAttachments(data || [])
    setLoading(false)
  }

  async function upload(file: File) {
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`File too large. Max ${MAX_MB} MB.`)
      return
    }
    const allowed = ['image/jpeg','image/jpg','image/png','image/webp','application/pdf']
    if (!allowed.includes(file.type)) {
      setError('Unsupported file. Use JPG, PNG, WebP, or PDF.')
      return
    }

    setUploading(true); setError('')
    const ext  = file.name.split('.').pop() || 'bin'
    const key  = `${patientId}/${encounterId || 'general'}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(key, file, { upsert: false })
    if (upErr) {
      // Storage bucket might not be set up yet
      if (upErr.message.includes('Bucket not found') || upErr.message.includes('bucket')) {
        setError('Storage bucket not set up. In Supabase → Storage → New Bucket → name: "consultation-files" → Private → Save.')
      } else {
        setError(`Upload failed: ${upErr.message}`)
      }
      setUploading(false)
      return
    }

    const { error: dbErr } = await supabase.from('consultation_attachments').insert({
      patient_id:   patientId,
      encounter_id: encounterId || null,
      file_name:    file.name,
      file_type:    file.type,
      file_size:    file.size,
      storage_key:  key,
      bucket:       BUCKET,
      notes:        noteInput.trim() || null,
    })
    if (dbErr) {
      setError(`DB error: ${dbErr.message}`)
      setUploading(false)
      return
    }
    setNoteInput('')
    setUploading(false)
    load()
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) upload(file)
    e.target.value = ''
  }

  async function openCam() {
    setCamOpen(true)
    try {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      }
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play() }
    } catch (err: any) {
      setError(err.name === 'NotAllowedError' ? 'Camera permission denied.' : `Camera error: ${err.message}`)
      setCamOpen(false)
    }
  }

  function stopCam() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  function captureCam() {
    const v = videoRef.current; const cv = canvasRef.current
    if (!v || !cv) return
    cv.width = v.videoWidth || 1280; cv.height = v.videoHeight || 720
    cv.getContext('2d')?.drawImage(v, 0, 0)
    cv.toBlob(blob => {
      if (!blob) return
      stopCam(); setCamOpen(false)
      upload(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.92)
  }

  async function openPreview(att: Attachment) {
    const { data } = await supabase.storage.from(BUCKET)
      .createSignedUrl(att.storage_key, 300)   // 5 min signed URL
    setPreview(att)
    setPreviewUrl(data?.signedUrl || '')
  }

  async function deleteAttachment(att: Attachment) {
    if (!confirm(`Delete "${att.file_name}"?`)) return
    await supabase.storage.from(BUCKET).remove([att.storage_key])
    await supabase.from('consultation_attachments').delete().eq('id', att.id)
    load()
  }

  function fmtSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`
    return `${(bytes/1024/1024).toFixed(1)} MB`
  }

  const isImage = (type: string) => type.startsWith('image/')
  const isPDF   = (type: string) => type === 'application/pdf'

  // Camera view
  if (camOpen) {
    return (
      <div className={`rounded-xl border-2 border-blue-300 bg-blue-50 ${compact ? '' : 'p-4'}`}>
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-blue-800">📷 Camera — point at document and capture</p>
            <button type="button" onClick={() => { stopCam(); setCamOpen(false) }}
              className="text-gray-400 hover:text-red-500"><X className="w-4 h-4"/></button>
          </div>
          <div className="relative bg-black rounded-lg overflow-hidden mb-3" style={{ aspectRatio:'16/9', maxHeight:'280px' }}>
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover"/>
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="border-2 border-white/50 rounded-lg" style={{ width:'80%', height:'80%' }}/>
            </div>
          </div>
          <canvas ref={canvasRef} className="hidden"/>
          <div className="flex gap-2 justify-center">
            <button type="button" onClick={captureCam}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2 rounded-lg transition-colors">
              <Camera className="w-4 h-4"/> Capture
            </button>
            <button type="button" onClick={() => { stopCam(); setCamOpen(false) }}
              className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Preview modal
  if (preview) {
    return (
      <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <div>
              <div className="font-semibold text-gray-900 text-sm">{preview.file_name}</div>
              <div className="text-xs text-gray-400">{fmtSize(preview.file_size)} · {formatDateTime(preview.created_at)}</div>
            </div>
            <div className="flex gap-2">
              {previewUrl && (
                <a href={previewUrl} download={preview.file_name} target="_blank" rel="noreferrer"
                  className="btn-secondary text-xs flex items-center gap-1">
                  <Download className="w-3.5 h-3.5"/> Download
                </a>
              )}
              <button onClick={() => { setPreview(null); setPreviewUrl('') }}
                className="text-gray-400 hover:text-gray-700 p-1"><X className="w-5 h-5"/></button>
            </div>
          </div>
          <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-gray-50">
            {previewUrl ? (
              isPDF(preview.file_type) ? (
                <iframe src={previewUrl} className="w-full" style={{ height:'60vh' }} title={preview.file_name}/>
              ) : (
                <img src={previewUrl} alt={preview.file_name} className="max-w-full max-h-full object-contain rounded-lg shadow"/>
              )
            ) : (
              <div className="text-gray-400 text-sm">Loading preview…</div>
            )}
          </div>
          {preview.notes && (
            <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-600">
              <span className="font-semibold">Notes:</span> {preview.notes}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={compact ? '' : 'card p-5'}>
      {!compact && <h2 className="section-title flex items-center gap-2"><Paperclip className="w-4 h-4"/> Files & Photos</h2>}

      {/* Upload area */}
      <div className="mb-4">
        <input id={fileId} type="file" accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
          onChange={handleFileChange}
          style={{ position:'absolute', width:1, height:1, opacity:0, pointerEvents:'none' }}/>
        <input id={camId} type="file" accept="image/jpeg,image/jpg,image/png,image/webp"
          capture="environment" onChange={handleFileChange}
          style={{ position:'absolute', width:1, height:1, opacity:0, pointerEvents:'none' }}/>

        <div className="mb-2">
          <input className="input text-sm" placeholder="Optional note for this file…"
            value={noteInput} onChange={e=>setNoteInput(e.target.value)}/>
        </div>
        <div className="flex gap-2">
          <label htmlFor={fileId}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors cursor-pointer select-none">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Upload className="w-3.5 h-3.5"/>}
            {uploading ? 'Uploading…' : 'Upload File'}
          </label>
          <button type="button" onClick={openCam} disabled={uploading}
            className="flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
            <Camera className="w-3.5 h-3.5"/> Camera
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1.5">
          Accepts JPG, PNG, WebP (photos) and PDF (reports, documents). Max {MAX_MB} MB each.
        </p>
      </div>

      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"/>
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto"><X className="w-3 h-3"/></button>
        </div>
      )}

      {/* File list */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2"/> Loading files…
        </div>
      ) : attachments.length === 0 ? (
        <div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-100 rounded-xl">
          <Paperclip className="w-8 h-8 mx-auto mb-2 opacity-30"/>
          <p className="text-sm">No files uploaded yet</p>
          <p className="text-xs mt-1">Upload photos, lab reports, or any documents for this patient</p>
        </div>
      ) : (
        <div className="space-y-2">
          {attachments.map(att => (
            <div key={att.id}
              className="flex items-center gap-3 border border-gray-100 rounded-lg px-3 py-2.5 hover:bg-gray-50 group">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                isImage(att.file_type) ? 'bg-blue-100' : 'bg-red-100'
              }`}>
                {isImage(att.file_type)
                  ? <Image className="w-4 h-4 text-blue-600"/>
                  : <FileText className="w-4 h-4 text-red-600"/>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{att.file_name}</div>
                <div className="text-xs text-gray-400">
                  {fmtSize(att.file_size)} · {formatDateTime(att.created_at)}
                  {att.notes && <span className="ml-2 text-gray-500">· {att.notes}</span>}
                </div>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => openPreview(att)}
                  className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="Preview">
                  <Eye className="w-3.5 h-3.5"/>
                </button>
                <button onClick={() => deleteAttachment(att)}
                  className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg" title="Delete">
                  <Trash2 className="w-3.5 h-3.5"/>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
