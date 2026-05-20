'use client'
/**
 * src/components/shared/PatientSearchWithSuggestions.tsx
 *
 * Reusable patient search input with auto-suggestions.
 * Shows the 5 most recently registered patients on focus (before typing),
 * then switches to live search results as the user types.
 *
 * Usage:
 *   <PatientSearchWithSuggestions
 *     onSelect={(patient) => { ... }}
 *     placeholder="Search patient..."
 *     autoFocus
 *   />
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { escapeLike } from '@/lib/utils'
import { Search, User, Clock, X, Loader2 } from 'lucide-react'

export interface PatientSuggestion {
  id: string
  full_name: string
  mrn: string
  mobile: string
  age?: number | null
  gender?: string | null
  date_of_birth?: string | null
}

interface Props {
  onSelect: (patient: PatientSuggestion) => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
  /** If set, pre-selects and displays this patient */
  selectedPatient?: PatientSuggestion | null
  /** Called when selection is cleared */
  onClear?: () => void
}

export default function PatientSearchWithSuggestions({
  onSelect,
  placeholder = 'Search patient by name, MRN, or mobile...',
  autoFocus = false,
  className = '',
  selectedPatient = null,
  onClear,
}: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PatientSuggestion[]>([])
  const [recentPatients, setRecentPatients] = useState<PatientSuggestion[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingRecent, setLoadingRecent] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load recent patients on mount (top 5 most recently created)
  useEffect(() => {
    async function loadRecent() {
      setLoadingRecent(true)
      const { data } = await supabase
        .from('patients')
        .select('id, full_name, mrn, mobile, age, gender, date_of_birth')
        .order('created_at', { ascending: false })
        .limit(5)
      setRecentPatients(data || [])
      setLoadingRecent(false)
    }
    loadRecent()
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    const safe = escapeLike(q)
    const { data } = await supabase
      .from('patients')
      .select('id, full_name, mrn, mobile, age, gender, date_of_birth')
      .or(`full_name.ilike.%${safe}%,mrn.ilike.%${safe}%,mobile.ilike.%${safe}%`)
      .order('created_at', { ascending: false })
      .limit(8)
    setResults(data || [])
    setLoading(false)
  }, [])

  function handleInputChange(val: string) {
    setQuery(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (val.trim().length < 2) {
      setResults([])
      setShowDropdown(true) // Show recent patients
      return
    }
    setLoading(true)
    searchTimer.current = setTimeout(() => doSearch(val), 250)
    setShowDropdown(true)
  }

  function handleSelect(patient: PatientSuggestion) {
    setQuery('')
    setResults([])
    setShowDropdown(false)
    onSelect(patient)
  }

  function handleFocus() {
    setShowDropdown(true)
  }

  // If patient is already selected, show selected state
  if (selectedPatient) {
    return (
      <div className={`flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 ${className}`}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-blue-700">{selectedPatient.full_name.charAt(0)}</span>
          </div>
          <div>
            <div className="font-semibold text-gray-900 text-sm">{selectedPatient.full_name}</div>
            <div className="text-xs text-gray-500">
              {selectedPatient.mrn} · {selectedPatient.age ? `${selectedPatient.age}y` : ''} · {selectedPatient.mobile}
            </div>
          </div>
        </div>
        {onClear && (
          <button onClick={onClear} className="text-gray-400 hover:text-red-500 transition-colors p-1">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    )
  }

  const displayItems = query.trim().length >= 2 ? results : recentPatients
  const isShowingRecent = query.trim().length < 2

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        {loading
          ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500 animate-spin" />
          : <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        }
        <input
          ref={inputRef}
          className="input pl-9 pr-8"
          placeholder={placeholder}
          value={query}
          onChange={e => handleInputChange(e.target.value)}
          onFocus={handleFocus}
          autoFocus={autoFocus}
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus() }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && (displayItems.length > 0 || loadingRecent) && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden max-h-[300px] overflow-y-auto">
          {/* Section label */}
          {isShowingRecent && (
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                <Clock className="w-3 h-3" /> Recent Patients
              </p>
            </div>
          )}

          {loadingRecent && isShowingRecent ? (
            <div className="px-3 py-4 text-center text-xs text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin mx-auto mb-1" />
              Loading...
            </div>
          ) : displayItems.length === 0 && !isShowingRecent ? (
            <div className="px-3 py-4 text-center text-xs text-gray-400">
              No patients found for "{query}"
            </div>
          ) : (
            displayItems.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelect(p)}
                className={`w-full text-left px-3 py-2.5 hover:bg-blue-50 flex items-center gap-3 transition-colors
                  ${i > 0 ? 'border-t border-gray-50' : ''}`}
              >
                <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <User className="w-3.5 h-3.5 text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800 truncate">{p.full_name}</div>
                  <div className="text-xs text-gray-400 truncate">
                    {p.mrn} · {p.age ? `${p.age}y` : ''}{p.gender ? ` · ${p.gender}` : ''} · {p.mobile}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
