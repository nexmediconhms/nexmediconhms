'use client'
/**
 * src/components/shared/ConsultationAttachments.tsx  (UPDATED)
 *
 * Changes from original:
 *  1. Added "Read Note" button on image attachments → calls /api/doctor-note-ocr
 *  2. Supports cursive & non-block handwriting via Claude Vision
 *  3. Shows transcription modal with structured extraction
 *  4. Passes Authorization header (Supabase access token) to the API
 *  5. Audit log on upload/delete
 */

import { useEffect, useId, useRef, useState } from 'react'
import { supabase }        from '@/lib/supabase'
import { formatDateTime }  from '@/lib/utils'
import { audit }           from '@/lib/audit'
import {
  Paperclip, Upload, Camera, X, FileText,
  Image, Trash2, Download, Eye, Loader2,
  AlertCircle, CheckCircle, Info, BookOpen,
  ChevronDown, ChevronUp, Sparkles,
} from 'lucide-react'

function buildDoctorNoteFileName(originalFile: File): string {
  const now = new Date()
  const dd  = String(now.getDate()).padStart(2, '0')
  const mm  = String(now.getMonth() + 1).padStart(2, '0')
  const yy  = String(now.getFullYear()).slice(-2)
  const ext = originalFile.name.split('.').pop()?.toLowerCase() || 'bin'
  return `DoctorNote_${dd}_${mm}_${yy}.${ext}`
}

interface Attachment {
  id:           string
  file_name:    string
  file_type:    string
  file_size:    number
  storage_key?: string
  file_data?:   string
  notes:        string
  created_at:   string
  source:       'storage' | 'db'
}

interface OCRResult {
  transcription:      string
  confidence:         'high' | 'medium' | 'low'
  illegible_sections: string[]
  structured: {
    chief_complaint?:        string
    history?:                string
    examination_findings?:   string
    diagnosis?:              string
    investigations_ordered?: string
    treatment_plan?:         string
    medications?:            { drug: string; dose: string; frequency: string; duration: string; route: string }[]
    advice?:                 string
    follow_up?:              string
    notes?:                  string
  }
  raw_text:    string
  _provider?:  string
  _parse_error?: boolean
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

  // ── OCR state ──────────────────────────────────────────────
  const [ocrTarget,   setOcrTarget]   = useState<Attachment | null>(null)
  const [ocrLoading,  setOcrLoading]  = useState(false)
  const [ocrResult,   setOcrResult]   = useState<OCRResult | null>(null)
  const [ocrError,    setOcrError]    = useState('')
  const [showOcrRaw,  setShowOcrRaw]  = useState(false)

  // ── Autofill state ────────────────────────────────────────
  const [autofilling,       setAutofilling]       = useState<string | null>(null)   // attachment id
  const [autofillDoneId,    setAutofillDoneId]    = useState<string | null>(null)   // id of last success
  const [autofillError,     setAutofillError]     = useState('')

  const uid    = useId()
  const fileId = `attach-file-${uid}`

  const [camOpen, setCamOpen] = useState(false)
  const videoRef   = useRef<HTMLVideoElement>(null)
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const streamRef  = useRef<MediaStream|null>(null)

