'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { formatDate, getHospitalSettings, getIndiaToday } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import {
    Scissors, Plus, X, Clock, CheckCircle, AlertTriangle,
    ChevronLeft, ChevronRight, Search, Calendar, ArrowLeft,
    Save, Loader2, Trash2, RefreshCw, MessageCircle,
    Baby, Sparkles,
} from 'lucide-react'

// ── Delivery-date suggestion interface ─────────────────────────
interface DeliverySuggestion {
    patient_id: string
    patient_name: string
    mrn: string
    mobile: string
    edd: string
    lmp: string
    days_until_delivery: number
    ga_weeks: number
}

interface OTSchedule {
    id: string
    patient_id: string
    patient_name: string
    mrn: string
    surgery_name: string
    surgery_date: string
    start_time: string
    end_time: string
    surgeon: string
    anesthetist: string | null
    ot_room: string
    status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'postponed'
    priority: 'elective' | 'urgent' | 'emergency'
    pre_op_notes: string | null
    post_op_notes: string | null
    anesthesia_type: string | null
    estimated_duration_min: number | null
    consent_taken: boolean
    blood_arranged: boolean
    fasting_confirmed: boolean
    created_at: string
}

const STATUS_STYLES: Record<string, string> = {
    scheduled: 'bg-blue-50 border-blue-200 text-blue-800',
    in_progress: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    completed: 'bg-green-50 border-green-200 text-green-700',
    cancelled: 'bg-gray-50 border-gray-200 text-gray-500',
    postponed: 'bg-orange-50 border-orange-200 text-orange-700',
}
const PRIORITY_STYLES: Record<string, string> = {
    elective: 'bg-gray-100 text-gray-600',
    urgent: 'bg-orange-100 text-orange-700',
    emergency: 'bg-red-100 text-red-700',
}
const SURGERIES = [
    'LSCS (Caesarean Section)', 'Normal Vaginal Delivery', 'D&C (Dilatation & Curettage)',
    'Hysterectomy (Abdominal)', 'Hysterectomy (Vaginal)', 'Laparoscopic Hysterectomy',
    'Ovarian Cystectomy', 'Laparoscopy (Diagnostic)', 'Laparoscopy (Operative)',
    'Tubal Ligation', 'Colposcopy + Biopsy', 'LEEP / LLETZ', 'Bartholin Cyst I&D',
    'Cervical Cerclage', 'MVA (Manual Vacuum Aspiration)', 'Episiotomy Repair',
    'Perineal Tear Repair', 'Hysteroscopy', 'Endometrial Biopsy', 'Other',
]
const TIME_SLOTS = Array.from({ length: 24 }, (_, h) => [':00', ':30'].map(m => `${String(h).padStart(2, '0')}${m}`)).flat().filter(t => t >= '07:00' && t <= '21:00')

