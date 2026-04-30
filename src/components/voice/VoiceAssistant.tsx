'use client'
/**
 * src/components/voice/VoiceAssistant.tsx — FIXED v2
 *
 * Errors fixed:
 *
 * ERROR 1: "Property 'length' does not exist on type 'unknown'"
 *   Cause: Object.entries(getCommandsByCategory()) returns [string, unknown][]
 *   in strict TypeScript because Object.entries<T>(o: T) resolves to
 *   [string, T[keyof T]][] — and when T has a union value type the compiler
 *   can widen to unknown in some configurations.
 *   Fix: extract entries with an explicit cast before the JSX:
 *     const categoryEntries = Object.entries(getCommandsByCategory())
 *       as [string, VoiceCommand[]][]
 *   Then type the map callback parameter explicitly.
 *
 * ERROR 2: executeIntent was a plain async function referenced inside the
 *   stopAndResolve useCallback, causing a missing-dep lint error and
 *   potential stale-closure in strict mode.
 *   Fix: executeIntent is now a useCallback too (stable — only depends on
 *   router and showToast, both of which are stable).
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Mic, MicOff, Loader2, X, HelpCircle } from 'lucide-react'
import {
  INTENT_ROUTES,
  INTENT_TABS,
  getCommandsByCategory,
  matchCommandOffline,
  type VoiceCommand,
} from '@/lib/voice-commands'
import { dispatchVoiceIntent } from './VoiceCommandBus'

type AssistantState = 'idle' | 'listening' | 'processing' | 'success' | 'error'
interface ToastMsg { text: string; type: 'success' | 'error' | 'info' }

export default function VoiceAssistant() {
  const router   = useRouter()
  const pathname = usePathname()

  // Refs for values used inside stable callbacks (avoids stale closures)
  const pathnameRef   = useRef<string>(pathname)
  const rawFinalRef   = useRef<string>('')
  const recogRef      = useRef<any>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stateRef      = useRef<AssistantState>('idle')

  const [state,    setState_]   = useState<AssistantState>('idle')
  const [toast,    setToast]    = useState<ToastMsg | null>(null)
  const [showHelp, setShowHelp] = useState<boolean>(false)

  // Keep pathname ref in sync with navigation changes
  useEffect(() => { pathnameRef.current = pathname }, [pathname])

  // Wrapper keeps both React state and the ref in sync
  function setState(s: AssistantState) {
    stateRef.current = s
    setState_(s)
  }

  // ── Toast helper — stable, reads nothing from React state ──────
  const showToast = useCallback(
    (text: string, type: ToastMsg['type'] = 'info', ms = 2500) => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      setToast({ text, type })
      toastTimerRef.current = setTimeout(() => setToast(null), ms)
    },
    [], // setToast is stable; toastTimerRef is a ref
  )

  // ── Execute resolved intent — stable useCallback ───────────────
  const executeIntent = useCallback(
    async (intent: string, param: string | null) => {

      // Utility
      if (intent === 'utility.stop') {
        showToast('Stopped', 'info', 1000)
        return
      }
      if (intent === 'utility.help') {
        setShowHelp(true)
        showToast('Showing commands', 'success')
        return
      }
      if (intent === 'utility.logout') {
        dispatchVoiceIntent(intent, null)
        return
      }
      if (intent === 'nav.back') {
        router.back()
        showToast('Going back', 'success')
        return
      }

      // Direct navigation
      const route = INTENT_ROUTES[intent]
      if (route) {
        router.push(route)
        showToast(
          `Opening ${intent.replace('nav.', '').replace(/_/g, ' ')}`,
          'success',
        )
        return
      }

      // Tab / section switching
      const tab = INTENT_TABS[intent]
      if (tab !== undefined || intent.startsWith('section.')) {
        dispatchVoiceIntent(intent, tab ?? param)
        showToast(
          `Switching to ${intent.replace('section.', '')} section`,
          'success',
        )
        return
      }

      // Prescription — read encounter ID from current URL
      if (intent === 'section.prescription') {
        const m = pathnameRef.current.match(/\/opd\/([^/]+)/)
        if (m) {
          router.push(`/opd/${m[1]}/prescription`)
          showToast('Opening prescription', 'success')
          return
        }
        dispatchVoiceIntent(intent, null)
        return
      }

      // Discharge — read patient ID from current URL
      if (intent === 'section.discharge') {
        const m = pathnameRef.current.match(/\/patients\/([^/]+)/)
        if (m) {
          router.push(`/patients/${m[1]}/discharge`)
          showToast('Opening discharge', 'success')
          return
        }
        dispatchVoiceIntent(intent, null)
        return
      }

      // All other page actions — forward to page listeners
      dispatchVoiceIntent(intent, param)

      const labels: Record<string, string> = {
        'action.print':            'Printing…',
        'action.save':             'Saving…',
        'action.add_medicine':     'Adding medicine',
        'action.remove_medicine':  'Removing medicine',
        'action.send_whatsapp':    'Opening WhatsApp',
        'action.book_appointment': 'Booking appointment',
        'action.refresh':          'Refreshing…',
        'action.export':           'Exporting…',
        'action.join_video':       'Joining call',
        'action.create_video_slot':'Creating slot',
        'action.collect_payment':  'Opening billing',
        'action.scan_form':        'Opening scanner',
        'form.clear':              'Form cleared',
        'form.next_section':       'Next section',
        'form.prev_section':       'Previous section',
      }
      const fallback = `Done: ${intent.split('.')[1] ?? intent}`
      showToast(labels[intent] ?? fallback, 'success')
    },
    [router, showToast],
  )

  // ── Stop listening + resolve intent ───────────────────────────
  const stopAndResolve = useCallback(async () => {
    if (recogRef.current) {
      try { recogRef.current.stop() } catch { /* ignore */ }
      recogRef.current = null
    }

    const raw = rawFinalRef.current.trim()
    rawFinalRef.current = ''

    if (!raw) { setState('idle'); return }

    setState('processing')
    showToast(`"${raw}"`, 'info', 3000)

    try {
      let intent     = 'unknown'
      let confidence = 0
      let param: string | null = null

      // AI resolution
      try {
        const res = await fetch('/api/voice-command', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript:  raw,
            currentPage: pathnameRef.current,
            currentTab:  '',
          }),
        })
        if (res.ok) {
          const data = await res.json() as {
            intent:     string
            confidence: number
            param:      string | null
          }
          intent     = data.intent     ?? 'unknown'
          confidence = data.confidence ?? 0
          param      = data.param      ?? null
        }
      } catch {
        // Offline fallback
        const match = matchCommandOffline(raw)
        if (match) {
          intent     = match.intent
          confidence = 0.7
        }
      }

      if (intent === 'unknown' || confidence < 0.3) {
        setState('error')
        showToast('Didn\'t understand. Say "help" to see all commands.', 'error', 3000)
        setTimeout(() => setState('idle'), 1500)
        return
      }

      await executeIntent(intent, param)
      setState('success')
      setTimeout(() => setState('idle'), 1200)
    } catch {
      setState('error')
      showToast('Voice command failed', 'error')
      setTimeout(() => setState('idle'), 1200)
    }
  }, [showToast, executeIntent])

  // ── Start listening ────────────────────────────────────────────
  const startListening = useCallback(() => {
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition

    if (!SR) {
      showToast('Voice requires Chrome or Edge browser', 'error')
      return
    }
    if (
      stateRef.current === 'listening' ||
      stateRef.current === 'processing'
    ) return

    if (recogRef.current) {
      try { recogRef.current.stop() } catch { /* ignore */ }
    }

    const r = new SR() as any
    r.continuous     = true
    r.interimResults = true
    r.lang           = 'en-IN' // Indian English — best for Indian medical terminology

    rawFinalRef.current = ''
    recogRef.current    = r

    r.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          rawFinalRef.current += e.results[i][0].transcript as string
        }
      }
    }

    r.onerror = (e: any) => {
      if ((e.error as string) === 'no-speech') return
      recogRef.current = null
      stopAndResolve()
    }

    r.onend = () => {
      if (stateRef.current === 'listening') stopAndResolve()
    }

    r.start()
    setState('listening')
  }, [showToast, stopAndResolve])

  // ── Keyboard shortcut: Alt+V (toggle) / Escape (stop) ────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        if (stateRef.current === 'listening') stopAndResolve()
        else startListening()
        return
      }
      if (e.key === 'Escape' && stateRef.current === 'listening') {
        stopAndResolve()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [startListening, stopAndResolve])

  // ── Cleanup ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (recogRef.current) {
        try { recogRef.current.stop() } catch { /* ignore */ }
      }
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  const isListening  = state === 'listening'
  const isProcessing = state === 'processing'
  const isSuccess    = state === 'success'
  const isError      = state === 'error'

  // getCommandsByCategory() now returns Array<[CommandCategory, VoiceCommand[]]>
  // directly — no Object.entries() call needed, no TypeScript widening issue.
  const categoryEntries = getCommandsByCategory()

  const catLabels: Record<string, string> = {
    navigation:  '🗺️ Navigation',
    section:     '📑 Switch Section / Tab',
    page_action: '⚡ Page Actions',
    form:        '📝 Form Controls',
    utility:     '🔧 Utility',
  }

  return (
    <>
      {/* ── Help overlay ─────────────────────────────────────── */}
      {showHelp && (
        <div className="fixed inset-0 z-[9998] flex items-end justify-end p-4 md:items-center md:justify-center">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/30"
            onClick={() => setShowHelp(false)}
          />

          <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-blue-600 to-blue-700">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                  <Mic className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="text-white font-bold text-sm">Voice Commands</h2>
                  <p className="text-blue-100 text-xs">Say any phrase to trigger an action</p>
                </div>
              </div>
              <button
                onClick={() => setShowHelp(false)}
                className="text-white/70 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Keyboard shortcut hint */}
            <div className="px-5 py-2 bg-blue-50 border-b border-blue-100 text-xs text-blue-700 flex items-center gap-1.5">
              <kbd className="bg-white border border-blue-200 rounded px-1.5 py-0.5 font-mono text-xs">
                Alt
              </kbd>
              <span>+</span>
              <kbd className="bg-white border border-blue-200 rounded px-1.5 py-0.5 font-mono text-xs">
                V
              </kbd>
              <span>— toggle listening from anywhere on the page</span>
            </div>

            {/* Command list */}
            <div className="overflow-y-auto flex-1 px-4 py-3">
              {categoryEntries.map(([cat, cmds]) => {
                if (cmds.length === 0) return null
                return (
                  <div key={cat} className="mb-4">
                    <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                      {catLabels[cat] ?? cat}
                    </div>
                    <div className="space-y-1">
                      {cmds.map((cmd: VoiceCommand) => (
                        <div
                          key={cmd.intent}
                          className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-gray-50"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-800">
                              {cmd.description}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5 truncate">
                              &ldquo;{cmd.phrases[0]}&rdquo;
                              {cmd.phrases[1] !== undefined && (
                                <span className="text-gray-300">
                                  {' '}·{' '}&ldquo;{cmd.phrases[1]}&rdquo;
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ──────────────────────────────────────────────── */}
      {toast !== null && (
        <div
          className={[
            'fixed bottom-24 right-4 md:bottom-8 md:right-24 z-[9997]',
            'max-w-xs pointer-events-none px-4 py-2.5',
            'rounded-xl text-sm font-medium shadow-lg border',
            toast.type === 'success'
              ? 'bg-green-600 text-white border-green-500'
              : toast.type === 'error'
              ? 'bg-red-600 text-white border-red-500'
              : 'bg-gray-800 text-white border-gray-700',
          ].join(' ')}
        >
          {toast.text}
        </div>
      )}

      {/* ── Floating mic + help buttons ─────────────────────── */}
      <div className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-[9995] flex flex-col items-end gap-2 no-print">

        {/* Help toggle */}
        <button
          onClick={() => setShowHelp(h => !h)}
          className="w-8 h-8 rounded-full bg-white shadow-md border border-gray-200 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:border-blue-300 transition-all"
          title="Show all voice commands"
        >
          <HelpCircle className="w-4 h-4" />
        </button>

        {/* Mic button */}
        <button
          onClick={() => {
            if (isListening) stopAndResolve()
            else if (!isProcessing) startListening()
          }}
          disabled={isProcessing}
          title={
            isListening
              ? 'Stop listening (Alt+V)'
              : 'Start voice command (Alt+V)'
          }
          className={[
            'relative w-14 h-14 rounded-full shadow-xl flex items-center justify-center',
            'transition-all duration-200 select-none focus:outline-none',
            isListening
              ? 'bg-red-600 hover:bg-red-700 scale-110'
              : isProcessing
              ? 'bg-blue-500 cursor-wait'
              : isSuccess
              ? 'bg-green-600'
              : isError
              ? 'bg-red-500'
              : 'bg-blue-600 hover:bg-blue-700 hover:scale-105 active:scale-95',
          ].join(' ')}
        >
          {/* Pulse rings while listening */}
          {isListening && (
            <>
              <span className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-30" />
              <span className="absolute inset-[-6px] rounded-full border-2 border-red-400 animate-pulse opacity-50" />
            </>
          )}

          {/* Icon */}
          {isProcessing ? (
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          ) : isListening ? (
            <MicOff className="w-6 h-6 text-white" />
          ) : isSuccess ? (
            <span className="text-white text-xl leading-none">✓</span>
          ) : isError ? (
            <span className="text-white text-xl leading-none">✕</span>
          ) : (
            <Mic className="w-6 h-6 text-white" />
          )}

          {/* "VOICE" label on idle */}
          {state === 'idle' && (
            <span className="absolute -bottom-5 text-[9px] font-bold text-blue-600 tracking-wider uppercase">
              VOICE
            </span>
          )}
        </button>
      </div>
    </>
  )
}