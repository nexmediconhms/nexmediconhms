'use client'
/**
 * src/app/queue/display/page.tsx
 * TV Token Display — open this on your waiting room screen
 * URL: /queue/display
 * No login required
 */

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { todayIST } from '@/lib/business-logic'

export default function QueueDisplayPage() {
  const [current, setCurrent] = useState<{ token_number: number; patient_id: string } | null>(null)
  const [nextUp, setNextUp] = useState<{ token_number: number }[]>([])
  const [waiting, setWaiting] = useState(0)
  const [lastToken, setLastToken] = useState<number | null>(null)
  const [time, setTime] = useState('')

  // Clock update
  useEffect(() => {
    const tick = () => setTime(
      new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    )
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  const loadQueue = useCallback(async () => {
    const today = todayIST()
    const { data } = await supabase
      .from('opd_queue')
      .select('id, token_number, patient_id, status')
      .eq('queue_date', today)
      .neq('status', 'done')
      .neq('status', 'cancelled')
      .order('token_number')

    if (!data) return

    const serving = data.filter(q => q.status === 'serving')
    const waitingList = data.filter(q => q.status === 'waiting')

    setWaiting(waitingList.length)
    
    // Map data structure to align with types
    setNextUp(waitingList.slice(0, 3).map(q => ({ token_number: q.token_number })))

    const curr = serving[0] || null
    if (curr && curr.token_number !== lastToken) {
      setLastToken(curr.token_number)
      setCurrent({ token_number: curr.token_number, patient_id: curr.patient_id })
      
      // Announce via text-to-speech
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        const u = new SpeechSynthesisUtterance(
          `Token number ${curr.token_number}. Please proceed to the consultation room.`
        )
        u.lang = 'en-IN'
        u.rate = 0.9
        window.speechSynthesis.speak(u)
      }
    } else if (!curr) {
      setCurrent(null)
    }
  }, [lastToken])

  useEffect(() => {
    loadQueue()
    const interval = setInterval(loadQueue, 15000)
    return () => clearInterval(interval)
  }, [loadQueue])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900
                    flex flex-col items-center justify-center p-8 select-none">
      <div className="text-blue-300 text-xl font-semibold mb-10 tracking-widest uppercase">
        OPD Token Display
      </div>

      {/* Current token */}
      <div className="text-center mb-14">
        <div className="text-blue-400 text-2xl font-semibold mb-3 tracking-wider uppercase">
          Now Serving
        </div>
        {current ? (
          <>
            <div
              className="text-[160px] font-black text-white leading-none mb-3"
              style={{ textShadow: '0 0 40px rgba(99,179,237,0.4)' }}
            >
              {current.token_number}
            </div>
            <div className="text-2xl text-blue-200 font-light">
              Please proceed to the Consultation Room
            </div>
          </>
        ) : (
          <div className="text-[100px] font-black text-blue-700 leading-none">—</div>
        )}
      </div>

      {/* Next tokens */}
      {nextUp.length > 0 && (
        <div className="mb-10 text-center">
          <div className="text-blue-400 text-lg font-semibold mb-4 tracking-wider uppercase">
            Next
          </div>
          <div className="flex gap-6 justify-center">
            {nextUp.map((q, i) => (
              <div
                key={q.token_number || i}
                className="w-24 h-24 rounded-2xl border-2 border-blue-600
                           bg-blue-800/50 flex items-center justify-center"
                style={{ opacity: 1 - i * 0.25 }}
              >
                <span className="text-4xl font-black text-blue-200">{q.token_number}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-12 text-center">
        <div>
          <div className="text-3xl font-black text-white">{waiting}</div>
          <div className="text-blue-400 text-sm mt-1">Waiting</div>
        </div>
        <div className="w-px h-10 bg-blue-700" />
        <div>
          <div className="text-3xl font-black text-white">{time}</div>
          <div className="text-blue-400 text-sm mt-1">Time</div>
        </div>
      </div>

      <div className="mt-12 text-blue-700 text-xs tracking-wider">
        Auto-refreshes every 15 seconds
      </div>
    </div>
  )
}