'use client'
/**
 * src/app/opd/page.tsx — UPDATED v3
 *
 * ENHANCEMENTS:
 *   1. Top 5 latest patients (by registration date) shown immediately.
 *   2. Real-time updates — Supabase Realtime subscription refreshes the list
 *      whenever a new patient is registered anywhere in the app.
 *   3. Bridge from Patient List page: accepts ?patientId= URL param to
 *      immediately navigate to /opd/new without any interaction.
 *   4. All original search logic preserved (debounce, escapeLike).
 *   5. Smooth animations on patient card entry.
 */
import { useState, useRef, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { escapeLike } from '@/lib/utils'
import { Search, Stethoscope, UserPlus, ChevronRight, Clock, Zap } from 'lucide-react'

interface PatientRow {
  id: string
  mrn: string
  full_name: string
  age: number | string
  gender: string
  mobile: string
  created_at: string
}

export default function OPDIndexPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  // Bridge: if patientId is passed via URL (from patient list page), jump straight to OPD
  const bridgeId = searchParams.get('patientId') ?? searchParams.get('patient')

  const [query,          setQuery]          = useState('')
  const [results,        setResults]        = useState<PatientRow[]>([])
  const [searched,       setSearched]       = useState(false)
  const [loading,        setLoading]        = useState(false)
  const [recentPatients, setRecentPatients] = useState<PatientRow[]>([])
  const [recentLoading,  setRecentLoading]  = useState(true)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Bridge: redirect immediately if patientId is in URL ──────
  useEffect(() => {
    if (bridgeId) {
      router.replace(`/opd/new?patient=${bridgeId}`)
    }
  }, [bridgeId, router])

  // ── Load Top 5 recent patients ────────────────────────────────
  async function loadRecent() {
    setRecentLoading(true)
    const { data } = await supabase
      .from('patients')
      .select('id, mrn, full_name, age, gender, mobile, created_at')
      .order('created_at', { ascending: false })
      .limit(5)
    setRecentPatients(data || [])
    setRecentLoading(false)
  }

  useEffect(() => {
    loadRecent()
  }, [])

  // ── Real-time subscription — refreshes list when new patient registered ──
  useEffect(() => {
    const channel = supabase
      .channel('opd-recent-patients')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'patients' },
        (_payload) => {
          // New patient registered — refresh top 5 immediately
          loadRecent()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  // ── Debounced search ──────────────────────────────────────────
  function handleSearch(val: string) {
    setQuery(val)
    if (val.trim().length < 2) { setResults([]); setSearched(false); return }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      setLoading(true)
      const safe = escapeLike(val)
      const { data } = await supabase
        .from('patients')
        .select('id, mrn, full_name, age, gender, mobile, created_at')
        .or(`full_name.ilike.%${safe}%,mobile.ilike.%${safe}%,mrn.ilike.%${safe}%`)
        .limit(10)
      setResults(data || [])
      setSearched(true)
      setLoading(false)
    }, 300)
  }

  function PatientCard({ p, color = 'blue' }: { p: PatientRow; color?: 'blue' | 'green' }) {
    const colors = {
      blue:  { avatar: 'bg-blue-100',  text: 'text-blue-700',  hover: 'hover:bg-blue-50 hover:border-blue-200',  btn: 'text-blue-600'  },
      green: { avatar: 'bg-green-100', text: 'text-green-700', hover: 'hover:bg-green-50 hover:border-green-200', btn: 'text-green-600' },
    }
    const c = colors[color]
    return (
      <button
        onClick={() => router.push(`/opd/new?patient=${p.id}`)}
        className={`w-full flex items-center gap-4 px-4 py-3 rounded-lg border border-transparent ${c.hover} transition-all text-left`}>
        <div className={`w-9 h-9 ${c.avatar} rounded-full flex items-center justify-center flex-shrink-0`}>
          <span className={`text-sm font-bold ${c.text}`}>{p.full_name.charAt(0).toUpperCase()}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900 text-sm">{p.full_name}</div>
          <div className="text-xs text-gray-400">{p.mrn} · {p.age}y · {p.gender} · {p.mobile}</div>
        </div>
        <div className={`flex items-center gap-1 text-xs ${c.btn} font-medium flex-shrink-0`}>
          Start Consultation <ChevronRight className="w-3.5 h-3.5" />
        </div>
      </button>
    )
  }

  return (
    <AppShell>
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Stethoscope className="w-6 h-6 text-blue-600" /> OPD Consultation
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Select a recent patient below, or search by name / mobile / MRN, or register new.
          </p>
        </div>

        {/* ── Top 5 Recent Patients (Real-time) ─────────────────── */}
        {!searched && (
          <div className="card p-5 mb-5">
            <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-gray-400" />
              Recent Patients
              <span className="text-xs font-normal text-gray-400">(latest 5 — updates live)</span>
              <span className="ml-auto flex items-center gap-1 text-xs text-green-600 font-normal">
                <Zap className="w-3 h-3" /> Real-time
              </span>
            </h3>
            {recentLoading ? (
              <div className="flex items-center gap-2 py-4 justify-center text-gray-400 text-sm">
                <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                Loading recent patients…
              </div>
            ) : recentPatients.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">
                No patients registered yet. Register your first patient below.
              </p>
            ) : (
              <div className="space-y-1">
                {recentPatients.map(p => (
                  <PatientCard key={p.id} p={p} color="green" />
                ))}
              </div>
            )}
            <div className="mt-3 text-center">
              <Link href="/patients" className="text-xs text-blue-600 hover:underline">
                View All Patients →
              </Link>
            </div>
          </div>
        )}

        {/* ── Search Card ────────────────────────────────────────── */}
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

          {/* Search results */}
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
                    <PatientCard key={p.id} p={p} color="blue" />
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

        {/* Bridge tip */}
        <div className="mt-6 bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-700">
          <strong>💡 Tip — Zero-Click Bridge:</strong>{' '}
          On the <Link href="/patients" className="underline font-semibold">Patient List</Link> page,
          each patient row has a <em>&#34;Start OPD&#34;</em> button that brings you here with the patient
          pre-selected — no searching, no typing. Perfect for returning patients.
        </div>
      </div>
    </AppShell>
  )
}