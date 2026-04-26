'use client'
import { useCallback, useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { getHospitalSettings } from '@/lib/utils'
import { whatsAppUrl } from '@/lib/whatsapp-templates'
import {
  MessageCircle, RefreshCw, CheckCircle, Clock, AlertTriangle,
  Baby, Calendar, Pill, IndianRupee, Syringe, Loader2,
  Filter, BellRing, Send, ChevronDown, ChevronUp,
} from 'lucide-react'

// ── Types (mirrors the API response) ─────────────────────────
type ReminderType =
  | 'appointment' | 'follow_up' | 'anc' | 'post_delivery'
  | 'vaccination' | 'pending_bill' | 'high_risk_anc'

type Priority = 'urgent' | 'today' | 'tomorrow' | 'upcoming'

interface ReminderItem {
  id:            string
  type:          ReminderType
  priority:      Priority
  patientId:     string
  patientName:   string
  mobile:        string
  mrn:           string
  sourceId:      string
  sourceTable:   string
  title:         string
  subtitle:      string
  dueDate?:      string
  reminderSentAt?: string | null
  context: {
    lmp?:          string
    edd?:          string
    deliveryDate?: string
    babyName?:     string
    apptDate?:     string
    apptTime?:     string
    apptType?:     string
    followUpDate?: string
    diagnosis?:    string
    labTests?:     string
    billAmount?:   number
    vaxName?:      string
    daysOverdue?:  number
    weeksGA?:      string
    riskReasons?:  string[]
  }
}

// ── Priority config ───────────────────────────────────────────
const PRIORITY: Record<Priority, { label: string; bg: string; text: string; border: string; dot: string }> = {
  urgent:   { label: 'Urgent',   bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200',    dot: 'bg-red-500'    },
  today:    { label: 'Today',    bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-500' },
  tomorrow: { label: 'Tomorrow', bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200',  dot: 'bg-amber-400'  },
  upcoming: { label: 'Upcoming', bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   dot: 'bg-blue-400'   },
}

// ── Type config ───────────────────────────────────────────────
const TYPE_CONFIG: Record<ReminderType, { icon: any; color: string; label: string }> = {
  appointment:    { icon: Calendar,      color: 'text-blue-600',   label: 'Appointment'         },
  follow_up:      { icon: Clock,         color: 'text-orange-600', label: 'Follow-up'           },
  anc:            { icon: Baby,          color: 'text-pink-600',   label: 'ANC Visit'           },
  high_risk_anc:  { icon: AlertTriangle, color: 'text-red-600',    label: 'High-Risk ANC'       },
  post_delivery:  { icon: Baby,          color: 'text-purple-600', label: 'Post-Delivery'       },
  vaccination:    { icon: Syringe,       color: 'text-green-600',  label: 'Vaccination'         },
  pending_bill:   { icon: IndianRupee,   color: 'text-yellow-600', label: 'Pending Payment'     },
}

const FILTER_TABS: { key: ReminderType | 'all'; label: string; emoji: string }[] = [
  { key: 'all',           label: 'All',            emoji: '📋' },
  { key: 'appointment',   label: 'Appointments',   emoji: '📅' },
  { key: 'follow_up',     label: 'Follow-ups',     emoji: '🔁' },
  { key: 'anc',           label: 'ANC',            emoji: '🤰' },
  { key: 'high_risk_anc', label: 'High-Risk ANC',  emoji: '🚨' },
  { key: 'post_delivery', label: 'Post-Delivery',  emoji: '👶' },
  { key: 'vaccination',   label: 'Vaccination',    emoji: '💉' },
  { key: 'pending_bill',  label: 'Pending Bills',  emoji: '💳' },
]

// ── WhatsApp message builders (client-side, uses hospital settings) ─
function buildWAMessage(r: ReminderItem, hs: any): string {
  const h = hs.hospitalName || 'NexMedicon Hospital'
  const a = hs.address      || ''
  const p = hs.phone        || ''
  const c = r.context

  function fmtDate(d?: string): string {
    if (!d) return '—'
    try {
      return new Date(d).toLocaleDateString('en-IN', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    } catch { return d }
  }

  switch (r.type) {

    case 'appointment':
      return `*${h}*\n\nNamaste ${r.patientName} ji 🙏\n\nThis is a reminder for your *upcoming appointment*.\n\n📅 *Date:* ${fmtDate(c.apptDate)}\n🕐 *Time:* ${c.apptTime || '—'}\n🏥 *Visit Type:* ${c.apptType || 'Consultation'}\n📍 *Address:* ${a}\n\nPlease bring any previous reports and arrive 10 minutes early.\n\nFor queries: ${p}\n\n---\nઆપની ડૉક્ટર સાથેની મુલાકાત છે. સમય પર આવો.\n\n_${h} — Caring for you_`

    case 'follow_up':
      return `*${h}*\n\nNamaste ${r.patientName} ji 🙏\n\n${c.daysOverdue ? `Your follow-up appointment was *due ${c.daysOverdue} days ago*. Please visit at the earliest. ⚠️` : `This is a reminder for your *follow-up visit* due on ${fmtDate(c.followUpDate)}.`}\n\n${c.diagnosis ? `🩺 *For:* ${c.diagnosis}\n` : ''}📍 *Address:* ${a}\n\nPlease bring:\n✅ Previous prescription\n✅ Any new reports\n\nFor queries: ${p}\n\n---\nઆપની ફૉલો-અપ મુલાકાત ${c.daysOverdue ? 'ઓવરડ્યૂ' : 'છે'}. અગાઉ prescription સાથે આવો.\n\n_${h} — Caring for you_`

    case 'anc':
      return `*${h}*\n\nNamaste ${r.patientName} ji 🙏\n\nThis is a reminder for your *ANC (Antenatal) check-up*.\n\n🤰 *Current GA:* ${c.weeksGA || '—'}\n${c.edd ? `📅 *Expected Delivery:* ${fmtDate(c.edd)}\n` : ''}🏥 *Hospital:* ${h}\n📍 *Address:* ${a}\n\nPlease bring:\n✅ Previous reports & USG\n✅ ANC card\n✅ Urine sample (morning)\n\nFor queries: ${p}\n\n---\nANC તપાસ માટે રિપોર્ટ્સ અને ANC કાર્ડ સાથે આવો.\n\n_${h} — Caring for you & your baby_ 👶`

    case 'high_risk_anc':
      return `*${h}*\n\n🚨 *URGENT* — Namaste ${r.patientName} ji 🙏\n\nYour doctor has flagged *important concerns* that need immediate attention.\n\n⚠️ *Concerns noted:*\n${(c.riskReasons || []).map(r => `• ${r}`).join('\n')}\n\n🤰 *Current GA:* ${c.weeksGA || '—'}\n${c.edd ? `📅 *Expected Delivery:* ${fmtDate(c.edd)}\n` : ''}\nPlease *visit immediately* or call us.\n\n☎️ *Emergency:* ${p}\n\n---\nડૉક્ટરે તમારી તબિયત અંગે ચિંતા નોંધી છે. તરત મળો.\n\n_${h} — Your health is our priority_`

    case 'post_delivery':
      return `*${h}*\n\nNamaste ${r.patientName} ji 🙏\n\nCongratulations on your delivery! 🎉\n\nThis is a reminder for your *6-week post-delivery review* due on ${fmtDate(c.followUpDate)}.\n\n✅ Recovery check\n✅ Wound/stitch examination\n✅ Blood pressure & weight\n✅ Breastfeeding guidance\n✅ Family planning counselling\n\nPlease bring:\n📋 Discharge summary\n📋 Baby's vaccination card\n\nFor queries: ${p}\n\n---\nડિલિવરી પછીની 6 અઠવાડિયાની તપાસ માટે આવો.\n\n_${h} — Caring for mother & baby_ 👶`

    case 'vaccination':
      return `*${h}*\n\nNamaste ${r.patientName} ji 🙏\n\nThis is a reminder for your baby's *vaccination*.\n\n💉 *Vaccine Due:* ${c.vaxName || 'As per schedule'}\n📅 *Due Date:* ${fmtDate(c.followUpDate)}\n🏥 *Hospital:* ${h}\n📍 *Address:* ${a}\n\nPlease bring:\n✅ Baby's vaccination card\n✅ Previous vaccination records\n\n⚠️ Do not skip vaccinations. They protect your baby from serious diseases.\n\nFor queries: ${p}\n\n---\nબાળકના રસીકરણ માટે vaccine card સાથે આવો.\n\n_${h} — Protecting your little one_ 💉`

    case 'pending_bill':
      return `*${h}*\n\nNamaste ${r.patientName} ji 🙏\n\nThis is a gentle reminder that your *payment of ₹${c.billAmount?.toLocaleString('en-IN') || '—'}* is pending.\n\nPlease visit the hospital billing counter or contact us to complete the payment.\n\n📍 *Address:* ${a}\n📞 *Contact:* ${p}\n\n---\nઆપની ₹${c.billAmount?.toLocaleString('en-IN') || '—'} ની ચૂકવણી બાકી છે.\n\n_${h}_`

    default:
      return `*${h}*\n\nNamaste ${r.patientName} ji 🙏\n\nThis is a reminder from ${h}. Please contact us for details.\n\n📞 ${p}\n\n_${h}_`
  }
}

// ── Main component ────────────────────────────────────────────
export default function RemindersPage() {
  const [reminders,    setReminders]    = useState<ReminderItem[]>([])
  const [loading,      setLoading]      = useState(true)
  const [refreshing,   setRefreshing]   = useState(false)
  const [filter,       setFilter]       = useState<ReminderType | 'all'>('all')
  const [sent,         setSent]         = useState<Set<string>>(new Set())
  const [expanded,     setExpanded]     = useState<string | null>(null)
  const [generatedAt,  setGeneratedAt]  = useState<string>('')
  const [sendingAll,   setSendingAll]   = useState(false)

  const hs = typeof window !== 'undefined' ? getHospitalSettings() : {} as any

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else         setRefreshing(true)
    try {
      const res  = await fetch('/api/reminders')
      if (!res.ok) {
        console.error('[Reminders] API returned', res.status, res.statusText)
      } else {
        const data = await res.json()
        setReminders(data.reminders || [])
        setGeneratedAt(data.generatedAt || '')
      }
    } catch (err) {
      console.error('[Reminders] fetch error:', err)
    }
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Mark a single reminder as sent in Supabase + local state
  async function markSent(r: ReminderItem) {
    setSent(prev => new Set(Array.from(prev).concat(r.id)))
    // Only tables with reminder_sent_at column need a PATCH
    if (['appointments', 'prescriptions', 'discharge_summaries'].includes(r.sourceTable)) {
      await fetch('/api/reminders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceTable: r.sourceTable, sourceId: r.sourceId }),
      })
    }
  }

  const filtered   = filter === 'all' ? reminders : reminders.filter(r => r.type === filter)
  const isSent     = (r: ReminderItem) => sent.has(r.id) || (r.reminderSentAt != null && r.type !== 'high_risk_anc')
  const pending    = filtered.filter(r => !isSent(r))
  const done       = filtered.filter(r => isSent(r))

  const counts = Object.fromEntries(
    FILTER_TABS.map(t => [
      t.key,
      t.key === 'all'
        ? reminders.length
        : reminders.filter(r => r.type === t.key).length,
    ])
  )
  const urgentCount = reminders.filter(r => r.priority === 'urgent' && !sent.has(r.id)).length

  return (
    <AppShell>
      <div className="p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <BellRing className="w-6 h-6 text-blue-600"/>
              WhatsApp Reminder Queue
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              All patients who need a reminder today — one tap to send.
              {generatedAt && (
                <span className="ml-2 text-xs text-gray-400">
                  Last refreshed: {new Date(generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-2 items-center">
            {urgentCount > 0 && (
              <span className="flex items-center gap-1.5 bg-red-100 text-red-700 text-xs font-bold px-3 py-1.5 rounded-full animate-pulse">
                <AlertTriangle className="w-3.5 h-3.5"/>
                {urgentCount} Urgent
              </span>
            )}
            <button onClick={() => load(true)} disabled={refreshing}
              className="btn-secondary flex items-center gap-2 text-xs disabled:opacity-60">
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}/>
              Refresh
            </button>
          </div>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total Due',      val: reminders.length,                                         bg: 'bg-blue-50',   text: 'text-blue-700'   },
            { label: 'Urgent',         val: reminders.filter(r => r.priority === 'urgent').length,     bg: 'bg-red-50',    text: 'text-red-700'    },
            { label: 'Sent Today',     val: sent.size,                                                 bg: 'bg-green-50',  text: 'text-green-700'  },
            { label: 'Still Pending',  val: reminders.filter(r => !sent.has(r.id)).length,             bg: 'bg-orange-50', text: 'text-orange-700' },
          ].map(({ label, val, bg, text }) => (
            <div key={label} className={`${bg} rounded-xl p-4 border border-opacity-50`}>
              <div className={`text-3xl font-bold ${text} mb-1`}>{val}</div>
              <div className="text-xs text-gray-500 font-semibold">{label}</div>
            </div>
          ))}
        </div>

        {/* Type filter tabs */}
        <div className="flex gap-2 flex-wrap mb-5 overflow-x-auto pb-1">
          {FILTER_TABS.map(({ key, label, emoji }) => {
            const count = counts[key] || 0
            return (
              <button key={key} onClick={() => setFilter(key)}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap transition-all
                  ${filter === key
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-700'}`}>
                <span>{emoji}</span>
                {label}
                {count > 0 && (
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                    filter === key ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
                  }`}>{count}</span>
                )}
              </button>
            )
          })}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin"/>
              <p className="text-sm text-gray-500">Loading reminders from all modules...</p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card p-16 text-center text-gray-400">
            <CheckCircle className="w-14 h-14 mx-auto mb-4 text-green-400"/>
            <p className="text-lg font-semibold text-gray-600 mb-2">All clear! 🎉</p>
            <p className="text-sm">No reminders due for the selected category. Check back tomorrow morning.</p>
          </div>
        ) : (
          <div className="space-y-4">

            {/* Pending reminders */}
            {pending.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-orange-500"/>
                    Pending ({pending.length})
                  </h2>
                  {pending.length > 1 && (
                    <p className="text-xs text-gray-400">Click a card to preview the message, then tap Send</p>
                  )}
                </div>
                <div className="space-y-3">
                  {pending.map(r => (
                    <ReminderCard
                      key={r.id}
                      reminder={r}
                      hs={hs}
                      isExpanded={expanded === r.id}
                      onToggle={() => setExpanded(prev => prev === r.id ? null : r.id)}
                      onSent={() => markSent(r)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Done reminders */}
            {done.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-gray-500 flex items-center gap-2 mb-3 mt-6">
                  <CheckCircle className="w-4 h-4 text-green-500"/>
                  Sent / Done ({done.length})
                </h2>
                <div className="space-y-2 opacity-60">
                  {done.map(r => (
                    <div key={r.id}
                      className="flex items-center gap-3 px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl">
                      <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0"/>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-gray-600">{r.patientName}</span>
                        <span className="mx-2 text-gray-300">·</span>
                        <span className="text-xs text-gray-400">{r.title}</span>
                      </div>
                      <span className="text-xs text-green-600 font-semibold">Sent ✓</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}

      </div>
    </AppShell>
  )
}

// ── Reminder Card Component ───────────────────────────────────
function ReminderCard({
  reminder: r, hs, isExpanded, onToggle, onSent,
}: {
  reminder:   ReminderItem
  hs:         any
  isExpanded: boolean
  onToggle:   () => void
  onSent:     () => void
}) {
  const [editing,   setEditing]   = useState(false)
  const [msgText,   setMsgText]   = useState('')

  // Build message on expand
  function handleToggle() {
    if (!isExpanded) {
      setMsgText(buildWAMessage(r, hs))
      setEditing(false)
    }
    onToggle()
  }

  const pCfg = PRIORITY[r.priority]
  const tCfg = TYPE_CONFIG[r.type]
  const Icon  = tCfg.icon

  const waUrl = whatsAppUrl(r.mobile, msgText || buildWAMessage(r, hs))

  return (
    <div className={`border-2 rounded-xl overflow-hidden transition-all ${pCfg.border} ${isExpanded ? pCfg.bg : 'bg-white hover:' + pCfg.bg}`}>

      {/* Card header — always visible */}
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={handleToggle}>

        {/* Priority dot */}
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${pCfg.dot}`}/>

        {/* Type icon */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${pCfg.bg}`}>
          <Icon className={`w-4 h-4 ${tCfg.color}`}/>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-bold text-sm text-gray-900 truncate">{r.patientName}</span>
            <span className="text-xs font-mono text-gray-400">{r.mrn}</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${pCfg.bg} ${pCfg.text} border ${pCfg.border}`}>
              {pCfg.label}
            </span>
          </div>
          <div className="text-xs text-gray-700 font-semibold">{r.title}</div>
          <div className="text-xs text-gray-400 truncate">{r.subtitle}</div>
        </div>

        {/* Mobile + expand toggle */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-xs font-mono text-gray-500 hidden sm:block">{r.mobile}</span>
          {isExpanded
            ? <ChevronUp className="w-4 h-4 text-gray-400"/>
            : <ChevronDown className="w-4 h-4 text-gray-400"/>}
        </div>
      </div>

      {/* Expanded section — message preview + send button */}
      {isExpanded && (
        <div className={`border-t ${pCfg.border} px-4 py-4`}>

          {/* Message preview / editor */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-600 uppercase tracking-wide">WhatsApp Message Preview</span>
              <button onClick={() => setEditing(e => !e)}
                className="text-xs text-blue-600 hover:underline">
                {editing ? 'Done editing' : 'Edit message'}
              </button>
            </div>
            {editing ? (
              <textarea
                className="w-full text-xs font-mono bg-white border border-gray-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                rows={10}
                value={msgText}
                onChange={e => setMsgText(e.target.value)}
              />
            ) : (
              <div className="bg-[#e9f5fe] border border-blue-100 rounded-xl px-4 py-3 text-xs text-gray-800 font-mono whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
                {msgText}
              </div>
            )}
          </div>

          {/* Mobile number */}
          <div className="flex items-center gap-2 mb-4 text-xs text-gray-500">
            <MessageCircle className="w-3.5 h-3.5 text-green-500"/>
            Sending to: <span className="font-mono font-semibold text-gray-700">+91 {r.mobile}</span>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onSent}
              className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold text-sm py-2.5 px-4 rounded-xl transition-colors shadow-sm shadow-green-200">
              <MessageCircle className="w-4 h-4"/>
              Open in WhatsApp &amp; Send
            </a>
            <button
              onClick={() => {
                navigator.clipboard.writeText(msgText)
                onSent()
              }}
              className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold py-2.5 px-4 rounded-xl transition-colors">
              <Send className="w-4 h-4"/>
              Copy &amp; Mark Sent
            </button>
          </div>

          <p className="text-xs text-gray-400 mt-2 text-center">
            Clicking either button marks this reminder as sent and removes it from the pending list.
          </p>
        </div>
      )}
    </div>
  )
}