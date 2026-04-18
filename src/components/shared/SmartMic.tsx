'use client'
import { useRef, useState } from 'react'
import { Mic, MicOff, Loader2 } from 'lucide-react'

/**
 * SmartMic — AI-powered voice input button
 *
 * How it works:
 *  1. User clicks → browser Web Speech API starts listening
 *  2. Interim results stream directly into the field (instant feedback)
 *  3. When user clicks again (stop) → final raw transcript is sent to
 *     /api/voice-correct which uses Claude to fix medical terminology errors
 *  4. Corrected text replaces the raw transcript in the field
 *
 * Props:
 *  field       — identifier string (used as recognition key + context hint for AI)
 *  value       — current field value (appended to, not replaced)
 *  onChange    — called with updated string on every change
 *  context     — optional human-readable hint e.g. "Per Abdomen findings"
 *                sent to Claude so it knows what kind of text to expect
 *  size        — 'sm' | 'md' (default 'sm')
 *  disabled    — prevents activation
 */

interface SmartMicProps {
  field: string
  value: string
  onChange: (v: string) => void
  context?: string
  size?: 'sm' | 'md'
  disabled?: boolean
}

// Module-level map so only one field listens at a time across the whole page
let activeField: string | null = null
let activeRecognition: any     = null

export default function SmartMic({
  field,
  value,
  onChange,
  context,
  size = 'sm',
  disabled = false,
}: SmartMicProps) {
  const [state, setState] = useState<'idle' | 'listening' | 'correcting'>('idle')
  const baseTextRef  = useRef('')   // text in field when recording started
  const rawFinalRef  = useRef('')   // accumulated final STT result

  const isListening  = state === 'listening'
  const isCorrecting = state === 'correcting'
  const isActive     = isListening || isCorrecting

  function getSpeechRecognition() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      alert('Voice input requires Chrome or Edge browser.')
      return null
    }
    return SR
  }

  async function correctWithAI(rawText: string): Promise<string> {
    if (!rawText.trim()) return rawText
    try {
      const res = await fetch('/api/voice-correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: rawText, context: context || field }),
      })
      if (!res.ok) return rawText
      const data = await res.json()
      return data.corrected || rawText
    } catch {
      return rawText   // on network error, use raw text
    }
  }

  async function stopListening() {
    // Stop the recognition
    if (activeRecognition) {
      activeRecognition.stop()
      activeRecognition = null
    }
    activeField = null

    const rawFinal = rawFinalRef.current.trim()

    if (!rawFinal) {
      // Nothing was said — restore base text
      onChange(baseTextRef.current)
      setState('idle')
      return
    }

    // Show correcting spinner
    setState('correcting')

    const corrected = await correctWithAI(rawFinal)

    // Compose: base text (what was there before) + corrected new text
    const separator = baseTextRef.current.trim() ? ' ' : ''
    onChange(baseTextRef.current + separator + corrected)

    setState('idle')
  }

  function startListening() {
    const SR = getSpeechRecognition()
    if (!SR || disabled) return

    // Stop any currently active recognition on another field
    if (activeRecognition) {
      activeRecognition.stop()
      activeRecognition = null
    }

    const r = new SR()
    r.continuous      = true
    r.interimResults  = true
    r.lang            = 'en-IN'   // Indian English — better for Indian medical terms

    activeField      = field
    activeRecognition = r
    baseTextRef.current  = value  // save what was already in the field
    rawFinalRef.current  = ''     // reset accumulated transcript

    r.onresult = (e: any) => {
      let interimText = ''
      let finalSegment = ''

      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalSegment += e.results[i][0].transcript
        } else {
          interimText += e.results[i][0].transcript
        }
      }

      if (finalSegment) rawFinalRef.current += finalSegment

      // Show live interim preview in the field (not yet AI-corrected)
      const separator = baseTextRef.current.trim() ? ' ' : ''
      const liveText  = baseTextRef.current + separator +
                        rawFinalRef.current + interimText
      onChange(liveText)
    }

    r.onerror = (e: any) => {
      if (e.error === 'no-speech') return   // ignore no-speech, keep listening
      activeField       = null
      activeRecognition = null
      // Restore base on error
      onChange(baseTextRef.current)
      setState('idle')
    }

    r.onend = () => {
      // onend fires after .stop() — but we handle state in stopListening()
      // It can also fire unexpectedly (e.g. silence timeout)
      if (activeField === field) {
        // Unexpected end — treat as user stop
        activeField = null
        const rawFinal = rawFinalRef.current.trim()
        if (rawFinal) {
          setState('correcting')
          correctWithAI(rawFinal).then(corrected => {
            const sep = baseTextRef.current.trim() ? ' ' : ''
            onChange(baseTextRef.current + sep + corrected)
            setState('idle')
          })
        } else {
          onChange(baseTextRef.current)
          setState('idle')
        }
      }
    }

    r.start()
    setState('listening')
  }

  function handleClick() {
    if (disabled) return
    if (isListening) stopListening()
    else if (!isCorrecting) startListening()
  }

  // ── Size variants ──────────────────────────────────────────
  const sizeMap = {
    sm: { btn: 'p-1.5 rounded-lg',  icon: 'w-3.5 h-3.5' },
    md: { btn: 'p-2   rounded-xl',  icon: 'w-4   h-4'   },
  }
  const sz = sizeMap[size]

  // ── Visual states ──────────────────────────────────────────
  let btnClass = `${sz.btn} transition-all flex items-center justify-center `
  let title    = 'Start voice input (AI-corrected)'

  if (disabled) {
    btnClass += 'opacity-30 cursor-not-allowed bg-gray-100 text-gray-400'
  } else if (isCorrecting) {
    btnClass += 'bg-purple-100 text-purple-600 cursor-wait'
    title     = 'Correcting with AI...'
  } else if (isListening) {
    btnClass += 'bg-red-100 text-red-600 ring-2 ring-red-300 ring-offset-1 animate-pulse'
    title     = 'Listening — click to stop and correct'
  } else {
    btnClass += 'bg-gray-100 text-gray-500 hover:bg-blue-100 hover:text-blue-600'
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || isCorrecting}
      title={title}
      className={btnClass}
    >
      {isCorrecting
        ? <Loader2 className={`${sz.icon} animate-spin`} />
        : isListening
        ? <MicOff className={sz.icon} />
        : <Mic    className={sz.icon} />}
    </button>
  )
}
