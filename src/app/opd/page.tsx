'use client'
import { useState, useRef, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { escapeLike } from '@/lib/utils'
import { Search, Stethoscope, UserPlus, ChevronRight, Clock, Users, Zap, ArrowRight } from 'lucide-react'

function OPDContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(false)

  // Top 5 latest registered patients (real-time)
  const [recentPatients, setRecentPatients] = useState<any[]>([])
  const [recentLoading, setRecentLoading] = useState(true)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load Top 5 latest patients on mount ────────────────────
  const loadRecentPatients = useCallback(async () => {
    setRecentLoading(true)
    const { data } = await supabase
      .from('patients')
      .select('id, mrn, full_name, age, gender, mobile, created_at')
      .order('created_at', { ascending: false })
      .limit(5)
    setRecentPatients(data || [])
    setRecentLoading(false)
  }, [])

  useEffect(() => {
    loadRecentPatients()
  }, [loadRecentPatients])

  // ── Real-time subscription for new patient registrations ───
  useEffect(() => {
    const channel = supabase
      .channel('opd-recent-patients')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'patients' },
        (payload) => {
          // Add new patient to top of recent list, keep max 5
          setRecentPatients(prev => {
            const updated = [payload.new as any, ...prev]
            return updated.slice(0, 5)
          })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // ── Handle pre-selected patient from Patient List page (bridge) ──
  useEffect(() => {
    const patientId = searchParams.get('patient')
    if (patientId) {
      // Direct navigation to new consultation for selected patient
      router.push(`/opd/new?patient=${patientId}`)
    }
  }, [searchParams, router])

  function handleSearch(val: string) {
    setQuery(val)
    if (val.trim().length < 2) { setResults([]); setSearched(false); return }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      setLoading(true)
      const safe = escapeLike(val)
      const { data } = await supabase
        .from('patients')
        .select('id, mrn, full_name, age, gender, mobile')
        .or(`full_name.ilike.%${safe}%,mobile.ilike.%${safe}%,mrn.ilike.%${safe}%`)
        .limit(10)
      setResults(data || [])
      setSearched(true)
      setLoading(false)
    }, 300)
  }

  function startConsultation(patientId: string) {
    router.push(`/opd/new?patient=${patientId}`)
  }

  // Time-ago helper
  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `${days}d ago`
  }

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Stethoscope className="w-6 h-6 text-blue-600" /> OPD Consultation
          </h1>
          <p className="text-sm text-gray-500 mt-1">Start a consultation — pick from recent patients or search.</p>
        </div>

        {/* ══ TOP 5 LATEST PATIENTS — Quick Select ══════════════════ */}
        <div className="card p-5 mb-5 border-l-4 border-blue-400 bg-gradient-to-r from-blue-50/50 to-white">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-800 flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              Quick Start — Latest Registered Patients
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                Live
              </span>
              <Link href="/patients" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                View All <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>

          {recentLoading ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : recentPatients.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No patients registered yet.</p>
          ) : (
            <div className="space-y-1.5">
              {recentPatients.map((p, idx) => (
                <button
                  key={p.id}
                  onClick={() => startConsultation(p.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-blue-50 border border-transparent hover:border-blue-200 transition-all text-left group"
                >
                  <div className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 group-hover:bg-blue-200 transition-colors">
                    <span className="text-sm font-bold text-blue-700">{p.full_name?.charAt(0) || '?'}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                      {p.full_name}
                      {idx === 0 && (
                        <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-bold">NEW</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400">
                      {p.mrn} · {p.age}y · {p.gender} · {p.mobile}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[11px] text-gray-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {timeAgo(p.created_at)}
                    </span>
                    <span className="text-xs text-blue-600 font-medium flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      Start <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ══ SEARCH CARD ══════════════════════════════════════════ */}
        <div className="card p-6 mb-5">
          <label className="label mb-2 block">Search Patient</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              className="input pl-10 text-base py-3"
              placeholder="Type patient name, mobile number, or MRN..."
              value={query}
              onChange={e => handleSearch(e.target.value)}
              autoFocus
            />
            {loading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            )}
          </div>

          {/* Results */}
          {searched && (
            <div className="mt-3">
              {results.length === 0 ? (
                <div className="text-center py-6 text-gray-400">
                  <p className="text-sm mb-3">No patient found for &quot;{query}&quot;</p>
                  <Link href="/patients/new" className="btn-primary inline-flex items-center gap-2 text-xs">
                    <UserPlus className="w-3.5 h-3.5" /> Register New Patient
                  </Link>
                </div>
              ) : (
                <div className="space-y-1">
                  {results.map(p => (
                    <button key={p.id}
                      onClick={() => startConsultation(p.id)}
                      className="w-full flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-200 transition-all text-left">
                      <div className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-bold text-blue-700">{p.full_name.charAt(0)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-gray-900 text-sm">{p.full_name}</div>
                        <div className="text-xs text-gray-400">{p.mrn} · {p.age}y · {p.gender} · {p.mobile}</div>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-blue-600 font-medium flex-shrink-0">
                        Start Consultation <ChevronRight className="w-3.5 h-3.5" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Or Register */}
        <div className="text-center">
          <p className="text-sm text-gray-400 mb-3">— or —</p>
          <Link href="/patients/new" className="btn-secondary inline-flex items-center gap-2">
            <UserPlus className="w-4 h-4" /> Register New Patient First
          </Link>
        </div>
      </div>
    </AppShell>
  )
}



export default function OPDIndexPage() {
  return (
    <Suspense fallback={<AppShell><div className="p-6 flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div></AppShell>}>
      <OPDContent />
    </Suspense>
  )
}
