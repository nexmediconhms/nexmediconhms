'use client'
import { useState, useRef, useCallback, useId, useEffect } from 'react'
import type { OCRFormType, OCRResult } from '@/lib/ocr'
import {
  ScanLine, Upload, CheckCircle, AlertCircle,
  Eye, RefreshCw, Camera, Loader2,
  ChevronDown, ChevronUp, X, ZoomIn
} from 'lucide-react'
import { pdfToPngFile } from '@/lib/pdf-to-image'

interface FormScannerProps {
  formType:   OCRFormType
  onExtracted:(result: OCRResult) => void
  label?:     string
  className?: string
  defaultMode?: 'free' | 'ai'  // 'free' = Tesseract (no key), 'ai' = Claude/GPT
}

type ScanState = 'idle' | 'camera' | 'uploading' | 'processing' | 'done' | 'error'

export default function FormScanner({
  formType,
  onExtracted,
  label = 'Scan Paper Form',
  className = '',
}: FormScannerProps) {
  const [state,       setState]      = useState<ScanState>('idle')
  const [error,       setError]      = useState('')
  const [result,      setResult]     = useState<OCRResult | null>(null)
  const [preview,     setPreview]    = useState<string>('')
  const [showRaw,     setShowRaw]    = useState(false)
  const [showPanel,   setShowPanel]  = useState(false)
  const [camError,    setCamError]   = useState('')
  const [ocrMode,     setOcrMode]    = useState<'free'|'ai'>('free')
  const [isPDF,       setIsPDF]      = useState(false)

  // Camera refs
  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // File upload refs/ids
  const uid     = useId()
  const fileId  = `scanner-file-${uid}`

  // ── Stop camera stream ────────────────────────────────────
  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }

  // Cleanup on unmount
  useEffect(() => () => stopCamera(), [])

  // ── Open camera (desktop + mobile) ───────────────────────
  async function openCamera() {
    setCamError('')
    setState('camera')
    try {
      // Try rear camera first (mobile), fall back to any camera (desktop)
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
      } catch {
        // facingMode constraint failed (desktop) — try without it
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
      }
    } catch (err: any) {
      setCamError(
        err.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera access in your browser and try again.'
          : err.name === 'NotFoundError'
          ? 'No camera found on this device.'
          : `Camera error: ${err.message}`
      )
      setState('idle')
    }
  }

  // ── Capture frame from live video ─────────────────────────
  function captureFrame() {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    canvas.width  = video.videoWidth  || 1280
    canvas.height = video.videoHeight || 720
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)

    canvas.toBlob(blob => {
      if (!blob) return
      const file = new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' })
      stopCamera()
      setState('idle')
      processFile(file)
    }, 'image/jpeg', 0.92)
  }

  function cancelCamera() {
    stopCamera()
    setState('idle')
    setCamError('')
  }

  // ── Process image file → OCR API ─────────────────────────
  async function processFile(file: File, forceEndpoint?: string) {
    setState('uploading')
    setError('')
    setResult(null)

    const reader = new FileReader()
    reader.onload = e => setPreview(e.target?.result as string)
    reader.readAsDataURL(file)

    setState('processing')

    // ── Scanned PDF handling ──────────────────────────────
    // If a PDF is uploaded, we try two strategies:
    // 1. Send directly to /api/ocr → /api/parse-pdf tries AcroForm fields + text extraction
    // 2. If that fails with "no text layer", render the PDF page to PNG in the
    //    browser (pdfjs-dist + canvas) and send the PNG to /api/ocr for vision OCR.
    setIsPDF(file.type === 'application/pdf')
    let fileToSend = file
    if (file.type === 'application/pdf') {
      // Render PDF page to PNG in browser (works for scanned + typed PDFs)
      try {
        const pngFile = await pdfToPngFile(file)
        if (pngFile) {
          fileToSend = pngFile
          const previewUrl = URL.createObjectURL(pngFile)
          setPreview(previewUrl)
        } else {
          // pdfToPngFile returned null — PDF could not be rendered
          // This happens with encrypted PDFs or corrupted files
          // Show clear actionable error instead of sending unusable PDF to server
          setState('error')
          setError(
            'Could not render this PDF. ' +
            'Please photograph the paper form with your camera (use the Camera button) ' +
            'or open the PDF on your phone and take a screenshot, then upload the image.'
          )
          return
        }
      } catch (renderErr: any) {
        setState('error')
        setError(
          'PDF rendering failed: ' + (renderErr?.message || 'Unknown error') +
          '. Please photograph the form and upload as JPG.'
        )
        return
      }
    }

    const fd = new FormData()
    fd.append('image', fileToSend)
    fd.append('form_type', formType)
    fd.append('lang', 'eng')  // 'eng+guj' for Gujarati support

    try {
      // Use /api/ocr for all files — scanned PDFs are now pre-rendered to PNG
      const endpoint = forceEndpoint ?? (ocrMode === 'free' && fileToSend.type !== 'application/pdf' ? '/api/ocr-free' : '/api/ocr')
      const res  = await fetch(endpoint, { method: 'POST', body: fd })
      const data = await res.json()
      // Always check for error in body (API returns 200 even on errors to avoid browser noise)
      if (data.error) throw new Error(data.error)
      if (!res.ok)    throw new Error(`Server error ${res.status}`)
      const ocrData: OCRResult = data
      setResult(ocrData)
      setState('done')
      onExtracted(ocrData)
      setShowPanel(true)
    } catch (err: any) {
      setState('error')
      setError(err.message || 'Could not read the image. Please try again.')
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      // PDFs must use /api/ocr (AI endpoint) — Tesseract cannot process PDFs
      // Pass endpoint explicitly to avoid React state async race condition
      const ep = file.type === 'application/pdf' ? '/api/ocr' : undefined
      if (file.type === 'application/pdf') setOcrMode('ai')  // sync UI toggle
      processFile(file, ep)
    }
    e.target.value = ''
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) {
      const ep = file.type === 'application/pdf' ? '/api/ocr' : undefined
      if (file.type === 'application/pdf') setOcrMode('ai')
      processFile(file, ep)
    }
  }, [])

  function reset() {
    stopCamera()
    setState('idle')
    setError('')
    setResult(null)
    setPreview('')
    setShowPanel(false)
    setShowRaw(false)
    setCamError('')
    setIsPDF(false)
  }

  function ConfBadge({ c }: { c: string }) {
    const map: Record<string, string> = {
      high:   'bg-green-100 text-green-800',
      medium: 'bg-yellow-100 text-yellow-700',
      low:    'bg-red-100 text-red-700',
    }
    return (
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[c] || 'bg-gray-100 text-gray-600'}`}>
        {c.charAt(0).toUpperCase() + c.slice(1)} confidence
      </span>
    )
  }

  function FieldList({ data }: { data: Record<string, any> }) {
    const entries = Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== '')
    if (!entries.length) return <p className="text-xs text-gray-400 italic">No fields extracted</p>
    return (
      <div className="space-y-1">
        {entries.map(([k, v]) => (
          <div key={k} className="flex gap-2 text-xs">
            <span className="text-gray-400 font-mono min-w-[140px] flex-shrink-0">{k.replace(/_/g, ' ')}:</span>
            <span className="text-gray-800 font-medium break-all">
              {typeof v === 'object' ? JSON.stringify(v) : String(v)}
            </span>
          </div>
        ))}
      </div>
    )
  }

  // ── CAMERA VIEW ───────────────────────────────────────────
  if (state === 'camera') {
    return (
      <div className={`rounded-xl border-2 border-blue-300 bg-blue-50 ${className}`}>
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-blue-800">
              📷 Live Camera — point at form and click Capture
            </p>
            <button type="button" onClick={cancelCamera}
              className="text-gray-400 hover:text-red-500 p-1">
              <X className="w-4 h-4"/>
            </button>
          </div>

          {camError ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
              {camError}
            </div>
          ) : (
            <>
              {/* Live video feed */}
              <div className="relative bg-black rounded-lg overflow-hidden mb-3"
                style={{ aspectRatio: '16/9', maxHeight: '320px' }}>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {/* Alignment guide overlay */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="border-2 border-white/60 rounded-lg"
                    style={{ width:'80%', height:'80%' }}/>
                </div>
              </div>

              {/* Hidden canvas for frame capture */}
              <canvas ref={canvasRef} className="hidden"/>

              <div className="flex gap-3 justify-center">
                <button type="button" onClick={captureFrame}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors">
                  <Camera className="w-4 h-4"/> Capture Photo
                </button>
                <button type="button" onClick={cancelCamera}
                  className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 font-medium px-4 py-2.5 rounded-lg hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
              </div>
              <p className="text-xs text-center text-blue-600 mt-2">
                Hold the form steady inside the frame, then click Capture
              </p>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`rounded-xl border-2 border-dashed transition-all ${className}
        ${state === 'idle'                                 ? 'border-blue-200 bg-blue-50/40 hover:border-blue-400 hover:bg-blue-50' : ''}
        ${state === 'processing' || state === 'uploading' ? 'border-blue-300 bg-blue-50'     : ''}
        ${state === 'done'                                 ? 'border-green-300 bg-green-50/40' : ''}
        ${state === 'error'                                ? 'border-red-300 bg-red-50/40'    : ''}
      `}
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
    >
      {/*
        Hidden file input for gallery/file upload.
        Triggered via label htmlFor — works on all platforms.
        No capture attribute here (gallery only).
      */}
      <input
        id={fileId}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
        onChange={handleFileChange}
        style={{ position:'absolute', width:1, height:1, opacity:0, pointerEvents:'none' }}
      />

      <div className="p-4">

        {/* ── IDLE ── */}
        {state === 'idle' && (
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <ScanLine className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-blue-800">{label}</p>
              <p className="text-xs text-blue-500 mt-0.5">
                Tap <strong>Camera</strong> for live webcam, or <strong>Upload</strong> to choose a JPG, PNG, or <strong>PDF</strong> file
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              {/*
                Upload: label triggers hidden file input (gallery)
              */}
              <label htmlFor={fileId}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors cursor-pointer select-none">
                <Upload className="w-3.5 h-3.5" /> Upload
              </label>

              {/*
                Camera: uses getUserMedia to open the actual camera.
                Works on desktop (webcam) and mobile (rear camera).
                No file input needed — we capture directly from video stream.
              */}
              <button type="button" onClick={openCamera}
                className="flex items-center gap-1.5 bg-white hover:bg-blue-50 text-blue-700 text-xs font-semibold px-3 py-2 rounded-lg border border-blue-200 transition-colors select-none">
                <Camera className="w-3.5 h-3.5" /> Camera
              </button>
            </div>
          </div>
        )}

        {/* ── UPLOADING / PROCESSING ── */}
        {(state === 'uploading' || state === 'processing') && (
          <div className="flex items-center gap-4">
            {preview && (
              <img src={preview} alt="Scanning"
                className="w-14 h-14 object-cover rounded-lg border border-blue-200 flex-shrink-0" />
            )}
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                <span className="text-sm font-semibold text-blue-800">
                  {state === 'uploading' ? 'Preparing image...' : 'Reading form with AI...'}
                </span>
              </div>
              <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full animate-scanner" />
              </div>
              <p className="text-xs text-blue-500 mt-1">
                {state === 'processing'
                  ? (isPDF ? 'Rendering PDF page, then reading with AI...' : 'Claude Vision is detecting Gujarati and English text...')
                  : 'Loading image...'}
              </p>
            </div>
          </div>
        )}

        {/* ── DONE ── */}
        {state === 'done' && result && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              {preview && (
                <img src={preview} alt="Scanned"
                  className="w-12 h-12 object-cover rounded-lg border border-green-200 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                  <span className="text-sm font-semibold text-green-800">Form read successfully</span>
                  <ConfBadge c={result.confidence} />
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  Language: {result.language_detected} · Type: {result.form_type?.replace(/_/g, ' ')}
                </p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button type="button" onClick={() => setShowPanel(!showPanel)}
                  className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-700 px-2 py-1 rounded border border-gray-200 hover:border-blue-300 transition-colors">
                  <Eye className="w-3 h-3" />
                  {showPanel ? 'Hide' : 'Review'}
                  {showPanel ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                <button type="button" onClick={reset}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 px-2 py-1 rounded border border-gray-200 hover:border-red-300 transition-colors">
                  <RefreshCw className="w-3 h-3" /> Rescan
                </button>
              </div>
            </div>

            {showPanel && (
              <div className="border border-green-200 rounded-lg bg-white p-4 mt-2 space-y-3">
                <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">
                  Extracted Fields — review before saving
                </p>
                {result.patient && Object.keys(result.patient).length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-blue-700 mb-1">Patient Details</p>
                    <FieldList data={result.patient} />
                  </div>
                )}
                {result.vitals && Object.keys(result.vitals).length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-blue-700 mb-1">Vitals &amp; Consultation</p>
                    <FieldList data={result.vitals} />
                  </div>
                )}
                {result.ob_data && Object.keys(result.ob_data).length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-blue-700 mb-1">Obstetric / Gynae</p>
                    <FieldList data={result.ob_data} />
                  </div>
                )}
                {result.lab && Object.keys(result.lab).length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-blue-700 mb-1">Lab Results</p>
                    <FieldList data={result.lab} />
                  </div>
                )}
                {result.prescription && (
                  <div>
                    <p className="text-xs font-semibold text-blue-700 mb-1">Prescription</p>
                    {result.prescription.medications?.map((m, i) => (
                      <div key={i} className="text-xs text-gray-700 ml-2">
                        {i + 1}. {m.drug}{m.dose && ` — ${m.dose}`}{m.frequency && ` · ${m.frequency}`}{m.duration && ` · ${m.duration}`}
                      </div>
                    ))}
                  </div>
                )}
                {result.unrecognised_fields && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded p-2">
                    <p className="text-xs font-semibold text-yellow-700 mb-1">⚠️ Unrecognised Text</p>
                    <p className="text-xs text-yellow-700">{result.unrecognised_fields}</p>
                  </div>
                )}
                <button type="button" onClick={() => setShowRaw(!showRaw)}
                  className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                  {showRaw ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {showRaw ? 'Hide raw text' : 'Show raw OCR text'}
                </button>
                {showRaw && (
                  <div className="bg-gray-50 border border-gray-200 rounded p-3 max-h-32 overflow-y-auto">
                    <pre className="text-xs text-gray-600 whitespace-pre-wrap">{result.raw_text}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── ERROR ── */}
        {state === 'error' && (
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-5 h-5 text-red-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-700">Could not read form</p>
                <p className="text-xs text-red-500 mt-0.5">{error}</p>
              </div>
              <button type="button" onClick={reset}
                className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
                <RefreshCw className="w-3.5 h-3.5" /> Try Again
              </button>
            </div>
            {/* If it's an API key issue, show setup instructions */}
            {(error.includes('SCANNED_PDF') || error.includes('photograph') || error.includes('camera')) && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
                <p className="font-semibold mb-1">📸 Use Camera instead</p>
                <p>This PDF is a scanned image with no text layer. Click the <strong>Camera</strong> button above to photograph the paper form directly.</p>
              </div>
            )}
            {(error.includes('AI key') || error.includes('ANTHROPIC') || error.includes('OpenAI') || error.includes('configured') || error.includes('OPENAI')) && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                <p className="font-semibold mb-1">Setup required: AI key not configured</p>
                <p>Go to <strong>Vercel → Project → Settings → Environment Variables</strong> and add <code className="bg-amber-100 px-1 rounded">OPENAI_API_KEY</code> or <code className="bg-amber-100 px-1 rounded">ANTHROPIC_API_KEY</code>, then redeploy.</p>
                <a href="/ai-setup" className="underline font-semibold">Check AI Status →</a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
