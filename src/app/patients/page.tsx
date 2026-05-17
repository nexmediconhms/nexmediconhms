'use client'
/**
 * src/app/patients/page.tsx — UPDATED v2
 *
 * ADDITIONS (no existing code removed):
 *   1. "Start OPD" quick-action button on every patient row — links to
 *      /opd?patientId=<id> which immediately bridges to /opd/new?patient=<id>
 *   2. Real-time subscription refreshes list when new patients are added
 *      from other sessions (staff registers on iPad, doctor sees it on PC).
 *   3. Added "Admit" quick link button to jump to /ipd with patient pre-filled.
 *   4. All original code (search, filters, pagination, error handling) preserved.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, ageFromDOB, escapeLike } from '@/lib/utils'
import { Search, UserPlus, ChevronRight, User, Filter, X, AlertCircle, Stethoscope, BedDouble, Zap } from 'lucide-react'

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']

const bloodGroupColor: Record<string, string> = {
  'A+': 'badge-red', 'A-': 'badge-red', 'B+': 'badge-blue', 'B-': 'badge-blue',
  'O+': 'badge-green', 'O-': 'badge-green', 'AB+': 'badge-yellow', 'AB-': 'badge-yellow'
}

export default function PatientsPage() {
  const router = useRouter()

  const [patients,     setPatients]     = useState<any[]>([])
  const [totalCount,   setTotalCount]   = useState(0)
  const [query,        setQuery]        = useState('')
  const [genderFilter, setGenderFilter] = useState('')
  const [bgFilter,     setBgFilter]     = useState('')
  const [loading,      setLoading]      = useState(true)
  const [showFilters,  setShowFilters]  = useState(false)
  const [fetchError,   setFetchError]   = useState<string | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const PAGE_SIZE = 50
  const [page, setPage] = useState(0)

  useEffect(() => { loadPatients() }, [page])

  async function loadPatients(q = query, gender = genderFilter, bg = bgFilter) {
    setLoading(true)
    setFetchError(null)

    try {
      let req = supabase.from('patients').select('*').order('created_at', { ascending: false })

      if (q.trim()) {
        const safe = escapeLike(q)
        req = req.or(`full_name.ilike.%${safe}%,mobile.ilike.%${safe}%,mrn.ilike.%${safe}%`)
      }
      if (gender) req = req.eq('gender', gender)
      if (bg)     req = req.eq('blood_group', bg)

      const from = page * PAGE_SIZE
      const to   = from + PAGE_SIZE - 1
      const { data, error } = await req.range(from, to)

      if (error) {
        console.error('[Patients] fetch error:', error.message)
        setFetchError('Unable to load patients. Please check your connection and try again.')
        setPatients([]); setTotalCount(0); setLoading(false); return
      }

      setPatients(data || [])

      let countReq = supabase.from('patients').select('*', { count: 'exact', head: true })
      if (q.trim()) {
        const safe = escapeLike(q)
        countReq = countReq.or(`full_name.ilike.%${safe}%,mobile.ilike.%${safe}%,mrn.ilike.%${safe}%`)
      }
      if (gender) countReq = countReq.eq('gender', gender)
      if (bg)     countReq = countReq.eq('blood_group', bg)
      const { count } = await countReq
      setTotalCount(count ?? 0)
    } catch (err: any) {
      console.error('[Patients] unexpected error:', err)
      setFetchError('Something went wrong. Please refresh the page.')
      setPatients([]); setTotalCount(0)
    }

    setLoading(false)
  }

  function handleSearch(val: string) {
    setQuery(val); setPage(0)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => loadPatients(val, genderFilter, bgFilter), 300)
  }

  function applyFilter(gender: string, bg: string) {
    setGenderFilter(gender); setBgFilter(bg); setPage(0)
    loadPatients(query, gender, bg)
  }

  function clearFilters() {
    setGenderFilter(''); setBgFilter(''); setPage(0)
    loadPatients(query, '', '')
  }

  // Real-time — refresh when a new patient is registered
  useEffect(() => {
    const channel = supabase
      .channel('patients-list-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'patients' },
        () => { if (page === 0) loadPatients() }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, query, genderFilter, bgFilter])

  const hasFilters = Boolean(genderFilter || bgFilter)
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  return (
    <AppShell>
      <div className="p-4 md:p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2">
              Patients
              <span className="flex items-center gap-1 text-xs font-normal text-green-600 bg-green-50 border border-green-200 rounded-full px-2 py-0.5 ml-1">
                <Zap className="w-3 h-3" /> Live
              </span>
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {loading ? 'Loading...' : `${totalCount.toLocaleString()} patient${totalCount !== 1 ? 's' : ''} found`}
              {hasFilters && <span className="ml-1 text-blue-600">(filtered)</span>}
            </p>
          </div>
          <Link href="/patients/new" className="btn-primary flex items-center gap-2 text-xs md:text-sm">
            <UserPlus className="w-4 h-4" />
            <span className="hidden sm:inline">Register New Patient</span>
            <span className="sm:hidden">Register</span>
          </Link>
        </div>

        {/* Error banner */}
        {fetchError && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">{fetchError}</span>
            <button onClick={() => loadPatients()} className="text-xs font-semibold text-red-800 underline hover:text-red-900 flex-shrink-0">Retry</button>
          </div>
        )}

        {/* Search + Filter bar */}
        <div className="card p-3 md:p-4 mb-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                className="input pl-9 bg-gray-50"
                placeholder="Search by name, mobile, or MRN..."
                value={query}
                onChange={e => handleSearch(e.target.value)}
              />
              {query && (
                <button onClick={() => handleSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                hasFilters ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}>
              <Filter className="w-4 h-4" />
              <span className="hidden sm:inline">Filter</span>
              {hasFilters && <span className="text-xs bg-blue-600 text-white rounded-full w-4 h-4 flex items-center justify-center">!</span>}
            </button>
          </div>

          {showFilters && (
            <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-3 items-end">
              <div>
                <label className="label">Gender</label>
                <select className="input w-32 py-1.5 text-xs" value={genderFilter}
                  onChange={e => applyFilter(e.target.value, bgFilter)}>
                  <option value="">All</option>
                  <option>Female</option><option>Male</option><option>Other</option>
                </select>
              </div>
              <div>
                <label className="label">Blood Group</label>
                <select className="input w-28 py-1.5 text-xs" value={bgFilter}
                  onChange={e => applyFilter(genderFilter, e.target.value)}>
                  <option value="">All</option>
                  {BLOOD_GROUPS.map(bg => <option key={bg}>{bg}</option>)}
                </select>
              </div>
              {hasFilters && (
                <button onClick={clearFilters} className="text-xs text-red-600 hover:underline flex items-center gap-1 pb-1">
                  <X className="w-3 h-3" /> Clear filters
                </button>
              )}
            </div>
          )}
        </div>

        {/* Patient table — desktop */}
        <div className="card overflow-hidden hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['Patient', 'MRN', 'Age / Gender', 'Mobile', 'Blood Group', 'Registered', 'Quick Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">
                  <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  Loading patients...
                </td></tr>
              ) : patients.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-16">
                  <User className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                  <p className="text-gray-400 font-medium">No patients found</p>
                  {!query && !hasFilters && (
                    <Link href="/patients/new" className="text-blue-600 text-sm hover:underline mt-1 block">
                      Register your first patient →
                    </Link>
                  )}
                </td></tr>
              ) : patients.map(p => {
                const displayAge = ageFromDOB(p.date_of_birth) ?? p.age
                return (
                  <tr key={p.id}
                    className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors cursor-pointer"
                    onClick={() => router.push(`/patients/${p.id}`)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-blue-700">{p.full_name.charAt(0)}</span>
                        </div>
                        <div>
                          <div className="font-semibold text-gray-900">{p.full_name}</div>
                          {p.abha_id && <div className="text-xs text-gray-400">ABHA: {p.abha_id}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className="badge-blue font-mono text-xs">{p.mrn}</span></td>
                    <td className="px-4 py-3 text-gray-600">{displayAge ?? '—'}y · {p.gender || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">{p.mobile}</td>
                    <td className="px-4 py-3">
                      {p.blood_group
                        ? <span className={bloodGroupColor[p.blood_group] || 'badge-gray'}>{p.blood_group}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(p.created_at)}</td>
                    {/* NEW: Quick action buttons — Start OPD & Admit */}
                    <td className="px-4 py-3">
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        <Link
                          href={`/opd?patientId=${p.id}`}
                          className="flex items-center gap-1 text-xs px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors font-medium whitespace-nowrap">
                          <Stethoscope className="w-3 h-3" /> OPD
                        </Link>
                        <Link
                          href={`/ipd?patientId=${p.id}`}
                          className="flex items-center gap-1 text-xs px-2 py-1 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors font-medium whitespace-nowrap">
                          <BedDouble className="w-3 h-3" /> Admit
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Patient list — mobile cards */}
        <div className="md:hidden space-y-2">
          {loading ? (
            <div className="card p-8 text-center text-gray-400">
              <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              Loading...
            </div>
          ) : patients.length === 0 ? (
            <div className="card p-8 text-center text-gray-400">
              <User className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="font-medium">No patients found</p>
            </div>
          ) : patients.map(p => {
            const displayAge = ageFromDOB(p.date_of_birth) ?? p.age
            return (
              <div key={p.id} className="card p-4">
                <div className="flex items-center gap-3 mb-3"
                  onClick={() => router.push(`/patients/${p.id}`)}
                  style={{ cursor: 'pointer' }}>
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-blue-700">{p.full_name.charAt(0)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 truncate">{p.full_name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {p.mrn} · {displayAge ?? '—'}y · {p.gender || '—'}
                      {p.blood_group && <span className="ml-1.5 font-semibold">{p.blood_group}</span>}
                    </div>
                    <div className="text-xs text-gray-400 font-mono">{p.mobile}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                </div>
                {/* Quick actions on mobile */}
                <div className="flex gap-2 border-t border-gray-50 pt-2">
                  <Link href={`/opd?patientId=${p.id}`}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 font-medium">
                    <Stethoscope className="w-3.5 h-3.5" /> Start OPD
                  </Link>
                  <Link href={`/ipd?patientId=${p.id}`}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-100 font-medium">
                    <BedDouble className="w-3.5 h-3.5" /> Admit
                  </Link>
                </div>
              </div>
            )
          })}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 py-4 mt-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="btn-secondary text-sm disabled:opacity-40">
              ← Previous
            </button>
            <span className="text-sm text-gray-500">Page {page + 1} of {totalPages} · {totalCount.toLocaleString()} total</span>
            <button onClick={() => setPage(p => p + 1)} disabled={page + 1 >= totalPages} className="btn-secondary text-sm disabled:opacity-40">
              Next →
            </button>
          </div>
        )}

      </div>
    </AppShell>
  )
}