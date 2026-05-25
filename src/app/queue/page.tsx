
'use client'
/**
 * src/app/queue/page.tsx  (UPDATED — B. OPD Queue → Supabase Realtime)
 *
 * Changes from original:
 *  - Replaces any polling with Supabase Realtime channel subscription
 *  - Live token status updates — no refresh needed
 *  - Audit log on status changes
 *  - Token auto-increment per day
 *
 * SETUP: In Supabase Dashboard → Database → Replication
 *        Toggle opd_queue table ON for Realtime.
 */
import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { audit } from '@/lib/audit'
import { escapeLike, formatDateTime, getIndiaToday } from '@/lib/utils'
import { handleVisitCompletion } from '@/lib/services/appointmentService'
import {
  Users, Plus, X, Clock, CheckCircle, Play, Stethoscope,
  AlertTriangle, Loader2, RefreshCw, Zap,
} from 'lucide-react'

type QueueStatus = 'waiting' | 'vitals_done' | 'in_progress' | 'done' | 'cancelled'
type Priority = 'normal' | 'urgent' | 'emergency'

interface QueueEntry {
  id: string
  patient_id: string
  encounter_id: string | null
  queue_date: string
  token_number: number
  status: QueueStatus
  priority: Priority
  notes: string
  called_at: string | null
  done_at: string | null
  created_at: string
  updated_at: string
  // joined:
  patient_name: string
  mrn: string
}

const STATUS_LABELS: Record<QueueStatus, string> = {
  waiting: 'Waiting',
  vitals_done: 'Vitals Done',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Cancelled',
}

const PRIORITY_STYLES: Record<Priority, string> = {
  normal: 'bg-gray-100 text-gray-600',
  urgent: 'bg-orange-100 text-orange-700',
  emergency: 'bg-red-100 text-red-700',
}

const STATUS_STYLES: Record<QueueStatus, string> = {
  waiting: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  vitals_done: 'bg-purple-50 border-purple-200 text-purple-800',
  in_progress: 'bg-blue-50 border-blue-200 text-blue-800',
  done: 'bg-green-50 border-green-200 text-green-700',
  cancelled: 'bg-gray-50 border-gray-200 text-gray-500',
}