export default function OTSchedulePage() {
    const { user } = useAuth()
    const hs = typeof window !== 'undefined' ? getHospitalSettings() : {} as any
    const [schedules, setSchedules] = useState<OTSchedule[]>([])
    const [loading, setLoading] = useState(true)
    const [date, setDate] = useState(getIndiaToday())
    const [view, setView] = useState<'list' | 'new'>('list')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [surgeonFilter, setSurgeonFilter] = useState('')
    const [patientQuery, setPatientQuery] = useState('')
    const [patientResults, setPatientResults] = useState<any[]>([])
    const [selPatient, setSelPatient] = useState<any>(null)
    const [form, setForm] = useState({
        surgery_name: SURGERIES[0], surgery_date: getIndiaToday(),
        start_time: '09:00', end_time: '10:00', surgeon: '', anesthetist: '',
        ot_room: 'OT-1', priority: 'elective' as 'elective' | 'urgent' | 'emergency',
        anesthesia_type: '', estimated_duration_min: '60', pre_op_notes: '',
        consent_taken: false, blood_arranged: false, fasting_confirmed: false,
    })
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const today = getIndiaToday()

    // ── Delivery-date auto-suggestions (Top 5 nearest EDD) ─────
    const [deliverySuggestions, setDeliverySuggestions] = useState<DeliverySuggestion[]>([])
    const [loadingSuggestions, setLoadingSuggestions] = useState(false)
    const [showSuggestions, setShowSuggestions] = useState(false)

    const loadDeliverySuggestions = useCallback(async () => {
        setLoadingSuggestions(true)
        try {
            // Fetch recent encounters with ob_data (LMP/EDD) from the last 10 months
            const tenMonthsAgo = new Date()
            tenMonthsAgo.setMonth(tenMonthsAgo.getMonth() - 10)
            const fromDate = tenMonthsAgo.toISOString().split('T')[0]

            const { data: encs } = await supabase
                .from('encounters')
                .select('patient_id, ob_data, patients!inner(id, full_name, mrn, mobile)')
                .not('ob_data', 'is', null)
                .gte('encounter_date', fromDate)
                .order('encounter_date', { ascending: false })
                .limit(500)

            if (!encs || encs.length === 0) {
                setDeliverySuggestions([])
                setLoadingSuggestions(false)
                return
            }

            // Keep only the latest encounter per patient
            const latestByPatient = new Map<string, any>()
            for (const enc of encs) {
                if (!latestByPatient.has(enc.patient_id)) {
                    latestByPatient.set(enc.patient_id, enc)
                }
            }

            const todayMs = new Date().getTime()
            const suggestions: DeliverySuggestion[] = []

            for (const enc of Array.from(latestByPatient.values())) {
                const ob = enc.ob_data as any
                const pat = enc.patients as any
                if (!ob?.lmp && !ob?.edd) continue
                if (!pat?.full_name) continue

                // Calculate EDD from LMP if not directly available
                let eddStr = ob.edd
                if (!eddStr && ob.lmp) {
                    const lmpDate = new Date(ob.lmp)
                    const eddDate = new Date(lmpDate.getTime() + 280 * 24 * 60 * 60 * 1000)
                    eddStr = eddDate.toISOString().split('T')[0]
                }
                if (!eddStr) continue

                const eddMs = new Date(eddStr).getTime()
                const daysUntil = Math.round((eddMs - todayMs) / (1000 * 60 * 60 * 24))

                // Only show patients whose delivery date is within -7 to +30 days (upcoming)
                if (daysUntil < -7 || daysUntil > 30) continue

                const lmpMs = ob.lmp ? new Date(ob.lmp).getTime() : eddMs - 280 * 24 * 60 * 60 * 1000
                const gaWeeks = Math.floor((todayMs - lmpMs) / (7 * 24 * 60 * 60 * 1000))

                suggestions.push({
                    patient_id: enc.patient_id,
                    patient_name: pat.full_name,
                    mrn: pat.mrn || '',
                    mobile: pat.mobile || '',
                    edd: eddStr,
                    lmp: ob.lmp || '',
                    days_until_delivery: daysUntil,
                    ga_weeks: gaWeeks,
                })
            }

            // Sort by nearest delivery date first, take top 5
            suggestions.sort((a, b) => a.days_until_delivery - b.days_until_delivery)
            setDeliverySuggestions(suggestions.slice(0, 5))
        } catch (err) {
            console.error('[OT] Error loading delivery suggestions:', err)
            setDeliverySuggestions([])
        }
        setLoadingSuggestions(false)
    }, [])

    useEffect(() => { loadDeliverySuggestions() }, [loadDeliverySuggestions])

    const loadSchedules = useCallback(async () => {
        setLoading(true)
        let q = supabase.from('ot_schedules').select('*').eq('surgery_date', date).order('start_time')
        if (surgeonFilter) q = q.ilike('surgeon', `%${surgeonFilter}%`)
        const { data } = await q
        setSchedules((data || []) as OTSchedule[])
        setLoading(false)
    }, [date, surgeonFilter])

    useEffect(() => { loadSchedules() }, [loadSchedules])
    useEffect(() => { if (hs.doctorName && !form.surgeon) setForm(p => ({ ...p, surgeon: hs.doctorName })) }, [hs.doctorName])

    // ✅ FIX: Auto-calculate end time from start_time + estimated_duration_min
    useEffect(() => {
        if (!form.start_time || !form.estimated_duration_min) return
        const durationMin = parseInt(form.estimated_duration_min) || 60
        const [hh, mm] = form.start_time.split(':').map(Number)
        const startMinutes = hh * 60 + mm
        const endMinutes = startMinutes + durationMin
        const endHH = Math.floor(endMinutes / 60) % 24
        const endMM = endMinutes % 60
        const endTime = `${String(endHH).padStart(2, '0')}:${endMM === 0 ? '00' : '30'}`
        // Only auto-update if end time would be different (avoid infinite loops)
        if (endTime !== form.end_time) {
            setForm(p => ({ ...p, end_time: endTime }))
        }
    }, [form.start_time, form.estimated_duration_min])

    useEffect(() => {
        if (typeof window === 'undefined') return
        const params = new URLSearchParams(window.location.search)
        const pid = params.get('patientId')
        const pname = params.get('patientName')
        const pmrn = params.get('mrn')
        if (pid && pname) {
            setSelPatient({ id: pid, full_name: decodeURIComponent(pname), mrn: pmrn || '', age: '', mobile: '' })
            if (params.get('view') === 'new') setView('new')
        }
    }, [])

    function searchPatients(q: string) {
        setPatientQuery(q); setSelPatient(null)
        if (q.trim().length < 2) { setPatientResults([]); return }
        if (searchTimer.current) clearTimeout(searchTimer.current)
        searchTimer.current = setTimeout(async () => {
            const { data } = await supabase.from('patients').select('id,full_name,mrn,age,mobile').or(`full_name.ilike.%${q}%,mrn.ilike.%${q}%`).limit(6)
            setPatientResults(data || [])
        }, 300)
    }

    async function handleBook() {
        if (!selPatient) { setError('Select a patient'); return }
        setSaving(true); setError('')
        const { data: conflicts } = await supabase.from('ot_schedules').select('id,patient_name,surgery_name,start_time,end_time')
            .eq('surgery_date', form.surgery_date).eq('ot_room', form.ot_room).neq('status', 'cancelled')
            .lt('start_time', form.end_time).gt('end_time', form.start_time)

        if (conflicts && conflicts.length > 0) {
            const c = conflicts[0]
            if (!confirm(`⚠️ Conflict: "${c.surgery_name}" for ${c.patient_name} (${c.start_time}-${c.end_time}). Book anyway?`)) { setSaving(false); return }
        }
        // Validate end time is after start time
        if (form.end_time <= form.start_time) {
            setError('End time must be after start time')
            setSaving(false)
            return
        }

        const { error: e } = await supabase.from('ot_schedules').insert({
            patient_id: selPatient.id, patient_name: selPatient.full_name, mrn: selPatient.mrn || '',
            surgery_name: form.surgery_name, surgery_date: form.surgery_date,
            start_time: form.start_time, end_time: form.end_time, surgeon: form.surgeon,
            anesthetist: form.anesthetist || null, ot_room: form.ot_room, priority: form.priority,
            anesthesia_type: form.anesthesia_type || null,
            estimated_duration_min: Number(form.estimated_duration_min) || null,
            pre_op_notes: form.pre_op_notes || null,
            consent_taken: form.consent_taken, blood_arranged: form.blood_arranged,
            fasting_confirmed: form.fasting_confirmed, status: 'scheduled', created_by: user?.full_name || null,
        })
        setSaving(false)
        if (e) { setError(e.message); return }
        resetForm(); setView('list'); setDate(form.surgery_date); loadSchedules()
    }

    async function completeWithNotes(s: OTSchedule) {
        const notes = prompt('Post-Op Notes (findings, complications, outcome):')
        if (notes === null) return
        await supabase.from('ot_schedules').update({ status: 'completed', post_op_notes: notes || null, updated_at: new Date().toISOString() }).eq('id', s.id)
        await supabase.from('encounters').insert({
            patient_id: s.patient_id, encounter_type: 'Surgery', encounter_date: s.surgery_date,
            diagnosis: s.surgery_name, chief_complaint: `Surgery: ${s.surgery_name}`,
            notes: `Surgeon: ${s.surgeon}${s.anesthetist ? ` | Anesthetist: ${s.anesthetist}` : ''}${notes ? `
Post-Op: ${notes}` : ''}`,
            doctor_name: s.surgeon,
        })
        loadSchedules()
    }

    async function updateStatus(id: string, status: string) {
        await supabase.from('ot_schedules').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
        loadSchedules()
    }

    function resetForm() {
        setSelPatient(null); setPatientQuery(''); setPatientResults([])
        setForm({ surgery_name: SURGERIES[0], surgery_date: today, start_time: '09:00', end_time: '10:00', surgeon: hs.doctorName || '', anesthetist: '', ot_room: 'OT-1', priority: 'elective', anesthesia_type: '', estimated_duration_min: '60', pre_op_notes: '', consent_taken: false, blood_arranged: false, fasting_confirmed: false })
    }

    function changeDate(n: number) { const d = new Date(date); d.setDate(d.getDate() + n); const newDate = d.toISOString().split('T')[0]; if (newDate >= today) setDate(newDate) }
    const activeCount = schedules.filter(s => s.status === 'scheduled' || s.status === 'in_progress').length

    // ═══ NEW BOOKING ═══
    if (view === 'new') {
        return (
            <AppShell>
                <div className="p-6 max-w-3xl mx-auto">
                    <div className="flex items-center gap-3 mb-5">
                        <button onClick={() => { resetForm(); setView('list') }} className="text-gray-400 hover:text-gray-700"><ArrowLeft className="w-5 h-5" /></button>
                        <h1 className="text-xl font-bold text-gray-900">Schedule Surgery</h1>
                    </div>
                    {error && <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />{error}</div>}
                    <div className="card p-5 mb-4">
                        <h2 className="section-title">Patient</h2>
                        {selPatient ? (
                            <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                                <div><div className="font-semibold">{selPatient.full_name}</div><div className="text-xs text-gray-500">{selPatient.mrn}</div></div>
                                <button onClick={() => { setSelPatient(null); setPatientQuery('') }}><X className="w-4 h-4 text-gray-400 hover:text-red-500" /></button>
                            </div>
                        ) : (
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input className="input pl-9" placeholder="Search patient…" value={patientQuery} onChange={e => searchPatients(e.target.value)} autoFocus />
                                {patientResults.length > 0 && (
                                    <div className="absolute top-full left-0 right-0 z-20 bg-white border rounded-lg shadow-lg mt-1">
                                        {patientResults.map(p => (
                                            <button key={p.id} onClick={() => { setSelPatient(p); setPatientResults([]) }} className="w-full text-left px-4 py-2.5 hover:bg-blue-50 text-sm border-b last:border-0">
                                                <span className="font-semibold">{p.full_name}</span><span className="text-gray-400 ml-2 text-xs">{p.mrn}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        {/* ── Delivery Date Auto-Suggestions (Top 5 nearest) ──── */}
                        {!selPatient && deliverySuggestions.length > 0 && (
                            <div className="mt-3">
                                <button onClick={() => setShowSuggestions(s => !s)} className="flex items-center gap-2 text-xs font-semibold text-pink-700 bg-pink-50 border border-pink-200 rounded-lg px-3 py-2 hover:bg-pink-100 transition-colors w-full justify-between">
                                    <span className="flex items-center gap-1.5"><Baby className="w-3.5 h-3.5" /><Sparkles className="w-3 h-3" /> Delivery Due Soon — {deliverySuggestions.length} patient{deliverySuggestions.length > 1 ? 's' : ''}</span>
                                    <span className="text-pink-400">{showSuggestions ? '▲' : '▼'}</span>
                                </button>
                                {showSuggestions && (
                                    <div className="mt-2 border border-pink-100 rounded-lg overflow-hidden bg-white shadow-sm">
                                        {deliverySuggestions.map(s => (
                                            <button key={s.patient_id} onClick={() => {
                                                setSelPatient({ id: s.patient_id, full_name: s.patient_name, mrn: s.mrn, mobile: s.mobile })
                                                setPatientResults([])
                                                setShowSuggestions(false)
                                                // Auto-set surgery to LSCS if near/past EDD
                                                if (s.days_until_delivery <= 3) {
                                                    setForm(p => ({ ...p, surgery_name: 'LSCS (Caesarean Section)', priority: 'urgent' }))
                                                }
                                            }} className="w-full text-left px-4 py-3 hover:bg-pink-50 text-sm border-b last:border-0 flex items-center justify-between gap-2">
                                                <div>
                                                    <span className="font-semibold text-gray-900">{s.patient_name}</span>
                                                    <span className="text-gray-400 ml-2 text-xs">{s.mrn}</span>
                                                    <div className="text-xs text-gray-500 mt-0.5">GA: {s.ga_weeks}w · EDD: {formatDate(s.edd)}</div>
                                                </div>
                                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                                    s.days_until_delivery <= 0 ? 'bg-red-100 text-red-700' :
                                                    s.days_until_delivery <= 3 ? 'bg-orange-100 text-orange-700' :
                                                    s.days_until_delivery <= 7 ? 'bg-yellow-100 text-yellow-700' :
                                                    'bg-blue-100 text-blue-600'
                                                }`}>
                                                    {s.days_until_delivery <= 0 ? `${Math.abs(s.days_until_delivery)}d overdue` : `${s.days_until_delivery}d away`}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="card p-5 mb-4">
                        <h2 className="section-title">Surgery Details</h2>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="col-span-2"><label className="label">Surgery *</label><select className="input" value={form.surgery_name} onChange={e => setForm(p => ({ ...p, surgery_name: e.target.value }))}>{SURGERIES.map(s => <option key={s}>{s}</option>)}</select></div>
                            <div><label className="label">Date *</label><input className="input" type="date" min={today} value={form.surgery_date} onChange={e => setForm(p => ({ ...p, surgery_date: e.target.value }))} /></div>
                            <div><label className="label">Priority</label><select className="input" value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value as any }))}><option value="elective">Elective</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></select></div>
                            <div><label className="label">Start *</label><select className="input" value={form.start_time} onChange={e => setForm(p => ({ ...p, start_time: e.target.value }))}>{TIME_SLOTS.map(t => <option key={t}>{t}</option>)}</select></div>
                            <div><label className="label">Duration (min)</label><input className="input" type="number" min="15" step="15" value={form.estimated_duration_min} onChange={e => setForm(p => ({ ...p, estimated_duration_min: e.target.value }))} placeholder="60" /></div>
                            <div><label className="label">End (auto)</label><input className="input bg-gray-50 text-gray-600" value={form.end_time} readOnly title="Auto-calculated from start time + duration" /></div>
                            <div><label className="label">Surgeon *</label><input className="input" value={form.surgeon} onChange={e => setForm(p => ({ ...p, surgeon: e.target.value }))} /></div>
                            <div><label className="label">Anesthetist</label><input className="input" value={form.anesthetist} onChange={e => setForm(p => ({ ...p, anesthetist: e.target.value }))} /></div>
                            <div><label className="label">OT Room</label><select className="input" value={form.ot_room} onChange={e => setForm(p => ({ ...p, ot_room: e.target.value }))}><option>OT-1</option><option>OT-2</option><option>Minor OT</option></select></div>
                            <div><label className="label">Anesthesia</label><select className="input" value={form.anesthesia_type} onChange={e => setForm(p => ({ ...p, anesthesia_type: e.target.value }))}><option value="">Select</option><option>General</option><option>Spinal</option><option>Epidural</option><option>Local</option><option>IV Sedation</option></select></div>
                        </div>
                    </div>
                    <div className="card p-5 mb-4">
                        <h2 className="section-title">Pre-Op Checklist</h2>
                        <div className="space-y-3">
                            {[{ key: 'consent_taken', label: 'Consent obtained' }, { key: 'fasting_confirmed', label: 'Patient fasting (NPO)' }, { key: 'blood_arranged', label: 'Blood arranged' }].map(({ key, label }) => (
                                <label key={key} className="flex items-center gap-3 cursor-pointer"><input type="checkbox" className="w-4 h-4 rounded accent-blue-600" checked={(form as any)[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.checked }))} /><span className="text-sm">{label}</span></label>
                            ))}
                        </div>
                        <div className="mt-4"><label className="label">Pre-Op Notes</label><textarea className="input resize-none" rows={2} value={form.pre_op_notes} onChange={e => setForm(p => ({ ...p, pre_op_notes: e.target.value }))} /></div>
                    </div>
                    <div className="flex justify-between">
                        <button onClick={() => { resetForm(); setView('list') }} className="btn-secondary">Cancel</button>
                        <button onClick={handleBook} disabled={saving || !selPatient} className="btn-primary flex items-center gap-2 disabled:opacity-60">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}{saving ? 'Scheduling…' : 'Schedule Surgery'}</button>
                    </div>
                </div>
            </AppShell>
        )
    }

    // ═══ LIST VIEW ═══
    return (
        <AppShell>
            <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Scissors className="w-6 h-6 text-purple-600" /> OT Schedule</h1>
                        <p className="text-sm text-gray-500">{activeCount} scheduled for {formatDate(date)}</p>
                    </div>
                    <div className="flex gap-2">
                        <Link href="/ot-schedule/week" className="btn-secondary text-xs flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Week</Link>
                        <button onClick={() => { resetForm(); setView('new') }} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" /> Schedule</button>
                    </div>
                </div>
                <div className="card p-3 mb-4 flex items-center gap-3">
                    <button onClick={() => changeDate(-1)} disabled={date <= today} className="p-2 border rounded-lg hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"><ChevronLeft className="w-4 h-4" /></button>
                    <input type="date" className="input w-48 text-center font-semibold" min={today} value={date} onChange={e => {
                        const val = e.target.value
                        if (val >= today) setDate(val)
                    }} />
                    <button onClick={() => changeDate(1)} className="p-2 border rounded-lg hover:bg-gray-50"><ChevronRight className="w-4 h-4" /></button>
                    {date !== today && <button onClick={() => setDate(today)} className="text-xs text-blue-600 font-medium">Today</button>}
                    <button onClick={loadSchedules} className="p-2 border rounded-lg hover:bg-gray-50"><RefreshCw className="w-4 h-4" /></button>
                    {date < today && <span className="text-xs text-red-500 font-medium">Cannot view past dates</span>}
                </div>
                <div className="flex items-center gap-3 mb-4">
                    <label className="text-xs font-semibold text-gray-500">Surgeon:</label>
                    <input className="input w-48 text-sm py-1.5" placeholder="All" value={surgeonFilter} onChange={e => setSurgeonFilter(e.target.value)} />
                    {surgeonFilter && <button onClick={() => setSurgeonFilter('')}><X className="w-3.5 h-3.5 text-gray-400" /></button>}
                </div>
                {/* ── Delivery Date Suggestions Banner (List View) ──── */}
                {deliverySuggestions.length > 0 && (
                    <div className="mb-4 bg-gradient-to-r from-pink-50 to-purple-50 border border-pink-200 rounded-xl p-4">
                        <h3 className="text-sm font-bold text-pink-800 flex items-center gap-2 mb-2">
                            <Baby className="w-4 h-4" /> Patients with Delivery Due Soon
                            <span className="text-xs font-normal text-pink-500">(Top 5 — nearest first)</span>
                        </h3>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                            {deliverySuggestions.map(s => (
                                <button key={s.patient_id} onClick={() => {
                                    setSelPatient({ id: s.patient_id, full_name: s.patient_name, mrn: s.mrn, mobile: s.mobile })
                                    setForm(p => ({ ...p, surgery_name: s.days_until_delivery <= 3 ? 'LSCS (Caesarean Section)' : p.surgery_name, priority: s.days_until_delivery <= 0 ? 'emergency' : s.days_until_delivery <= 3 ? 'urgent' : 'elective' }))
                                    setView('new')
                                }} className="flex-shrink-0 bg-white border border-pink-100 rounded-lg px-3 py-2 hover:border-pink-300 hover:shadow-sm transition-all text-left min-w-[160px]">
                                    <div className="text-xs font-semibold text-gray-900 truncate">{s.patient_name}</div>
                                    <div className="text-xs text-gray-500">{s.mrn} · GA {s.ga_weeks}w</div>
                                    <div className={`text-xs font-bold mt-1 ${
                                        s.days_until_delivery <= 0 ? 'text-red-600' :
                                        s.days_until_delivery <= 3 ? 'text-orange-600' :
                                        s.days_until_delivery <= 7 ? 'text-yellow-700' :
                                        'text-blue-600'
                                    }`}>
                                        EDD: {formatDate(s.edd)} ({s.days_until_delivery <= 0 ? `${Math.abs(s.days_until_delivery)}d overdue` : `${s.days_until_delivery}d`})
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {loading ? <div className="text-center py-12 text-gray-400">Loading…</div> : schedules.length === 0 ? (
                    <div className="card p-12 text-center text-gray-400">
                        <Scissors className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="font-medium">No surgeries for {formatDate(date)}</p>
                        <button onClick={() => { resetForm(); setView('new') }} className="btn-primary inline-flex items-center gap-2 text-xs mt-3"><Plus className="w-3.5 h-3.5" /> Schedule</button>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {schedules.map(s => (
                            <div key={s.id} className={`card p-4 border ${STATUS_STYLES[s.status]}`}>
                                <div className="flex items-start gap-4">
                                    <div className="text-center min-w-[60px]">
                                        <div className="text-lg font-bold text-gray-800">{s.start_time}</div>
                                        <div className="text-xs text-gray-400">to {s.end_time}</div>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap mb-1">
                                            <span className="font-semibold text-gray-900">{s.surgery_name}</span>
                                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_STYLES[s.priority]}`}>{s.priority}</span>
                                            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{s.ot_room}</span>
                                        </div>
                                        <div className="text-sm text-gray-600"><span className="font-medium">{s.patient_name}</span><span className="text-gray-400 ml-2">{s.mrn}</span></div>
                                        <div className="text-xs text-gray-500 mt-1">Surgeon: {s.surgeon}{s.anesthetist && ` · ${s.anesthetist}`}{s.anesthesia_type && ` · ${s.anesthesia_type}`}</div>
                                        {s.status === 'completed' && s.post_op_notes && (
                                            <div className="mt-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-800"><span className="font-semibold">Post-Op: </span>{s.post_op_notes}</div>
                                        )}
                                        <div className="flex gap-3 mt-2">
                                            <span className={`text-xs flex items-center gap-1 ${s.consent_taken ? 'text-green-600' : 'text-red-500'}`}>{s.consent_taken ? <CheckCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />} Consent</span>
                                            <span className={`text-xs flex items-center gap-1 ${s.fasting_confirmed ? 'text-green-600' : 'text-red-500'}`}>{s.fasting_confirmed ? <CheckCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />} Fasting</span>
                                            <span className={`text-xs flex items-center gap-1 ${s.blood_arranged ? 'text-green-600' : 'text-gray-400'}`}>{s.blood_arranged ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />} Blood</span>
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-1 flex-shrink-0">
                                        {s.status === 'scheduled' && (
                                            <>
                                                <button onClick={() => updateStatus(s.id, 'in_progress')} className="text-xs bg-yellow-50 text-yellow-700 hover:bg-yellow-100 px-2 py-1 rounded font-medium">Start</button>
                                                <button onClick={() => updateStatus(s.id, 'postponed')} className="text-xs bg-orange-50 text-orange-700 hover:bg-orange-100 px-2 py-1 rounded font-medium">Postpone</button>
                                                <a href={`https://wa.me/?text=${encodeURIComponent(`*Pre-Surgery*
${s.patient_name}
Surgery: ${s.surgery_name}
Date: ${formatDate(s.surgery_date)} at ${s.start_time}

✓ No food/drink after 10 PM
✓ Bring reports + ID
✓ Arrive 1hr early

${hs.hospitalName || 'Hospital'}`)}`} target="_blank" rel="noopener noreferrer" className="text-xs text-green-600 hover:underline px-2 py-1 flex items-center gap-1"><MessageCircle className="w-3 h-3" />Pre-Op</a>
                                            </>
                                        )}
                                        {s.status === 'in_progress' && <button onClick={() => completeWithNotes(s)} className="text-xs bg-green-50 text-green-700 hover:bg-green-100 px-2 py-1 rounded font-medium">Complete</button>}
                                        {(s.status === 'scheduled' || s.status === 'postponed') && <button onClick={() => updateStatus(s.id, 'cancelled')} className="text-xs text-red-400 hover:text-red-600 px-2 py-1">Cancel</button>}
                                        <Link href={`/patients/${s.patient_id}`} className="text-xs text-blue-600 hover:underline px-2 py-1">Patient</Link>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </AppShell>
    )
}