'use client'
/**
 * src/components/shared/PatientSearchWithRecents.tsx
 *
 * Reusable patient search input with auto-suggestions.
 * Shows recent patients on focus (before typing) and search results when typing.
 *
 * Features:
 *  - Shows last 5 recently registered patients on focus (empty query)
 *  - Debounced search by name, MRN, or mobile (300ms)
 *  - Selected patient shown as a confirmation chip with clear button
 *  - Dropdown closes on outside click
 *  - Stores recent selections in sessionStorage for quick re-access
 *
 * Usage:
 *   <PatientSearchWithRecents
 *     onSelect={(patient) => setSelectedPatient(patient)}
 *     selectedPatient={selectedPatient}
 *     onClear={() => setSelectedPatient(null)}
 *     placeholder="Search patient..."
 *     autoFocus
 *   />
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { escapeLike } from '@/lib/utils'
import { Search, X, CheckCircle, Clock, Loader2, User } from 'lucide-react'

export interface PatientResult {
  id: string
  full_name: string
  mrn: string
  mobile: string
  age?: number | null
  gender?: string | null
}

interface Props {
  onSelect: (patient: PatientResult) => void
  selectedPatient?: PatientResult | null
  onClear?: () => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
}

const RECENT_KEY = 'nexmedicon_recent_patients'
const MAX_RECENTS = 5

function getStoredRecents(): PatientResult[] {
  try {
    const stored = sessionStorage.getItem(RECENT_KEY)
    if (!stored) return []
    return JSON.parse(stored).slice(0, MAX_RECENTS)
  } catch {
    return []
  }
}

function storeRecent(patient: PatientResult) {
  try {
    const existing = getStoredRecents()
    const filtered = existing.filter(p => p.id !== patient.id)
    const updated = [patient, ...filtered].slice(0, MAX_RECENTS)
    sessionStorage.setItem(RECENT_KEY, JSON.stringify(updated))
  } catch { /* ignore */ }
}

export default function PatientSearchWithRecents({
  onSelect,
  selectedPatient,
  onClear,
  placeholder = 'Search patient by name, MRN, or mobile…',
  autoFocus = false,
  className = '',
}: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PatientResult[]>([])
  const [recents, setRecents] = useState<PatientResult[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingRecents, setLoadingRecents] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load recent patients (from DB) on first focus
  const loadRecents = useCallback(async () => {
    setLoadingRecents(true)
    try {
      // First try stored recents from session
      const stored = getStoredRecents()
      if (stored.length > 0) {
        setRecents(stored)
        setLoadingRecents(false)
        return
      }

      // Otherwise fetch latest registered patients
      const { data } = await supabase
        .from('patients')
        .select('id, full_name, mrn, mobile, age, gender')
        .order('created_at', { ascending: false })
        .limit(MAX_RECENTS)

      if (data) {
        setRecents(data as PatientResult[])
      }
    } catch { /* ignore */ }
    setLoadingRecents(false)
  }, [])

  // Search patients with debounce
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      return
    }

    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      setLoading(true)
      const safe = escapeLike(query.trim())
      const { data } = await supabase
        .from('patients')
        .select('id, full_name, mrn, mobile, age, gender')
        .or(`full_name.ilike.%${safe}%,mrn.ilike.%${safe}%,mobile.ilike.%${safe}%`)
        .order('created_at', { ascending: false })
        .limit(8)

      setResults((data || []) as PatientResult[])
      setLoading(false)
    }, 300)

    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [query])

  // Close on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  function handleSelect(patient: PatientResult) {
    storeRecent(patient)
    onSelect(patient)
    setQuery('')
    setResults([])
    setShowDropdown(false)
  }

  function handleFocus() {
    setShowDropdown(true)
    if (recents.length === 0) {
      loadRecents()
    }
  }

  function handleClear() {
    setQuery('')
    setResults([])
    onClear?.()
  }

  // If a patient is selected, show the confirmation chip
  if (selectedPatient) {
    return (
      <div className={`flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-3 ${className}`}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-green-700">
              {selectedPatient.full_name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <div className="font-semibold text-sm text-gray-900">{selectedPatient.full_name}</div>
            <div className="text-xs text-gray-500">
              {selectedPatient.mrn}
              {selectedPatient.age ? ` · ${selectedPatient.age}y` : ''}
              {selectedPatient.gender ? ` · ${selectedPatient.gender}` : ''}
              {selectedPatient.mobile ? ` · ${selectedPatient.mobile}` : ''}
            </div>
          </div>
        </div>
        <button
          onClick={handleClear}
          className="text-gray-400 hover:text-red-500 transition-colors p-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  // Determine what to show in dropdown
  const showResults = query.trim().length >= 2 && results.length > 0
  const showRecents = query.trim().length < 2 && recents.length > 0
  const showEmpty = query.trim().length >= 2 && !loading && results.length === 0

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          className="input pl-9 pr-8"
          placeholder={placeholder}
          value={query}
          onChange={e => { setQuery(e.target.value); setShowDropdown(true) }}
          onFocus={handleFocus}
          autoFocus={autoFocus}
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && (showResults || showRecents || showEmpty || loadingRecents) && (
        <div className="absolute z-30 top-full mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-[300px] overflow-y-auto">

          {/* Recent patients header */}
          {showRecents && (
            <>
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                <Clock className="w-3 h-3 text-gray-400" />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recent Patients</span>
              </div>
              {recents.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelect(p)}
                  className="w-full text-left px-4 py-2.5 hover:bg-blue-50 flex items-center gap-3 border-b border-gray-50 last:border-0 transition-colors"
                >
                  <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-blue-700">
                      {p.full_name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{p.full_name}</div>
                    <div className="text-xs text-gray-400">
                      {p.mrn}{p.age ? ` · ${p.age}y` : ''}{p.mobile ? ` · ${p.mobile}` : ''}
                    </div>
                  </div>
                </button>
              ))}
            </>
          )}

          {/* Loading recents */}
          {loadingRecents && !showRecents && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
            </div>
          )}

          {/* Search results */}
          {showResults && (
            <>
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                <Search className="w-3 h-3 text-gray-400" />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Search Results</span>
              </div>
              {results.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelect(p)}
                  className="w-full text-left px-4 py-2.5 hover:bg-blue-50 flex items-center gap-3 border-b border-gray-50 last:border-0 transition-colors"
                >
                  <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-blue-700">
                      {p.full_name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{p.full_name}</div>
                    <div className="text-xs text-gray-400">
                      {p.mrn}{p.age ? ` · ${p.age}y` : ''}{p.gender ? ` · ${p.gender}` : ''}{p.mobile ? ` · ${p.mobile}` : ''}
                    </div>
                  </div>
                  <CheckCircle className="w-4 h-4 text-blue-300 flex-shrink-0" />
                </button>
              ))}
            </>
          )}

          {/* No results */}
          {showEmpty && (
            <div className="px-4 py-4 text-center">
              <User className="w-5 h-5 text-gray-300 mx-auto mb-1" />
              <p className="text-xs text-gray-400">
                No patients found for &ldquo;{query}&rdquo;
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Try searching by MRN or mobile number
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
