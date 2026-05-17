'use client'
/**
 * src/components/shared/AadhaarScanner.tsx
 *
 * Aadhaar Card Photo Scanner.
 * When staff captures an Aadhaar card photo:
 *  1. Uses Tesseract.js to extract text from the image
 *  2. Parses the text using aadhaar-ocr.ts
 *  3. Auto-fills patient registration fields
 *
 * Usage:
 *   <AadhaarScanner onExtracted={(data) => fillForm(data)} />
 */

import { useState, useCallback } from 'react'
import CameraUpload from './CameraUpload'
import { parseAadhaarText, type AadhaarData } from '@/lib/aadhaar-ocr'
import { useToast } from './Toast'
import { CreditCard, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react'

interface AadhaarScannerProps {
  onExtracted: (data: AadhaarData) => void
  className?: string
}

export default function AadhaarScanner({ onExtracted, className = '' }: AadhaarScannerProps) {
  const { showSuccess, showWarning, showError } = useToast()
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<AadhaarData | null>(null)

  const handleCapture = useCallback(async (file: File) => {
    setProcessing(true)
    setResult(null)

    try {
      // Use Tesseract.js for OCR
      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker('eng+hin')

      // Convert file to data URL for Tesseract
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      const { data: { text } } = await worker.recognize(dataUrl)
      await worker.terminate()

      if (!text || text.trim().length < 10) {
        showWarning('Could not read the Aadhaar card. Please try again with better lighting.')
        setProcessing(false)
        return
      }

      // Parse the extracted text
      const aadhaarData = parseAadhaarText(text)
      setResult(aadhaarData)

      if (aadhaarData.confidence === 'high' || aadhaarData.confidence === 'medium') {
        showSuccess(`Aadhaar details extracted (${aadhaarData.confidence} confidence)`)
        onExtracted(aadhaarData)
      } else {
        showWarning('Low confidence extraction. Please verify the details manually.')
        onExtracted(aadhaarData)
      }
    } catch (err: any) {
      console.error('[AadhaarScanner] error:', err)
      showError('Failed to process Aadhaar card: ' + err.message)
    } finally {
      setProcessing(false)
    }
  }, [onExtracted, showSuccess, showWarning, showError])

  return (
    <div className={`${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <CreditCard className="w-4 h-4 text-blue-600" />
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
          Scan Aadhaar Card
        </span>
        {result && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            result.confidence === 'high' ? 'bg-green-100 text-green-700' :
            result.confidence === 'medium' ? 'bg-amber-100 text-amber-700' :
            'bg-red-100 text-red-700'
          }`}>
            {result.confidence} confidence
          </span>
        )}
      </div>

      {processing ? (
        <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
          <div>
            <p className="text-sm font-medium text-blue-800">Reading Aadhaar card...</p>
            <p className="text-xs text-blue-600">Extracting name, DOB, gender, and address</p>
          </div>
        </div>
      ) : (
        <CameraUpload
          onCapture={handleCapture}
          label="Capture Aadhaar Card (Front or Back)"
          accept="image/*"
        />
      )}

      {/* Show extracted data preview */}
      {result && !processing && (
        <div className="mt-3 bg-green-50 border border-green-200 rounded-xl p-3 space-y-1.5">
          <p className="text-xs font-semibold text-green-800 flex items-center gap-1">
            <CheckCircle className="w-3.5 h-3.5" /> Extracted Details
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {result.full_name && (
              <div><span className="text-gray-500">Name:</span> <span className="font-medium">{result.full_name}</span></div>
            )}
            {result.date_of_birth && (
              <div><span className="text-gray-500">DOB:</span> <span className="font-medium">{result.date_of_birth}</span></div>
            )}
            {result.age && (
              <div><span className="text-gray-500">Age:</span> <span className="font-medium">{result.age} years</span></div>
            )}
            {result.gender && (
              <div><span className="text-gray-500">Gender:</span> <span className="font-medium">{result.gender}</span></div>
            )}
            {result.aadhaar_no && (
              <div><span className="text-gray-500">Aadhaar:</span> <span className="font-mono font-medium">{result.aadhaar_no}</span></div>
            )}
            {result.address && (
              <div className="col-span-2"><span className="text-gray-500">Address:</span> <span className="font-medium">{result.address}</span></div>
            )}
          </div>
          {result.confidence === 'low' && (
            <p className="text-[10px] text-amber-700 flex items-center gap-1 mt-2">
              <AlertTriangle className="w-3 h-3" />
              Low confidence — please verify details above before saving
            </p>
          )}
        </div>
      )}
    </div>
  )
}
