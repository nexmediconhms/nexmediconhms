'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDateTime } from '@/lib/utils'
import {
  Paperclip, Upload, Camera, X, FileText,
  Image, Trash2, Download, Eye, Loader2,
  AlertCircle, CheckCircle, Info
} from 'lucide-react'

interface Attachment {
  id:           string
  file_name:    string
  file_type:    string
  file_size:    number
  storage_key?: string
  file_data?:   string   // base64 for DB fallback
  notes:        string
  created_at:   string
  source:       'storage' | 'db'
}

interface Props {
  patientId:    string
  encounterId?: string
  compact?:     boolean
}

const BUCKET    = 'consultation-files'
const MAX_MB    = 10
const DB_MAX_MB = 2

type StorageMode = 'checking' | 'storage' | 'db'

export default function ConsultationAttachments({ patientId, encounterId, compact = false }: Props) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loading,     setLoading]     = useState(true)
  const [uploading,   setUploading]   = useState(false)
  const [error,       setError]       = useState('')
  const [noteInput,   setNoteInput]   = useState('')
  const [preview,     setPreview]     = useState<Attachment|null>(null)
  const [previewUrl,  setPreviewUrl]  = useState('')
  const [storageMode, setStorageMode] = useState<StorageMode>('checking')
  const [setupNote,   setSetupNote]   = useState('')

  const uid    = useId()
  const fileId = `attach-file-${uid}`

  const [camOpen, setCamOpen] = useState(false)
  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream|null>(null)

  useEffect(() => {
    detectStorageMode().then(() => load())
  }, [patientId, encounterId])

  useEffect(() => () => stopCam(), [])

  async function detectStorageMode() {
    try {
      const testFile = new Blob(['x'], { type: 'text/plain' })
      const testKey  = `_healthcheck/${Date.now()}.txt`
      const { error } = await supabase.storage.from(BUCKET).upload(testKey, testFile, { upsert: true })
      if (!error) {
        await supabase.storage.from(BUCKET).remove([testKey])
        setStorageMode('storage')
      } else {
        setStorageMode('db')
        const isBucketMissing = error.message.toLowerCase().includes('bucket') ||
                                error.message.toLowerCase().includes('not found') ||
                                error.message.includes('404')
        setSetupNote(isBucketMissing
          ? 'Storage bucket not set up → using DB storage (max 2 MB). To enable up to 10 MB: Supabase Dashboard → Storage → New Bucket → name: "consultation-files" → Private → Save.'
          : `Storage unavailable (${error.message}) → using DB storage (max 2 MB).`)
      }
    } catch {
      setStorageMode('db')
      setSetupNote('Using database storage (max 2 MB per file).')
    }
  }

  async function load() {
    setLoading(true)
    const combined: Attachment[] = []

    try {
      let q = supabase.from('consultation_attachments')
        .select('*').eq('patient_id', patientId).order('created_at', { ascending: false })
      if (encounterId) q = q.eq('encounter_id', encounterId)
      const { data } = await q
      ;(data || []).forEach((r: any) => combined.push({ ...r, source: 'storage' as const }))
    } catch { /* table might not exist yet */ }

    try {
      let q2 = supabase.from('consultation_files_db')
        .select('*').eq('patient_id', patientId).order('created_at', { ascending: false })
      if (encounterId) q2 = q2.eq('encounter_id', encounterId)
      const { data } = await q2
      ;(data || []).forEach((r: any) => combined.push({ ...r, source: 'db' as const }))
    } catch { /* DB fallback table might not exist yet */ }

    combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    setAttachments(combined)
    setLoading(false)
  }

  async function upload(file: File) {
    const maxBytes = storageMode === 'db' ? DB_MAX_MB * 1024 * 1024 : MAX_MB * 1024 * 1024
    if (file.size > maxBytes) {
      setError(`File too large — max ${storageMode === 'db' ? DB_MAX_MB : MAX_MB} MB.${storageMode === 'db' ? ' Create the Supabase Storage bucket to allow up to 10 MB.' : ''}`)
      return
    }
    const allowed = ['image/jpeg','image/jpg','image/png','image/webp','application/pdf']
    if (!allowed.includes(file.type)) {
      setError('Unsupported type. Use JPG, PNG, WebP, or PDF.')
      return
    }
    setUploading(true); setError('')
    if (storageMode === 'storage') await uploadToStorage(file)
    else await uploadToDB(file)
  }

  async function uploadToStorage(file: File) {
    const ext = file.name.split('.').pop() || 'bin'
    const key = `${patientId}/${encounterId || 'general'}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(key, file, { upsert: false })
    if (upErr) {
      // Auto-fallback to DB
      setStorageMode('db')
      setSetupNote(`Storage error (${upErr.message}) — switched to DB fallback.`)
      await uploadToDB(file)
      return
    }
    const { error: dbErr } = await supabase.from('consultation_attachments').insert({
      patient_id: patientId, encounter_id: encounterId || null,
      file_name: file.name, file_type: file.type, file_size: file.size,
      storage_key: key, bucket: BUCKET, notes: noteInput.trim() || null,
    })
    if (dbErr) setError(`Save failed: ${dbErr.message}`)
    else { setNoteInput(''); load() }
    setUploading(false)
  }

  async function uploadToDB(file: File) {
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload  = () => res((r.result as string).split(',')[1])
        r.onerror = rej
        r.readAsDataURL(file)
      })
      const { error: dbErr } = await supabase.from('consultation_files_db').insert({
        patient_id: patientId, encounter_id: encounterId || null,
        file_name: file.name, file_type: file.type, file_size: file.size,
        file_data: base64, notes: noteInput.trim() || null,
      })
      if (dbErr) {
        if (dbErr.message.includes('does not exist') || dbErr.message.includes('relation')) {
          setError('Run supabase_v6_updates.sql in Supabase SQL Editor, then try again.')
        } else {
          setError(`Upload failed: ${dbErr.message}`)
        }
      } else { setNoteInput(''); load() }
    } catch (err: any) { setError(`Error: ${err.message}`) }
    setUploading(false)
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
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }) }
      catch { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }) }
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play() }
    } catch (err: any) {
      setError(err.name === 'NotAllowedError' ? 'Camera permission denied.' : `Camera error: ${err.message}`)
      setCamOpen(false)
    }
  }

  function stopCam() { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null }

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
    setPreview(att)
    if (att.source === 'db' && att.file_data) {
      setPreviewUrl(`data:${att.file_type};base64,${att.file_data}`)
    } else if (att.storage_key) {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(att.storage_key, 300)
      setPreviewUrl(data?.signedUrl || '')
    }
  }

  async function deleteAttachment(att: Attachment) {
    if (!confirm(`Delete "${att.file_name}"?`)) return
    if (att.source === 'storage' && att.storage_key) {
      await supabase.storage.from(BUCKET).remove([att.storage_key])
      await supabase.from('consultation_attachments').delete().eq('id', att.id)
    } else {
      await supabase.from('consultation_files_db').delete().eq('id', att.id)
    }
    load()
  }

  function fmtSize(b: number) {
    if (b < 1024) return `${b} B`
    if (b < 1024*1024) return `${(b/1024).toFixed(1)} KB`
    return `${(b/1024/1024).toFixed(1)} MB`
  }

  if (camOpen) return (
    <div className="rounded-xl border-2 border-blue-300 bg-blue-50">
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-blue-800">📷 Live Camera — point at document, then Capture</p>
          <button type="button" onClick={() => { stopCam(); setCamOpen(false) }} className="text-gray-400 hover:text-red-500"><X className="w-4 h-4"/></button>
        </div>
        <div className="relative bg-black rounded-lg overflow-hidden mb-3" style={{ aspectRatio:'16/9', maxHeight:'280px' }}>
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover"/>
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="border-2 border-white/50 rounded-lg" style={{ width:'80%', height:'80%' }}/>
          </div>
        </div>
        <canvas ref={canvasRef} className="hidden"/>
        <div className="flex gap-2 justify-center">
          <button type="button" onClick={captureCam} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2 rounded-lg">
            <Camera className="w-4 h-4"/> Capture
          </button>
          <button type="button" onClick={() => { stopCam(); setCamOpen(false) }} className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50">Cancel</button>
        </div>
      </div>
    </div>
  )

  if (preview) return (
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
                className="btn-secondary text-xs flex items-center gap-1"><Download className="w-3.5 h-3.5"/> Download</a>
            )}
            <button onClick={() => { setPreview(null); setPreviewUrl('') }} className="text-gray-400 hover:text-gray-700 p-1"><X className="w-5 h-5"/></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-gray-50">
          {previewUrl
            ? preview.file_type === 'application/pdf'
              ? <iframe src={previewUrl} className="w-full" style={{ height:'60vh' }} title={preview.file_name}/>
              : <img src={previewUrl} alt={preview.file_name} className="max-w-full max-h-full object-contain rounded-lg shadow"/>
            : <div className="text-gray-400 text-sm">Loading…</div>
          }
        </div>
        {preview.notes && <div className="px-5 py-3 border-t text-xs text-gray-600"><span className="font-semibold">Notes:</span> {preview.notes}</div>}
      </div>
    </div>
  )

  return (
    <div className={compact ? '' : 'card p-5'}>
      {!compact && <h2 className="section-title flex items-center gap-2 mb-4"><Paperclip className="w-4 h-4"/> Files & Photos</h2>}

      {storageMode === 'checking' && (
        <div className="flex items-center gap-2 text-xs text-gray-400 mb-3"><Loader2 className="w-3.5 h-3.5 animate-spin"/> Checking storage…</div>
      )}
      {storageMode === 'storage' && (
        <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5 mb-3">
          <CheckCircle className="w-3.5 h-3.5"/> Cloud Storage active — up to {MAX_MB} MB per file
        </div>
      )}
      {storageMode === 'db' && setupNote && (
        <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"/><span>{setupNote}</span>
        </div>
      )}

      <div className="mb-4">
        <input id={fileId} type="file" accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
          onChange={handleFileChange}
          style={{ position:'absolute', width:1, height:1, opacity:0, pointerEvents:'none' }}/>
        <div className="mb-2">
          <input className="input text-sm" placeholder="Optional note for this file…" value={noteInput} onChange={e => setNoteInput(e.target.value)}/>
        </div>
        <div className="flex gap-2">
          <label htmlFor={fileId}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2 rounded-lg cursor-pointer select-none transition-colors">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Upload className="w-3.5 h-3.5"/>}
            {uploading ? 'Uploading…' : 'Upload File'}
          </label>
          <button type="button" onClick={openCam} disabled={uploading}
            className="flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50 transition-colors">
            <Camera className="w-3.5 h-3.5"/> Camera
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1.5">JPG, PNG, WebP photos · PDF documents · Max {storageMode === 'db' ? DB_MAX_MB : MAX_MB} MB</p>
      </div>

      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"/>
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto flex-shrink-0"><X className="w-3 h-3"/></button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mr-2"/> Loading…</div>
      ) : attachments.length === 0 ? (
        <div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-100 rounded-xl">
          <Paperclip className="w-8 h-8 mx-auto mb-2 opacity-30"/>
          <p className="text-sm">No files uploaded yet</p>
          <p className="text-xs mt-1">Upload photos, lab reports, or documents</p>
        </div>
      ) : (
        <div className="space-y-2">
          {attachments.map(att => (
            <div key={att.id} className="flex items-center gap-3 border border-gray-100 rounded-lg px-3 py-2.5 hover:bg-gray-50 group">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${att.file_type.startsWith('image/') ? 'bg-blue-100' : 'bg-red-100'}`}>
                {att.file_type.startsWith('image/') ? <Image className="w-4 h-4 text-blue-600"/> : <FileText className="w-4 h-4 text-red-600"/>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{att.file_name}</div>
                <div className="text-xs text-gray-400">
                  {fmtSize(att.file_size)} · {formatDateTime(att.created_at)}
                  {att.notes && <span className="ml-2">· {att.notes}</span>}
                </div>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => openPreview(att)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="Preview"><Eye className="w-3.5 h-3.5"/></button>
                <button onClick={() => deleteAttachment(att)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg" title="Delete"><Trash2 className="w-3.5 h-3.5"/></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
