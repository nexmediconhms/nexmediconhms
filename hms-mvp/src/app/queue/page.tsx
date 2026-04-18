'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, ageFromDOB } from '@/lib/utils'
import {
  Users, ChevronRight, CheckCircle, Clock,
  UserPlus, Stethoscope, RefreshCw, Search
} from 'lucide-react'

interface QueueItem {
  token:           string
  encounterId:     string
  patientId:       string
  patientName:     string
  mrn:             string
  age:             number | null
  gender:          string
  chief_complaint: string
  hasPrescription: boolean
  status:          'waiting' | 'in_progress' | 'done'
  time:            string
}

const STATUS_CFG = {
  waiting:     { label:'Waiting',     bg:'bg-yellow-50', border:'border-yellow-200', badge:'bg-yellow-100 text-yellow-700', dot:'bg-yellow-400' },
  in_progress: { label:'In Progress', bg:'bg-blue-50',   border:'border-blue-200',   badge:'bg-blue-100 text-blue-700',    dot:'bg-blue-500 animate-pulse' },
  done:        { label:'Done',        bg:'bg-green-50',  border:'border-green-200',  badge:'bg-green-100 text-green-700',  dot:'bg-green-500' },
}

export default function QueuePage() {
  const [queue,   setQueue]   = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [date,    setDate]    = useState(new Date().toISOString().split('T')[0])

  // Manual status overrides — persisted to sessionStorage per day
  // Using a ref so the load() closure always reads the latest value
  const overridesRef = useRef<Record<string, QueueItem['status']>>({})
  const [, forceRender] = useState(0) // trigger re-renders when overrides change

  // Load overrides from sessionStorage when date changes
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(`queue_overrides_${date}`)
      overridesRef.current = saved ? JSON.parse(saved) : {}
    } catch {
      overridesRef.current = {}
    }
    load()
  }, [date])

  // Auto-refresh every 30s
  useEffect(() => {
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [date])

  async function load() {
    setLoading(true)

    // Step 1: encounters for the selected date
    const { data: encs } = await supabase
      .from('encounters')
      .select('id, patient_id, created_at, chief_complaint, encounter_date, patients(full_name, mrn, age, gender, date_of_birth)')
      .eq('encounter_date', date)
      .order('created_at', { ascending: true })

    // Step 2: prescriptions for those encounters
    const encIds = (encs || []).map((e: any) => e.id)
    const { data: rxs } = encIds.length > 0
      ? await supabase.from('prescriptions').select('encounter_id').in('encounter_id', encIds)
      : { data: [] }

    const rxSet = new Set((rxs || []).map((r: any) => r.encounter_id))

    const items: QueueItem[] = (encs || []).map((e: any, idx: number) => {
      const pat = e.patients || {}
      const hasPrescription = rxSet.has(e.id)

      // Auto-derived status: override wins, then derive from prescription/position
      const derived: QueueItem['status'] =
        hasPrescription ? 'done' :
        idx === (encs || []).findIndex((x: any) => !rxSet.has(x.id)) ? 'in_progress' :
        'waiting'

      return {
        token:           `T-${String(idx + 1).padStart(3, '0')}`,
        encounterId:     e.id,
        patientId:       e.patient_id,
        patientName:     pat.full_name || '—',
        mrn:             pat.mrn || '—',
        age:             ageFromDOB(pat.date_of_birth) ?? pat.age ?? null,
        gender:          pat.gender || '—',
        chief_complaint: e.chief_complaint || 'General consultation',
        hasPrescription,
        status:          overridesRef.current[e.id] || derived,
        time:            new Date(e.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      }
    })

    setQueue(items)
    setLoading(false)
  }

  function setManualStatus(encId: string, status: QueueItem['status']) {
    overridesRef.current = { ...overridesRef.current, [encId]: status }
    try {
      sessionStorage.setItem(`queue_overrides_${date}`, JSON.stringify(overridesRef.current))
    } catch {}
    setQueue(prev => prev.map(q => q.encounterId === encId ? { ...q, status } : q))
    forceRender(n => n + 1)
  }

  const filtered = !search
    ? queue
    : queue.filter(q => {
        const s = search.toLowerCase()
        return q.patientName.toLowerCase().includes(s) || q.mrn.toLowerCase().includes(s) || q.token.includes(s)
      })

  const waiting    = queue.filter(q => q.status === 'waiting').length
  const inProgress = queue.filter(q => q.status === 'in_progress').length
  const done       = queue.filter(q => q.status === 'done').length

  return (
    <AppShell>
      <div className="p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Clock className="w-6 h-6 text-blue-600"/> OPD Queue
            </h1>
            <p className="text-sm text-gray-500">Today's consultation queue — auto-refreshes every 30 seconds</p>
          </div>
          <div className="flex gap-3">
            <input type="date" className="input text-sm py-2 px-3 w-40"
              value={date} onChange={e => setDate(e.target.value)}/>
            <button onClick={load} disabled={loading}
              className="btn-secondary flex items-center gap-2 text-xs disabled:opacity-60">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}/> Refresh
            </button>
            <Link href="/opd" className="btn-primary flex items-center gap-2 text-xs">
              <UserPlus className="w-3.5 h-3.5"/> Add to Queue
            </Link>
          </div>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-4 gap-4 mb-5">
          {[
            { label: 'Total Today', value: queue.length, cls: 'bg-blue-50 text-blue-700'     },
            { label: 'Waiting',     value: waiting,      cls: 'bg-yellow-50 text-yellow-700'  },
            { label: 'In Progress', value: inProgress,   cls: 'bg-blue-50 text-blue-700'     },
            { label: 'Completed',   value: done,         cls: 'bg-green-50 text-green-700'   },
          ].map(({ label, value, cls }) => (
            <div key={label} className={`card p-4 text-center ${cls.split(' ')[0]}`}>
              <div className={`text-3xl font-bold ${cls.split(' ')[1]}`}>{value}</div>
              <div className="text-xs font-semibold text-gray-600 mt-1">{label}</div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="card p-4 mb-5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
            <input className="input pl-9 bg-gray-50" placeholder="Search by name, MRN or token..."
              value={search} onChange={e => setSearch(e.target.value)}/>
          </div>
        </div>

        {/* Queue list */}
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400 card p-8">
            <Clock className="w-12 h-12 mx-auto mb-3 opacity-20"/>
            <p className="font-medium text-gray-500 mb-1">
              {queue.length === 0 ? 'No patients in queue for this date' : 'No results match your search'}
            </p>
            {queue.length === 0 && (
              <p className="text-sm text-gray-400 mb-4">Patients appear here when an OPD consultation is started.</p>
            )}
            <Link href="/opd" className="btn-primary inline-flex items-center gap-2 text-xs">
              <Stethoscope className="w-3.5 h-3.5"/> Start Consultation
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(q => {
              const cfg = STATUS_CFG[q.status]
              return (
                <div key={q.encounterId}
                  className={`card p-4 border ${cfg.border} ${cfg.bg} transition-all`}>
                  <div className="flex items-center gap-4">

                    {/* Token + time */}
                    <div className="text-center w-14 flex-shrink-0">
                      <div className="text-lg font-black text-gray-800 leading-none">{q.token}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{q.time}</div>
                    </div>

                    {/* Status dot */}
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${cfg.dot}`}/>

                    {/* Patient info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900">{q.patientName}</span>
                        <span className="text-xs text-gray-400">{q.mrn}</span>
                        {q.age && <span className="text-xs text-gray-400">{q.age}y · {q.gender}</span>}
                      </div>
                      <div className="text-sm text-gray-500 mt-0.5 truncate">{q.chief_complaint}</div>
                    </div>

                    {/* Status badge + actions */}
                    <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${cfg.badge}`}>
                        {cfg.label}
                      </span>

                      {/* Manual status override buttons */}
                      {q.status !== 'in_progress' && (
                        <button onClick={() => setManualStatus(q.encounterId, 'in_progress')}
                          className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-200 px-2 py-1 rounded-lg font-medium transition-colors">
                          ▶ Start
                        </button>
                      )}
                      {q.status !== 'done' && (
                        <button onClick={() => setManualStatus(q.encounterId, 'done')}
                          className="text-xs bg-green-100 text-green-700 hover:bg-green-200 px-2 py-1 rounded-lg font-medium transition-colors">
                          ✓ Done
                        </button>
                      )}
                      {q.status !== 'waiting' && (
                        <button onClick={() => setManualStatus(q.encounterId, 'waiting')}
                          className="text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 px-2 py-1 rounded-lg font-medium transition-colors">
                          ↺ Reset
                        </button>
                      )}

                      {/* Navigate */}
                      <Link href={`/opd/${q.encounterId}`}
                        className="btn-primary text-xs flex items-center gap-1.5 py-1.5">
                        <Stethoscope className="w-3 h-3"/>
                        {q.status === 'done' ? 'View' : q.status === 'in_progress' ? 'Continue' : 'Open'}
                      </Link>

                      {q.hasPrescription && (
                        <Link href={`/opd/${q.encounterId}/prescription`}
                          className="btn-secondary text-xs flex items-center gap-1.5 py-1.5">
                          <CheckCircle className="w-3 h-3 text-green-600"/>
                          Rx
                        </Link>
                      )}

                      <Link href={`/patients/${q.patientId}`}
                        className="text-gray-400 hover:text-blue-600 transition-colors p-1">
                        <ChevronRight className="w-4 h-4"/>
                      </Link>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AppShell>
  )
}
