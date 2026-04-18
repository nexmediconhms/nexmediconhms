'use client'
import { useRef, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, ageFromDOB } from '@/lib/utils'
import {
  Search, User, Stethoscope, Pill, X,
  ChevronRight, Loader2
} from 'lucide-react'

interface SearchResult {
  type:     'patient' | 'encounter' | 'prescription'
  id:       string
  title:    string
  subtitle: string
  meta:     string
  href:     string
}

export default function SearchPage() {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>|null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function doSearch(q: string) {
    if (q.trim().length < 2) { setResults([]); setSearched(false); return }
    setLoading(true)
    setSearched(true)

    const out: SearchResult[] = []

    // Search patients
    const { data: pts } = await supabase
      .from('patients')
      .select('id, full_name, mrn, age, date_of_birth, gender, mobile, blood_group')
      .or(`full_name.ilike.%${q}%,mrn.ilike.%${q}%,mobile.ilike.%${q}%,abha_id.ilike.%${q}%`)
      .limit(8)

    ;(pts || []).forEach(p => {
      const age = ageFromDOB(p.date_of_birth) ?? p.age
      out.push({
        type:     'patient',
        id:       p.id,
        title:    p.full_name,
        subtitle: `${p.mrn} · ${age ? age + 'y' : ''} · ${p.gender || ''}`,
        meta:     p.mobile || '',
        href:     `/patients/${p.id}`,
      })
    })

    // Search encounters by diagnosis or chief complaint
    const { data: encs } = await supabase
      .from('encounters')
      .select('id, encounter_date, diagnosis, chief_complaint, patients(full_name, mrn)')
      .or(`diagnosis.ilike.%${q}%,chief_complaint.ilike.%${q}%`)
      .order('encounter_date', { ascending: false })
      .limit(6)

    ;(encs || []).forEach((e: any) => {
      const pt = e.patients || {}
      out.push({
        type:     'encounter',
        id:       e.id,
        title:    e.diagnosis || e.chief_complaint || 'Consultation',
        subtitle: `${pt.full_name || '?'} · ${pt.mrn || ''}`,
        meta:     formatDate(e.encounter_date),
        href:     `/opd/${e.id}`,
      })
    })

    // Search prescriptions by drug name
    const { data: rxs } = await supabase
      .from('prescriptions')
      .select('id, medications, follow_up_date, patients(full_name, mrn), created_at')
      .order('created_at', { ascending: false })
      .limit(100)  // search client-side for drug name in JSONB

    ;(rxs || []).forEach((rx: any) => {
      const meds: any[] = Array.isArray(rx.medications) ? rx.medications : []
      const match = meds.find(m => m.drug?.toLowerCase().includes(q.toLowerCase()))
      if (match) {
        const pt = rx.patients || {}
        out.push({
          type:     'prescription',
          id:       rx.id,
          title:    `Rx: ${match.drug} ${match.dose || ''}`,
          subtitle: `${pt.full_name || '?'} · ${pt.mrn || ''}`,
          meta:     formatDate(rx.created_at),
          href:     `/opd/${rx.id}/prescription`,
        })
      }
    })

    setResults(out.slice(0, 20))
    setLoading(false)
  }

  function handleChange(val: string) {
    setQuery(val)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => doSearch(val), 300)
  }

  const patients      = results.filter(r => r.type === 'patient')
  const encounters    = results.filter(r => r.type === 'encounter')
  const prescriptions = results.filter(r => r.type === 'prescription')

  const TypeIcon = ({ type }: { type: SearchResult['type'] }) => {
    if (type === 'patient')      return <User       className="w-4 h-4 text-blue-500"/>
    if (type === 'encounter')    return <Stethoscope className="w-4 h-4 text-green-500"/>
    if (type === 'prescription') return <Pill        className="w-4 h-4 text-purple-500"/>
    return null
  }

  function ResultGroup({ title, items }: { title: string; items: SearchResult[] }) {
    if (!items.length) return null
    return (
      <div className="mb-5">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1 mb-2">{title}</p>
        <div className="card overflow-hidden">
          {items.map((r, i) => (
            <Link key={r.id} href={r.href}
              className={`flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-colors ${i > 0 ? 'border-t border-gray-50' : ''}`}>
              <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <TypeIcon type={r.type}/>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-900 text-sm truncate">{r.title}</div>
                <div className="text-xs text-gray-400 truncate">{r.subtitle}</div>
              </div>
              <div className="text-xs text-gray-400 flex-shrink-0 flex items-center gap-1">
                {r.meta}
                <ChevronRight className="w-3.5 h-3.5"/>
              </div>
            </Link>
          ))}
        </div>
      </div>
    )
  }

  return (
    <AppShell>
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 mb-1">
            <Search className="w-6 h-6 text-blue-600"/> Global Search
          </h1>
          <p className="text-sm text-gray-500">Search patients, diagnoses, and prescriptions</p>
        </div>

        {/* Search input */}
        <div className="card p-4 mb-5">
          <div className="relative">
            {loading
              ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-500 animate-spin"/>
              : <Search  className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"/>
            }
            <input
              ref={inputRef}
              className="input pl-10 text-base py-3"
              placeholder="Patient name, MRN, mobile, diagnosis, drug name…"
              value={query}
              onChange={e => handleChange(e.target.value)}
              autoFocus
            />
            {query && (
              <button onClick={() => { setQuery(''); setResults([]); setSearched(false); inputRef.current?.focus() }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4"/>
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Searches: patient name · MRN · mobile number · diagnosis · drug/medicine name
          </p>
        </div>

        {/* Results */}
        {searched && !loading && results.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <Search className="w-10 h-10 mx-auto mb-3 opacity-20"/>
            <p className="font-medium">No results for "{query}"</p>
            <p className="text-sm mt-1">Try a different spelling or search term</p>
          </div>
        )}

        <ResultGroup title={`Patients (${patients.length})`}      items={patients}/>
        <ResultGroup title={`Encounters (${encounters.length})`}   items={encounters}/>
        <ResultGroup title={`Prescriptions (${prescriptions.length})`} items={prescriptions}/>
      </div>
    </AppShell>
  )
}
