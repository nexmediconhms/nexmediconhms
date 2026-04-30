'use client'
/**
 * src/components/voice/VoiceCommandBus.ts — FIXED v2
 *
 * No new errors from the previous version — preserved as-is from final-fixes.
 * Re-delivered for completeness alongside VoiceAssistant.tsx.
 *
 * The useLayoutEffect approach ensures handlers are always fresh without
 * causing stale closure bugs from an empty [] dependency array.
 */

import { useEffect, useLayoutEffect, useRef } from 'react'

const VOICE_COMMAND_EVENT = 'nexmedicon:voice-command'

interface VoiceCommandDetail {
  intent: string
  param:  string | null
}

/**
 * Dispatch a resolved voice intent to all page listeners.
 * Called by VoiceAssistant after resolving a transcript.
 */
export function dispatchVoiceIntent(intent: string, param: string | null = null): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<VoiceCommandDetail>(VOICE_COMMAND_EVENT, {
      detail:  { intent, param },
      bubbles: true,
    }),
  )
}

/**
 * Subscribe to a single voice intent.
 *
 * The handler is stored in a ref (updated via useLayoutEffect before every
 * paint) so it always closes over the latest state, even though the event
 * listener is registered only once.
 *
 * Usage:
 *   useVoiceCommand('action.print', () => window.print())
 *   useVoiceCommand('section.obgyn', () => setTab('obgyn'))  // setTab always fresh
 */
export function useVoiceCommand(
  intent:  string,
  handler: (param: string | null) => void,
): void {
  const handlerRef = useRef(handler)
  useLayoutEffect(() => { handlerRef.current = handler })

  useEffect(() => {
    function onEvent(e: Event) {
      const detail = (e as CustomEvent<VoiceCommandDetail>).detail
      if (detail.intent === intent) handlerRef.current(detail.param)
    }
    window.addEventListener(VOICE_COMMAND_EVENT, onEvent)
    return () => window.removeEventListener(VOICE_COMMAND_EVENT, onEvent)
  }, [intent]) // re-subscribe only if the intent string itself changes
}

/**
 * Subscribe to multiple voice intents at once.
 *
 * Handlers map is stored in a ref so every handler always sees fresh state.
 * The event listener is registered once (empty dep array is intentional and
 * correct here because freshness is guaranteed by the ref update).
 *
 * Usage:
 *   useVoiceCommands({
 *     'action.save':       () => handleSave(),   // handleSave sees latest state
 *     'section.obgyn':     () => setTab('obgyn'),
 *     'form.next_section': () => goNextTab(),
 *   })
 */
export function useVoiceCommands(
  handlers: Record<string, (param: string | null) => void>,
): void {
  const handlersRef = useRef(handlers)
  useLayoutEffect(() => { handlersRef.current = handlers })

  useEffect(() => {
    function onEvent(e: Event) {
      const detail  = (e as CustomEvent<VoiceCommandDetail>).detail
      const handler = handlersRef.current[detail.intent]
      if (handler) handler(detail.param)
    }
    window.addEventListener(VOICE_COMMAND_EVENT, onEvent)
    return () => window.removeEventListener(VOICE_COMMAND_EVENT, onEvent)
  }, []) // register once; handler freshness is guaranteed by the ref
}