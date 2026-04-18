'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { Search, Stethoscope, UserPlus, ChevronRight } from 'lucide-react'

export default function OPDIndexPage() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(false)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleSearch(val: string) {
    setQuery(val)
    if (val.trim().length < 2) { setResults([]); setSearched(false); return }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('patients')
        .select('id, mrn, full_name, age, gender, mobile')
        .or(`full_name.ilike.%${val}%,mobile.ilike.%${val}%,mrn.ilike.%${val}%`)
        .limit(10)
      setResults(data || [])
      setSearched(true)
      setLoading(false)
    }, 300)
  }

  return (
    <AppShell>
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Stethoscope className="w-6 h-6 text-blue-600" /> OPD Consultation
          </h1>
          <p className="text-sm text-gray-500 mt-1">Search for an existing patient or register a new one to start a consultation.</p>
        </div>

        {/* Search Card */}
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
                  <p className="text-sm mb-3">No patient found for "{query}"</p>
                  <Link href="/patients/new" className="btn-primary inline-flex items-center gap-2 text-xs">
                    <UserPlus className="w-3.5 h-3.5" /> Register New Patient
                  </Link>
                </div>
              ) : (
                <div className="space-y-1">
                  {results.map(p => (
                    <button key={p.id}
                      onClick={() => router.push(`/opd/new?patient=${p.id}`)}
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