function QueueContent() {
  const searchParams = useSearchParams()
  const [queue, setQueue] = useState<QueueEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [realtimeOk, setRealtimeOk] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [error, setError] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)

  // Add to queue form state
  const [addPatientId, setAddPatientId] = useState(searchParams.get('patient') ?? '')
  const [addName, setAddName] = useState(searchParams.get('patientName') ? decodeURIComponent(searchParams.get('patientName')!) : '')
  const [addMrn, setAddMrn] = useState(searchParams.get('mrn') ? decodeURIComponent(searchParams.get('mrn')!) : '')
  const [addPriority, setAddPriority] = useState<Priority>('normal')
  const [addNotes, setAddNotes] = useState('')
  const [addEncounter, setAddEncounter] = useState(searchParams.get('encounter') ?? '')
  const [addingEntry, setAddingEntry] = useState(false)

  // ── Patient live search — uses 'mobile' (correct column name in patients table) ──
  const [patientSearch, setPatientSearch] = useState(
    searchParams.get('patientName') ? decodeURIComponent(searchParams.get('patientName')!) : ''
  )
  const [patientResults, setPatientResults] = useState<{ id: string; full_name: string; mrn: string; mobile: string }[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  // Auto-open modal when arriving from patient profile page (?patient=ID&patientName=NAME)
  const [autoOpened, setAutoOpened] = useState(false)
  useEffect(() => {
    if (!autoOpened && searchParams.get('patient') && searchParams.get('patientName')) {
      setShowAddModal(true)
      setAutoOpened(true)
    }
  }, [searchParams, autoOpened])

  // Debounced search — queries full_name, mrn, mobile (NOT phone — column is 'mobile')
  useEffect(() => {
    if (patientSearch.trim().length < 2) { setPatientResults([]); return }
    const t = setTimeout(async () => {
      setSearchLoading(true)
      const q = patientSearch.trim()
      const safe = escapeLike(q)
      const { data, error } = await supabase
        .from('patients')
        .select('id, full_name, mrn, mobile')
        .or(`full_name.ilike.%${safe}%,mrn.ilike.%${safe}%,mobile.ilike.%${safe}%`).limit(6)
        .limit(8)
      if (!error) setPatientResults(data ?? [])
      setSearchLoading(false)
    }, 300)
    return () => clearTimeout(t)
  }, [patientSearch])

  function selectPatient(p: { id: string; full_name: string; mrn: string; mobile: string }) {
    setAddPatientId(p.id)
    setAddName(p.full_name)
    setAddMrn(p.mrn)
    setPatientSearch(p.full_name)
    setPatientResults([])
  }

  function resetModal() {
    setAddPatientId(''); setAddName(''); setAddMrn('')
    setAddNotes(''); setAddPriority('normal')
    setPatientSearch(''); setPatientResults([])
  }

  const today = getIndiaToday()
  const [queueDate, setQueueDate] = useState(today)  // ← Date filter state
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // ── Load queue for selected date ──────────────────────────
  async function load() {
    setLoading(true)
    try {
      const { data, error: e } = await supabase
        .from('opd_queue')
        .select(`
          id, queue_date, token_number, status, priority,
          notes, called_at, done_at, created_at, updated_at,
          patient_id, encounter_id,
          patients!inner ( full_name, mrn )
        `)
        .eq('queue_date', queueDate)
        .order('token_number', { ascending: true })

      if (e) throw e

      const mapped: QueueEntry[] = (data || []).map((r: any) => ({
        id: r.id,
        patient_id: r.patient_id,
        encounter_id: r.encounter_id,
        queue_date: r.queue_date,
        token_number: r.token_number,
        status: r.status,
        priority: r.priority,
        notes: r.notes ?? '',
        called_at: r.called_at,
        done_at: r.done_at,
        created_at: r.created_at,
        updated_at: r.updated_at,
        patient_name: r.patients.full_name,
        mrn: r.patients.mrn,
      }))

      setQueue(mapped)
      setLastUpdate(new Date())
    } catch (e: any) {
      setError(`Load failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  // ── Supabase Realtime subscription ───────────────────────
  useEffect(() => {
    load()

    const channel = supabase
      .channel('opd_queue_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'opd_queue' },
        (payload) => {
          setLastUpdate(new Date())
          // Full reload on any change — keeps it simple & correct
          load()
        }
      )
      .subscribe((status) => {
        setRealtimeOk(status === 'SUBSCRIBED')
      })

    channelRef.current = channel

    return () => {
      channel.unsubscribe()
      channelRef.current = null
    }
  }, [queueDate])

  // ── Status update ─────────────────────────────────────────
  async function updateStatus(entry: QueueEntry, newStatus: QueueStatus) {
    const patch: any = { status: newStatus, updated_at: new Date().toISOString() }
    if (newStatus === 'in_progress') patch.called_at = new Date().toISOString()
    if (newStatus === 'done') patch.done_at = new Date().toISOString()

    const { error: e } = await supabase
      .from('opd_queue').update(patch).eq('id', entry.id)
    if (e) { setError(e.message); return }

    await audit('update', 'encounter', entry.id,
      `Queue token #${entry.token_number} — ${entry.patient_name} → ${newStatus}`)
    // Gap 7: when manually marking a token Done, mirror the visit-completion logic
    // (close follow-ups + cancel active follow-up appointments).
    // Guard: only run if an encounter exists for this patient today, so reception
    // marking 'Done' before the doctor has saved an encounter does NOT cancel
    // future-scheduled follow-ups.
    if (newStatus === 'done') {
      try {
        const today = entry.queue_date
        const { data: enc } = await supabase
          .from('encounters')
          .select('id')
          .eq('patient_id', entry.patient_id)
          .eq('encounter_date', today)
          .limit(1)
          .maybeSingle()
        if (enc?.id) {
          await handleVisitCompletion(entry.patient_id, enc.id)
        }
      } catch (err) {
        console.warn('[Queue] visit completion on Done failed (non-fatal):', err)
      }
    }
    // Realtime will trigger reload
  }

  // ── Next token number ─────────────────────────────────────
  async function nextTokenNumber(): Promise<number> {
    const { data } = await supabase
      .from('opd_queue')
      .select('token_number')
      .eq('queue_date', queueDate)
      .order('token_number', { ascending: false })
      .limit(1)
    return ((data?.[0]?.token_number ?? 0) as number) + 1
  }

  // ── Remind patient (WhatsApp message) ─────────────────────
  async function handleRemindPatient(entry: QueueEntry) {
    // Get patient mobile number
    const { data: patient } = await supabase
      .from('patients')
      .select('mobile')
      .eq('id', entry.patient_id)
      .single()

    const mobile = patient?.mobile?.replace(/\D/g, '')
    if (!mobile) {
      setError(`No mobile number found for ${entry.patient_name}. Cannot send reminder.`)
      return
    }

    // Calculate position in queue
    const waitingBefore = queue.filter(q =>
      q.status === 'waiting' && q.token_number < entry.token_number
    ).length

    const message = encodeURIComponent(
      `Hi ${entry.patient_name}, your turn is approaching. ` +
      `You are #${entry.token_number} in the OPD queue` +
      (waitingBefore > 0 ? ` (${waitingBefore} patient${waitingBefore > 1 ? 's' : ''} ahead)` : ' (you are next!)') +
      `. Please be ready near the consultation room. Thank you.`
    )

    // Open WhatsApp with pre-filled message
    const whatsappUrl = `https://wa.me/91${mobile}?text=${message}`
    window.open(whatsappUrl, '_blank')

    await audit('update', 'encounter', entry.id,
      `Reminder sent to ${entry.patient_name} (Token #${entry.token_number}) via WhatsApp`)
  }

  // ── Remove from queue with confirmation ───────────────────
  const [showRemoveConfirm, setShowRemoveConfirm] = useState<QueueEntry | null>(null)
  const [removeReason, setRemoveReason] = useState('')

  async function handleRemoveFromQueue(entry: QueueEntry) {
    setShowRemoveConfirm(entry)
    setRemoveReason('')
  }

  async function confirmRemoveFromQueue() {
    if (!showRemoveConfirm) return

    const reason = removeReason || 'No reason provided'
    const patch: any = {
      status: 'cancelled',
      updated_at: new Date().toISOString(),
      notes: showRemoveConfirm.notes
        ? `${showRemoveConfirm.notes} | REMOVED: ${reason}`
        : `REMOVED: ${reason}`
    }

    const { error: e } = await supabase
      .from('opd_queue').update(patch).eq('id', showRemoveConfirm.id)

    if (e) { setError(e.message); setShowRemoveConfirm(null); return }

    await audit('delete', 'encounter', showRemoveConfirm.id,
      `Queue token #${showRemoveConfirm.token_number} — ${showRemoveConfirm.patient_name} REMOVED. Reason: ${reason}`)

    setShowRemoveConfirm(null)
    setRemoveReason('')
  }

  // ── Add to queue ──────────────────────────────────────────
  async function handleAddToQueue() {
    if (!addPatientId) { setError('Select a patient.'); return }
    setAddingEntry(true); setError('')

    try {
      const token = await nextTokenNumber()
      const { data, error: e } = await supabase
        .from('opd_queue')
        .insert({
          patient_id: addPatientId,
          encounter_id: addEncounter || null,
          queue_date: queueDate,
          token_number: token,
          status: 'waiting',
          priority: addPriority,
          notes: addNotes.trim(),
        })
        .select().single()

      if (e) throw e
      await audit('create', 'encounter', data?.id,
        `Queue token #${token} — ${addName || addPatientId}`)

      setShowAddModal(false)
      resetModal()
    } catch (e: any) {
      setError(`Failed to add: ${e.message}`)
    } finally {
      setAddingEntry(false)
    }
  }

  // ── Stats ──────────────────────────────────────────────────
  const waiting = queue.filter(q => q.status === 'waiting').length
  const vitalsDone = queue.filter(q => q.status === 'vitals_done').length
  const inProgress = queue.filter(q => q.status === 'in_progress').length
  const done = queue.filter(q => q.status === 'done').length

  // ── Render ────────────────────────────────────────────────
  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-600" /> OPD Queue
              <span className={`ml-2 flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border ${realtimeOk ? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>
                {realtimeOk
                  ? <><Zap className="w-3 h-3" /> Live</>
                  : <><RefreshCw className="w-3 h-3" /> Connecting…</>}
              </span>
            </h1>
            <p className="text-sm text-gray-500">
              {queueDate === today ? 'Today' : queueDate} — {new Date(queueDate + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long' })}
              {lastUpdate && <span className="ml-2 text-xs text-gray-400">· Updated {lastUpdate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Date Filter */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const d = new Date(queueDate)
                  d.setDate(d.getDate() - 1)
                  setQueueDate(d.toISOString().slice(0, 10))
                }}
                className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 text-xs">
                ←
              </button>
              <input
                type="date"
                value={queueDate}
                onChange={e => setQueueDate(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              />
              <button
                onClick={() => {
                  const d = new Date(queueDate)
                  d.setDate(d.getDate() + 1)
                  setQueueDate(d.toISOString().slice(0, 10))
                }}
                className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 text-xs">
                →
              </button>
              {queueDate !== today && (
                <button
                  onClick={() => setQueueDate(today)}
                  className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-lg hover:bg-blue-200 font-medium">
                  Today
                </button>
              )}
            </div>
            <button onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg">
              <Plus className="w-4 h-4" /> Add to Queue
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Waiting', count: waiting, color: 'text-yellow-700 bg-yellow-50 border-yellow-200' },
            { label: 'Vitals Done', count: vitalsDone, color: 'text-purple-700 bg-purple-50 border-purple-200' },
            { label: 'In Progress', count: inProgress, color: 'text-blue-700 bg-blue-50 border-blue-200' },
            { label: 'Done', count: done, color: 'text-green-700 bg-green-50 border-green-200' },
          ].map(s => (
            <div key={s.label} className={`border rounded-xl p-3 text-center ${s.color}`}>
              <div className="text-2xl font-bold">{s.count}</div>
              <div className="text-xs font-medium mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Estimated wait time indicator */}
        {waiting > 0 && (
          <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-500" />
              <span className="text-sm text-blue-700">
                <strong>Estimated wait:</strong>{' '}
                {(() => {
                  const AVG_CONSULT_MIN = 10 // avg consultation time in minutes
                  const totalWait = waiting * AVG_CONSULT_MIN
                  return totalWait < 60
                    ? `~${totalWait} min`
                    : `~${Math.floor(totalWait / 60)}h ${totalWait % 60}min`
                })()}
                {' '}for last patient in queue
              </span>
            </div>
            <span className="text-xs text-blue-500 bg-blue-100 px-2 py-0.5 rounded-full">(~10 min/consult avg)</span>
          </div>
        )}

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error}
            <button onClick={() => setError('')} className="ml-auto"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Queue list */}
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading queue…
          </div>
        ) : queue.length === 0 ? (
          <div className="text-center py-16 text-gray-400 border-2 border-dashed border-gray-100 rounded-xl">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Queue is empty</p>
            <p className="text-sm mt-1">Add patients to start the day</p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Active first */}
            {['in_progress', 'vitals_done', 'waiting', 'done', 'cancelled'].map(statusGroup =>
              queue.filter(q => q.status === statusGroup).map(entry => (
                <div key={entry.id}
                  className={`border rounded-xl px-4 py-3 ${STATUS_STYLES[entry.status]} transition-colors`}>
                  <div className="flex items-center gap-4">
                    {/* Token */}
                    <div className="text-2xl font-bold tabular-nums w-10 text-center flex-shrink-0">
                      {String(entry.token_number).padStart(2, '0')}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900">{entry.patient_name}</span>
                        <span className="text-xs text-gray-500 bg-white/70 px-1.5 py-0.5 rounded">MRN {entry.mrn}</span>
                        {entry.priority !== 'normal' && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PRIORITY_STYLES[entry.priority]}`}>
                            {entry.priority.charAt(0).toUpperCase() + entry.priority.slice(1)}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                        <Clock className="w-3 h-3" />
                        Added {formatDateTime(entry.created_at)}
                        {entry.called_at && <span>· Called {formatDateTime(entry.called_at)}</span>}
                        {entry.status === 'waiting' && (() => {
                          const ahead = queue.filter(q =>
                            (q.status === 'waiting' || q.status === 'vitals_done') && q.token_number < entry.token_number
                          ).length
                          const waitMin = ahead * 10 // avg 10 min/consult
                          return ahead > 0
                            ? <span className="text-blue-600 font-medium">· ~{waitMin} min wait ({ahead} ahead)</span>
                            : <span className="text-green-600 font-medium">· Next up!</span>
                        })()}
                        {entry.notes && <span className="ml-1">· {entry.notes}</span>}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 flex-shrink-0">
                      {entry.status === 'waiting' && (
                        <>
                          <Link
                            href={`/opd/new?patient=${entry.patient_id}&tab=vitals`}
                            onClick={() => updateStatus(entry, 'vitals_done')}
                            className="flex items-center gap-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-xs font-medium px-2.5 py-1.5 rounded-lg">
                            <Stethoscope className="w-3 h-3" /> Vitals
                          </Link>
                          <Link
                            href={`/opd/new?patient=${entry.patient_id}`}
                            onClick={() => updateStatus(entry, 'in_progress')}
                            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg"
                            title="Start OPD consultation">
                            <Play className="w-3 h-3" /> Start OPD
                          </Link>
                          <button onClick={() => handleRemindPatient(entry)}
                            className="flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-xs font-medium px-2.5 py-1.5 rounded-lg"
                            title="Send reminder to patient">
                            <Clock className="w-3 h-3" /> Remind
                          </button>
                          <button onClick={() => handleRemoveFromQueue(entry)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                            title="Remove from queue">
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      {entry.status === 'vitals_done' && (
                        <>
                          <Link
                            href={`/opd/new?patient=${entry.patient_id}`}
                            onClick={() => updateStatus(entry, 'in_progress')}
                            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg">
                            <Play className="w-3 h-3" /> Start OPD
                          </Link>
                          <button onClick={() => handleRemindPatient(entry)}
                            className="flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-xs font-medium px-2.5 py-1.5 rounded-lg">
                            <Clock className="w-3 h-3" /> Remind
                          </button>
                          <button onClick={() => handleRemoveFromQueue(entry)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      {entry.status === 'in_progress' && (
                        <>
                        <button onClick={() => updateStatus(entry, 'done')}
                          className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg">
                          <CheckCircle className="w-3 h-3" /> Done
                        </button>
                        <Link
                          href={`/billing?patientId=${entry.patient_id}&patientName=${encodeURIComponent(entry.patient_name || '')}&mrn=${entry.mrn || ''}&encounterType=OPD&view=new`}
                          onClick={() => updateStatus(entry, 'done')}
                          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg"
                        >
                          <CheckCircle className="w-3 h-3" /> Done + Bill
                        </Link>
                        </>
                      )}
                      {entry.patient_id && (
                        <Link href={`/patients/${entry.patient_id}`}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg text-xs">
                          View
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Remove Confirmation Modal ── */}
      {showRemoveConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Remove from Queue?</h3>
                <p className="text-xs text-gray-500">
                  #{String(showRemoveConfirm.token_number).padStart(2, '0')} — {showRemoveConfirm.patient_name}
                </p>
              </div>
            </div>

            <div className="mb-4">
              <label className="label">Reason for removal</label>
              <select
                className="input mb-2"
                value={removeReason}
                onChange={e => setRemoveReason(e.target.value)}
              >
                <option value="">Select reason...</option>
                <option value="Patient did not show up">Patient did not show up (No-show)</option>
                <option value="Patient left before turn">Patient left before turn</option>
                <option value="Duplicate entry">Duplicate entry</option>
                <option value="Appointment rescheduled">Appointment rescheduled</option>
                <option value="Patient request">Patient requested removal</option>
                <option value="Other">Other</option>
              </select>
              {removeReason === 'Other' && (
                <input
                  className="input"
                  placeholder="Specify reason..."
                  onChange={e => setRemoveReason(e.target.value)}
                />
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={confirmRemoveFromQueue}
                disabled={!removeReason}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <X className="w-4 h-4" /> Remove
              </button>
              <button
                onClick={() => { setShowRemoveConfirm(null); setRemoveReason('') }}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add to Queue modal ── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Add to Queue</h3>
              <button onClick={() => { setShowAddModal(false); resetModal() }} className="text-gray-400 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              {/* Patient search — queries full_name, mrn, mobile */}
              <div>
                <label className="label">Search Patient</label>
                <div className="relative">
                  <input
                    className="input pr-8"
                    value={patientSearch}
                    onChange={e => {
                      setPatientSearch(e.target.value)
                      // Clear selection if user changes the text
                      if (addPatientId && e.target.value !== addName) {
                        setAddPatientId(''); setAddName(''); setAddMrn('')
                      }
                    }}
                    placeholder="Search by name, MRN, or mobile…"
                    autoFocus
                  />
                  {searchLoading && (
                    <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
                  )}
                </div>

                {/* Live dropdown results */}
                {patientResults.length > 0 && !addPatientId && (
                  <div className="border border-gray-200 rounded-lg shadow-md mt-1 bg-white overflow-hidden">
                    {patientResults.map(p => (
                      <button key={p.id} type="button"
                        onClick={() => selectPatient(p)}
                        className="w-full text-left px-4 py-2.5 hover:bg-blue-50 text-sm flex items-center gap-3 border-b last:border-0 transition-colors">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-blue-700 font-bold text-xs">{p.full_name.charAt(0).toUpperCase()}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-gray-900 truncate">{p.full_name}</div>
                          <div className="text-xs text-gray-400">
                            MRN: {p.mrn}{p.mobile ? ` · ${p.mobile}` : ''}
                          </div>
                        </div>
                        <CheckCircle className="w-4 h-4 text-blue-300 flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )}

                {/* No results message */}
                {patientSearch.trim().length >= 2 && !searchLoading && patientResults.length === 0 && !addPatientId && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-1">
                    No patients found for "{patientSearch}". Check spelling or try MRN / mobile number.
                  </p>
                )}

                {/* Search hint */}
                {patientSearch.trim().length < 2 && !addPatientId && (
                  <p className="text-xs text-gray-400 mt-1">
                    Type at least 2 characters — searches name, MRN and mobile number.
                  </p>
                )}

                {/* Selected patient confirmation */}
                {addPatientId && addName && (
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    <CheckCircle className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                    <span className="flex-1 truncate"><strong>{addName}</strong>{addMrn ? ` · MRN: ${addMrn}` : ''}</span>
                    <button type="button"
                      className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                      onClick={() => { setAddPatientId(''); setAddName(''); setAddMrn(''); setPatientSearch('') }}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="label">Priority</label>
                <select className="input" value={addPriority} onChange={e => setAddPriority(e.target.value as Priority)}>
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent</option>
                  <option value="emergency">Emergency</option>
                </select>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <input className="input" value={addNotes} onChange={e => setAddNotes(e.target.value)}
                  placeholder="e.g. Follow-up, fasting, wheelchair" />
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={handleAddToQueue} disabled={addingEntry || !addPatientId}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg disabled:opacity-50">
                {addingEntry ? 'Adding…' : 'Add to Queue'}
              </button>
              <button onClick={() => { setShowAddModal(false); resetModal() }} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}

// Bug #9 fix: Suspense wrapper so useSearchParams() doesn't cause hydration warning
export default function QueuePage() {
  return (
    <Suspense fallback={
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </AppShell>
    }>
      <QueueContent />
    </Suspense>
  )
}