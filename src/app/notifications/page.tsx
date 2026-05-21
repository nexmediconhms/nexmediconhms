'use client'
/**
 * src/app/notifications/page.tsx
 *
 * Full Notification Center — accessed via "View All" from the notification panel.
 *
 * Features:
 *  - All notifications (paginated, filterable by type)
 *  - Mark individual / all as read
 *  - Filter by type (lab, billing, discharge, appointment, system)
 *  - Click to navigate to relevant entity
 *  - Clear old notifications
 *  - Realtime updates
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { formatDateTime } from '@/lib/utils'
import {
  Bell, Check, CheckCheck, Trash2, Filter,
  FlaskConical, BedDouble, IndianRupee, Calendar,
  AlertTriangle, FileText, Shield, RefreshCw,
  Loader2, Inbox, Stethoscope, Users,
} from 'lucide-react'

interface Notification {
  id: string
  title: string
  message: string
  type: string
  severity: string
  source: string | null
  entity_type: string | null
  entity_id: string | null
  patient_id: string | null
  patient_name: string | null
  mrn: string | null
  is_read: boolean
  created_at: string
  metadata: any
}

const TYPE_CONFIG: Record<string, { icon: any; color: string; bg: string; label: string }> = {
  lab_report:   { icon: FlaskConical,  color: 'text-purple-600', bg: 'bg-purple-50',  label: 'Lab Report' },
  discharge:    { icon: BedDouble,     color: 'text-red-600',    bg: 'bg-red-50',     label: 'Discharge' },
  billing:      { icon: IndianRupee,   color: 'text-green-600',  bg: 'bg-green-50',   label: 'Billing' },
  appointment:  { icon: Calendar,      color: 'text-blue-600',   bg: 'bg-blue-50',    label: 'Appointment' },
  insurance:    { icon: Shield,        color: 'text-cyan-600',   bg: 'bg-cyan-50',    label: 'Insurance' },
  system:       { icon: AlertTriangle, color: 'text-amber-600',  bg: 'bg-amber-50',   label: 'System' },
  info:         { icon: Bell,          color: 'text-gray-600',   bg: 'bg-gray-50',    label: 'General' },
}

type FilterType = 'all' | 'lab_report' | 'discharge' | 'billing' | 'appointment' | 'insurance' | 'system' | 'info'

export default function NotificationsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterType>('all')
  const [showUnreadOnly, setShowUnreadOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const PAGE_SIZE = 50

  const fetchNotifications = useCallback(async (pageNum = 1, append = false) => {
    if (!user) return
    setLoading(true)
    try {
      let query = supabase
        .from('clinic_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .range((pageNum - 1) * PAGE_SIZE, pageNum * PAGE_SIZE - 1)

      // Filter by role visibility
      if (user.role !== 'admin') {
        query = query.contains('target_roles', [user.role])
      }

      // Type filter
      if (filter !== 'all') {
        query = query.eq('type', filter)
      }

      // Unread only
      if (showUnreadOnly) {
        query = query.eq('is_read', false)
      }

      const { data, error } = await query

      if (error) {
        console.error('[notifications] fetch error:', error.message)
        setNotifications(append ? notifications : [])
      } else {
        const items = (data || []) as Notification[]
        setNotifications(append ? [...notifications, ...items] : items)
        setHasMore(items.length === PAGE_SIZE)
      }
    } catch (err) {
      console.error('[notifications] error:', err)
    }
    setLoading(false)
  }, [user, filter, showUnreadOnly])

  useEffect(() => {
    setPage(1)
    fetchNotifications(1)
  }, [fetchNotifications])

  // Realtime updates
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel('notifications-page-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'clinic_notifications' }, () => {
        fetchNotifications(1)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user, fetchNotifications])

  async function markRead(id: string) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id], read_by: user?.full_name || user?.role }),
    })
  }

  async function markAllRead() {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mark_all: true, role: user?.role, read_by: user?.full_name }),
    })
  }

  async function deleteOldNotifications() {
    if (!confirm('Delete all notifications older than 30 days? This cannot be undone.')) return
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    await supabase
      .from('clinic_notifications')
      .delete()
      .lt('created_at', thirtyDaysAgo.toISOString())
      .eq('is_read', true)
    fetchNotifications(1)
  }

  function handleClick(notif: Notification) {
    if (!notif.is_read) markRead(notif.id)
    if (notif.patient_id) {
      router.push(`/patients/${notif.patient_id}`)
    } else if (notif.type === 'lab_report') {
      router.push('/labs')
    } else if (notif.type === 'billing') {
      router.push('/billing')
    } else if (notif.type === 'insurance') {
      router.push('/insurance')
    } else if (notif.type === 'appointment') {
      router.push('/appointments')
    } else if (notif.type === 'discharge') {
      router.push('/ipd')
    }
  }

  function loadMore() {
    const nextPage = page + 1
    setPage(nextPage)
    fetchNotifications(nextPage, true)
  }

  const unreadCount = notifications.filter(n => !n.is_read).length
  const filteredNotifications = notifications

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Bell className="w-6 h-6 text-blue-600" /> Notifications
            </h1>
            <p className="text-sm text-gray-500">
              {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up!'} · Showing {filteredNotifications.length} notifications
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => fetchNotifications(1)}
              className="btn-secondary flex items-center gap-1.5 text-xs">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
            {unreadCount > 0 && (
              <button onClick={markAllRead}
                className="btn-secondary flex items-center gap-1.5 text-xs">
                <CheckCheck className="w-3.5 h-3.5" /> Mark All Read
              </button>
            )}
            <button onClick={deleteOldNotifications}
              className="btn-secondary flex items-center gap-1.5 text-xs text-red-600 hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5" /> Clear Old
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-5 items-center">
          <Filter className="w-4 h-4 text-gray-400" />
          {([
            ['all', 'All'],
            ['lab_report', 'Lab'],
            ['billing', 'Billing'],
            ['appointment', 'Appointments'],
            ['discharge', 'Discharge'],
            ['insurance', 'Insurance'],
            ['system', 'System'],
            ['info', 'General'],
          ] as [FilterType, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-all ${
                filter === key
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {label}
            </button>
          ))}

          <span className="text-xs text-gray-300 mx-1">|</span>

          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={showUnreadOnly}
              onChange={e => setShowUnreadOnly(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-gray-300 accent-blue-600" />
            <span className="text-xs font-medium text-gray-600">Unread only</span>
          </label>
        </div>

        {/* Notification List */}
        {loading && filteredNotifications.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Inbox className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No notifications</p>
            <p className="text-sm mt-1">
              {filter !== 'all' ? 'Try changing the filter' : showUnreadOnly ? 'All notifications are read' : 'Nothing to show yet'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredNotifications.map(notif => {
              const config = TYPE_CONFIG[notif.type] || TYPE_CONFIG.info
              const Icon = config.icon
              const timeAgo = getTimeAgo(notif.created_at)

              return (
                <div
                  key={notif.id}
                  onClick={() => handleClick(notif)}
                  className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all hover:shadow-sm ${
                    notif.is_read
                      ? 'bg-white border-gray-100 opacity-70'
                      : `${config.bg} border-gray-200`
                  }`}
                >
                  {/* Icon */}
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    notif.is_read ? 'bg-gray-100' : config.bg
                  }`}>
                    <Icon className={`w-4.5 h-4.5 ${notif.is_read ? 'text-gray-400' : config.color}`} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className={`text-sm font-semibold truncate ${notif.is_read ? 'text-gray-600' : 'text-gray-900'}`}>
                        {notif.title}
                      </h3>
                      {!notif.is_read && (
                        <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />
                      )}
                      {notif.severity === 'high' && (
                        <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-bold flex-shrink-0">
                          HIGH
                        </span>
                      )}
                    </div>
                    <p className={`text-xs mt-0.5 line-clamp-2 ${notif.is_read ? 'text-gray-400' : 'text-gray-600'}`}>
                      {notif.message}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-[11px] text-gray-400">{timeAgo}</span>
                      {notif.patient_name && (
                        <span className="text-[11px] text-gray-400 flex items-center gap-1">
                          <Users className="w-3 h-3" /> {notif.patient_name}
                        </span>
                      )}
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${config.bg} ${config.color}`}>
                        {config.label}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex-shrink-0 flex items-center gap-1">
                    {!notif.is_read && (
                      <button
                        onClick={e => { e.stopPropagation(); markRead(notif.id) }}
                        className="p-1.5 rounded-lg hover:bg-white/80 text-gray-400 hover:text-green-600 transition-colors"
                        title="Mark as read"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Load More */}
            {hasMore && (
              <div className="text-center pt-4">
                <button onClick={loadMore}
                  disabled={loading}
                  className="btn-secondary text-xs px-6">
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Load More'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}

// ── Time ago helper ──────────────────────────────────────────
function getTimeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then

  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`

  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}
