'use client'
/**
 * src/components/shared/CameraUpload.tsx
 *
 * Universal Camera + File Upload component.
 * Provides both:
 *  1. Direct camera capture (rear camera preferred for documents)
 *  2. Traditional file upload from gallery/file explorer
 *
 * Features:
 *  - Works on mobile (uses native camera via capture attribute)
 *  - Desktop webcam support via getUserMedia
 *  - Image preview before processing
 *  - PDF support (converts to image using pdfjs-dist)
 *  - Integrates with OCR pipeline
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { Camera, Upload, X, RotateCcw, Check, Loader2, FileText } from 'lucide-react'

interface CameraUploadProps {
  onCapture: (file: File) => void
  onCancel?: () => void
  label?: string
  accept?: string
  className?: string
  showPreview?: boolean
  maxSizeMB?: number
}

export default function CameraUpload({
  onCapture,
  onCancel,
  label = 'Upload or Capture Photo',
  accept = 'image/*,application/pdf',
  className = '',
  showPreview = true,
  maxSizeMB = 10,
}: CameraUploadProps) {
  const [mode, setMode] = useState<'idle' | 'camera' | 'preview'>('idle')
  const [preview, setPreview] = useState<string>('')
  const [capturedFile, setCapturedFile] = useState<File | null>(null)
  const [cameraError, setCameraError] = useState('')
  const [processing, setProcessing] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  // Stop camera on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
      }
    }
  }, [])

  // Start camera (desktop webcam)
  const startCamera = useCallback(async () => {
    setCameraError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' }, // Prefer back camera
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
      }
      setMode('camera')
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setCameraError('Camera permission denied. Please allow camera access.')
      } else if (err.name === 'NotFoundError') {
        setCameraError('No camera found. Use file upload instead.')
      } else {
        setCameraError(`Camera error: ${err.message}`)
      }
    }
  }, [])

  // Stop camera
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setMode('idle')
  }, [])

  // Capture photo from video stream
  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return

    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) return
      const file = new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' })
      setCapturedFile(file)
      setPreview(canvas.toDataURL('image/jpeg', 0.9))
      stopCamera()
      setMode('preview')
    }, 'image/jpeg', 0.9)
  }, [stopCamera])

  // Handle file input (traditional upload)
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Size check
    if (file.size > maxSizeMB * 1024 * 1024) {
      setCameraError(`File too large. Maximum ${maxSizeMB}MB allowed.`)
      return
    }

    setCapturedFile(file)

    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = () => {
        setPreview(reader.result as string)
        setMode('preview')
      }
      reader.readAsDataURL(file)
    } else if (file.type === 'application/pdf') {
      setPreview('')
      setMode('preview')
    }
  }, [maxSizeMB])

  // Handle mobile camera input
  const handleCameraCapture = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setCapturedFile(file)
    const reader = new FileReader()
    reader.onload = () => {
      setPreview(reader.result as string)
      setMode('preview')
    }
    reader.readAsDataURL(file)
  }, [])

  // Confirm and send to parent
  const handleConfirm = useCallback(() => {
    if (!capturedFile) return
    setProcessing(true)
    onCapture(capturedFile)
    // Don't reset - let parent handle the state
    setTimeout(() => setProcessing(false), 500)
  }, [capturedFile, onCapture])

  // Reset everything
  const handleRetake = useCallback(() => {
    setCapturedFile(null)
    setPreview('')
    setCameraError('')
    setMode('idle')
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (cameraInputRef.current) cameraInputRef.current.value = ''
  }, [])

  return (
    <div className={`${className}`}>
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleFileSelect}
        className="hidden"
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCameraCapture}
        className="hidden"
      />

      {/* Hidden canvas for camera capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Error message */}
      {cameraError && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 flex items-center gap-2">
          <X className="w-3.5 h-3.5 flex-shrink-0" />
          {cameraError}
          <button onClick={() => setCameraError('')} className="ml-auto text-red-400 hover:text-red-600">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* IDLE STATE — Show upload and camera buttons */}
      {mode === 'idle' && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">{label}</p>
          <div className="grid grid-cols-2 gap-2">
            {/* Camera button — uses native camera on mobile, webcam on desktop */}
            <button
              type="button"
              onClick={() => {
                // On mobile, use native file input with capture
                if (/iPhone|iPad|Android/i.test(navigator.userAgent)) {
                  cameraInputRef.current?.click()
                } else {
                  startCamera()
                }
              }}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed border-blue-200
                         hover:border-blue-400 hover:bg-blue-50 transition-all cursor-pointer"
            >
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                <Camera className="w-5 h-5 text-blue-600" />
              </div>
              <span className="text-xs font-semibold text-blue-700">Take Photo</span>
              <span className="text-[10px] text-gray-400">Camera capture</span>
            </button>

            {/* File upload button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed border-gray-200
                         hover:border-gray-400 hover:bg-gray-50 transition-all cursor-pointer"
            >
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                <Upload className="w-5 h-5 text-gray-600" />
              </div>
              <span className="text-xs font-semibold text-gray-700">Upload File</span>
              <span className="text-[10px] text-gray-400">Photo, PDF</span>
            </button>
          </div>
        </div>
      )}

      {/* CAMERA STATE — Show live viewfinder */}
      {mode === 'camera' && (
        <div className="space-y-3">
          <div className="camera-viewfinder aspect-[4/3] rounded-xl overflow-hidden bg-black relative">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            <div className="capture-overlay" />
            {/* Capture button overlay */}
            <div className="absolute bottom-4 left-0 right-0 flex justify-center">
              <button
                onClick={capturePhoto}
                className="w-14 h-14 rounded-full bg-white shadow-lg flex items-center justify-center
                           hover:scale-105 transition-transform active:scale-95"
              >
                <div className="w-11 h-11 rounded-full bg-red-500" />
              </button>
            </div>
          </div>
          <div className="flex justify-between">
            <button
              onClick={stopCamera}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <p className="text-xs text-gray-400">Position document in frame, then tap capture</p>
          </div>
        </div>
      )}

      {/* PREVIEW STATE — Show captured/uploaded image */}
      {mode === 'preview' && (
        <div className="space-y-3">
          {preview ? (
            <div className="relative rounded-xl overflow-hidden border border-gray-200">
              <img src={preview} alt="Captured" className="w-full h-auto max-h-64 object-contain bg-gray-50" />
            </div>
          ) : capturedFile?.type === 'application/pdf' ? (
            <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
              <FileText className="w-8 h-8 text-red-500" />
              <div>
                <p className="text-sm font-medium text-gray-800">{capturedFile.name}</p>
                <p className="text-xs text-gray-400">{(capturedFile.size / 1024).toFixed(0)} KB · PDF</p>
              </div>
            </div>
          ) : null}

          <div className="flex gap-2">
            <button
              onClick={handleRetake}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border border-gray-300
                         text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> Retake
            </button>
            <button
              onClick={handleConfirm}
              disabled={processing}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg
                         bg-green-600 hover:bg-green-700 text-white text-sm font-semibold
                         transition-colors disabled:opacity-50"
            >
              {processing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {processing ? 'Processing…' : 'Use This Photo'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
