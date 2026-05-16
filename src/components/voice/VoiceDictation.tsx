'use client'
/**
 * src/components/voice/VoiceDictation.tsx
 *
 * Voice-to-Notes (Dictation) Component
 *
 * Doctor speaks during consultation → real-time transcription fills a target textarea.
 * This is SEPARATE from VoiceAssistant (which handles commands).
 *
 * Features:
 *   - Toggle button (enable/disable) per textarea
 *   - Real-time interim results shown in gray
 *   - Final results appended to the target value
 *   - Auto-punctuation hints (pause detection)
 *   - Language: en-IN (Indian English, best for medical terms)
 *   - Keyboard shortcut: Alt+D to toggle dictation
 *   - Persists enabled/disabled preference in localStorage
 *
 * Usage in any form:
 *   <VoiceDictation
 *     value={notes}
 *     onChange={setNotes}
 *     placeholder="Speak your clinical notes..."
 *   />
 *
 * Or as a floating toggle button that fills a target ref:
 *   <DictationToggle targetRef={textareaRef} onTranscript={text => setNotes(prev => prev + text)} />
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Pause, Type } from 'lucide-react'

// ── Dictation Textarea Component ──────────────────────────────
// Full replacement for <textarea> with built-in dictation toggle

interface VoiceDictationProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  rows?: number
  label?: string
  disabled?: boolean
}

export default function VoiceDictation({
  value,
  onChange,
  placeholder = 'Type or dictate clinical notes...',
  className = '',
  rows = 4,
  label,
  disabled = false,
}: VoiceDictationProps) {
  const [isListening, setIsListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [enabled, setEnabled] = useState(false) // Dictation feature toggle
  const recogRef = useRef<any>(null)
  const valueRef = useRef(value)

  // Keep valueRef in sync
  useEffect(() => { valueRef.current = value }, [value])

  // Load preference from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    const pref = localStorage.getItem('nexmedicon_dictation_enabled')
    if (pref === 'true') setEnabled(true)
  }, [])

  // Toggle the feature on/off
  function toggleFeature() {
    const next = !enabled
    setEnabled(next)
    localStorage.setItem('nexmedicon_dictation_enabled', String(next))
    if (!next && isListening) stopDictation()
  }

  // Check browser support
  function hasSpeechRecognition(): boolean {
    return !!(
      typeof window !== 'undefined' &&
      ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    )
  }

  // Start dictation
  const startDictation = useCallback(() => {
    if (!hasSpeechRecognition()) return
    if (recogRef.current) return // Already running

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const recognition = new SR()

    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-IN' // Indian English — best for medical terminology
    recognition.maxAlternatives = 1

    recognition.onresult = (event: any) => {
      let interimText = ''
      let finalText = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalText += transcript
        } else {
          interimText += transcript
        }
      }

      setInterim(interimText)

      if (finalText) {
        // Append final text with auto-spacing
        const current = valueRef.current
        const separator = current && !current.endsWith(' ') && !current.endsWith('\n') ? ' ' : ''
        const newValue = current + separator + finalText.trim()
        onChange(newValue)
        setInterim('')
      }
    }

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') return // Ignore silence
      console.warn('[Dictation] Error:', event.error)
      if (event.error === 'not-allowed') {
        setIsListening(false)
        recogRef.current = null
      }
    }

    recognition.onend = () => {
      // Auto-restart if still in listening mode (handles Chrome's 60s limit)
      if (isListening && recogRef.current) {
        try { recognition.start() } catch { /* ignore */ }
      }
    }

    try {
      recognition.start()
      recogRef.current = recognition
      setIsListening(true)
    } catch (e) {
      console.error('[Dictation] Start failed:', e)
    }
  }, [isListening, onChange])

  // Stop dictation
  function stopDictation() {
    if (recogRef.current) {
      try { recogRef.current.stop() } catch { /* ignore */ }
      recogRef.current = null
    }
    setIsListening(false)
    setInterim('')
  }

  // Toggle dictation
  function toggleDictation() {
    if (isListening) stopDictation()
    else startDictation()
  }

  // Keyboard shortcut: Alt+D
  useEffect(() => {
    if (!enabled) return
    function onKey(e: KeyboardEvent) {
      if (e.altKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        toggleDictation()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, isListening, startDictation])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recogRef.current) {
        try { recogRef.current.stop() } catch { /* ignore */ }
      }
    }
  }, [])

  const showDictation = enabled && hasSpeechRecognition()

  return (
    <div className="relative">
      {/* Label + Feature Toggle */}
      {label && (
        <div className="flex items-center justify-between mb-1.5">
          <label className="label mb-0">{label}</label>
          <button
            type="button"
            onClick={toggleFeature}
            className={`flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-full border transition-all ${
              enabled
                ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
                : 'bg-gray-50 border-gray-200 text-gray-400 hover:border-gray-300'
            }`}
            title={enabled ? 'Dictation enabled (Alt+D to toggle mic)' : 'Click to enable voice dictation'}
          >
            {enabled ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
            {enabled ? 'Dictation ON' : 'Dictation OFF'}
          </button>
        </div>
      )}

      {/* Textarea */}
      <div className="relative">
        <textarea
          className={`input resize-y ${className} ${isListening ? 'ring-2 ring-red-300 border-red-300' : ''}`}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
        />

        {/* Interim text overlay */}
        {interim && (
          <div className="absolute bottom-2 left-3 right-12 text-xs text-gray-400 italic truncate pointer-events-none">
            {interim}...
          </div>
        )}

        {/* Dictation mic button (inside textarea) */}
        {showDictation && (
          <button
            type="button"
            onClick={toggleDictation}
            disabled={disabled}
            className={`absolute bottom-2 right-2 w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-sm ${
              isListening
                ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
                : 'bg-gray-100 hover:bg-blue-100 text-gray-500 hover:text-blue-600 border border-gray-200'
            }`}
            title={isListening ? 'Stop dictation (Alt+D)' : 'Start dictation (Alt+D)'}
          >
            {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* Status bar */}
      {showDictation && isListening && (
        <div className="flex items-center gap-2 mt-1.5 text-xs text-red-600">
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          Listening... Speak clearly. Press Alt+D or click mic to stop.
        </div>
      )}

      {/* First-time hint */}
      {!label && enabled && !isListening && (
        <div className="text-[10px] text-gray-400 mt-1">
          <kbd className="bg-gray-100 border border-gray-200 rounded px-1 py-0.5 font-mono">Alt</kbd>+
          <kbd className="bg-gray-100 border border-gray-200 rounded px-1 py-0.5 font-mono">D</kbd> to start dictation
        </div>
      )}
    </div>
  )
}

// ── Standalone Toggle Button ──────────────────────────────────
// For use alongside existing textareas without replacing them

interface DictationToggleProps {
  onTranscript: (text: string) => void
  className?: string
}

export function DictationToggle({ onTranscript, className = '' }: DictationToggleProps) {
  const [isListening, setIsListening] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const recogRef = useRef<any>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const pref = localStorage.getItem('nexmedicon_dictation_enabled')
    if (pref === 'true') setEnabled(true)
  }, [])

  function hasSR(): boolean {
    return !!(typeof window !== 'undefined' &&
      ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition))
  }

  function toggle() {
    if (!enabled) {
      setEnabled(true)
      localStorage.setItem('nexmedicon_dictation_enabled', 'true')
      return
    }
    if (isListening) stop()
    else start()
  }

  function start() {
    if (!hasSR() || recogRef.current) return
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const r = new SR()
    r.continuous = true
    r.interimResults = false
    r.lang = 'en-IN'

    r.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          onTranscript(e.results[i][0].transcript)
        }
      }
    }
    r.onerror = () => {}
    r.onend = () => {
      if (isListening && recogRef.current) {
        try { r.start() } catch { /* ignore */ }
      }
    }

    r.start()
    recogRef.current = r
    setIsListening(true)
  }

  function stop() {
    if (recogRef.current) {
      try { recogRef.current.stop() } catch { /* ignore */ }
      recogRef.current = null
    }
    setIsListening(false)
  }

  useEffect(() => () => { if (recogRef.current) try { recogRef.current.stop() } catch {} }, [])

  if (!hasSR()) return null

  return (
    <button
      type="button"
      onClick={toggle}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
        isListening
          ? 'bg-red-50 border-red-300 text-red-700 animate-pulse'
          : enabled
          ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
          : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-blue-200 hover:text-blue-600'
      } ${className}`}
      title={isListening ? 'Stop dictation' : enabled ? 'Start dictation' : 'Enable dictation'}
    >
      {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
      {isListening ? 'Stop' : enabled ? 'Dictate' : 'Enable Dictation'}
    </button>
  )
}
