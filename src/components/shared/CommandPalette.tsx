'use client'
/**
 * src/components/shared/CommandPalette.tsx
 * 
 * Global Command Palette (Ctrl+K or Cmd+K)
 * Reduces clicks across the entire application by providing:
 * 1. Quick navigation to any page
 * 2. Patient search
 * 3. Quick actions (new patient, new bill, etc.)
 * 4. Recent items
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  Search, Users, IndianRupee, Calendar, FileText,
  Stethoscope, BedDouble, BarChart2, Settings,
  ArrowRight, Clock, Zap, Command,
  Baby, Pill, FlaskConical, PiggyBank,
  Megaphone, TrendingUp, Shield,
} from 'lucide-react'

interface CommandItem {
  id: string
  label: string
  icon: any
  category: 'navigation' | 'action' | 'patient' | 'recent'
  href?: string
  action?: () => void
  shortcut?: string
  keywords?: string
}

export default function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [patients, setPatients] = useState<CommandItem[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // Navigation commands
  const commands: CommandItem[] = [
    // Quick actions
    { id: 'new-patient', label: 'New Patient Registration', icon: Users, category: 'action', href: '/patients/new', shortcut: 'Alt+N', keywords: 'register create add' },
    { id: 'new-bill', label: 'Create New Bill', icon: IndianRupee, category: 'action', href: '/billing/new', keywords: 'billing payment invoice' },
    { id: 'new-appointment', label: 'Book Appointment', icon: Calendar, category: 'action', href: '/appointments/new', keywords: 'schedule book slot' },
    { id: 'new-opd', label: 'Start OPD Consultation', icon: Stethoscope, category: 'action', href: '/opd/new', keywords: 'consultation encounter visit' },

    // Navigation
    { id: 'dashboard', label: 'Dashboard', icon: TrendingUp, category: 'navigation', href: '/dashboard', shortcut: 'Alt+D', keywords: 'home revenue' },
    { id: 'patients', label: 'Patient List', icon: Users, category: 'navigation', href: '/patients', keywords: 'list all records' },
    { id: 'queue', label: 'OPD Queue', icon: Clock, category: 'navigation', href: '/queue', keywords: 'waiting token' },
    { id: 'billing', label: 'Billing', icon: IndianRupee, category: 'navigation', href: '/billing', keywords: 'bills payments collection' },
    { id: 'appointments', label: 'Appointments', icon: Calendar, category: 'navigation', href: '/appointments', keywords: 'schedule calendar slots' },
    { id: 'opd', label: 'OPD Consultations', icon: Stethoscope, category: 'navigation', href: '/opd', keywords: 'encounters visits' },
    { id: 'beds', label: 'Bed Management', icon: BedDouble, category: 'navigation', href: '/beds', keywords: 'ward admission ipd' },
    { id: 'anc', label: 'ANC Registry', icon: Baby, category: 'navigation', href: '/anc', keywords: 'pregnancy antenatal' },
    { id: 'labs', label: 'Lab Results', icon: FlaskConical, category: 'navigation', href: '/labs', keywords: 'laboratory reports tests' },
    { id: 'pharmacy', label: 'Pharmacy', icon: Pill, category: 'navigation', href: '/pharmacy', keywords: 'medicines drugs prescriptions' },
    { id: 'fund', label: 'Hospital Fund', icon: PiggyBank, category: 'navigation', href: '/fund', keywords: 'expenses petty cash' },
    { id: 'analytics', label: 'Analytics', icon: BarChart2, category: 'navigation', href: '/analytics', keywords: 'reports charts trends' },
    { id: 'marketing', label: 'Marketing Tools', icon: Megaphone, category: 'navigation', href: '/marketing', keywords: 'qr whatsapp referral growth' },
    { id: 'settings', label: 'Settings', icon: Settings, category: 'navigation', href: '/settings', keywords: 'configuration preferences' },
    { id: 'audit', label: 'Audit Log', icon: Shield, category: 'navigation', href: '/audit-log', keywords: 'security activity log' },
  ]

  // Filter commands based on query
  const filtered = query.trim()
    ? [...commands, ...patients].filter(cmd => {
        const q = query.toLowerCase()
        return (
          cmd.label.toLowerCase().includes(q) ||
          cmd.keywords?.toLowerCase().includes(q) ||
          cmd.category.includes(q)
        )
      })
    : commands.filter(c => c.category === 'action')

  // Search patients when query changes
  useEffect(() => {
    if (!query.trim() || query.length < 2) { setPatients([]); return }

    const timeout = setTimeout(async () => {
      const { data } = await supabase
        .from('patients')
        .select('id, full_name, mrn, mobile')
        .or(`full_name.ilike.%${query}%,mrn.ilike.%${query}%,mobile.ilike.%${query}%`)
        .limit(5)

      if (data) {
        setPatients(data.map(p => ({
          id: `patient-${p.id}`,
          label: `${p.full_name} (${p.mrn})`,
          icon: Users,
          category: 'patient' as const,
          href: `/patients/${p.id}`,
          keywords: p.mobile || '',
        })))
      }
    }, 300)

    return () => clearTimeout(timeout)
  }, [query])

  // Keyboard shortcut to open
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
      setQuery('')
      setSelectedIdx(0)
    }
  }, [open])

  // Handle selection
  const handleSelect = useCallback((item: CommandItem) => {
    setOpen(false)
    if (item.href) router.push(item.href)
    if (item.action) item.action()
  }, [router])

  // Keyboard nav within palette
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[selectedIdx]) handleSelect(filtered[selectedIdx])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 md:bottom-4 md:right-20 z-40 flex items-center gap-2 bg-white border border-gray-200 shadow-lg rounded-xl px-3 py-2 text-xs text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-all no-print"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Quick Search</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 bg-gray-100 text-gray-400 rounded px-1.5 py-0.5 text-[10px] font-mono">
          <Command className="w-2.5 h-2.5" />K
        </kbd>
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />

      {/* Palette */}
      <div className="relative w-full max-w-lg mx-4 bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIdx(0) }}
            onKeyDown={handleKeyDown}
            placeholder="Search patients, pages, or actions..."
            className="flex-1 text-sm text-gray-900 placeholder-gray-400 outline-none"
          />
          <kbd className="text-[10px] text-gray-300 bg-gray-50 px-2 py-0.5 rounded font-mono">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto py-2">
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              No results found for &quot;{query}&quot;
            </div>
          )}

          {/* Group by category */}
          {['action', 'patient', 'navigation'].map(cat => {
            const items = filtered.filter(f => f.category === cat)
            if (items.length === 0) return null

            const catLabel = cat === 'action' ? 'Quick Actions' : cat === 'patient' ? 'Patients' : 'Navigation'

            return (
              <div key={cat}>
                <div className="px-4 py-1.5">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{catLabel}</span>
                </div>
                {items.map((item, i) => {
                  const globalIdx = filtered.indexOf(item)
                  const isSelected = globalIdx === selectedIdx
                  const Icon = item.icon

                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSelect(item)}
                      onMouseEnter={() => setSelectedIdx(globalIdx)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <Icon className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-blue-600' : 'text-gray-400'}`} />
                      <span className={`text-sm flex-1 ${isSelected ? 'text-blue-900 font-medium' : 'text-gray-700'}`}>
                        {item.label}
                      </span>
                      {item.shortcut && (
                        <kbd className="text-[10px] text-gray-300 bg-gray-50 px-1.5 py-0.5 rounded font-mono">
                          {item.shortcut}
                        </kbd>
                      )}
                      {isSelected && <ArrowRight className="w-3.5 h-3.5 text-blue-400" />}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-gray-100 flex items-center gap-4 text-[10px] text-gray-400">
          <span className="flex items-center gap-1"><kbd className="bg-gray-100 px-1 rounded">↑↓</kbd> Navigate</span>
          <span className="flex items-center gap-1"><kbd className="bg-gray-100 px-1 rounded">↵</kbd> Select</span>
          <span className="flex items-center gap-1"><kbd className="bg-gray-100 px-1 rounded">Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  )
}