  useEffect(() => { detectStorageMode().then(() => load()) }, [patientId, encounterId])
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
      setError(`File too large — max ${storageMode === 'db' ? DB_MAX_MB : MAX_MB} MB.`)
      return
    }
    const allowed = ['image/jpeg','image/jpg','image/png','image/webp','application/pdf']
    if (!allowed.includes(file.type)) { setError('Unsupported type. Use JPG, PNG, WebP, or PDF.'); return }
    setUploading(true); setError('')
    if (storageMode === 'storage') await uploadToStorage(file)
    else await uploadToDB(file)
  }

  async function uploadToStorage(file: File) {
    const displayName = buildDoctorNoteFileName(file)
    const ext = file.name.split('.').pop() || 'bin'
    const key = `${patientId}/${encounterId || 'general'}/${displayName.replace(/\s/g,'-')}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(key, file, { upsert: false })
    if (upErr) {
      setStorageMode('db')
      setSetupNote(`Storage error (${upErr.message}) — switched to DB fallback.`)
      await uploadToDB(file); return
    }
    const { data, error: dbErr } = await supabase.from('consultation_attachments').insert({
      patient_id: patientId, encounter_id: encounterId || null,
      file_name: displayName, file_type: file.type, file_size: file.size,
      storage_key: key, bucket: BUCKET, notes: noteInput.trim() || null,
    }).select().single()
    if (dbErr) setError(`Save failed: ${dbErr.message}`)
    else {
      setNoteInput('')
      await audit('create', 'attachment', data?.id, displayName)
      load()
    }
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
      const displayName = buildDoctorNoteFileName(file)
      const { data, error: dbErr } = await supabase.from('consultation_files_db').insert({
        patient_id: patientId, encounter_id: encounterId || null,
        file_name: displayName, file_type: file.type, file_size: file.size,
        file_data: base64, notes: noteInput.trim() || null,
      }).select().single()
      if (dbErr) setError(`Save failed: ${dbErr.message}`)
      else {
        setNoteInput('')
        await audit('create', 'attachment', data?.id, displayName)
        load()
      }
    } catch (e: any) { setError(`Upload failed: ${e.message}`) }
    setUploading(false)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) upload(f)
    e.target.value = ''
  }

  async function deleteAttachment(att: Attachment) {
    if (!confirm(`Delete "${att.file_name}"?`)) return
    if (att.source === 'storage' && att.storage_key) {
      await supabase.storage.from(BUCKET).remove([att.storage_key])
      await supabase.from('consultation_attachments').delete().eq('id', att.id)
    } else {
      await supabase.from('consultation_files_db').delete().eq('id', att.id)
    }
    await audit('delete', 'attachment', att.id, att.file_name)
    load()
  }

  async function openPreview(att: Attachment) {
    setPreview(att)
    if (att.source === 'storage' && att.storage_key) {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(att.storage_key, 300)
      setPreviewUrl(data?.signedUrl ?? '')
    } else if (att.source === 'db' && att.file_data) {
      setPreviewUrl(`data:${att.file_type};base64,${att.file_data}`)
    }
  }

  // ── Camera ────────────────────────────────────────────────
  async function openCam() {
    setCamOpen(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch { setCamOpen(false); setError('Camera access denied.') }
  }
  function stopCam() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }
  function captureCam() {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width  = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    canvas.toBlob(blob => {
      if (!blob) return
      const camFile = new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' })
      stopCam(); setCamOpen(false)
      upload(camFile)
    }, 'image/jpeg', 0.92)
  }

  // ── Doctor Note OCR ───────────────────────────────────────
  async function readDoctorNote(att: Attachment) {
    setOcrTarget(att)
    setOcrLoading(true)
    setOcrResult(null)
    setOcrError('')

    try {
      // Get image blob
      let imageBlob: Blob | null = null

      if (att.source === 'storage' && att.storage_key) {
        const { data } = await supabase.storage.from(BUCKET).download(att.storage_key)
        imageBlob = data
      } else if (att.source === 'db' && att.file_data) {
        const byteChars = atob(att.file_data)
        const bytes     = new Uint8Array(byteChars.length)
        for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i)
        imageBlob = new Blob([bytes], { type: att.file_type })
      }

      if (!imageBlob) throw new Error('Could not retrieve image data.')

      // Get auth token for API
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated.')

      const fd = new FormData()
      fd.append('image', new File([imageBlob], att.file_name, { type: att.file_type }))
      fd.append('context', `Doctor note — patient file. Attached note: "${att.notes || 'no label'}"`)

      const res  = await fetch('/api/doctor-note-ocr', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const data = await res.json()

      if (!res.ok || data.error) throw new Error(data.error || 'OCR failed.')
      setOcrResult(data as OCRResult)
      await audit('scan', 'attachment', att.id, att.file_name)
    } catch (e: any) {
      setOcrError(e.message || 'Failed to read note.')
    } finally {
      setOcrLoading(false)
    }
  }

  function closeOcr() { setOcrTarget(null); setOcrResult(null); setOcrError('') }

  // ── Extract & Autofill ────────────────────────────────────
  // Sends the file to /api/doctor-note-ocr in 'autofill' mode.
  // The API returns structured fields + a formType (ob_exam | vitals | encounter).
  // We fire a custom DOM event 'autofill-fields' so the parent OPD/ANC page
  // can listen and populate its own form state automatically.
  async function extractAndFill(att: Attachment) {
    setAutofilling(att.id)
    setAutofillDoneId(null)
    setAutofillError('')

    try {
      // Get the image blob the same way readDoctorNote does
      let imageBlob: Blob | null = null
      if (att.source === 'storage' && att.storage_key) {
        const { data } = await supabase.storage.from(BUCKET).download(att.storage_key)
        imageBlob = data
      } else if (att.source === 'db' && att.file_data) {
        const byteChars = atob(att.file_data)
        const bytes     = new Uint8Array(byteChars.length)
        for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i)
        imageBlob = new Blob([bytes], { type: att.file_type })
      }
      if (!imageBlob) throw new Error('Could not retrieve image data.')

      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated.')

      const fd = new FormData()
      fd.append('image', new File([imageBlob], att.file_name, { type: att.file_type }))
      fd.append('context', `Extract structured fields for autofill. File: ${att.file_name}`)
      fd.append('mode', 'autofill')

      const res  = await fetch('/api/doctor-note-ocr', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Extraction failed.')

      const { formType, fields } = data as { formType: string; fields: Record<string, any> }
      if (!fields || Object.keys(fields).length === 0) {
        throw new Error('Could not extract structured fields from this image. Try a clearer photo.')
      }

      // Dispatch DOM event so OPD/ANC pages can pick up and fill their forms
      window.dispatchEvent(new CustomEvent('autofill-fields', {
        detail: { formType, fields, sourceFile: att.file_name },
      }))

      await audit('autofill', 'attachment', att.id, att.file_name)
      setAutofillDoneId(att.id)
      setTimeout(() => setAutofillDoneId(null), 4000)
    } catch (e: any) {
      setAutofillError(e.message || 'Extract failed.')
      setTimeout(() => setAutofillError(''), 5000)
    } finally {
      setAutofilling(null)
    }
  }

  const fmtSize = (b: number) =>
    b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`

  const confColor = (c: string) =>
    c === 'high' ? 'text-green-700 bg-green-50 border-green-200' :
    c === 'medium' ? 'text-yellow-700 bg-yellow-50 border-yellow-200' :
    'text-red-700 bg-red-50 border-red-200'

  // ── Camera modal ──────────────────────────────────────────
  if (camOpen) return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-lg w-full p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">Capture Doctor Note</h3>
          <button type="button" onClick={() => { stopCam(); setCamOpen(false) }} className="text-gray-400 hover:text-red-500"><X className="w-4 h-4"/></button>
        </div>
        <div className="relative bg-black rounded-lg overflow-hidden mb-3" style={{ aspectRatio:'16/9', maxHeight:'280px' }}>
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover"/>
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="border-2 border-white/50 rounded-lg" style={{ width:'80%', height:'80%' }}/>
          </div>
        </div>
        <canvas ref={canvasRef} className="hidden"/>
        <p className="text-xs text-gray-500 mb-3 text-center">Hold steady • Good lighting • Camera directly above the note</p>
        <div className="flex gap-2 justify-center">
          <button type="button" onClick={captureCam} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2 rounded-lg">
            <Camera className="w-4 h-4"/> Capture
          </button>
          <button type="button" onClick={() => { stopCam(); setCamOpen(false) }} className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50">Cancel</button>
        </div>
      </div>
    </div>
  )

  // ── OCR result modal ──────────────────────────────────────
  if (ocrTarget) return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-600"/> Reading: {ocrTarget.file_name}
            </h3>
            <p className="text-xs text-gray-400">AI handwriting reader — works with cursive & block letters</p>
          </div>
          <button onClick={closeOcr} className="text-gray-400 hover:text-gray-700 p-1"><X className="w-5 h-5"/></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {ocrLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <Loader2 className="w-8 h-8 animate-spin mb-3 text-blue-500"/>
              <p className="text-sm font-medium">Reading handwriting…</p>
              <p className="text-xs text-gray-400 mt-1">Works with cursive, scrawl, abbreviations</p>
            </div>
          )}

          {ocrError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5"/>
              <div>
                <p className="font-medium text-red-800 text-sm">Could not read note</p>
                <p className="text-red-600 text-xs mt-1">{ocrError}</p>
                <p className="text-red-500 text-xs mt-1">Tip: Ensure good lighting and the camera is directly above the note.</p>
              </div>
            </div>
          )}

          {ocrResult && (
            <>
              {/* Confidence badge */}
              <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-medium ${confColor(ocrResult.confidence)}`}>
                <CheckCircle className="w-3.5 h-3.5"/>
                Confidence: {ocrResult.confidence.charAt(0).toUpperCase() + ocrResult.confidence.slice(1)}
                {ocrResult._provider && <span className="opacity-60">· via {ocrResult._provider}</span>}
              </div>

              {/* Illegible warnings */}
              {ocrResult.illegible_sections?.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                  <span className="font-semibold">Could not read:</span> {ocrResult.illegible_sections.join(', ')}
                </div>
              )}

              {/* Transcription */}
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Transcription</h4>
                <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-800 whitespace-pre-wrap font-mono leading-relaxed">
                  {ocrResult.transcription || ocrResult.raw_text || 'No text extracted.'}
                </pre>
              </div>

              {/* Structured extraction */}
              {ocrResult.structured && Object.keys(ocrResult.structured).length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Extracted Clinical Data</h4>
                  <div className="space-y-2">
                    {(Object.entries(ocrResult.structured) as [string, any][])
                      .filter(([, v]) => v && (typeof v === 'string' ? v.trim() : Array.isArray(v) ? v.length > 0 : true))
                      .map(([key, val]) => {
                        const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                        return (
                          <div key={key} className="bg-white border border-gray-100 rounded-lg px-3 py-2">
                            <div className="text-xs font-semibold text-gray-500 mb-0.5">{label}</div>
                            {Array.isArray(val) ? (
                              <ul className="text-sm text-gray-800 space-y-0.5">
                                {val.map((item: any, i: number) => (
                                  <li key={i} className="text-xs">
                                    {typeof item === 'object'
                                      ? Object.entries(item).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join(' · ')
                                      : String(item)
                                    }
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-sm text-gray-800">{String(val)}</p>
                            )}
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}

              {/* Raw toggle */}
              <button
                onClick={() => setShowOcrRaw(v => !v)}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600"
              >
                {showOcrRaw ? <ChevronUp className="w-3.5 h-3.5"/> : <ChevronDown className="w-3.5 h-3.5"/>}
                {showOcrRaw ? 'Hide' : 'Show'} raw response
              </button>
              {showOcrRaw && (
                <pre className="bg-gray-900 text-green-400 text-xs rounded-lg p-3 overflow-x-auto">
                  {JSON.stringify(ocrResult, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-between items-center">
          <p className="text-xs text-gray-400">Results are AI-generated — verify before recording in chart</p>
          <button onClick={closeOcr} className="btn-secondary text-xs">Close</button>
        </div>
      </div>
    </div>
  )

  // ── Preview modal ─────────────────────────────────────────
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
            {preview.file_type.startsWith('image/') && (
              <button
                onClick={() => { setPreview(null); setPreviewUrl(''); readDoctorNote(preview) }}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg"
              >
                <BookOpen className="w-3.5 h-3.5"/> Read Handwriting
              </button>
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

  // ── Main UI ───────────────────────────────────────────────
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

      {/* Upload area */}
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
        <p className="text-xs text-gray-400 mt-1.5">
          JPG, PNG, WebP photos · PDF documents · Max {storageMode === 'db' ? DB_MAX_MB : MAX_MB} MB
          <span className="ml-2 text-blue-500">· Image uploads: tap <BookOpen className="w-3 h-3 inline"/> to read handwriting (cursive OK) · tap <Sparkles className="w-3 h-3 inline text-emerald-500"/> to extract &amp; autofill form fields</span>
        </p>
      </div>

      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"/>
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto flex-shrink-0"><X className="w-3 h-3"/></button>
        </div>
      )}

      {autofillError && (
        <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"/>
          <span><strong>Extract &amp; Fill:</strong> {autofillError}</span>
          <button onClick={() => setAutofillError('')} className="ml-auto flex-shrink-0"><X className="w-3 h-3"/></button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mr-2"/> Loading…</div>
      ) : attachments.length === 0 ? (
        <div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-100 rounded-xl">
          <Paperclip className="w-8 h-8 mx-auto mb-2 opacity-30"/>
          <p className="text-sm">No files uploaded yet</p>
          <p className="text-xs mt-1">Upload photos of handwritten notes — AI can read cursive too</p>
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
                <button onClick={() => openPreview(att)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="Preview">
                  <Eye className="w-3.5 h-3.5"/>
                </button>
                {att.file_type.startsWith('image/') && (
                  <button onClick={() => readDoctorNote(att)} className="p-1.5 text-purple-600 hover:bg-purple-50 rounded-lg" title="Read handwriting with AI">
                    <BookOpen className="w-3.5 h-3.5"/>
                  </button>
                )}
                {/* ── Extract & Fill Fields — NEW ── */}
                {att.file_type.startsWith('image/') && (
                  <button
                    onClick={() => extractAndFill(att)}
                    disabled={autofilling === att.id}
                    title="Extract data and autofill form fields"
                    className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg disabled:opacity-50"
                  >
                    {autofilling === att.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin"/>
                      : autofillDoneId === att.id
                      ? <CheckCircle className="w-3.5 h-3.5 text-green-500"/>
                      : <Sparkles className="w-3.5 h-3.5"/>
                    }
                  </button>
                )}
                <button onClick={() => deleteAttachment(att)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg" title="Delete">
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